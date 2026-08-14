import { json, currentUser } from '../_lib/auth.js';
export async function onRequestGet({ request, env }) {
    const me = await currentUser(request, env);
    if (!me) return json({ ok: false, guest: true }, 200);       // 200 + guest:true，前端无需处理 401 分支
    return json({ ok: true, username: me.username, storage: 'kv' });
}
