import { json, currentUser, uname } from './_lib/auth.js';

const MAX_BYTES = 200 * 1024;      // 单用户配置上限 200KB（KV 硬上限 25MB，此处严格得多，防误传 base64 图）

export async function onRequestGet({ request, env }) {
    const me = await currentUser(request, env);
    if (!me) return json({ ok: false, guest: true, error: '未登录' }, 401);
    const rec = await env.TD_USERS.get('p:' + uname(me.username), 'json');
    return json({ ok: true, username: me.username, v: (rec && rec.v) || 0, updatedAt: (rec && rec.updatedAt) || '', data: (rec && rec.data) || {} });
}

export async function onRequestPut({ request, env }) {
    const me = await currentUser(request, env);
    if (!me) return json({ ok: false, guest: true, error: '未登录' }, 401);
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return json({ ok: false, error: `配置体积 ${(raw.length / 1024).toFixed(0)}KB 超过上限 200KB（请勿把 base64 图片同步到云端）` }, 413);
    let b;
    try { b = JSON.parse(raw); } catch { return json({ ok: false, error: '非法 JSON' }, 400); }
    if (!b || typeof b.data !== 'object' || b.data === null) return json({ ok: false, error: '缺少 data 字段' }, 400);

    const key = 'p:' + uname(me.username);
    const cur = await env.TD_USERS.get(key, 'json');
    const curV = (cur && cur.v) || 0;
    // 乐观锁：客户端必须带上它最后一次看到的版本号 v。落后即冲突，回传服务端最新值，由前端合并后重试。
    if (typeof b.v === 'number' && b.v < curV) {
        return json({ ok: false, conflict: true, v: curV, updatedAt: cur.updatedAt, data: cur.data }, 409);
    }
    const next = { v: curV + 1, updatedAt: new Date().toISOString(), data: b.data };
    await env.TD_USERS.put(key, JSON.stringify(next));
    return json({ ok: true, v: next.v, updatedAt: next.updatedAt });
}

export async function onRequestDelete({ request, env }) {
    const me = await currentUser(request, env);
    if (!me) return json({ ok: false, error: '未登录' }, 401);
    await env.TD_USERS.delete('p:' + uname(me.username));
    return json({ ok: true });
}
