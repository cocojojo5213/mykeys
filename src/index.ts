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
  expires_at: string | null;
}

interface SessionRow {
  user_id: number;
  step: string;
  data: string;
  updated_at: string;
}

// 会话步骤
type SessionStep = 'idle' | 'ask_site' | 'ask_account' | 'ask_password' | 'ask_expiry' | 'ask_extra';

interface SessionData {
  step: SessionStep;
  name?: string;
  site?: string;
  account?: string;
  password?: string;
  expiresAt?: string | null;
  extra?: string | null;
}

// ========== 文本清理 ==========

function cleanTelegramText(text: string): string {
  let result = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  result = result.replace(/^```\w*\n?/gm, '').replace(/\n?```$/gm, '');
  const emojiPattern = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+\s*/gmu;
  result = result.split('\n').map(line => line.replace(emojiPattern, '')).join('\n');
  const fullToHalf: Record<string, string> = {
    '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
    '＋': '+', '－': '-', '＝': '=', '／': '/', '＼': '\\', '（': '(', '）': ')', '［': '[', '］': ']',
    '｛': '{', '｝': '}', '＜': '<', '＞': '>', '｜': '|', '＆': '&', '＊': '*', '＠': '@', '＄': '$',
    '％': '%', '＾': '^', '＿': '_', '｀': '`', '～': '~', '：': ':', '；': ';', '＂': '"', '＇': "'",
    '，': ',', '．': '.', '？': '?', '！': '!', '　': ' ',
  };
  for (const [full, half] of Object.entries(fullToHalf)) {
    result = result.split(full).join(half);
  }
  result = result.replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, '');
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

// ========== 加密工具 ==========

async function deriveKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32));
  return crypto.subtle.importKey("raw", keyData, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encrypt(text: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
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
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// ========== 会话管理 ==========

async function getSession(env: Env, userId: number): Promise<SessionData> {
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE user_id = ?").bind(userId).first<SessionRow>();
  if (!row) return { step: 'idle' };
  // 5分钟超时
  if (Date.now() - new Date(row.updated_at).getTime() > 5 * 60 * 1000) {
    await clearSession(env, userId);
    return { step: 'idle' };
  }
  return JSON.parse(row.data);
}

async function setSession(env: Env, userId: number, data: SessionData) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO sessions (user_id, step, data, updated_at) VALUES (?, ?, ?, datetime('now'))"
  ).bind(userId, data.step, JSON.stringify(data)).run();
}

async function clearSession(env: Env, userId: number) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

// ========== 日期工具 ==========

