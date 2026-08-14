import { json, uname, validUser, derive, b64u, PBKDF2_ITER } from '../_lib/auth.js';
export async function onRequestPost({ request, env }) {
    if (String(env.TD_REGISTER_OPEN || '0') !== '1') return json({ ok: false, error: '注册已关闭，请联系管理员开通账号' }, 403);
    let b;
    try { b = await request.json(); } catch { return json({ ok: false, error: '非法请求' }, 400); }
    const u = uname(b.username), pw = String(b.password || '');
    if (!validUser(u)) return json({ ok: false, error: '用户名需 2-32 位，仅字母数字 . _ -' }, 400);
    if (pw.length < 6) return json({ ok: false, error: '密码至少 6 位' }, 400);
    if (await env.TD_USERS.get('u:' + u)) return json({ ok: false, error: '该用户名已存在' }, 409);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await env.TD_USERS.put('u:' + u, JSON.stringify({ username: u, salt: b64u.enc(salt), hash: await derive(pw, salt), iter: PBKDF2_ITER, pv: 1, role: 'user', createdAt: new Date().toISOString() }));
    return json({ ok: true });
}
