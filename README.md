# MyKeys

<p align="center">
  <strong>Telegram Password Manager on Cloudflare Workers</strong>
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

A personal password manager bot for Telegram. Interactive guided input, expiry reminders, temporary email, AES-256-GCM encryption. Runs entirely on Cloudflare Workers free tier.

## Features

- **Interactive Input** - Send a name, bot guides you through site, account, password, expiry, and notes
- **Expiry Reminders** - Set expiry dates, get notified 7/3/1 days before expiration
- **Long Text Storage** - Save SSH keys, certificates, API tokens with `#save name`
- **Temporary Email** - Create custom email addresses, receive and forward emails to Telegram
- **Fuzzy Search** - Send any keyword to search your entries
- **AES-256-GCM Encryption** - All sensitive data encrypted at rest
- **Zero Cost** - Runs entirely on Cloudflare free tier

## One-Click Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cocojojo5213/mykeys)

The one-click deploy will set up the Worker for you. After deployment, you still need to complete these steps:

1. **Create a D1 database** in Cloudflare Dashboard (Workers & Pages > D1 > Create)
2. **Update wrangler.toml** with your database ID and Telegram User ID
3. **Set secrets** via Wrangler CLI (see below)
4. **Redeploy** with `npx wrangler deploy`
5. **Initialize** database and webhook

For a smoother experience, consider manual deployment instead.

## Manual Setup

### Prerequisites
- Cloudflare account (free)
- Node.js 18+
- Telegram Bot token from [@BotFather](https://t.me/BotFather)
- Your Telegram User ID from [@userinfobot](https://t.me/userinfobot)

### Steps

```bash
# Clone the repository
git clone https://github.com/cocojojo5213/mykeys.git
cd mykeys
npm install

# Login to Cloudflare
npx wrangler login

# Create database
npx wrangler d1 create password-bot-db
# Copy the database_id to wrangler.toml

# Edit wrangler.toml
# - Set database_id
# - Set ALLOWED_USER_ID to your Telegram User ID
# - Set EMAIL_DOMAINS if using email feature

# Set secrets (you will be prompted for values)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ENCRYPT_KEY      # 32-char string, SAVE THIS
npx wrangler secret put ADMIN_SECRET

# Deploy
npx wrangler deploy

# Initialize database and webhook
curl "https://YOUR_WORKER.workers.dev/init?key=YOUR_ADMIN_SECRET"
curl "https://YOUR_WORKER.workers.dev/setWebhook?key=YOUR_ADMIN_SECRET"
```

## Email Feature (Optional)

To use the temporary email feature, you need:

1. One or more domains added to Cloudflare
2. Email Worker deployed separately

```bash
# Deploy email worker
npx wrangler deploy --config wrangler-email.toml

# Set secrets for email worker
npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler-email.toml
npx wrangler secret put ENCRYPT_KEY --config wrangler-email.toml
```

Then configure Email Routing in Cloudflare Dashboard:
- Go to your domain > Email > Email Routing
- Enable Email Routing
- Add a Catch-all rule pointing to the `mykeys-email` worker

## Usage

### Save Account (Interactive)
```
You: gpt team
Bot: Saving "gpt team"
     Enter website:
You: chat.openai.com
Bot: Enter account:
You: test@mail.com
Bot: Enter password:
You: mypassword123
Bot: Set expiry reminder?
     [No] [7 days] [30 days] [90 days] [Custom]
You: (click 30 days)
Bot: Add notes?
     [No, save now]
You: monthly renewal
Bot: Saved successfully!
```

### Save Long Text
```
#save server-key @2025-12-31
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjE...
-----END OPENSSH PRIVATE KEY-----
```

### Create Temporary Email
```
#email myname
(select domain)
Bot: Created myname@yourdomain.com
```

### Commands
| Command | Description |
|---------|-------------|
| `/menu` | Main menu |
| `/list` | View all entries |
| `/emails` | View email addresses |
| `/expiring` | View entries expiring in 30 days |
| `/cancel` | Cancel current operation |
| `/help` | Show help |

### Search
Send any keyword to search by name or site.

## Security

- AES-256-GCM encryption for account, password, notes, and email content
- Secrets stored via Cloudflare Secrets Manager
- Admin endpoints require secret key
- Telegram User ID verification
- Session timeout after 5 minutes of inactivity

## Important Notes

- Do not change ENCRYPT_KEY after saving data, or old entries become unreadable
- Enable 2FA on your Cloudflare account
- Consider enabling auto-delete messages in Telegram for sensitive data

## License

MIT