function parseExpiryDate(text: string): string | null {
  // 支持 2025-12-31, 2025/12/31, 12-31, 12/31
  const match = text.match(/^(\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  
  let year = match[1] ? parseInt(match[1]) : new Date().getFullYear();
  if (typeof year === 'string') year = parseInt(year);
  const month = match[2].padStart(2, '0');
  const day = match[3].padStart(2, '0');
  
  // 如果没有年份且日期已过，用明年
  if (!match[1]) {
    const testDate = new Date(`${year}-${month}-${day}`);
    if (testDate < new Date()) year++;
  }
  
  return `${year}-${month}-${day}`;
}

function formatExpiryInfo(expiresAt: string | null): string {
  if (!expiresAt) return '';
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `\n⚠️ 已过期 ${-days} 天`;
  if (days === 0) return `\n🔴 今天到期！`;
  if (days <= 3) return `\n🔴 ${days} 天后到期`;
  if (days <= 7) return `\n🟡 ${days} 天后到期`;
  if (days <= 30) return `\n🟢 ${days} 天后到期`;
  return `\n📅 到期：${expiresAt}`;
}

// ========== 帮助文本 ==========

const HELP_TEXT = `🔐 密码管理机器人

📝 保存账号：直接发送名称开始引导
例如：gpt team车位号

📄 保存长文本（SSH密钥等）：
  #存 名称 [@到期日期]
  内容...

🔍 查询：直接输入关键词

📋 命令：
  /list - 所有条目
  /expiring - 即将到期
  /cancel - 取消当前操作
  /help - 帮助

🔒 AES-GCM 加密存储
⏰ 到期自动提醒`;

// ========== 主入口 ==========

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/setWebhook") {
      if (url.searchParams.get("key") !== env.ADMIN_SECRET) return new Response("Forbidden", { status: 403 });
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commands: [
            { command: "list", description: "📋 查看所有条目" },
            { command: "expiring", description: "⏰ 即将到期" },
            { command: "cancel", description: "❌ 取消当前操作" },
            { command: "help", description: "❓ 帮助" },
          ],
        }),
      });
      return new Response(await res.text());
    }

    if (url.pathname === "/init") {
      if (url.searchParams.get("key") !== env.ADMIN_SECRET) return new Response("Forbidden", { status: 403 });
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS secrets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          site TEXT NOT NULL DEFAULT '',
          account TEXT NOT NULL DEFAULT '',
          password TEXT NOT NULL DEFAULT '',
          extra TEXT,
          expires_at DATE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS sessions (
          user_id INTEGER PRIMARY KEY,
          step TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      try { await env.DB.prepare("ALTER TABLE secrets ADD COLUMN expires_at DATE").run(); } catch {}
      return new Response("数据库初始化完成");
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      const update: TelegramUpdate = await request.json();
      if (update.callback_query) {
        await handleCallback(env, update.callback_query);
        return new Response("OK");
      }
      const message = update.message;
      if (!message?.text || !message.from) return new Response("OK");
      if (message.from.id.toString() !== env.ALLOWED_USER_ID) {
        await sendMessage(env, message.chat.id, "⛔ 无权限");
        return new Response("OK");
      }
      await handleMessage(env, message.chat.id, message.from.id, message.text.trim());
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await checkExpiryReminders(env);
  },
};

// ========== 消息处理 ==========

