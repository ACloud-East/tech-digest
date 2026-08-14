import { json, uname, validUser, derive, b64u, timingSafeEq, signToken, sessionCookie, PBKDF2_ITER } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
    if (!env.AUTH_SECRET) return json({ ok: false, error: '服务端未配置 AUTH_SECRET' }, 500);
    if (!env.TD_USERS) return json({ ok: false, error: '服务端未绑定 KV（TD_USERS）' }, 500);
    let b;
    try { b = await request.json(); } catch { return json({ ok: false, error: '请求体不是合法 JSON' }, 400); }
    const u = uname(b.username), pw = String(b.password || '');
    if (!validUser(u) || !pw) return json({ ok: false, error: '用户名或密码格式不正确' }, 400);

    let rec = await env.TD_USERS.get('u:' + u, 'json');

    // 首启引导：TD_BOOTSTRAP_USERS="user:123,alice:pwd" —— 命中则懒创建 KV 记录（散列后存），
    // 保证在没人手工建账号前，原有的 user/123 依然能登录，不打断现有使用者。
    if (!rec) {
        const pairs = String(env.TD_BOOTSTRAP_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
        const hit = pairs.find(p => uname(p.split(':')[0]) === u && p.slice(p.indexOf(':') + 1) === pw);
        if (!hit) return json({ ok: false, error: '用户名或密码错误' }, 401);
        const salt = crypto.getRandomValues(new Uint8Array(16));
        rec = { username: u, salt: b64u.enc(salt), hash: await derive(pw, salt), iter: PBKDF2_ITER, pv: 1, role: 'user', createdAt: new Date().toISOString() };
        await env.TD_USERS.put('u:' + u, JSON.stringify(rec));
    } else {
        const ok = timingSafeEq(await derive(pw, b64u.dec(rec.salt), rec.iter || PBKDF2_ITER), rec.hash);
        if (!ok) return json({ ok: false, error: '用户名或密码错误' }, 401);
    }

    const exp = Date.now() + 30 * 24 * 3600 * 1000;
    const token = await signToken({ u, pv: rec.pv || 1, iat: Date.now(), exp }, env.AUTH_SECRET);
    return json({ ok: true, username: u, exp }, 200, { 'Set-Cookie': sessionCookie(token) });
}
