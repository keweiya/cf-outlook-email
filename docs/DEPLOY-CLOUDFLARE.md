# 部署到 Cloudflare

> 目标体验：**点一次按钮 → 自动建库 + 自动建表 → 直接用**。
> 下面第 1 节是一键流程，第 2 节是失败时的手动兜底，第 3 节是「完全用控制台管绑定」的替代路线。

---

## 一、一键部署（推荐）

点按钮：

```
https://deploy.workers.cloudflare.com/?url=https://github.com/keweiya/cf-outlook-email
```

1. 授权 GitHub（会把仓库复制一份到你账号）→ 授权 Cloudflare
2. 向导里填三项：

   | 向导项 | 值 |
   |---|---|
   | Worker name | `outlook-email` |
   | `ADMIN_PASSWORD` | 面板登录密码 |
   | `COOKIE_SECRET` | `openssl rand -hex 32` 或 32+ 位随机串 |

3. 等构建完成，打开 `https://<worker名>.<你的子域>.workers.dev`

### 构建时自动发生了什么

```
pnpm install
npm run build   → tsc --noEmit
npm run deploy  → node scripts/prepare-d1.mjs
                    ├─ wrangler d1 list  → 按 database_id / database_name 找库
                    ├─ 找不到就 wrangler d1 create outlook-email-db
                    ├─ 把真实 ID 写回本次构建的 wrangler.toml
                    └─ wrangler d1 migrations apply DB --remote   ← 建表
                → wrangler deploy
```

`prepare-d1.mjs` 解决的正是 `could not be found [code: 7404]`：Deploy 按钮会把向导新建库的 ID 写回仓库，
而多账号场景下这个库可能属于账号 A、构建却跑在账号 B —— 脚本会用**当前构建账号**重新解析，必要时自己建库。
脚本内部任何一步失败都只告警、不阻断部署（最坏情况是站点先起来，你按第 2 节补表）。

---

## 二、手动兜底（只在第 1 节失败时）

典型信号：构建日志出现 `[prepare-d1][warn]`，随后 `wrangler deploy` 因 D1 绑定失败。

### 2.1 建库

**Storage & Databases → D1 → Create**，名字 `outlook-email-db`。

### 2.2 建表

进这个库 → **Console** → 下面 3 段 SQL **按顺序、一段一段**粘贴执行。