async function handleMessage(env: Env, chatId: number, userId: number, text: string) {
  // 命令处理
  if (text === "/start" || text === "/help") return sendMessage(env, chatId, HELP_TEXT);
  if (text === "/list") return showList(env, chatId);
  if (text === "/expiring") return showExpiring(env, chatId);
  if (text === "/cancel") {
    await clearSession(env, userId);
    return sendMessage(env, chatId, "✅ 已取消");
  }

  // 获取会话状态
  const session = await getSession(env, userId);

  // 处理会话流程
  if (session.step !== 'idle') {
    return handleSessionFlow(env, chatId, userId, text, session);
  }

  // 长文本保存：#存 名称
  if (text.startsWith("#存 ") || text.startsWith("#存\n")) {
    const firstLineEnd = text.indexOf("\n");
    if (firstLineEnd === -1) return sendMessage(env, chatId, "❓ 格式：#存 名称\\n内容");
    
    let firstLine = text.slice(3, firstLineEnd).trim();
    let expiresAt: string | null = null;
    const dateMatch = firstLine.match(/@([\d\-\/]+)$/);
    if (dateMatch) {
      expiresAt = parseExpiryDate(dateMatch[1]);
      firstLine = firstLine.slice(0, dateMatch.index).trim();
    }
    
    let content = cleanTelegramText(text.slice(firstLineEnd + 1).trim());
    if (!firstLine || !content) return sendMessage(env, chatId, "❓ 名称和内容都不能为空");

    const encContent = await encrypt(content, env.ENCRYPT_KEY);
    await env.DB.prepare(
      "INSERT INTO secrets (name, site, account, password, extra, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(firstLine, "raw", "", encContent, null, expiresAt).run();

    let msg = `✅ 已保存「${firstLine}」`;
    if (expiresAt) msg += `\n📅 到期：${expiresAt}`;
    return sendMessage(env, chatId, msg);
  }

  // 设置到期：#到期 ID 日期
  if (text.startsWith("#到期 ")) {
    const match = text.match(/^#到期\s+(\d+)\s+(.+)$/);
    if (!match) return sendMessage(env, chatId, "❓ 格式：#到期 ID 2025-12-31");
    const id = parseInt(match[1]);
    const dateStr = match[2].trim();
    if (dateStr === "无" || dateStr === "取消") {
      await env.DB.prepare("UPDATE secrets SET expires_at = NULL WHERE id = ?").bind(id).run();
      return sendMessage(env, chatId, "✅ 已取消到期日期");
    }
    const expiresAt = parseExpiryDate(dateStr);
    if (!expiresAt) return sendMessage(env, chatId, "❓ 日期格式不对");
    await env.DB.prepare("UPDATE secrets SET expires_at = ? WHERE id = ?").bind(expiresAt, id).run();
    return sendMessage(env, chatId, `✅ 到期：${expiresAt}`);
  }

  // 单词搜索
  if (!text.includes(" ") && text.length <= 20) {
    const like = `%${text}%`;
    const result = await env.DB.prepare(
      "SELECT id, name, site FROM secrets WHERE name LIKE ? OR site LIKE ? LIMIT 5"
    ).bind(like, like).all<SecretRow>();
    
    if (result.results?.length) {
      if (result.results.length === 1) return showDetail(env, chatId, result.results[0].id);
      const buttons = result.results.map(r => [{ text: `${r.name} (${r.site})`, callback_data: `view_${r.id}` }]);
      return sendMessageWithKeyboard(env, chatId, `🔍 找到 ${result.results.length} 条：`, buttons);
    }
  }

  // 开始新的保存流程
  await setSession(env, userId, { step: 'ask_site', name: text });
  return sendMessage(env, chatId, `📝 保存「${text}」\n\n🌐 请输入网站：`);
}

// ========== 会话流程处理 ==========

async function handleSessionFlow(env: Env, chatId: number, userId: number, text: string, session: SessionData) {
  switch (session.step) {
    case 'ask_site':
      session.site = text;
      session.step = 'ask_account';
      await setSession(env, userId, session);
      return sendMessage(env, chatId, "👤 请输入账号：");

    case 'ask_account':
      session.account = text;
      session.step = 'ask_password';
      await setSession(env, userId, session);
      return sendMessage(env, chatId, "🔑 请输入密码：");

    case 'ask_password':
      session.password = text;
      session.step = 'ask_expiry';
      await setSession(env, userId, session);
      return sendMessageWithKeyboard(env, chatId, "📅 需要设置到期提醒吗？", [
        [{ text: "不需要", callback_data: "exp_no" }],
        [{ text: "7天后", callback_data: "exp_7" }, { text: "30天后", callback_data: "exp_30" }],
        [{ text: "90天后", callback_data: "exp_90" }, { text: "1年后", callback_data: "exp_365" }],
        [{ text: "自定义日期", callback_data: "exp_custom" }],
      ]);

    case 'ask_expiry':
      // 用户输入自定义日期
      const expiresAt = parseExpiryDate(text);
      if (!expiresAt) {
        return sendMessage(env, chatId, "❓ 日期格式不对，请用 2025-12-31 或 12-31 格式：");
      }
      session.expiresAt = expiresAt;
      session.step = 'ask_extra';
      await setSession(env, userId, session);
      return sendMessageWithKeyboard(env, chatId, `📅 到期：${expiresAt}\n\n📝 需要添加备注吗？`, [
        [{ text: "不需要，直接保存", callback_data: "extra_no" }],
      ]);

    case 'ask_extra':
      session.extra = text;
      return saveAndFinish(env, chatId, userId, session);
  }
}

async function saveAndFinish(env: Env, chatId: number, userId: number, session: SessionData) {
  const encAccount = await encrypt(session.account!, env.ENCRYPT_KEY);
  const encPassword = await encrypt(session.password!, env.ENCRYPT_KEY);
  const encExtra = session.extra ? await encrypt(session.extra, env.ENCRYPT_KEY) : null;

  await env.DB.prepare(
    "INSERT INTO secrets (name, site, account, password, extra, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(session.name, session.site, encAccount, encPassword, encExtra, session.expiresAt || null).run();

  await clearSession(env, userId);

  let msg = `✅ 保存成功！\n\n🏷️ ${session.name}\n🌐 ${session.site}\n👤 ${session.account}\n🔑 ******`;
  if (session.extra) msg += `\n📝 ${session.extra}`;
  if (session.expiresAt) msg += `\n📅 到期：${session.expiresAt}`;
  
  return sendMessage(env, chatId, msg);
}

// ========== 按钮回调 ==========

async function handleCallback(env: Env, cb: NonNullable<TelegramUpdate["callback_query"]>) {
  const chatId = cb.message?.chat.id;
  const userId = cb.from.id;
  const data = cb.data;
  if (!chatId || !data) return;

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id }),
  });

  if (userId.toString() !== env.ALLOWED_USER_ID) return;

  // 到期日期选择
  if (data.startsWith("exp_")) {
    const session = await getSession(env, userId);
    if (session.step !== 'ask_expiry') return;

    if (data === "exp_no") {
      session.expiresAt = null;
    } else if (data === "exp_custom") {
      return sendMessage(env, chatId, "📅 请输入到期日期（如 2025-12-31 或 12-31）：");
    } else {
      const days = parseInt(data.slice(4));
      const date = new Date();
      date.setDate(date.getDate() + days);
      session.expiresAt = date.toISOString().split('T')[0];
    }

    session.step = 'ask_extra';
    await setSession(env, userId, session);
    
    const expiryText = session.expiresAt ? `📅 到期：${session.expiresAt}\n\n` : '';
    return sendMessageWithKeyboard(env, chatId, `${expiryText}📝 需要添加备注吗？`, [
      [{ text: "不需要，直接保存", callback_data: "extra_no" }],
    ]);
  }

  // 备注选择
  if (data === "extra_no") {
    const session = await getSession(env, userId);
    if (session.step !== 'ask_extra') return;
    session.extra = null;
    return saveAndFinish(env, chatId, userId, session);
  }

  // 查看详情
  if (data.startsWith("view_")) {
    return showDetail(env, chatId, parseInt(data.slice(5)));
  }

  // 删除模式
  if (data === "delete_mode") {
    const result = await env.DB.prepare("SELECT id, name, site FROM secrets ORDER BY created_at DESC").all<SecretRow>();
    if (!result.results?.length) return sendMessage(env, chatId, "📭 没有记录");
    const buttons = result.results.map(r => [{ text: `❌ ${r.name} (${r.site})`, callback_data: `del_${r.id}` }]);
    return sendMessageWithKeyboard(env, chatId, "🗑️ 点击删除：", buttons);
  }

  // 删除
  if (data.startsWith("del_")) {
    const id = parseInt(data.slice(4));
    const row = await env.DB.prepare("SELECT name FROM secrets WHERE id = ?").bind(id).first<SecretRow>();
    await env.DB.prepare("DELETE FROM secrets WHERE id = ?").bind(id).run();
    return sendMessage(env, chatId, `🗑️ 已删除「${row?.name || id}」`);
  }

  // 设置到期
  if (data.startsWith("setexp_")) {
    const id = parseInt(data.slice(7));
    return sendMessage(env, chatId, `📅 回复设置到期：\n#到期 ${id} 2025-12-31\n\n取消到期：\n#到期 ${id} 无`);
  }
}

