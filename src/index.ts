interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_USER_ID: string;
  ENCRYPT_KEY: string;
  ADMIN_SECRET: string;
}

interface TelegramUpdate {
  message?: { chat: { id: number }; from?: { id: number }; text?: string };
  callback_query?: { id: string; from: { id: number }; message?: { chat: { id: number } }; data?: string };
}

interface SecretRow {
  id: number; name: string; site: string; account: string; password: string;
  extra: string | null; expires_at: string | null; created_at: string;
}

type SessionStep = 'idle' | 'ask_site' | 'ask_account' | 'ask_password' | 'ask_expiry' | 'ask_extra';
interface SessionData {
  step: SessionStep; name?: string; site?: string; account?: string;
  password?: string; expiresAt?: string | null; extra?: string | null;
}

// ========== 缓存密钥 ==========
let cachedKey: CryptoKey | null = null;
let cachedKeySecret: string | null = null;

async function getKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedKeySecret === secret) return cachedKey;
  const keyData = new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32));
  cachedKey = await crypto.subtle.importKey("raw", keyData, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  cachedKeySecret = secret;
  return cachedKey;
}

async function encrypt(text: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  const buf = new Uint8Array(12 + ct.byteLength);
  buf.set(iv); buf.set(new Uint8Array(ct), 12);
  return btoa(String.fromCharCode(...buf));
}

async function decrypt(b64: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
  return new TextDecoder().decode(dec);
}

// ========== 工具函数 ==========
const FULL_TO_HALF = '０１２３４５６７８９＋－＝／＼（）［］｛｝＜＞｜＆＊＠＄％＾＿｀～：；＂＇，．？！　';
const HALF_CHARS = '0123456789+-=/\\()[]{}<>|&*@$%^_`~:;"\',.?! ';

