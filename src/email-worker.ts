/**
 * Email Worker - 接收邮件并转发到 Telegram
 * 
 * 此 Worker 需要与主 Bot Worker 配合使用：
 * 1. 共享同一个 D1 数据库
 * 2. 共享 TELEGRAM_BOT_TOKEN 和 ENCRYPT_KEY secrets
 * 3. 在 Cloudflare Email Routing 中配置 catch-all 规则指向此 Worker
 */

interface Env {
    DB: D1Database;
    TELEGRAM_BOT_TOKEN: string;
    ALLOWED_USER_ID: string;
    ENCRYPT_KEY: string;
}

interface EmailRow {
    id: number;
    address: string;
}

// ========== 加密 ==========
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

// ========== Telegram ==========
const send = (env: Env, text: string) =>
    fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.ALLOWED_USER_ID, text })
    });

// ========== 邮件处理 ==========
async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return new TextDecoder().decode(result);
}

function extractTextFromEmail(rawEmail: string): string {
    // 简单解析：查找空行后的内容作为正文
    const parts = rawEmail.split(/\r?\n\r?\n/);
    if (parts.length < 2) return rawEmail;

    let body = parts.slice(1).join('\n\n');

    // 处理 quoted-printable 编码
    body = body.replace(/=\r?\n/g, '');
    body = body.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

    // 处理 base64 编码（如果检测到）
    if (/^[A-Za-z0-9+/=\s]+$/.test(body.trim())) {
        try {
            body = atob(body.replace(/\s/g, ''));
        } catch {
            // 不是有效的 base64，保持原样
        }
    }

    // 移除 HTML 标签
    body = body.replace(/<[^>]+>/g, '');

    // 清理多余空白
    body = body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    return body.slice(0, 2000); // 限制长度
}

export default {
    async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
        const to = message.to.toLowerCase();
        const from = message.from;
        const subject = message.headers.get('subject') || '(无主题)';

        // 在数据库中查找匹配的邮箱
        const email = await env.DB.prepare('SELECT id,address FROM email_addresses WHERE address=?')
            .bind(to)
            .first<EmailRow>();

        if (!email) {
            // 未注册的邮箱地址，忽略
            console.log(`Unknown email address: ${to}`);
            return;
        }

        // 读取邮件正文
        let body = '';
        try {
            const rawEmail = await streamToText(message.raw);
            body = extractTextFromEmail(rawEmail);
        } catch (e) {
            body = '(无法读取邮件内容)';
        }

        // 加密并保存到数据库
        const encBody = await encrypt(body, env.ENCRYPT_KEY);
        await env.DB.prepare('INSERT INTO email_messages(email_id,from_addr,subject,body)VALUES(?,?,?,?)')
            .bind(email.id, from, subject, encBody)
            .run();

        // 发送 Telegram 通知
        const notification = `📧 新邮件\n\n📬 ${to}\n📨 ${from}\n📋 ${subject}\n\n${body.slice(0, 500)}${body.length > 500 ? '...' : ''}`;
        await send(env, notification);
    }
};