> D1 控制台对 `--` 注释的语句切分有 bug，带注释整段粘会报 `No SQL statements detected`
> （[workers-sdk#4713](https://github.com/cloudflare/workers-sdk/issues/4713)）。下面已去掉注释并分段。

**第 1 段**

```sql
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  color       TEXT DEFAULT '#2563eb',
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO groups (id, name, description, color)
VALUES (1, '默认分组', '默认邮箱分组', '#2563eb');
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  client_id     TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  password      TEXT DEFAULT '',
  group_id      INTEGER DEFAULT 1,
  remark        TEXT DEFAULT '',
  status        TEXT DEFAULT 'active',
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id)
);
CREATE TABLE IF NOT EXISTS temp_emails (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  source     TEXT DEFAULT '',
  remark     TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**第 2 段**

```sql
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT DEFAULT '#6366f1',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS account_tags (
  account_id INTEGER NOT NULL,
  tag_id     INTEGER NOT NULL,
  PRIMARY KEY (account_id, tag_id),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_account_tags_tag ON account_tags(tag_id);
```

**第 3 段**

```sql
CREATE TABLE IF NOT EXISTS push_state (
  account_id     INTEGER PRIMARY KEY,
  last_pushed_at TEXT DEFAULT '',
  updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
```

**自检**

```sql
select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name;
```

应返回 7 张：`account_tags, accounts, groups, push_state, settings, tags, temp_emails`
（`sqlite_sequence` 是 AUTOINCREMENT 的内部表，已过滤）

### 2.3 把 ID 写回配置 / 绑定

两条路，选一条：

| 选择 | 做法 |
|---|---|
| **继续用构建部署**（推荐） | 把该库的 `database_id` 填进仓库 `wrangler.toml`，`git push` 重新构建 |
| 改成本地部署 | 本地 `pnpm exec wrangler d1 migrations apply DB --remote && pnpm exec wrangler deploy` |

### 2.4 密钥

如果构建向导里没填 Secret，**Settings → Variables and Secrets** 里补（类型选 **Secret**）：
`ADMIN_PASSWORD`、`COOKIE_SECRET`，可选 `GPTMAIL_API_KEY`。改动下次请求即生效。

---

## 三、完全用控制台管绑定（不用 wrangler 管 D1）

不想让仓库持有 `database_id`，可以切成「控制台模式」：

1. `wrangler.toml` 里把 `[[d1_databases]]` **整段注释掉**
2. Cloudflare 项目设置里 Deploy command 改成 `npx wrangler deploy`
3. 按 2.1 / 2.2 建库建表
4. Worker → **Settings → Bindings → Add → D1 database**，Variable name 填 **`DB`**，选那个库
5. 保存即部署新版本，刷新页面即可登录

| | 自动模式（默认） | 控制台模式 |
|---|---|---|
| D1 绑定写在哪 | `wrangler.toml` | 控制台 |
| 建库建表 | 构建时自动 | 手动 |
| 需要 `database_id` 吗 | 需要（脚本会回填） | 不需要 |
| 之后 `git push` | 正常 | 会覆盖控制台绑定，**别混用** |

---

## 四、本地 CLI

```bash
pnpm install
pnpm exec wrangler login
pnpm run deploy        # prepare-d1（建库/回填/建表）+ wrangler deploy
```

单独执行：

| 命令 | 作用 |
|---|---|
| `pnpm run db:ensure` | 只做「认领/创建 D1 + 回填 ID + 建表」 |
| `pnpm run db:migrate` | 只跑迁移（`--remote`） |
| `pnpm run build` | 只做类型检查 |
| `pnpm run dev` | 本地开发（需 `.dev.vars`，见 docs/GUIDE.md） |

---

## 五、排错

| 现象 | 原因 | 处理 |
|---|---|---|
| `could not be found [code: 7404]` | 配置里的 ID 属于别的账号，或脚本没跑起来 | 看构建日志 `[prepare-d1]` 输出；或按 2.3 填真实 ID |
| 登录 500 / `DB_NOT_READY` | 表没建，或绑定变量名不是 `DB` | 走 2.2；确认绑定名叫 `DB` |
| 「服务端密钥未配置」 | `COOKIE_SECRET` 没设 | Settings → Variables and Secrets |
| D1 控制台 `No SQL statements detected` | 粘了带 `--` 注释的版本，或换行被压平 | 用上面去注释的 3 段，逐段粘 |
| 页面 404 / 只有 JSON | 静态资源没生效 | 确认 `wrangler.toml` 有 `[assets] directory = "./public"` |
| 登录后又跳回登录页 | Cookie 签名失败 | 检查 `COOKIE_SECRET` 是否为空 / 被改过 |
| 迁移显示 `Resource location: local` | `npm exec` 吃掉了 `--remote` | 改用 `npx` / `pnpm exec` |
| cron 不触发 | 手动创建的 Worker 不继承 cron | Settings → Triggers → Cron 加 `0 */6 * * *` |
| 一键授权报 `redirect_uri is not valid` | 默认 Thunderbird Client ID 没登记你的域名 | 用「方式二：手动授权」，或注册自己的 Azure 应用 |

---

## 六、仓库里都放了什么

```
wrangler.toml            Worker 名 / 入口 / [assets] / cron / [[d1_databases]]（占位 ID）
.dev.vars.example        声明 ADMIN_PASSWORD、COOKIE_SECRET（按钮向导据此弹输入框）
scripts/prepare-d1.mjs   构建时认领/创建 D1、回填 database_id、执行迁移
migrations/*.sql         建表脚本（README 里也内联了去注释版本）
docs/GUIDE.md            纯 CLI 路线与邮箱授权等细节
```

业务代码（`src/`、`public/`）与上游一致，未做改动。
