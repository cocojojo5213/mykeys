interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_USER_ID: string;
  ENCRYPT_KEY: string;
  ADMIN_SECRET: string;
}

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
  };
}

interface SecretRow {
  id: number;
  name: string;
  site: string;
  account: string;
  password: string;
  extra: string | null;
}

// ========== 加密工具 ==========

async function deriveKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32));
  return crypto.subtle.importKey("raw", keyData, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encrypt(text: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  // iv(12字节) + 密文 -> base64
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(b64: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const combined = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

// ========== 帮助文本 ==========

const HELP_TEXT = `🔐 密码管理机器人

保存账号（空格分隔）：
  用途 网站 账号 密码
  用途 网站 账号 密码 备注

例如：
  claude claude.ai test@mail.com mypass123

保存长文本（SSH密钥等）：
  第一行：#存 名称
  后面的内容原样保存

例如：
  #存 服务器密钥
  -----BEGIN OPENSSH PRIVATE KEY-----
  xxxxx
  -----END OPENSSH PRIVATE KEY-----

查询：直接输入关键词，模糊搜索

菜单命令：
  /list - 查看所有已保存条目
  /help - 显示帮助

🔒 所有敏感信息 AES-GCM 加密存储`;

// ========== 主入口 ==========

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 管理接口需要密钥验证
    if (url.pathname === "/setWebhook") {
      if (url.searchParams.get("key") !== env.ADMIN_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`
      );
      await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commands: [
              { command: "list", description: "📋 查看所有已保存条目" },
              { command: "help", description: "❓ 显示帮助信息" },
            ],
          }),
        }
      );
      return new Response(await res.text());
    }

    if (url.pathname === "/init") {
      if (url.searchParams.get("key") !== env.ADMIN_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS secrets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          site TEXT NOT NULL DEFAULT '',
          account TEXT NOT NULL DEFAULT '',
          password TEXT NOT NULL DEFAULT '',
          extra TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      return new Response("数据库初始化完成");
    }

    // Telegram webhook
    if (url.pathname === "/webhook" && request.method === "POST") {
      const update: TelegramUpdate = await request.json();

      if (update.callback_query) {
        await handleCallback(env, update.callback_query);
        return new Response("OK");
      }

      const message = update.message;
      if (!message?.text || !message.from) return new Response("OK");

      if (message.from.id.toString() !== env.ALLOWED_USER_ID) {
        await sendMessage(env, message.chat.id, "⛔ 你没有权限使用此机器人");
        return new Response("OK");
      }

      await handleMessage(env, message.chat.id, message.text.trim());
      return new Response("OK");
    }

    // 其他路径一律 404
    return new Response("Not Found", { status: 404 });
  },
};

// ========== 消息处理 ==========

async function handleMessage(env: Env, chatId: number, text: string) {
  if (text === "/start" || text === "/help") {
    return sendMessage(env, chatId, HELP_TEXT);
  }

  if (text === "/list") {
    return showList(env, chatId);
  }

  // 多行保存模式：#存 名称\n内容
  if (text.startsWith("#存 ") || text.startsWith("#存\n")) {
    const firstLineEnd = text.indexOf("\n");
    if (firstLineEnd === -1) {
      return sendMessage(env, chatId, "❓ 格式：#存 名称\\n内容");
    }
    const name = text.slice(3, firstLineEnd).trim();
    const content = text.slice(firstLineEnd + 1).trim();
    if (!name || !content) {
      return sendMessage(env, chatId, "❓ 名称和内容都不能为空");
    }

    const encContent = await encrypt(content, env.ENCRYPT_KEY);

    await env.DB.prepare(
      "INSERT INTO secrets (name, site, account, password, extra) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(name, "raw", "", encContent, null)
      .run();

    const preview = content.length > 30 ? content.slice(0, 30) + "..." : content;
    return sendMessage(env, chatId, `✅ 已保存「${name}」\n📄 ${preview}`);
  }

  // 4段以上 = 保存账号密码
  const parts = text.split(/\s+/);
  if (parts.length >= 4) {
    const [name, site, account, password, ...rest] = parts;
    const extra = rest.length > 0 ? rest.join(" ") : null;

    const encAccount = await encrypt(account, env.ENCRYPT_KEY);
    const encPassword = await encrypt(password, env.ENCRYPT_KEY);
    const encExtra = extra ? await encrypt(extra, env.ENCRYPT_KEY) : null;

    await env.DB.prepare(
      "INSERT INTO secrets (name, site, account, password, extra) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(name, site, encAccount, encPassword, encExtra)
      .run();

    return sendMessage(
      env,
      chatId,
      `✅ 已保存「${name}」\n🌐 ${site}\n👤 ${account}\n🔑 ******`
    );
  }

  // 1-2段 = 搜索
  if (parts.length <= 2) {
    return fuzzySearch(env, chatId, text);
  }

  return sendMessage(
    env,
    chatId,
    "❓ 格式不对\n\n保存：用途 网站 账号 密码 [备注]\n搜索：直接输入关键词"
  );
}

// ========== 列表 ==========

async function showList(env: Env, chatId: number) {
  const result = await env.DB.prepare(
    "SELECT id, name, site FROM secrets ORDER BY created_at DESC"
  ).all<SecretRow>();

  if (!result.results?.length) {
    return sendMessage(env, chatId, "📭 还没有保存任何信息");
  }

  const buttons = result.results.map((r) => [
    { text: `${r.name} (${r.site})`, callback_data: `view_${r.id}` },
  ]);
  buttons.push([{ text: "🗑️ 进入删除模式", callback_data: "delete_mode" }]);

  await sendMessageWithKeyboard(env, chatId, "📋 点击查看详情：", buttons);
}

// ========== 模糊搜索 ==========

async function fuzzySearch(env: Env, chatId: number, keyword: string) {
  const like = `%${keyword}%`;
  // name 和 site 是明文，可以搜索
  const result = await env.DB.prepare(
    "SELECT id, name, site FROM secrets WHERE name LIKE ? OR site LIKE ? ORDER BY created_at DESC LIMIT 10"
  )
    .bind(like, like)
    .all<SecretRow>();

  if (!result.results?.length) {
    return sendMessage(env, chatId, `🔍 没有找到与「${keyword}」相关的记录`);
  }

  if (result.results.length === 1) {
    return showDetail(env, chatId, result.results[0].id);
  }

  const buttons = result.results.map((r) => [
    { text: `${r.name} (${r.site})`, callback_data: `view_${r.id}` },
  ]);

  await sendMessageWithKeyboard(
    env,
    chatId,
    `🔍 找到 ${result.results.length} 条相关记录：`,
    buttons
  );
}

// ========== 详情（解密） ==========

async function showDetail(env: Env, chatId: number, id: number) {
  const row = await env.DB.prepare("SELECT * FROM secrets WHERE id = ?")
    .bind(id)
    .first<SecretRow>();

  if (!row) {
    return sendMessage(env, chatId, "❌ 记录不存在");
  }

  let msg: string;

  if (row.site === "raw") {
    // 长文本模式
    const content = await decrypt(row.password, env.ENCRYPT_KEY);
    msg = `🔐 ${row.name}\n\n${content}`;
  } else {
    // 账号密码模式
    const account = await decrypt(row.account, env.ENCRYPT_KEY);
    const password = await decrypt(row.password, env.ENCRYPT_KEY);
    const extra = row.extra ? await decrypt(row.extra, env.ENCRYPT_KEY) : null;
    msg = `🔐 ${row.name}\n🌐 ${row.site}\n👤 ${account}\n🔑 ${password}`;
    if (extra) msg += `\n📝 ${extra}`;
  }

  const buttons = [[{ text: "🗑️ 删除", callback_data: `del_${row.id}` }]];
  await sendMessageWithKeyboard(env, chatId, msg, buttons);
}

// ========== 按钮回调 ==========

async function handleCallback(
  env: Env,
  cb: NonNullable<TelegramUpdate["callback_query"]>
) {
  const chatId = cb.message?.chat.id;
  const data = cb.data;
  if (!chatId || !data) return;

  await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cb.id }),
    }
  );

  if (cb.from.id.toString() !== env.ALLOWED_USER_ID) return;

  if (data.startsWith("view_")) {
    return showDetail(env, chatId, parseInt(data.slice(5)));
  }

  if (data === "delete_mode") {
    const result = await env.DB.prepare(
      "SELECT id, name, site FROM secrets ORDER BY created_at DESC"
    ).all<SecretRow>();

    if (!result.results?.length) {
      return sendMessage(env, chatId, "📭 没有可删除的记录");
    }

    const buttons = result.results.map((r) => [
      { text: `❌ ${r.name} (${r.site})`, callback_data: `del_${r.id}` },
    ]);
    return sendMessageWithKeyboard(env, chatId, "🗑️ 点击要删除的条目：", buttons);
  }

  if (data.startsWith("del_")) {
    const id = parseInt(data.slice(4));
    const row = await env.DB.prepare("SELECT name FROM secrets WHERE id = ?")
      .bind(id)
      .first<SecretRow>();
    await env.DB.prepare("DELETE FROM secrets WHERE id = ?").bind(id).run();
    return sendMessage(env, chatId, `🗑️ 已删除「${row?.name || id}」`);
  }
}

// ========== Telegram API ==========

async function sendMessage(env: Env, chatId: number, text: string) {
  await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  );
}

async function sendMessageWithKeyboard(
  env: Env,
  chatId: number,
  text: string,
  buttons: any[][]
) {
  await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: { inline_keyboard: buttons },
      }),
    }
  );
}
