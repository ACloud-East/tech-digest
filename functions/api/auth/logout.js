import { json, clearCookie } from '../_lib/auth.js';
export const onRequestPost = () => json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
