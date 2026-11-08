# 📬 Outlook Email Manager

<div align="center">

**Lightweight Outlook email manager powered by Cloudflare Workers**

🆓 100% Free · ☁️ No Server Required · 🌍 Global CDN · 🌗 Dark/Light Theme · 🌐 Bilingual UI

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![D1](https://img.shields.io/badge/D1-SQLite-003B57?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/roseforyou/cf-outlook-email/pulls)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keweiya/cf-outlook-email)

**Cloudflare Workers + D1 email manager.** Deploy the Worker with one button; create the database yourself once (the database ID only exists in your account).

🌐 [中文](./README.md) · 📖 [Deployment Guide](./docs/GUIDE.md) · 🔌 [API Docs](./docs/API.md)

</div>

---

| 🌙 Dark | ☀️ Light |
|:---:|:---:|
| ![Dark mode](./docs/preview.png) | ![Light mode](./docs/preview-light.png) |

## ✨ Features

- 🔐 **One-Click OAuth** — Authorize Outlook accounts via browser popup, no manual token copying
- 🔄 **Auto Token Refresh** — Automatically saves new refresh tokens on each use, preventing expiry
- 📦 **Batch Operations** — Import/export/delete/move in bulk, including per-row & selected export, with group & status filters
- 📨 **Email Reading** — Read inbox / junk / deleted via Microsoft Graph API with folder switching, aggregated view, paginated load-more, search and HTML rendering
- 📭 **Temp Email** — GPTMail API integration for disposable email addresses
- 🎨 **Polished Themes** — Dark / Light / Auto with glassmorphism, circle-swoop transition & ambient breathing glow
- 🌐 **Bilingual UI** — Chinese by default, one-click switch to English in the topbar, preference remembered locally, backend messages translated on display
- 🆓 **Completely Free** — Runs on Cloudflare's free tier, no credit card needed

## 🚀 Deploy

Short version: **click the button → database and tables are created for you → log in.**
Tables are applied at build time by `scripts/prepare-d1.mjs`, which claims/creates the D1 database in the
deploying account, writes its ID back, then runs `migrations/*.sql`.

### ① One-click (recommended)

Click the **Deploy to Cloudflare** button above; the wizard asks for three things:

| Field | Value |
|---|---|
| Worker name | `outlook-email` (or anything) |
| `ADMIN_PASSWORD` | your login password |
| `COOKIE_SECRET` | `openssl rand -hex 32`, or 32+ random characters |

Build log looks like:

```
npm run build   → tsc --noEmit
npm run deploy  → node scripts/prepare-d1.mjs   ← claim/create D1, write database_id, apply migrations
                → wrangler deploy
```

Open `https://<worker>.<subdomain>.workers.dev` and log in.

### ② Manual fallback (only if ① fails)

If the build logs show `[prepare-d1][warn]` and the deploy fails (e.g. the build token lacks D1 permission):

1. **Create the DB**: **Storage & Databases → D1 → Create**, name it `outlook-email-db`
2. **Create tables**: open it → **Console** → run the three blocks below **one at a time**
3. **Write the ID back**: put that database's `database_id` into `wrangler.toml` and `git push` (or run `pnpm run deploy` locally)

> Why three blocks and no comments: the D1 console splits statements poorly when `--` comments are present
> and reports `No SQL statements detected` ([workers-sdk#4713](https://github.com/cloudflare/workers-sdk/issues/4713)).

**Part 1** · `settings` / `groups` / `accounts` / `temp_emails` + default group

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

**Part 2** · `tags` / `account_tags`

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

**Part 3** · `push_state`

```sql
CREATE TABLE IF NOT EXISTS push_state (
  account_id     INTEGER PRIMARY KEY,
  last_pushed_at TEXT DEFAULT '',
  updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
```

**Verify**

```sql
select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name;
```

Expected 7 tables: `account_tags, accounts, groups, push_state, settings, tags, temp_emails`.

### ③ Log in

Open the Worker URL, log in with `ADMIN_PASSWORD`. `DB_NOT_READY` means tables are missing or the binding is not named `DB`.

### ④ Updating later

`git push` rebuilds and redeploys; `prepare-d1` re-resolves the binding on every build.
Prefer binding through the dashboard instead? Comment out `[[d1_databases]]` in `wrangler.toml`, set the deploy
command to `npx wrangler deploy`, and bind `DB` under **Settings → Bindings** — do not mix the two modes.

## 📮 Adding Accounts

Login → **Add Account** → **One-Click Auth** → Microsoft login popup → Authorize → Credentials auto-filled → Save.

Works with all Outlook / Hotmail / Live accounts. Bulk import supported (format: `email----password----client_id----refresh_token`).

## 🧱 Tech Stack

| Layer | Technology |
|-------|-----------|
| ⚙️ Runtime | Cloudflare Workers (TypeScript) |
| 🧭 Router | Hono |
| 🗄️ Database | Cloudflare D1 (SQLite) |
| 🎨 Frontend | Vanilla HTML/CSS/JS |
| 📧 Email | Microsoft Graph API |
| 🚀 Deploy | Wrangler |

## 💰 Free Tier Limits

| Resource | Free Quota | Sufficient? |
|----------|-----------|:-----------:|
| ⚡ Worker Requests | 100K/day | ✅ |
| ⏱️ CPU Time | 10ms/req | ✅ |
| 🌐 Subrequests | 50/req | ✅ (single account per request) |
| 💾 D1 Storage | 5 GB | ✅ |

## 🗺️ Roadmap

**Core features (implemented)**

- [x] 🔐 One-click OAuth & auto token refresh
- [x] 👤 Account management (CRUD, connection test)
- [x] 🗂️ Group management (custom colors, group & status filters)
- [x] 📦 Bulk import / export / delete / move
- [x] 📤 Per-row & selected export
- [x] 📨 Email reading (live fetch, search, HTML rendering)
- [x] 📁 Folder switching (Inbox / Junk / Deleted)
- [x] 🔀 Aggregated view (Inbox + Junk merged by time — great for finding codes)
- [x] 📄 Paginated load-more
- [x] 📭 Temp email (GPTMail integration)
- [x] 🎨 Theme switching + circle-swoop transition + breathing glow
- [x] 🔑 External API + API Key (login-free email fetch for automation, see [API Docs](./docs/API.md))
- [x] 🗑️ Delete emails (single / batch, soft-delete to Deleted Items)
- [x] 📎 Attachment download
- [x] 🏷️ Tag system (multiple tags per account, cross-group filtering)
- [x] ⏰ Scheduled token refresh (Cron Trigger, configurable interval/batch, keeps accounts alive)
- [x] 🤖 Telegram push for new emails (cron polling, near-real-time delivery, configurable interval)
- [x] 🧭 UI polish (per-page toolbars, dashboard health cards, responsive settings grid, paginated accounts table, searchable account combobox)
- [x] 🌐 UI internationalization (Chinese default, one-click English)

**Planned (PRs welcome)**

- [ ] 🔔 More push channels (WeCom / DingTalk etc.)

> ⚠️ Due to Cloudflare Workers platform limits, the following are not feasible: IMAP (Gmail / QQ / 163 and other non-Microsoft mailboxes), SMTP forwarding, HTTP/SOCKS5 proxy.

## ⚠️ Disclaimer

This project is intended for personal use to manage your own email accounts. Ensure you have legal authorization for all accounts you manage. The default Client ID is Mozilla Thunderbird's public ID for quick setup only — registering your own Azure app is recommended for production use. The author assumes no liability for any misuse.

## 🙏 Credits

This project is a rewrite of [xiaozhi349/outlookEmail](https://github.com/xiaozhi349/outlookEmail), originally built with Python Flask + SQLite. It has been migrated to Cloudflare Workers + D1 with a completely new frontend and backend. Thanks to the original author.

## 📜 License

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](./LICENSE)

Licensed under **GPL-3.0**. Free to use, modify, and distribute — but any distributed derivative must also be open-sourced under GPL-3.0 with full source code.
