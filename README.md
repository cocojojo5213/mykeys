# MyKeys

<p align="center">
  <strong>🔐 Telegram Password Manager on Cloudflare Workers</strong>
</p>

<p align="center">
  English | <a href="README_CN.md">中文</a>
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/cocojojo5213/mykeys">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers">
  </a>
</p>

<p align="center">
  <img src="assets/preview-en.png" alt="MyKeys Preview" width="360">
</p>

---

A personal password manager bot for Telegram. Interactive guided input, expiry reminders, AES-256-GCM encryption. Runs on Cloudflare Workers free tier.

## ✨ Features

- **Interactive Input** - Just send a name, bot guides you through site → account → password → expiry → notes
- **Expiry Reminders** - Set expiry dates, get notified 7/3/1 days before
- **Long Text Storage** - Save SSH keys, certificates, API tokens with `#存 name`
- **Fuzzy Search** - Send any keyword to search
- **AES-256-GCM Encryption** - All sensitive data encrypted at rest
- **Zero Cost** - Runs entirely on Cloudflare free tier

## 🚀 One-Click Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cocojojo5213/mykeys)

After clicking, you'll need to:
1. Set your D1 database ID in `wrangler.toml`
2. Set secrets (see below)
3. Initialize database and webhook

## 📦 Manual Setup

### Prerequisites
- Cloudflare account (free)
- Node.js 18+
- Telegram Bot token ([@BotFather](https://t.me/BotFather))
- Your Telegram User ID ([@userinfobot](https://t.me/userinfobot))

### Steps

```bash
# Clone
git clone https://github.com/cocojojo5213/mykeys.git
cd mykeys
npm install

# Login to Cloudflare
npx wrangler login

# Create database
npx wrangler d1 create password-bot-db
# Copy the database_id to wrangler.toml

# Set your Telegram User ID in wrangler.toml
# ALLOWED_USER_ID = "your-telegram-user-id"

# Set secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ENCRYPT_KEY      # 32-char string, DO NOT LOSE
npx wrangler secret put ADMIN_SECRET

# Deploy
npx wrangler deploy

# Initialize (replace with your values)
# Visit: https://mykeys.xxx.workers.dev/init?key=YOUR_ADMIN_SECRET
# Visit: https://mykeys.xxx.workers.dev/setWebhook?key=YOUR_ADMIN_SECRET
```

## 📖 Usage

### Save Account (Interactive)
```
You: gpt team车位号
Bot: 📝 保存「gpt team车位号」
     🌐 请输入网站：
You: chat.openai.com
Bot: 👤 请输入账号：
You: test@mail.com
Bot: 🔑 请输入密码：
You: mypassword123
Bot: 📅 需要设置到期提醒吗？
     [不需要] [7天后] [30天后] [90天后] [1年后] [自定义]
You: (click 30天后)
Bot: 📝 需要添加备注吗？
     [不需要，直接保存]
You: 每月续费
Bot: ✅ 保存成功！
```

### Save Long Text (SSH Keys, etc.)
```
#存 服务器密钥 @2025-12-31
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmU...
-----END OPENSSH PRIVATE KEY-----
```

### Commands
| Command | Description |
|---------|-------------|
| `/list` | View all entries |
| `/expiring` | View entries expiring in 30 days |
| `/cancel` | Cancel current operation |
| `/help` | Show help |

### Search
Just send any keyword - fuzzy matching on name and site.

## 🔒 Security

- AES-256-GCM encryption for account, password, notes
- Secrets stored via Cloudflare Secrets (not in code)
- Admin endpoints require secret key
- Telegram User ID verification
- Session timeout (5 minutes)

## ⚠️ Important

- **DO NOT change `ENCRYPT_KEY`** after saving data - old entries become unreadable
- Enable 2FA on your Cloudflare account
- Consider enabling auto-delete messages in Telegram

## 📄 License

MIT