// ========== 列表和详情 ==========

async function showList(env: Env, chatId: number) {
  const result = await env.DB.prepare(
    "SELECT id, name, site, expires_at FROM secrets ORDER BY created_at DESC"
  ).all<SecretRow>();

  if (!result.results?.length) return sendMessage(env, chatId, "📭 还没有保存任何信息");

  const buttons = result.results.map(r => {
    let label = `${r.name} (${r.site})`;
    if (r.expires_at) {
      const days = Math.ceil((new Date(r.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (days <= 0) label = `⚠️ ${label}`;
      else if (days <= 7) label = `🔴 ${label}`;
    }
    return [{ text: label, callback_data: `view_${r.id}` }];
  });
  buttons.push([{ text: "🗑️ 删除模式", callback_data: "delete_mode" }]);
  await sendMessageWithKeyboard(env, chatId, "📋 点击查看：", buttons);
}

async function showExpiring(env: Env, chatId: number) {
  const result = await env.DB.prepare(
    `SELECT id, name, site, expires_at FROM secrets 
     WHERE expires_at IS NOT NULL AND expires_at <= date('now', '+30 days')
     ORDER BY expires_at ASC`
  ).all<SecretRow>();

  if (!result.results?.length) return sendMessage(env, chatId, "✅ 30天内没有到期");

  const buttons = result.results.map(r => {
    const days = Math.ceil((new Date(r.expires_at!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    let icon = days <= 0 ? '⚠️' : days <= 3 ? '🔴' : days <= 7 ? '🟡' : '🟢';
    return [{ text: `${icon} ${r.name} (${days}天)`, callback_data: `view_${r.id}` }];
  });
  await sendMessageWithKeyboard(env, chatId, "⏰ 即将到期：", buttons);
}

async function showDetail(env: Env, chatId: number, id: number) {
  const row = await env.DB.prepare("SELECT * FROM secrets WHERE id = ?").bind(id).first<SecretRow>();
  if (!row) return sendMessage(env, chatId, "❌ 不存在");

  let msg: string;
  if (row.site === "raw") {
    const content = await decrypt(row.password, env.ENCRYPT_KEY);
    msg = `🔐 ${row.name}\n\n${content}`;
  } else {
    const account = await decrypt(row.account, env.ENCRYPT_KEY);
    const password = await decrypt(row.password, env.ENCRYPT_KEY);
    const extra = row.extra ? await decrypt(row.extra, env.ENCRYPT_KEY) : null;
    msg = `🔐 ${row.name}\n🌐 ${row.site}\n👤 ${account}\n🔑 ${password}`;
    if (extra) msg += `\n📝 ${extra}`;
  }
  msg += formatExpiryInfo(row.expires_at);

  const buttons = [
    [{ text: "📅 设置到期", callback_data: `setexp_${row.id}` }],
    [{ text: "🗑️ 删除", callback_data: `del_${row.id}` }]
  ];
  await sendMessageWithKeyboard(env, chatId, msg, buttons);
}

// ========== 到期提醒 ==========

async function checkExpiryReminders(env: Env) {
  const chatId = parseInt(env.ALLOWED_USER_ID);
  const result = await env.DB.prepare(`
    SELECT name, site, expires_at FROM secrets 
    WHERE expires_at IS NOT NULL AND expires_at <= date('now', '+7 days')
    ORDER BY expires_at ASC
  `).all<SecretRow>();

  if (!result.results?.length) return;

  const groups: Record<string, string[]> = { expired: [], today: [], in1: [], in3: [], in7: [] };
  
  for (const r of result.results) {
    const days = Math.ceil((new Date(r.expires_at!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const item = `• ${r.name}`;
    if (days < 0) groups.expired.push(item);
    else if (days === 0) groups.today.push(item);
    else if (days === 1) groups.in1.push(item);
    else if (days <= 3) groups.in3.push(item);
    else groups.in7.push(item);
  }

  let msg = '';
  if (groups.expired.length) msg += `⚠️ 已过期：\n${groups.expired.join('\n')}\n\n`;
  if (groups.today.length) msg += `🔴 今天到期：\n${groups.today.join('\n')}\n\n`;
  if (groups.in1.length) msg += `🔴 明天到期：\n${groups.in1.join('\n')}\n\n`;
  if (groups.in3.length) msg += `🟡 3天内：\n${groups.in3.join('\n')}\n\n`;
  if (groups.in7.length) msg += `🟢 7天内：\n${groups.in7.join('\n')}`;

  if (msg) await sendMessage(env, chatId, `⏰ 到期提醒\n\n${msg.trim()}`);
}

// ========== Telegram API ==========

async function sendMessage(env: Env, chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendMessageWithKeyboard(env: Env, chatId: number, text: string, buttons: any[][]) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: { inline_keyboard: buttons } }),
  });
}
