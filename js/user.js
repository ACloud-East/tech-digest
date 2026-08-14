/**
 * UserStore —— 个人中心统一存储层
 * 双模：cloud（登录后写 Cloudflare KV）/ guest（未登录写 localStorage，带浏览器本地告警）
 * 策略：本地内存即时生效 → 800ms 防抖 → 云端 PUT；失败入队，online / 下次 flush 时重试。
 */
const UserStore = {
    LS_GUEST: 'td_profile_guest_v1',
    LS_PENDING: 'td_profile_pending_v1',
    // 白名单：只有这些键会被同步（防止把 base64 插图、临时草稿等误上云）
    SYNC_KEYS: [
        'theme', 'defaultPanel', 'defaultSocialPlatform', 'hotboardTab',
        'sidebarShrink',
        'aiApi',            // { basePreset, customBase, model }
        'aiImgApi',         // { base, model }
        'aiApiKey', 'aiImgApiKey',   // 仅 syncApiKey=true 时写入
        'syncApiKey', 'favorites', 'aiHistory', 'imageCaptionOn',
    ],
    state: { mode: 'guest', username: '', v: 0, updatedAt: '', syncing: false, lastError: '', lastSyncAt: '', loaded: false },
    data: {},
    _timer: null,

    async init() {
        try {
            const r = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
            const d = await r.json();
            if (d && d.ok) {
                this.state.mode = 'cloud'; this.state.username = d.username;
                await this.pull();
                this.state.loaded = true;
                this._flushPending();
                return this.state;
            }
        } catch (e) { console.warn('[UserStore] /api/auth/me 失败，降级访客模式:', e.message); }
        // 后端未就绪（无 KV/AUTH_SECRET）→ 浏览器本地按用户命名空间
        this.state.mode = 'guest'; this.state.username = '';
        try { this.data = JSON.parse(localStorage.getItem(this.LS_GUEST) || '{}') || {}; } catch { this.data = {}; }
        this.state.loaded = true;
        return this.state;
    },

    async pull() {
        const r = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || '读取云端配置失败');
        this.data = d.data || {}; this.state.v = d.v || 0; this.state.updatedAt = d.updatedAt || '';
        return this.data;
    },

    async login(username, password) {
        const r = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || '登录失败');
        const localBackup = { ...this.data };                // 访客期间的本地配置
        this.state.mode = 'cloud'; this.state.username = d.username;
        await this.pull();
        // 首次登录且云端为空 → 把访客本地配置上传（"迁移"），避免用户设置白丢
        if (this.state.v === 0 && Object.keys(localBackup).length) { this.data = { ...localBackup, ...this.data }; await this.flush(true); }
        return d;
    },

    async logout() {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        this.state.mode = 'guest'; this.state.username = ''; this.state.v = 0;
        try { this.data = JSON.parse(localStorage.getItem(this.LS_GUEST) || '{}') || {}; } catch { this.data = {}; }
    },

    get(k, def) { return (k in this.data) ? this.data[k] : def; },

    set(k, v, immediate) {
        if (this.SYNC_KEYS.indexOf(k) < 0) { console.warn('[UserStore] 未在 SYNC_KEYS 白名单内，忽略:', k); return; }
        this.data[k] = v;
        if (this.state.mode === 'guest') { this._saveGuest(); return; }
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.flush(), immediate ? 0 : 800);
    },

    _saveGuest() { try { localStorage.setItem(this.LS_GUEST, JSON.stringify(this.data)); } catch (_) {} },

    // 剔除超大字段（AI 插图 base64 单张可达数 MB，绝不能进 KV）
    _sanitize() {
        const d = JSON.parse(JSON.stringify(this.data));
        if (Array.isArray(d.aiHistory)) {
            d.aiHistory = d.aiHistory.slice(0, 50).map(h => {
                const c = { ...h };
                if (Array.isArray(c.images)) c.imageCount = c.images.filter(x => typeof x === 'string').length;
                delete c.images; delete c.inputContent;      // 原文草稿也不上云（可能很大且含敏感稿件）
                return c;
            });
        }
        if (!d.syncApiKey) { delete d.aiApiKey; delete d.aiImgApiKey; }
        return d;
    },

    async flush(force) {
        if (this.state.mode !== 'cloud') { this._saveGuest(); return; }
        this.state.syncing = true; this.state.lastError = '';
        const payload = { v: this.state.v, data: this._sanitize() };
        try {
            let r = await fetch('/api/profile', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (r.status === 409) {                          // 冲突：服务端更新，合并后重试一次（本地字段优先）
                const s = await r.json();
                this.data = { ...(s.data || {}), ...this.data };
                this.state.v = s.v;
                r = await fetch('/api/profile', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: this.state.v, data: this._sanitize() }) });
            }
            const d = await r.json();
            if (!d.ok) throw new Error(d.error || ('HTTP ' + r.status));
            this.state.v = d.v; this.state.updatedAt = d.updatedAt;
            this.state.lastSyncAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            try { localStorage.removeItem(this.LS_PENDING); } catch (_) {}
        } catch (e) {
            this.state.lastError = e.message || '同步失败';
            try { localStorage.setItem(this.LS_PENDING, JSON.stringify(this._sanitize())); } catch (_) {}
            console.warn('[UserStore] 云端同步失败，已入队待重试:', this.state.lastError);
        } finally { this.state.syncing = false; }
    },

    async _flushPending() {
        let p = null; try { p = JSON.parse(localStorage.getItem(this.LS_PENDING) || 'null'); } catch (_) {}
        if (p) { this.data = { ...p, ...this.data }; await this.flush(true); }
    },

    exportJSON() { return JSON.stringify({ exportedAt: new Date().toISOString(), mode: this.state.mode, username: this.state.username, data: this.data }, null, 2); },
    async importJSON(text) {
        const o = JSON.parse(text);
        const src = (o && o.data) ? o.data : o;
        this.SYNC_KEYS.forEach(k => { if (k in src) this.data[k] = src[k]; });
        await this.flush(true);
    },
    async wipeCloud() {
        if (this.state.mode !== 'cloud') return;
        await fetch('/api/profile', { method: 'DELETE', credentials: 'same-origin' });
        this.data = {}; this.state.v = 0;
    },
};
window.UserStore = UserStore;
