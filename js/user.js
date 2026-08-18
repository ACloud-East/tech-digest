/**
 * UserStore —— 个人中心统一存储层
 * 双模：cloud（登录后写 Cloudflare KV）/ guest（未登录写 localStorage，带浏览器本地告警）
 * 策略：本地内存即时生效 → 800ms 防抖 → 云端 PUT；失败入队，online / 下次 flush 时重试。
 */
const UserStore = {
    LS_GUEST: 'td_profile_guest_v1',
    LS_PENDING: 'td_profile_pending_v1',
    // 云端镜像：已登录时每次写入同时落地本机。作用——即使某次云端 PUT 因网络/冲突偶发失败，
    // 强制刷新（Ctrl+Shift+R）后也能从镜像秒级恢复，绝不丢记录（云端恢复成功后再以云端为准合并）。
    LS_MIRROR: 'td_profile_cloud_mirror_v1',
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
    _syncTimer: null,
    _changeListeners: [],

    async init() {
        const mirror = this._loadMirror();          // 先取本机镜像（已写未落库的数据也在这里）
        try {
            const r = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
            const d = await r.json();
            if (d && d.ok) {
                this.state.mode = 'cloud'; this.state.username = d.username;
                await this.pull();
                // 云端为准，但用镜像补回"已写但上次 PUT 未成功落库"的条目（favorites/aiHistory 取并集）
                this.data = this._mergeMirrorInto(this.data, mirror);
                this._saveMirror();
                this.state.loaded = true;
                this._flushPending();
                return this.state;
            }
        } catch (e) { console.warn('[UserStore] /api/auth/me 失败，降级镜像恢复:', e.message); }
        // 后端未就绪（无 KV/AUTH_SECRET）或会话失效 → 本机镜像兜底，绝不丢记录
        this.state.mode = 'guest'; this.state.username = '';
        this.data = mirror;
        this.state.loaded = true;
        return this.state;
    },

    _loadMirror() {
        try { return JSON.parse(localStorage.getItem(this.LS_MIRROR) || '{}') || {}; } catch { return {}; }
    },
    _saveMirror() {
        try { localStorage.setItem(this.LS_MIRROR, JSON.stringify(this._sanitize())); } catch (_) {}
    },
    // 云端优先；镜像仅在云端缺失该键/条目时补位（favorites/aiHistory 按 url/id 取并集，避免丢本地新增）
    _mergeMirrorInto(data, mirror) {
        const out = { ...mirror, ...data };
        for (const k of ['favorites', 'aiHistory']) {
            const c = Array.isArray(data[k]) ? data[k] : [];
            const m = Array.isArray(mirror[k]) ? mirror[k] : [];
            if (!c.length && m.length) out[k] = m;
            else if (c.length && m.length) {
                const seen = new Set(c.map(x => x.url || x.id));
                out[k] = c.concat(m.filter(x => !seen.has(x.url || x.id)));
            }
        }
        return out;
    },

    async pull(silent) {
        const r = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || '读取云端配置失败');
        if (silent) {
            const changed = await this._mergeRemote(d.data || {}, { v: d.v || 0, updatedAt: d.updatedAt || '' });
            return changed;
        }
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
        this._saveMirror();                          // 立即镜像，强制刷新也不丢
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.flush(), immediate ? 0 : 800);
        this._notifyChanges([k]);
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
            this._startRealtimeSync();
            this._saveMirror();                       // 云端落库成功 → 镜像同步为权威快照
            try { localStorage.removeItem(this.LS_PENDING); } catch (_) {}
        } catch (e) {
            this.state.lastError = e.message || '同步失败';
            try { localStorage.setItem(this.LS_PENDING, JSON.stringify(this._sanitize())); } catch (_) {}
            console.warn('[UserStore] 云端同步失败，已入队待重试:', this.state.lastError);
        } finally { this.state.syncing = false; }
    },

    /* ---------- 实时同步：关页前强制落库 + 每 15s 拉取云端变更 ---------- */
    _startRealtimeSync() {
        if (this.state.mode === 'guest' || this._syncTimer) return;
        this._syncTimer = setInterval(() => this.pull(true), 15000);
        const onVis = () => { if (!document.hidden) this.pull(true); };
        document.addEventListener('visibilitychange', onVis);
        const onBeforeUnload = () => { if (this._timer) { clearTimeout(this._timer); this.flush(true); } };
        window.addEventListener('beforeunload', onBeforeUnload);
        window.addEventListener('pagehide', onBeforeUnload);
    },
    _stopRealtimeSync() {
        if (this._syncTimer) { clearInterval(this._syncTimer); this._syncTimer = null; }
    },
    _notifyChanges(keys) {
        this._changeListeners.forEach(cb => { try { cb(keys); } catch (_) {} });
    },
    onChange(cb) {
        this._changeListeners.push(cb);
        return () => {
            const i = this._changeListeners.indexOf(cb);
            if (i >= 0) this._changeListeners.splice(i, 1);
        };
    },
    async _mergeRemote(remoteData, remoteState) {
        if (!remoteData || typeof remoteData !== 'object') return false;
        let changed = false;
        const mergeArray = (key) => {
            const local = this.data[key] || [];
            const remote = remoteData[key] || [];
            if (!Array.isArray(local) || !Array.isArray(remote)) return;
            const keyOf = (x) => (x && (x.id || x.url || x.title || x.uuid || JSON.stringify(x))) || JSON.stringify(x);
            const seen = new Set(local.map(keyOf));
            const added = remote.filter(x => !seen.has(keyOf(x)));
            if (added.length) { this.data[key] = [...added, ...local].slice(0, key === 'aiHistory' ? 50 : 300); changed = true; }
        };
        mergeArray('favorites');
        mergeArray('aiHistory');
        ['preferences', 'readingVolume', 'theme', 'profile'].forEach(k => {
            if (remoteData[k] !== undefined) {
                const localTime = (this.data[k] && this.data[k].updatedAt) || 0;
                const remoteTime = (remoteData[k] && remoteData[k].updatedAt) || 0;
                if (JSON.stringify(this.data[k]) !== JSON.stringify(remoteData[k]) && remoteTime >= localTime) {
                    this.data[k] = remoteData[k]; changed = true;
                }
            }
        });
        if (remoteState && remoteState.v > this.state.v) { this.state.v = remoteState.v; this.state.updatedAt = remoteState.updatedAt; }
        if (changed) { this._saveMirror(); this._saveGuest(); this._notifyChanges(['favorites', 'aiHistory', 'preferences', 'readingVolume']); }
        return changed;
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
