# MyKeys

<p align="center">
  <strong>🔐 基于 Cloudflare Workers 的 Telegram 密码管理机器人</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | 中文
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/cocojojo5213/mykeys">
    <img src="https://deploy.workers.cloudflare.com/button" alt="部署到 Cloudflare Workers">
  </a>
</p>

<p align="center">
  <img src="assets/preview-zh.png" alt="MyKeys 预览" width="360">
</p>

---

个人 Telegram 密码管理机器人。交互式引导输入，到期提醒，AES-256-GCM 加密。完全运行在 Cloudflare Workers 免费套餐上。

## ✨ 功能

- **交互式输入** - 发送名称，机器人引导你输入：网站 → 账号 → 密码 → 到期日期 → 备注
- **到期提醒** - 设置到期日期，提前 7/3/1 天自动提醒
- **长文本存储** - 用 `#存 名称` 保存 SSH 密钥、证书、API Token
- **模糊搜索** - 发送关键词即可搜索
- **AES-256-GCM 加密** - 所有敏感数据加密存储
- **零成本** - 完全运行在 Cloudflare 免费套餐

## 🚀 一键部署

[![部署到 Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cocojojo5213/mykeys)

点击后需要：
1. 在 `wrangler.toml` 中设置 D1 数据库 ID
2. 设置 Secrets（见下方）
3. 初始化数据库和 Webhook

## 📦 手动部署

### 前置条件
- Cloudflare 账号（免费）
- Node.js 18+
- Telegram Bot Token（[@BotFather](https://t.me/BotFather) 创建）
- 你的 Telegram User ID（[@userinfobot](https://t.me/userinfobot) 获取）

### 步骤

```bash
# 克隆
git clone https://github.com/cocojojo5213/mykeys.git
cd mykeys
npm install

# 登录 Cloudflare
npx wrangler login

# 创建数据库
npx wrangler d1 create password-bot-db
# 把 database_id 复制到 wrangler.toml

# 在 wrangler.toml 设置你的 Telegram User ID
# ALLOWED_USER_ID = "你的ID"

# 设置 Secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ENCRYPT_KEY      # 32位字符串，不要丢失！
npx wrangler secret put ADMIN_SECRET

# 部署
npx wrangler deploy

# 初始化（替换成你的值）
# 访问: https://mykeys.xxx.workers.dev/init?key=你的ADMIN_SECRET
# 访问: https://mykeys.xxx.workers.dev/setWebhook?key=你的ADMIN_SECRET
```

## 📖 使用方法

### 保存账号（交互式）
```
你: gpt team车位号
Bot: 📝 保存「gpt team车位号」
     🌐 请输入网站：
你: chat.openai.com
Bot: 👤 请输入账号：
你: test@mail.com
Bot: 🔑 请输入密码：
你: mypassword123
Bot: 📅 需要设置到期提醒吗？
     [不需要] [7天后] [30天后] [90天后] [1年后] [自定义]
你: (点击 30天后)
Bot: 📝 需要添加备注吗？
     [不需要，直接保存]
你: 每月续费
Bot: ✅ 保存成功！
```

### 保存长文本（SSH 密钥等）
```
#存 服务器密钥 @2025-12-31
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmU...
-----END OPENSSH PRIVATE KEY-----
```

### 命令
| 命令 | 说明 |
|------|------|
| `/list` | 查看所有条目 |
| `/expiring` | 查看 30 天内到期的条目 |
| `/cancel` | 取消当前操作 |
| `/help` | 显示帮助 |

### 搜索
直接发送关键词，模糊匹配名称和网站。

## 🔒 安全性

- AES-256-GCM 加密账号、密码、备注
- Secrets 通过 Cloudflare Secrets 存储（不在代码中）
- 管理接口需要密钥验证
- Telegram User ID 验证
- 会话 5 分钟超时

## ⚠️ 注意事项

- **不要修改 `ENCRYPT_KEY`** - 修改后旧数据无法解密
- 建议开启 Cloudflare 账号两步验证
- 建议在 Telegram 对话中开启消息自动删除

## 📄 许可证

MIT