function cleanText(t: string): string {
  let r = t.replace(/\r\n?/g, '\n').replace(/^```\w*\n?/gm, '').replace(/\n?```$/gm, '');
  r = r.split('\n').map(l => l.replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]+\s*/u, '')).join('\n');
  for (let i = 0; i < FULL_TO_HALF.length; i++) r = r.split(FULL_TO_HALF[i]).join(HALF_CHARS[i]);
  return r.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function parseDate(t: string): string | null {
  const m = t.match(/^(\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  let y = m[1] ? +m[1] : new Date().getFullYear();
  const d = `${y}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  if (!m[1] && new Date(d) < new Date()) y++;
  return `${y}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
}

function expiryInfo(d: string | null): string {
  if (!d) return '';
  const days = Math.ceil((new Date(d).getTime() - Date.now()) / 864e5);
  if (days < 0) return `\n⚠️ 已过期 ${-days} 天`;
  if (days === 0) return '\n🔴 今天到期！';
  if (days <= 3) return `\n🔴 ${days} 天后到期`;
  if (days <= 7) return `\n🟡 ${days} 天后到期`;
  return days <= 30 ? `\n🟢 ${days} 天后到期` : `\n📅 ${d}`;
}

// ========== 会话 ==========
async function getSession(env: Env, uid: number): Promise<SessionData> {
  const r = await env.DB.prepare("SELECT data,updated_at FROM sessions WHERE user_id=?").bind(uid).first<{data:string,updated_at:string}>();
  if (!r || Date.now() - new Date(r.updated_at).getTime() > 3e5) return { step: 'idle' };
  return JSON.parse(r.data);
}
const setSession = (env: Env, uid: number, d: SessionData) => 
  env.DB.prepare("INSERT OR REPLACE INTO sessions(user_id,step,data,updated_at)VALUES(?,?,?,datetime('now'))").bind(uid,d.step,JSON.stringify(d)).run();
const clearSession = (env: Env, uid: number) => env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(uid).run();

// ========== Telegram API ==========
const tg = (env: Env, method: string, body: object) => 
  fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
const send = (env: Env, chatId: number, text: string) => tg(env, 'sendMessage', { chat_id: chatId, text });
const sendKb = (env: Env, chatId: number, text: string, buttons: any[][]) => 
  tg(env, 'sendMessage', { chat_id: chatId, text, reply_markup: { inline_keyboard: buttons } });

const HELP = `🔐 密码管理机器人

📝 保存：直接发送名称开始引导
📄 长文本：#存 名称\\n内容
🔍 搜索：发送关键词
📋 菜单：/menu

🔒 AES加密 ⏰ 到期提醒`;

// ========== 主入口 ==========
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/setWebhook') {
      if (url.searchParams.get('key') !== env.ADMIN_SECRET) return new Response('Forbidden', { status: 403 });
      await Promise.all([
        fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${url.origin}/webhook`),
        tg(env, 'setMyCommands', { commands: [{ command: 'menu', description: '📋 菜单' }, { command: 'help', description: '❓ 帮助' }] })
      ]);
      return new Response('OK');
    }

    if (path === '/init') {
      if (url.searchParams.get('key') !== env.ADMIN_SECRET) return new Response('Forbidden', { status: 403 });
      await env.DB.batch([
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS secrets(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,site TEXT DEFAULT'',account TEXT DEFAULT'',password TEXT DEFAULT'',extra TEXT,expires_at DATE,created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`),
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions(user_id INTEGER PRIMARY KEY,step TEXT,data TEXT,updated_at DATETIME)`)
      ]);
      return new Response('OK');
    }

    if (path === '/webhook' && req.method === 'POST') {
      const u: TelegramUpdate = await req.json();
      if (u.callback_query) { handleCallback(env, u.callback_query); return new Response('OK'); }
      const m = u.message;
      if (!m?.text || !m.from || m.from.id.toString() !== env.ALLOWED_USER_ID) return new Response('OK');
      handleMessage(env, m.chat.id, m.from.id, m.text.trim());
      return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_: ScheduledEvent, env: Env) {
    const r = await env.DB.prepare(`SELECT name,expires_at FROM secrets WHERE expires_at IS NOT NULL AND expires_at<=date('now','+7 days')`).all<SecretRow>();
    if (!r.results?.length) return;
    const g: Record<string, string[]> = { e: [], t: [], '1': [], '3': [], '7': [] };
    for (const x of r.results) {
      const d = Math.ceil((new Date(x.expires_at!).getTime() - Date.now()) / 864e5);
      g[d < 0 ? 'e' : d === 0 ? 't' : d === 1 ? '1' : d <= 3 ? '3' : '7'].push(`• ${x.name}`);
    }
    let msg = '';
    if (g.e.length) msg += `⚠️ 已过期：\n${g.e.join('\n')}\n\n`;
    if (g.t.length) msg += `🔴 今天：\n${g.t.join('\n')}\n\n`;
    if (g['1'].length) msg += `🔴 明天：\n${g['1'].join('\n')}\n\n`;
    if (g['3'].length) msg += `🟡 3天内：\n${g['3'].join('\n')}\n\n`;
    if (g['7'].length) msg += `🟢 7天内：\n${g['7'].join('\n')}`;
    if (msg) send(env, +env.ALLOWED_USER_ID, `⏰ 到期提醒\n\n${msg.trim()}`);
  }
};

// ========== 消息处理 ==========
async function handleMessage(env: Env, chatId: number, uid: number, text: string) {
  if (text === '/start' || text === '/help') return send(env, chatId, HELP);
  if (text === '/menu') return sendKb(env, chatId, '🔐 选择操作：', [
    [{ text: '📋 全部', callback_data: 'm_list' }, { text: '🔍 搜索', callback_data: 'm_search' }],
    [{ text: '⏰ 到期', callback_data: 'm_exp' }, { text: '💾 备份', callback_data: 'm_backup' }]
  ]);
  if (text === '/list') return showList(env, chatId);
  if (text === '/expiring') return showExpiring(env, chatId);
  if (text === '/backup') return sendBackup(env, chatId);
  if (text === '/cancel') { clearSession(env, uid); return send(env, chatId, '✅ 已取消'); }

  const session = await getSession(env, uid);
  if (session.step !== 'idle') return handleFlow(env, chatId, uid, text, session);

  // #存 长文本
  if (text.startsWith('#存')) {
    const nl = text.indexOf('\n');
    if (nl === -1) return send(env, chatId, '❓ 格式：#存 名称\\n内容');
    let name = text.slice(3, nl).trim(), exp: string | null = null;
    const dm = name.match(/@([\d\-\/]+)$/);
    if (dm) { exp = parseDate(dm[1]); name = name.slice(0, dm.index).trim(); }
    const content = cleanText(text.slice(nl + 1));
    if (!name || !content) return send(env, chatId, '❓ 名称和内容不能为空');
    await env.DB.prepare('INSERT INTO secrets(name,site,password,expires_at)VALUES(?,?,?,?)').bind(name, 'raw', await encrypt(content, env.ENCRYPT_KEY), exp).run();
    return send(env, chatId, `✅ 已保存「${name}」${exp ? '\n📅 ' + exp : ''}`);
  }

  // #到期 设置
  if (text.startsWith('#到期 ')) {
    const m = text.match(/^#到期\s+(\d+)\s+(.+)$/);
    if (!m) return send(env, chatId, '❓ 格式：#到期 ID 日期');
    const [, id, d] = m;
    if (d === '无') { await env.DB.prepare('UPDATE secrets SET expires_at=NULL WHERE id=?').bind(+id).run(); return send(env, chatId, '✅ 已取消'); }
    const exp = parseDate(d);
    if (!exp) return send(env, chatId, '❓ 日期格式不对');
    await env.DB.prepare('UPDATE secrets SET expires_at=? WHERE id=?').bind(exp, +id).run();
    return send(env, chatId, `✅ 到期：${exp}`);
  }

  // 搜索
  if (!text.includes(' ') && text.length <= 20) {
    const r = await env.DB.prepare('SELECT id,name,site FROM secrets WHERE name LIKE ? OR site LIKE ? LIMIT 5').bind(`%${text}%`, `%${text}%`).all<SecretRow>();
    if (r.results?.length) {
      if (r.results.length === 1) return showDetail(env, chatId, r.results[0].id);
      return sendKb(env, chatId, `🔍 找到 ${r.results.length} 条：`, r.results.map(x => [{ text: `${x.name} (${x.site})`, callback_data: `v_${x.id}` }]));
    }
  }

  // 新建
  await setSession(env, uid, { step: 'ask_site', name: text });
  send(env, chatId, `📝 保存「${text}」\n\n🌐 请输入网站：`);
}

// ========== 会话流程 ==========
async function handleFlow(env: Env, chatId: number, uid: number, text: string, s: SessionData) {
  if (s.step === 'ask_site') { s.site = text; s.step = 'ask_account'; await setSession(env, uid, s); return send(env, chatId, '👤 请输入账号：'); }
  if (s.step === 'ask_account') { s.account = text; s.step = 'ask_password'; await setSession(env, uid, s); return send(env, chatId, '🔑 请输入密码：'); }
  if (s.step === 'ask_password') {
    s.password = text; s.step = 'ask_expiry'; await setSession(env, uid, s);
    return sendKb(env, chatId, '📅 设置到期？', [
      [{ text: '不需要', callback_data: 'e_0' }],
      [{ text: '7天', callback_data: 'e_7' }, { text: '30天', callback_data: 'e_30' }, { text: '90天', callback_data: 'e_90' }],
      [{ text: '自定义', callback_data: 'e_c' }]
    ]);
  }
  if (s.step === 'ask_expiry') {
    const exp = parseDate(text);
    if (!exp) return send(env, chatId, '❓ 格式：2025-12-31 或 12-31');
    s.expiresAt = exp; s.step = 'ask_extra'; await setSession(env, uid, s);
    return sendKb(env, chatId, `📅 ${exp}\n\n📝 添加备注？`, [[{ text: '不需要，保存', callback_data: 'x_0' }]]);
  }
  if (s.step === 'ask_extra') { s.extra = text; return saveFinish(env, chatId, uid, s); }
}

async function saveFinish(env: Env, chatId: number, uid: number, s: SessionData) {
  const [encA, encP, encX] = await Promise.all([
    encrypt(s.account!, env.ENCRYPT_KEY),
    encrypt(s.password!, env.ENCRYPT_KEY),
    s.extra ? encrypt(s.extra, env.ENCRYPT_KEY) : null
  ]);
  await Promise.all([
    env.DB.prepare('INSERT INTO secrets(name,site,account,password,extra,expires_at)VALUES(?,?,?,?,?,?)').bind(s.name, s.site, encA, encP, encX, s.expiresAt || null).run(),
    clearSession(env, uid)
  ]);
  send(env, chatId, `✅ 保存成功！\n\n🏷️ ${s.name}\n🌐 ${s.site}\n👤 ${s.account}\n🔑 ******${s.extra ? '\n📝 ' + s.extra : ''}${s.expiresAt ? '\n📅 ' + s.expiresAt : ''}`);
}

// ========== 回调处理 ==========
async function handleCallback(env: Env, cb: NonNullable<TelegramUpdate['callback_query']>) {
  const chatId = cb.message?.chat.id, uid = cb.from.id, d = cb.data;
  if (!chatId || !d) return;
  tg(env, 'answerCallbackQuery', { callback_query_id: cb.id });
  if (uid.toString() !== env.ALLOWED_USER_ID) return;

  // 菜单
  if (d === 'm_list') return showList(env, chatId);
  if (d === 'm_exp') return showExpiring(env, chatId);
  if (d === 'm_backup') return sendBackup(env, chatId);
  if (d === 'm_search') return send(env, chatId, '🔍 直接发送关键词搜索');

  // 到期选择
  if (d.startsWith('e_')) {
    const s = await getSession(env, uid);
    if (s.step !== 'ask_expiry') return;
    if (d === 'e_c') return send(env, chatId, '📅 请输入日期（如 2025-12-31）：');
    const days = +d.slice(2);
    s.expiresAt = days ? new Date(Date.now() + days * 864e5).toISOString().slice(0, 10) : null;
    s.step = 'ask_extra'; await setSession(env, uid, s);
    return sendKb(env, chatId, `${s.expiresAt ? '📅 ' + s.expiresAt + '\n\n' : ''}📝 添加备注？`, [[{ text: '不需要，保存', callback_data: 'x_0' }]]);
  }

  // 备注
  if (d === 'x_0') { const s = await getSession(env, uid); if (s.step === 'ask_extra') { s.extra = null; return saveFinish(env, chatId, uid, s); } }

  // 查看
  if (d.startsWith('v_')) return showDetail(env, chatId, +d.slice(2));

  // 删除模式
  if (d === 'del_mode') {
    const r = await env.DB.prepare('SELECT id,name,site FROM secrets ORDER BY created_at DESC').all<SecretRow>();
    if (!r.results?.length) return send(env, chatId, '📭 没有记录');
    return sendKb(env, chatId, '🗑️ 点击删除：', r.results.map(x => [{ text: `❌ ${x.name}`, callback_data: `d_${x.id}` }]));
  }

  // 删除
  if (d.startsWith('d_')) {
    const id = +d.slice(2);
    const r = await env.DB.prepare('SELECT name FROM secrets WHERE id=?').bind(id).first<SecretRow>();
    await env.DB.prepare('DELETE FROM secrets WHERE id=?').bind(id).run();
    return send(env, chatId, `🗑️ 已删除「${r?.name || id}」`);
  }

  // 设置到期
  if (d.startsWith('s_')) return send(env, chatId, `📅 回复：#到期 ${d.slice(2)} 2025-12-31\n取消：#到期 ${d.slice(2)} 无`);
}

// ========== 列表/详情/备份 ==========
async function showList(env: Env, chatId: number) {
  const r = await env.DB.prepare('SELECT id,name,site,expires_at FROM secrets ORDER BY created_at DESC').all<SecretRow>();
  if (!r.results?.length) return send(env, chatId, '📭 没有数据');
  const btns = r.results.map(x => {
    let l = `${x.name} (${x.site})`;
    if (x.expires_at) { const d = Math.ceil((new Date(x.expires_at).getTime() - Date.now()) / 864e5); if (d <= 0) l = '⚠️ ' + l; else if (d <= 7) l = '🔴 ' + l; }
    return [{ text: l, callback_data: `v_${x.id}` }];
  });
  btns.push([{ text: '🗑️ 删除模式', callback_data: 'del_mode' }]);
  sendKb(env, chatId, '📋 点击查看：', btns);
}

async function showExpiring(env: Env, chatId: number) {
  const r = await env.DB.prepare(`SELECT id,name,expires_at FROM secrets WHERE expires_at IS NOT NULL AND expires_at<=date('now','+30 days') ORDER BY expires_at`).all<SecretRow>();
  if (!r.results?.length) return send(env, chatId, '✅ 30天内没有到期');
  sendKb(env, chatId, '⏰ 即将到期：', r.results.map(x => {
    const d = Math.ceil((new Date(x.expires_at!).getTime() - Date.now()) / 864e5);
    return [{ text: `${d <= 0 ? '⚠️' : d <= 3 ? '🔴' : d <= 7 ? '🟡' : '🟢'} ${x.name} (${d}天)`, callback_data: `v_${x.id}` }];
  }));
}

async function showDetail(env: Env, chatId: number, id: number) {
  const r = await env.DB.prepare('SELECT * FROM secrets WHERE id=?').bind(id).first<SecretRow>();
  if (!r) return send(env, chatId, '❌ 不存在');
  let msg: string;
  if (r.site === 'raw') {
    msg = `🔐 ${r.name}\n\n${await decrypt(r.password, env.ENCRYPT_KEY)}`;
  } else {
    const [a, p, x] = await Promise.all([decrypt(r.account, env.ENCRYPT_KEY), decrypt(r.password, env.ENCRYPT_KEY), r.extra ? decrypt(r.extra, env.ENCRYPT_KEY) : null]);
    msg = `🔐 ${r.name}\n🌐 ${r.site}\n👤 ${a}\n🔑 ${p}${x ? '\n📝 ' + x : ''}`;
  }
  sendKb(env, chatId, msg + expiryInfo(r.expires_at), [[{ text: '📅 设置到期', callback_data: `s_${r.id}` }], [{ text: '🗑️ 删除', callback_data: `d_${r.id}` }]]);
}

async function sendBackup(env: Env, chatId: number) {
  const r = await env.DB.prepare('SELECT * FROM secrets ORDER BY created_at DESC').all<SecretRow>();
  if (!r.results?.length) return send(env, chatId, '📭 没有数据');
  const data = await Promise.all(r.results.map(async x => {
    if (x.site === 'raw') return { id: x.id, name: x.name, type: 'raw', content: await decrypt(x.password, env.ENCRYPT_KEY), expires_at: x.expires_at };
    const [a, p, e] = await Promise.all([decrypt(x.account, env.ENCRYPT_KEY), decrypt(x.password, env.ENCRYPT_KEY), x.extra ? decrypt(x.extra, env.ENCRYPT_KEY) : null]);
    return { id: x.id, name: x.name, site: x.site, account: a, password: p, extra: e, expires_at: x.expires_at };
  }));
  const fd = new FormData();
  fd.append('chat_id', chatId.toString());
  fd.append('document', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `backup_${new Date().toISOString().slice(0, 10)}.json`);
  fd.append('caption', `💾 备份 ${data.length} 条\n⚠️ 明文密码，妥善保管！`);
  fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd });
}
