# MyKeys

<p align="center">
  <strong>A Telegram bot for managing passwords, powered by Cloudflare Workers.</strong>
</p>

<p align="center">
  English | <a href="README_CN.md">中文</a>
</p>

<p align="center">
  <img src="assets/preview-en.png" alt="MyKeys Preview" width="360">
</p>

---

Send a message to save credentials, send a keyword to search them back. All sensitive data is encrypted with AES-256-GCM and stored in Cloudflare D1. Zero cost, no server needed.

## Features

- Save credentials by sending: `name site account password [notes]`
- Fuzzy search by keyword, tap inline buttons to view details
- Tap /list in the menu to browse all saved entries
- Delete entries with inline buttons
- Only your Telegram account can access the bot

## Security

- Account, password, and notes are AES-256-GCM encrypted at rest
- Bot token, encryption key, and admin secret stored via Cloudflare Secrets (never in code)
- Admin endpoints (/init, /setWebhook) require a secret key to access
- Telegram User ID verification -- only your ID is allowed
- All undefined paths return 404

## Prerequisites

- A Cloudflare account (free tier is enough)
- Node.js 18+
- A Telegram Bot (create via [@BotFather](https://t.me/BotFather))
- Your Telegram User ID (get from [@userinfobot](https://t.me/userinfobot))

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/cocojojo5213/mykeys.git
cd mykeys
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

### 3. Create the database

```bash
npx wrangler d1 create password-bot-db
```

Copy the `database_id` from the output, open `wrangler.toml`, and replace `your-database-id-here` with it.

Also set `ALLOWED_USER_ID` to your Telegram User ID.

### 4. Set secrets

Three secrets are required:

| Secret | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather |
| `ENCRYPT_KEY` | A 32-character string for AES encryption. **Do not lose or change it.** |
| `ADMIN_SECRET` | Key for accessing admin endpoints |

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ENCRYPT_KEY
npx wrangler secret put ADMIN_SECRET
```

Or bulk set via a temporary file:

```bash
# Create .secrets.json (delete it after!)
npx wrangler secret bulk .secrets.json
rm .secrets.json
```

### 5. Deploy

```bash
npx wrangler deploy
```

### 6. Initialize database and webhook

Visit these URLs in your browser (replace with your actual values):

```
https://mykeys.xxx.workers.dev/init?key=YOUR_ADMIN_SECRET
https://mykeys.xxx.workers.dev/setWebhook?key=YOUR_ADMIN_SECRET
```

Done. Open your bot in Telegram and start saving passwords.

## Usage

| Action | How |
|---|---|
| **Save** | Send: `claude claude.ai test@mail.com abc123` |
| **Save with notes** | Send: `github github.com user pass 2FA enabled` |
| **Save long text** | First line: `#存 name`, rest is content (SSH keys, etc.) |
| **Search** | Send a keyword like `cla` -- fuzzy matching |
| **List all** | Tap /list in the menu |
| **Delete** | Tap the delete button on any entry |

## Important Notes

- **Do not change `ENCRYPT_KEY`** after saving data -- old entries will become unreadable
- Enable 2FA on your Cloudflare account
- Consider enabling auto-delete messages in your Telegram chat with the bot

## Tech Stack

Cloudflare Workers / D1 / Secrets / Web Crypto API (AES-256-GCM) / TypeScript / Wrangler

## License

MIT
