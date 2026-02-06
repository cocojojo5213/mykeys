# MyKeys

<p align="center">
  <strong>一个跑在 Cloudflare Workers 上的 Telegram 密码管理机器人。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | 中文
</p>

<p align="center">
  <img src="assets/preview-zh.png" alt="MyKeys 预览" width="360">
</p>

---

发条消息就能存账号密码，发个关键词就能模糊搜索找回来。所有敏感信息 AES-256-GCM 加密后存入 Cloudflare D1 数据库，不花一分钱，不需要服务器。

## 功能

- 发一条消息保存账号密码，格式：`用途 网站 账号 密码 [备注]`
- 发关键词模糊搜索，点按钮查看完整信息
- 菜单里点 /list 查看所有条目
- 点按钮删除不需要的记录
- 只有你自己能用，别人发消息会被拒绝

## 安全性

- 账号、密码、备注字段 AES-256-GCM 加密存储，数据库里只有密文
- Bot Token、加密密钥等敏感配置通过 Cloudflare Secrets 加密保存，不在代码里
- 管理接口（/init、/setWebhook）需要密钥才能访问
- 通过 Telegram User ID 做身份验证，只有你能操作
- 其他所有路径返回 404

## 前置条件

- 一个 Cloudflare 账号（免费就行）
- Node.js 18+
- 一个 Telegram Bot（找 [@BotFather](https://t.me/BotFather) 创建）
- 你的 Telegram User ID（找 [@userinfobot](https://t.me/userinfobot) 获取）

## 部署步骤

整个过程大概 5 分钟。

### 1. 克隆项目

```bash
git clone https://github.com/cocojojo5213/mykeys.git
cd mykeys
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

浏览器会弹出来让你授权，点同意就行。

### 3. 创建数据库

```bash
npx wrangler d1 create password-bot-db
```

命令会输出一段信息，里面有个 `database_id`，把它复制下来。

打开 `wrangler.toml`，把 `your-database-id-here` 替换成你刚才拿到的 ID。

同时把 `ALLOWED_USER_ID` 改成你自己的 Telegram User ID。

### 4. 设置密钥

需要设置三个密钥：

| 密钥 | 说明 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | 找 @BotFather 创建 bot 时给你的 token |
| `ENCRYPT_KEY` | 自己想一个 32 位的字符串，用来加密密码。**设好之后别丢了也别改。** |
| `ADMIN_SECRET` | 管理密钥，用来访问初始化接口，随便设一个你记得住的 |

逐个设置：

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ENCRYPT_KEY
npx wrangler secret put ADMIN_SECRET
```

每条命令会提示你输入值，粘贴进去回车就行。

也可以创建一个临时文件批量设置：

```bash
# 创建 .secrets.json（用完记得删）
npx wrangler secret bulk .secrets.json
rm .secrets.json
```

### 5. 部署

```bash
npx wrangler deploy
```

### 6. 初始化数据库和 Webhook

浏览器访问以下地址（换成你自己的 URL 和密钥）：

```
https://mykeys.xxx.workers.dev/init?key=你的ADMIN_SECRET
https://mykeys.xxx.workers.dev/setWebhook?key=你的ADMIN_SECRET
```

搞定。打开 Telegram 找到你的 bot 就能用了。

## 使用方法

| 操作 | 方式 |
|---|---|
| **保存** | 发送：`claude claude.ai test@mail.com abc123` |
| **带备注保存** | 发送：`github github.com user pass 开了2FA` |
| **保存长文本** | 第一行：`#存 名称`，后面的内容原样保存（SSH密钥等） |
| **搜索** | 发关键词，比如 `cla`，支持模糊匹配 |
| **查看全部** | 点菜单里的 /list |
| **删除** | 查看详情时点删除按钮 |

## 注意事项

- **ENCRYPT_KEY 设好之后不要改**，改了之前存的数据就解不开了
- 建议给 Cloudflare 账号开两步验证
- 可以在 Telegram 里设置聊天自动删除消息，避免密码留在聊天记录里

## 技术栈

Cloudflare Workers / D1 / Secrets / Web Crypto API (AES-256-GCM) / TypeScript / Wrangler

## License

MIT
