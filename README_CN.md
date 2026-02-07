# MyKeys

<p align="center">
  <strong>基于 Cloudflare Workers 的 Telegram 密码管理机器人</strong>
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

个人 Telegram 密码管理机器人。交互式引导输入，到期提醒，临时邮箱，AES-256-GCM 加密。完全运行在 Cloudflare Workers 免费套餐上。

## 功能

- **交互式输入** - 发送名称，机器人引导你输入网站、账号、密码、到期日期、备注
- **到期提醒** - 设置到期日期，提前 7/3/1 天自动提醒
- **长文本存储** - 用 `#存 名称` 保存 SSH 密钥、证书、API Token
- **临时邮箱** - 创建自定义邮箱地址，接收邮件并转发到 Telegram
- **模糊搜索** - 发送关键词即可搜索
- **AES-256-GCM 加密** - 所有敏感数据加密存储
- **零成本** - 完全运行在 Cloudflare 免费套餐

## 一键部署

[![部署到 Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cocojojo5213/mykeys)

一键部署会创建 Worker，但还需要手动完成以下步骤：

1. **创建 D1 数据库**：在 Cloudflare Dashboard 中进入 Workers & Pages > D1 > 创建数据库
2. **修改 wrangler.toml**：填入数据库 ID 和你的 Telegram User ID
3. **设置 Secrets**：通过 Wrangler CLI 设置密钥（见下方说明）
4. **重新部署**：执行 `npx wrangler deploy`
5. **初始化**：访问初始化接口创建数据库表和设置 Webhook

如果觉得步骤繁琐，建议直接使用手动部署方式。

## 手动部署

### 前置条件
- Cloudflare 账号（免费）
- Node.js 18+
- Telegram Bot Token，从 [@BotFather](https://t.me/BotFather) 创建
- 你的 Telegram User ID，从 [@userinfobot](https://t.me/userinfobot) 获取

### 部署步骤

```bash
# 克隆仓库
git clone https://github.com/cocojojo5213/mykeys.git
cd mykeys
npm install

# 登录 Cloudflare
npx wrangler login

# 创建数据库
npx wrangler d1 create password-bot-db
# 把返回的 database_id 复制到 wrangler.toml

# 编辑 wrangler.toml
# - 填入 database_id
# - 设置 ALLOWED_USER_ID 为你的 Telegram User ID
# - 如需邮箱功能，设置 EMAIL_DOMAINS

# 设置密钥（会提示输入值）
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ENCRYPT_KEY      # 32位字符串，务必保存好
npx wrangler secret put ADMIN_SECRET

# 部署
npx wrangler deploy

# 初始化数据库和 Webhook
curl "https://你的Worker地址.workers.dev/init?key=你的ADMIN_SECRET"
curl "https://你的Worker地址.workers.dev/setWebhook?key=你的ADMIN_SECRET"
```

## 邮箱功能（可选）

使用临时邮箱功能需要：

1. 在 Cloudflare 添加你自己的域名
2. 单独部署 Email Worker

```bash
# 部署邮箱 Worker
npx wrangler deploy --config wrangler-email.toml

# 设置邮箱 Worker 的密钥
npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler-email.toml
npx wrangler secret put ENCRYPT_KEY --config wrangler-email.toml
```

然后在 Cloudflare Dashboard 配置 Email Routing：
- 进入域名 > Email > Email Routing
- 启用 Email Routing
- 添加 Catch-all 规则，指向 `mykeys-email` Worker

## 使用方法

### 保存账号（交互式）
```
你: gpt team车位号
Bot: 保存「gpt team车位号」
     请输入网站：
你: chat.openai.com
Bot: 请输入账号：
你: test@mail.com
Bot: 请输入密码：
你: mypassword123
Bot: 设置到期提醒？
     [不需要] [7天] [30天] [90天] [自定义]
你: (点击 30天)
Bot: 添加备注？
     [不需要，保存]
你: 每月续费
Bot: 保存成功！
```

### 保存长文本
```
#存 服务器密钥 @2025-12-31
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjE...
-----END OPENSSH PRIVATE KEY-----
```

### 创建临时邮箱
```
#邮箱 test
(选择域名)
Bot: 已创建 test@yourdomain.com
```

### 命令
| 命令 | 说明 |
|------|------|
| `/menu` | 主菜单 |
| `/list` | 查看所有条目 |
| `/emails` | 查看邮箱列表 |
| `/expiring` | 查看 30 天内到期的条目 |
| `/cancel` | 取消当前操作 |
| `/help` | 显示帮助 |

### 搜索
直接发送关键词，模糊匹配名称和网站。

## 安全性

- AES-256-GCM 加密账号、密码、备注和邮件内容
- 密钥通过 Cloudflare Secrets 存储，不在代码中暴露
- 管理接口需要密钥验证
- Telegram User ID 验证
- 会话 5 分钟超时

## 注意事项

- 不要修改 ENCRYPT_KEY，否则已保存的数据无法解密
- 建议开启 Cloudflare 账号两步验证
- 建议在 Telegram 对话中开启消息自动删除

## 许可证

MIT
