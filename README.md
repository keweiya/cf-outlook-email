# 📬 Outlook 邮件管理

<div align="center">

**基于 Cloudflare Workers 的轻量级 Outlook 邮件管理工具**

🆓 完全免费 · ☁️ 无需服务器 · 🌍 全球加速 · 🌗 深浅主题 · 🌐 中英双语

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![D1](https://img.shields.io/badge/D1-SQLite-003B57?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/roseforyou/cf-outlook-email/pulls)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keweiya/cf-outlook-email)

## 🚀 部署

一句话：**点按钮 → 自动建库 + 自动建表 → 登录**。建表由构建时的 `scripts/prepare-d1.mjs` 完成，
它会先在你当前账号里认领/创建 D1、回填 ID，再执行 `migrations/*.sql`。

### ① 一键部署（推荐）

点上面的 **Deploy to Cloudflare** 按钮，向导里只需填三项：

| 向导项 | 填什么 |
|---|---|
| Worker name | `outlook-email`（或任意） |
| `ADMIN_PASSWORD` | 你的登录密码 |
| `COOKIE_SECRET` | `openssl rand -hex 32`，或乱敲 32 位以上随机字符 |

构建日志会依次出现：

```
npm run build   → tsc --noEmit
npm run deploy  → node scripts/prepare-d1.mjs   ← 认领/创建 D1、回填 database_id、建表
                → wrangler deploy
```

完成后打开 `https://<worker名>.<你的子域>.workers.dev`，用 `ADMIN_PASSWORD` 登录。

> 数据库名默认 `outlook-email-db`。D1 由向导创建或由脚本创建，两种都行；跨账号也不会卡住。

### ② 手动兜底（只在 ① 失败时需要）

如果构建日志里出现 `[prepare-d1][warn]` 且部署最终失败（例如构建用的 API Token 没有 D1 权限），按下面三步收尾：

1. **建库**：**Storage & Databases → D1 → Create**，名字 `outlook-email-db`
2. **建表**：进这个库 → **Console** → 下面 3 段 SQL **按顺序、一段一段**粘贴执行
3. **写回 ID**：把该库的 `database_id` 填进 `wrangler.toml` 的 `database_id` 字段并 `git push`
   （或本地 `pnpm run deploy`），再次构建即通过

> 为什么 3 段、为什么没有注释：D1 控制台对 `--` 注释的语句切分有 bug，带注释整段粘会报
> `No SQL statements detected`（[workers-sdk#4713](https://github.com/cloudflare/workers-sdk/issues/4713)）。
> 下面已是「去注释 + 分段」版本，直接用代码块右上角的复制按钮取。

**第 1 段** · `settings` / `groups` / `accounts` / `temp_emails` + 默认分组

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

**第 2 段** · `tags` / `account_tags`

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

**第 3 段** · `push_state`（Telegram 推送水位）

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

应返回 7 张表：`account_tags, accounts, groups, push_state, settings, tags, temp_emails`
（`sqlite_sequence` 是 AUTOINCREMENT 的内部表，已过滤）

### ③ 登录验收

1. 打开 Worker 域名 → 自动跳 `/login.html`
2. 用 `ADMIN_PASSWORD` 登录 → 进仪表盘
3. 系统设置里改点东西并保存（验证 D1 写权限）
4. 添加账号 → 「方式二：手动授权」（默认 Thunderbird Client ID + `https://localhost` 回调，免注册 Azure）→ 能读邮件

| 遇到 | 原因 | 处理 |
|---|---|---|
| 登录提示「数据库未就绪」/ `DB_NOT_READY` | 表没建，或绑定变量名不是 `DB` | 走 ② 建表；确认绑定名是 `DB` |
| 构建报 `could not be found [code: 7404]` | `prepare-d1` 没跑起来，或配置里的 ID 属于别的账号 | 看构建日志里的 `[prepare-d1]` 输出；必要时按 ② 手动填真实 ID |
| 登录提示「服务端密钥未配置」 | `COOKIE_SECRET` 没设 | Settings → Variables and Secrets 补 |
| D1 控制台报 `No SQL statements detected` | 粘了带 `--` 注释的版本，或整段被压成一行 | 用上面去注释的 3 段，逐段粘 |

### ④ 以后怎么更新

- 改代码：`git push`，构建会自动重新部署（`prepare-d1` 每次都会自愈绑定，不会因为 ID 变化而失败）。
- 想完全用控制台管绑定（不用 wrangler）：把 `wrangler.toml` 里 `[[d1_databases]]` 整段注释掉，
  Deploy command 改成 `npx wrangler deploy`，再在 **Settings → Bindings** 里绑 `DB`。
  两种方式别混用，否则构建部署会把控制台加的绑定覆盖掉。
- 💡 环境变量**不能**替代 D1 绑定：`env.DB` 必须是绑定对象（有 `.prepare()`），传 `D1_DATABASE_ID=xxx` 没用。

## ✨ 特性

- 🔐 **一键授权** — 浏览器弹窗登录微软账号，自动获取凭证，无需手动复制 token
- 🔄 **Token 自动续期** — 每次读邮件自动刷新 token，只要定期使用就不会过期
- 📦 **批量管理** — 批量导入/导出/删除/移组，支持单条与选中导出、分组和状态筛选
- 📨 **邮件阅读** — 通过 Microsoft Graph API 实时读取，支持收件箱/垃圾箱/已删除文件夹切换、聚合视图、分页加载、搜索和 HTML 渲染
- 📭 **临时邮箱** — 集成 GPTMail API，一键生成临时邮箱接收邮件
- 🎨 **精致主题** — 深色/浅色/跟随系统，毛玻璃质感 + 圆形扫掠切换 + 低频呼吸光晕
- 🌐 **中英双语** — 默认中文，顶栏一键切换 English，偏好本地记忆，后端消息同步翻译
- 🆓 **完全免费** — 运行在 Cloudflare 免费层，无需信用卡

## 🖥️ CLI 部署（可选，适合本地开发）

<details>
<summary>展开：本地 wrangler 部署（建库 / 建表 / 密钥 / 部署）</summary>

```bash
git clone https://github.com/<你的用户名>/cf-outlook-email.git
cd cf-outlook-email
pnpm install
pnpm exec wrangler login

# 一条命令搞定：脚本会认领/创建 D1、回填 database_id、跑迁移，然后部署
pnpm run deploy

# 首次部署需要设置这两个 Secret（构建部署则填在 Cloudflare 的向导 / Settings 里）
pnpm exec wrangler secret put ADMIN_PASSWORD
pnpm exec wrangler secret put COOKIE_SECRET
```

只想单独跑建库建表：`pnpm run db:ensure`（或 `pnpm run db:migrate`）。
想用已有数据库：把它的 ID 填进 `wrangler.toml` 的 `database_id` 再 `pnpm run deploy`。

更细的步骤（含 Telegram 推送、Azure 应用注册）见 [docs/GUIDE.md](./docs/GUIDE.md)。

</details>

## 📮 添加邮箱

登录后点击 **添加账号** → **一键授权** → 弹出微软登录窗口 → 授权后自动填入凭证 → 保存。

支持所有 Outlook / Hotmail / Live 邮箱，也支持批量导入（格式：`邮箱----密码----client_id----refresh_token`）。

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| ⚙️ 运行时 | Cloudflare Workers (TypeScript) |
| 🧭 路由 | Hono |
| 🗄️ 数据库 | Cloudflare D1 (SQLite) |
| 🎨 前端 | 原生 HTML/CSS/JS |
| 📧 邮件 | Microsoft Graph API |
| 🚀 部署 | Wrangler |

## 🗂️ 项目结构

```
src/                     后端源码（Worker）
├── index.ts             入口 + 路由
├── auth.ts              HMAC-SHA256 Cookie 鉴权
├── graph.ts             Graph API 集成
├── routes/              业务路由（6 个模块）
└── utils/               加密、校验工具
public/                  前端（静态 SPA）
migrations/              D1 数据库建表
tools/                   辅助脚本
```

## 💰 免费额度

| 资源 | 免费额度 | 够用？ |
|------|----------|:------:|
| ⚡ Workers 请求 | 10 万/天 | ✅ |
| ⏱️ CPU 时间 | 10ms/请求 | ✅ |
| 🌐 外部请求 | 50/次 | ✅ (单账号单请求) |
| 💾 D1 存储 | 5 GB | ✅ |

## 🗺️ 路线图

**核心功能（已实现）**

- [x] 🔐 一键 OAuth 授权 & Token 自动续期
- [x] 👤 邮箱账号管理（增 / 删 / 改 / 查、测试连接）
- [x] 🗂️ 分组管理（自定义颜色、按分组与状态筛选）
- [x] 📦 批量导入 / 导出 / 删除 / 移组
- [x] 📤 单条 / 选中导出
- [x] 📨 邮件阅读（实时收件、搜索、HTML 渲染）
- [x] 📁 文件夹切换（收件箱 / 垃圾箱 / 已删除）
- [x] 🔀 聚合视图（收件箱 + 垃圾箱合并按时间排序，找验证码神器）
- [x] 📄 分页加载（加载更多）
- [x] 📭 临时邮箱（集成 GPTMail）
- [x] 🎨 主题切换 + 圆形扫掠过渡 + 呼吸光晕
- [x] 🔑 对外 API + API Key（免登录拉取邮件，自动化取验证码，见 [API 文档](./docs/API.md)）
- [x] 🗑️ 删除邮件（单条 / 批量，软删除到「已删除」）
- [x] 📎 附件下载
- [x] 🏷️ 标签系统（一个账号多标签，跨分组筛选）
- [x] ⏰ 定时刷新 Token（Cron Trigger，可配间隔/批量，自动保活账号）
- [x] 🤖 Telegram 推送新邮件（Cron 轮询，新邮件实时推送到 Telegram，可配间隔）
- [x] 🧭 界面打磨（页面级工具栏、仪表盘健康度卡片、设置页响应式网格、账号表分页、可搜索账号下拉）
- [x] 🌐 界面国际化（默认中文，一键切换 English）

**计划中（欢迎 PR）**

- [ ] 🔔 更多推送渠道（企业微信 / 钉钉等）

> ⚠️ 受 Cloudflare Workers 平台限制，以下功能无法实现：IMAP（Gmail / QQ / 163 等非微软邮箱）、SMTP 转发、HTTP/SOCKS5 代理。

## ⚠️ 免责声明

本项目仅供个人学习和管理自己的邮箱使用。请确保你对所管理的邮箱账号拥有合法授权，不得用于未授权访问他人邮箱或其他违法用途。默认 Client ID 为 Mozilla Thunderbird 公开 ID，仅供快速体验，正式使用建议[注册自己的 Azure 应用](./docs/GUIDE.md#自己注册-azure-应用)。使用者应自行承担因不当使用产生的一切法律责任，作者不承担任何责任。

## 🙏 致谢

本项目基于 [xiaozhi349/outlookEmail](https://github.com/xiaozhi349/outlookEmail) 改造而来。原项目为 Python Flask + SQLite 实现，本项目将其迁移至 Cloudflare Workers + D1，并重写了前后端代码。感谢原作者的工作。

## 友情链接

[LINUX DO](https://linux.do/) —— 新的理想型社区，技术爱好者的聚集地。

## 📜 许可证

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](./LICENSE)

基于 **GPL-3.0** 协议开源。你可以自由使用、修改和分发本项目，但任何分发的衍生作品也必须以 GPL-3.0 协议开源并提供完整源代码。
