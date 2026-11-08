#!/usr/bin/env node
/**
 * 部署前把 D1 绑定「自愈」好，让一键部署真正做到自动建库 + 自动建表。
 *
 * 为什么需要它：
 *   Deploy 按钮会把向导新建数据库的 ID 写回你仓库里的 wrangler.toml。当你的 Cloudflare
 *   账号不止一个（或用了团队账号）时，这个库可能建在账号 A，而构建任务跑在账号 B，
 *   于是 wrangler 在 B 里找不到 A 的库，报 `could not be found [code: 7404]`，部署中断。
 *
 * 它做的事：
 *   1. 用**当前部署身份**列出账号下的 D1，按 database_id → database_name 顺序匹配；
 *   2. 都没有就按 database_name 创建；
 *   3. 把解析到的真实 ID 写回本次构建的 wrangler.toml（只影响这次构建，不改你仓库里的值）；
 *   4. 执行 `wrangler d1 migrations apply <binding> --remote`，把表建好。
 *
 * 任何一步失败都只告警、不阻断部署 —— 这样最坏情况也只是「站点先起来、你再去控制台
 * 手动绑 D1 + 执行 migrations/*.sql」，而不是整个部署红掉。
 *
 * 本地想手动跑一次：pnpm run db:ensure
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CONFIG = process.env.WRANGLER_CONFIG || 'wrangler.toml';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const log = (...a) => console.log('[prepare-d1]', ...a);
const warn = (...a) => console.warn('[prepare-d1][warn]', ...a);

function wrangler(args, { inherit = false } = {}) {
  let r = spawnSync('wrangler', args, { encoding: 'utf8', env: process.env });
  if (r.error && r.error.code === 'ENOENT') {
    r = spawnSync('npx', ['--yes', 'wrangler', ...args], { encoding: 'utf8', env: process.env });
  }
  if (r.error) throw r.error;
  if (inherit) {
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
  }
  return r;
}

function parseList(stdout) {
  if (!stdout) return null;
  const i = stdout.indexOf('[');
  if (i === -1) return null;
  try {
    const arr = JSON.parse(stdout.slice(i));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function findBlock(src) {
  const m = src.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|\s*$)/);
  return m ? m[0] : null;
}

function main() {
  if (!existsSync(CONFIG)) {
    warn(`${CONFIG} 不存在，跳过`);
    return 0;
  }
  let src = readFileSync(CONFIG, 'utf8');

  const block = findBlock(src);
  if (!block) {
    warn('配置里没有 [[d1_databases]]（说明你选了「控制台手动绑定」模式），跳过');
    return 0;
  }

  const binding = (block.match(/binding\s*=\s*"([^"]+)"/) || [])[1] || 'DB';
  const dbName = (block.match(/database_name\s*=\s*"([^"]+)"/) || [])[1];
  const currentId = (block.match(/database_id\s*=\s*"([^"]+)"/) || [])[1];
  log(`binding=${binding} name=${dbName || '?'} id=${currentId || '?'}`);

  let list = null;
  try {
    const r = wrangler(['d1', 'list', '--json']);
    if (r.status !== 0) warn('wrangler d1 list 失败，改为尝试直接创建');
    list = parseList(r.stdout);
  } catch (e) {
    warn(`无法执行 wrangler：${e.message}`);
  }

  let target = null;
  if (list) {
    log(`当前账号 D1 数量：${list.length}`);
    target =
      (currentId && list.find((d) => (d.uuid || d.id) === currentId)) ||
      (dbName && list.find((d) => d.name === dbName)) ||
      null;
    if (target) log(`命中已有库：${target.name} (${target.uuid || target.id})`);
  }

  if (!target && dbName) {
    log(`账号里没有 ${dbName}，尝试创建…`);
    const r = wrangler(['d1', 'create', dbName]);
    const id = (r.stdout || '').match(UUID_RE);
    if (r.status === 0 && id) {
      target = { name: dbName, uuid: id[0] };
      log(`已创建：${dbName} (${id[0]})`);
    } else {
      warn(`创建失败：${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')}`);
      try {
        const l2 = parseList(wrangler(['d1', 'list', '--json']).stdout);
        target = (l2 && dbName && l2.find((d) => d.name === dbName)) || null;
      } catch {}
    }
  }

  if (!target) {
    warn('没能确定可用的 D1：跳过建表。若接下来的 wrangler deploy 仍因 D1 绑定失败，请按 README「手动兜底」处理（建库 → 填真实 database_id → 重试）');
    return 0;
  }

  const realId = target.uuid || target.id;
  if (realId && realId !== currentId) {
    src = currentId
      ? src.replace(currentId, realId)
      : src.replace(/(\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"[^"]+"\n)/, `$1database_id = "${realId}"\n`);
    writeFileSync(CONFIG, src);
    log(`已回填 database_id：${currentId || '(空)'} → ${realId}`);
  }

  log(`执行迁移：wrangler d1 migrations apply ${binding} --remote`);
  const m = wrangler(['d1', 'migrations', 'apply', binding, '--remote'], { inherit: true });
  if (m.status !== 0) {
    warn('建表失败（部署继续）。到 Cloudflare 控制台 → D1 → 该库 → Console，执行 README 里的 3 段 SQL 即可');
  }
  return 0;
}

process.exit(main());
