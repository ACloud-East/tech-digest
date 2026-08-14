// 通用工具：base64url、HMAC 签名无状态 token、PBKDF2 口令散列、JSON 响应
const enc = new TextEncoder();

export const b64u = {
    enc(bytes) {
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    dec(str) {
        const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
        const a = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
        return a;
    },
    str(o) { return b64u.enc(enc.encode(JSON.stringify(o))); },
};

export function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',                 // Functions 响应不受 _headers 影响，必须在此声明
            'X-Content-Type-Options': 'nosniff',
            ...extraHeaders,
        },
    });
}

async function hmacKey(secret) {
    return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signToken(payload, secret) {
    const body = b64u.str(payload);
    const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
    return body + '.' + b64u.enc(new Uint8Array(sig));
}
export async function verifyToken(token, secret) {
    if (!token || token.indexOf('.') < 0) return null;
    const [body, sig] = token.split('.');
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64u.dec(sig), enc.encode(body)).catch(() => false);
    if (!ok) return null;
    let p;
    try { p = JSON.parse(new TextDecoder().decode(b64u.dec(body))); } catch { return null; }
    if (!p || !p.u || !p.exp || Date.now() > p.exp) return null;
    return p;
}

// PBKDF2-SHA256（Workers 免费版单次请求 CPU 预算紧；15000 迭代实测约 8-15ms 可过）
export const PBKDF2_ITER = 15000;
export async function derive(password, saltBytes, iter = PBKDF2_ITER) {
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iter }, key, 256);
    return b64u.enc(new Uint8Array(bits));
}
export function timingSafeEq(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}
export function readCookie(request, name) {
    const c = request.headers.get('Cookie') || '';
    const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
}
export function sessionCookie(token, maxAge = 60 * 60 * 24 * 30) {
    return `td_sess=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = () => 'td_sess=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';

export const uname = (s) => String(s || '').trim().toLowerCase();
export const validUser = (s) => /^[a-zA-Z0-9_.-]{2,32}$/.test(String(s || '').trim());

// 统一取当前登录用户；未登录返回 null
export async function currentUser(request, env) {
    if (!env.AUTH_SECRET) return null;
    const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const token = bearer || readCookie(request, 'td_sess');
    const p = await verifyToken(token, env.AUTH_SECRET);
    if (!p) return null;
    // 校验 pv（改密后旧 token 立即失效）
    if (env.TD_USERS) {
        const rec = await env.TD_USERS.get('u:' + uname(p.u), 'json');
        if (rec && (rec.pv || 1) !== (p.pv || 1)) return null;
    }
    return { username: p.u, pv: p.pv || 1 };
}
