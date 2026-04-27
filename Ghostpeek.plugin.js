/**
 * @name GhostPeek
 * @author axy
 * @authorLink https://github.com/axralty
 * @source https://github.com/axralty/GhostPeek
 * @description Right-click or Ctrl+click a DM → peek messages without marking as read.
 * @version 3.1.0
 */

module.exports = class GhostPeek {
    constructor() {
        this.name         = "GhostPeek";
        this.popups       = [];
        this.listObserver = null;
        this.menuObserver = null;
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onCtrlClick   = this._onCtrlClick.bind(this);

        this._tokenCache = null;

        this._msgCache = {};

        this._callStore = null;

        this.defaultSettings = {
            cacheSeconds:   120,
            callTimeFormat: "hms",
        };
    }

    getSettings() {
        return Object.assign({}, this.defaultSettings, BdApi.Data.load("GhostPeek", "settings") || {});
    }
    saveSettings(s) { BdApi.Data.save("GhostPeek", "settings", s); }

    getSettingsPanel() {
        const s = this.getSettings();
        const panel = document.createElement("div");
        panel.style.cssText = "padding:10px 0;color:#dbdee1;font-family:'gg sans',sans-serif;";

        const mkH = t => { const e = document.createElement("div"); e.style.cssText = "font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#b5bac1;margin-bottom:6px;"; e.textContent = t; return e; };
        const mkD = t => { const e = document.createElement("div"); e.style.cssText = "font-size:12px;color:#72767d;margin-bottom:10px;"; e.textContent = t; return e; };
        const mkDiv = () => { const e = document.createElement("div"); e.style.cssText = "height:1px;background:#3a3b3e;margin:14px 0;"; return e; };
        const mkRadios = (name, opts, cur, onChange) => {
            const g = document.createElement("div");
            g.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-bottom:10px;";
            for (const o of opts) {
                const label = document.createElement("label");
                label.style.cssText = "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#dbdee1;";
                const r = document.createElement("input");
                r.type = "radio"; r.name = name; r.value = String(o.v); r.checked = cur === o.v;
                r.style.cssText = "accent-color:#5865f2;cursor:pointer;";
                r.addEventListener("change", () => { if (r.checked) onChange(o.v); });
                const sp = document.createElement("span"); sp.textContent = o.l;
                label.append(r, sp); g.appendChild(label);
            }
            return g;
        };

        panel.appendChild(mkH("Cache Duration"));
        panel.appendChild(mkD("Reopening within this window reuses fetched messages instantly. New messages are always appended."));
        panel.appendChild(mkRadios("gp-cache", [
            { v: 0,   l: "Disabled (always fresh fetch)" },
            { v: 60,  l: "1 minute" },
            { v: 120, l: "2 minutes (default)" },
            { v: 300, l: "5 minutes" },
            { v: 600, l: "10 minutes" },
        ], s.cacheSeconds, v => { s.cacheSeconds = v; this.saveSettings(s); }));

        panel.appendChild(mkDiv());
        panel.appendChild(mkH("Call Time Format"));
        panel.appendChild(mkD("How total call duration appears in the peek header."));
        panel.appendChild(mkRadios("gp-ctfmt", [
            { v: "hms", l: "1h 4m 5s  (default)" },
            { v: "h",   l: "1109h  (raw hours)" },
            { v: "dh",  l: "46d 5h  (days + hours)" },
            { v: "dhm", l: "46d 5h 3m  (days + hours + minutes)" },
        ], s.callTimeFormat, v => { s.callTimeFormat = v; this.saveSettings(s); }));

        panel.appendChild(mkDiv());
        panel.appendChild(mkH("Data Management"));

        const ctData = BdApi.Data.load("GhostPeek", "callTime") || {};
        const info = document.createElement("div");
        info.style.cssText = "font-size:12px;color:#72767d;margin-bottom:10px;";
        info.textContent = `Tracked conversations: ${Object.keys(ctData).length}`;

        const mkBtn = (lbl, col, fn) => {
            const b = document.createElement("button");
            b.textContent = lbl;
            b.style.cssText = `background:#2b2d31;border:1px solid #3a3b3e;border-radius:4px;color:${col};font-size:12px;padding:5px 12px;cursor:pointer;font-family:inherit;transition:background .1s;`;
            b.onmouseenter = () => b.style.background = "#3a3b3e";
            b.onmouseleave = () => b.style.background = "#2b2d31";
            b.addEventListener("click", fn); return b;
        };

        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
        btnRow.append(
            mkBtn("Reset Call Time Data", "#ed4245", () => {
                this._callStore = {};
                BdApi.Data.save("GhostPeek", "callTime", {});
                info.textContent = "Tracked conversations: 0";
                BdApi.UI.showToast("👻 GhostPeek: call time cleared.", { type: "info" });
            }),
            mkBtn("Clear Message Cache", "#72767d", () => {
                this._msgCache = {};
                BdApi.UI.showToast("👻 GhostPeek: message cache cleared.", { type: "info" });
            })
        );
        panel.append(info, btnRow);
        return panel;
    }

    start() {
        BdApi.DOM.addStyle("GhostPeekStyles", `
            .ghostpeek-popup {
                position:fixed; z-index:10000;
                width:400px; height:520px; min-width:280px; min-height:200px;
                background:#1e1f22; border:1px solid #3a3b3e; border-radius:12px;
                box-shadow:0 8px 40px rgba(0,0,0,.8), 0 0 0 2px #5865f2;
                display:flex; flex-direction:column; overflow:hidden;
                opacity:0; transform:scale(.96);
                transition:opacity .15s ease, transform .15s ease;
                font-family:'gg sans','Noto Sans','Helvetica Neue',Arial,sans-serif;
                pointer-events:all !important; resize:both;
            }
            .ghostpeek-popup.visible { opacity:1; transform:scale(1); }
            .ghostpeek-titlebar {
                display:flex; align-items:center; gap:8px; padding:10px 10px 8px;
                border-bottom:1px solid #2e2f33; background:#25262a;
                cursor:grab; flex-shrink:0; user-select:none;
            }
            .ghostpeek-titlebar:active { cursor:grabbing; }
            .ghostpeek-avatar {
                width:34px; height:34px; border-radius:50%; flex-shrink:0; background:#36373d;
                pointer-events:none; display:flex; align-items:center; justify-content:center;
                overflow:hidden; font-size:18px;
            }
            .ghostpeek-avatar img { width:100%; height:100%; object-fit:cover; border-radius:50%; pointer-events:none; }
            .ghostpeek-username { font-weight:600; font-size:14px; color:#f2f3f5; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:none; }
            .ghostpeek-badge { background:#ed4245; color:#fff; font-size:10px; font-weight:700; padding:2px 7px; border-radius:8px; pointer-events:none; flex-shrink:0; }
            .ghostpeek-call-time { font-size:10px; color:#72767d; background:#2b2d31; padding:2px 7px; border-radius:6px; pointer-events:none; flex-shrink:0; white-space:nowrap; }
            .ghostpeek-close {
                width:24px; height:24px; border-radius:50%; background:#3a3b3e; border:none;
                color:#b5bac1; font-size:12px; cursor:pointer;
                display:flex; align-items:center; justify-content:center;
                flex-shrink:0; transition:background .1s, color .1s; pointer-events:all !important;
            }
            .ghostpeek-close:hover { background:#ed4245; color:#fff; }
            .ghostpeek-label { font-size:10px; color:#72767d; padding:3px 14px; background:#25262a; border-bottom:1px solid #2e2f33; letter-spacing:.3px; flex-shrink:0; pointer-events:none; }
            .ghostpeek-search { display:flex; align-items:center; gap:6px; padding:5px 8px; background:#1e1f22; border-bottom:1px solid #2e2f33; flex-shrink:0; }
            .ghostpeek-search-icon { font-size:12px; color:#4e5058; flex-shrink:0; pointer-events:none; }
            .ghostpeek-search-input { flex:1; background:#2b2d31; border:1px solid #3a3b3e; border-radius:6px; color:#dbdee1; font-size:12px; font-family:inherit; padding:4px 8px; outline:none; transition:border-color .1s; }
            .ghostpeek-search-input::placeholder { color:#4e5058; }
            .ghostpeek-search-input:focus { border-color:#5865f2; }
            .ghostpeek-search-count { font-size:10px; color:#72767d; white-space:nowrap; min-width:42px; text-align:right; }
            .ghostpeek-search-nav { display:flex; gap:2px; }
            .ghostpeek-search-nav button { background:#2b2d31; border:1px solid #3a3b3e; color:#b5bac1; font-size:11px; width:22px; height:22px; border-radius:4px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .1s; }
            .ghostpeek-search-nav button:hover { background:#5865f2; color:#fff; border-color:#5865f2; }
            .ghostpeek-search-nav button:disabled { opacity:.3; cursor:default; pointer-events:none; }
            .ghostpeek-bgticker { display:flex; align-items:center; gap:5px; padding:2px 10px; background:#1a1b1e; border-bottom:1px solid #2e2f33; font-size:10px; color:#4e5058; flex-shrink:0; pointer-events:none; }
            .ghostpeek-bgticker .ghostpeek-spinner { width:8px; height:8px; border-width:1.5px; }
            .ghostpeek-messages { flex:1; padding:4px 2px; overflow-y:scroll !important; overflow-x:hidden; scrollbar-width:thin; scrollbar-color:#4e5058 #2b2d31; min-height:0; pointer-events:all !important; }
            .ghostpeek-messages::-webkit-scrollbar { width:5px; }
            .ghostpeek-messages::-webkit-scrollbar-track { background:#2b2d31; }
            .ghostpeek-messages::-webkit-scrollbar-thumb { background:#4e5058; border-radius:3px; }
            .ghostpeek-messages::-webkit-scrollbar-thumb:hover { background:#6d6f78; }
            .ghostpeek-spinner { width:26px; height:26px; border:3px solid #3a3b3e; border-top-color:#5865f2; border-radius:50%; animation:gp-spin .7s linear infinite; }
            @keyframes gp-spin { to { transform:rotate(360deg); } }
            .ghostpeek-loading { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:#72767d; font-size:13px; pointer-events:none; }
            .ghostpeek-load-older { display:flex; align-items:center; justify-content:center; gap:6px; padding:6px; color:#72767d; font-size:11px; pointer-events:none; }
            .ghostpeek-load-older .ghostpeek-spinner { width:12px; height:12px; border-width:2px; }
            .ghostpeek-date { display:flex; align-items:center; gap:8px; padding:6px 10px 2px; color:#4e5058; font-size:10px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; pointer-events:none; }
            .ghostpeek-date::before, .ghostpeek-date::after { content:''; flex:1; height:1px; background:#2e2f33; }
            .ghostpeek-msg { display:flex; gap:10px; padding:3px 10px; border-radius:4px; transition:background .08s; }
            .ghostpeek-msg:hover { background:#2a2b2f; }
            .ghostpeek-msg-av { width:28px; height:28px; border-radius:50%; object-fit:cover; flex-shrink:0; background:#36373d; margin-top:2px; pointer-events:none; }
            .ghostpeek-msg-body { flex:1; min-width:0; pointer-events:none; }
            .ghostpeek-msg-author { font-size:12px; font-weight:600; color:#c9ccd0; margin-bottom:1px; }
            .ghostpeek-msg-ts { font-size:10px; font-weight:400; color:#4e5058; margin-left:6px; }
            .ghostpeek-msg-text { font-size:13px; color:#dbdee1; line-height:1.45; word-break:break-word; white-space:pre-wrap; }
            .ghostpeek-sys { color:#72767d !important; font-style:italic !important; }
            .ghostpeek-att { font-size:11px; color:#72767d; font-style:italic; margin-top:2px; pointer-events:all; cursor:pointer; }
            .ghostpeek-embed { margin-top:4px; border-left:3px solid #4f545c; padding:5px 8px; border-radius:0 4px 4px 0; font-size:12px; max-width:240px; background:#2b2d31; }
            .gp-hl { background:#faa81a44; color:#faa81a; border-radius:2px; padding:0 1px; }
            .ghostpeek-msg.gp-hidden { display:none !important; }
            .ghostpeek-date.gp-hidden { display:none !important; }
            .ghostpeek-msg.gp-current { background:#2e3440 !important; outline:1px solid #5865f2; border-radius:4px; }
            .ghostpeek-footer { padding:5px 12px; border-top:1px solid #2e2f33; background:#25262a; font-size:10px; color:#4e5058; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; pointer-events:none; }
            .ghostpeek-top-lbl { text-align:center; color:#4e5058; font-size:10px; padding:5px; pointer-events:none; font-style:italic; }
            .ghostpeek-empty { text-align:center; color:#4e5058; font-size:13px; padding:40px 16px; pointer-events:none; }
            .ghostpeek-menu-item { display:flex !important; align-items:center !important; gap:8px !important; padding:6px 8px !important; margin:2px 4px !important; border-radius:4px !important; font-size:14px !important; font-weight:500 !important; color:#dbdee1 !important; cursor:pointer !important; box-sizing:border-box !important; width:calc(100% - 8px) !important; user-select:none !important; line-height:18px !important; pointer-events:all !important; position:relative !important; }
            .ghostpeek-menu-item:hover { background:#5865f2 !important; color:#fff !important; }
            .ghostpeek-menu-sep { height:1px !important; background:#3a3b3e !important; margin:4px 8px !important; pointer-events:none !important; }
        `);

        document.addEventListener("contextmenu", this._onContextMenu, true);
        document.addEventListener("click",       this._onCtrlClick,   true);
        this._startListObserver();
        BdApi.UI.showToast("👻 GhostPeek enabled — right-click or Ctrl+click a DM!", { type: "success" });
    }

    stop() {
        BdApi.DOM.removeStyle("GhostPeekStyles");
        document.removeEventListener("contextmenu", this._onContextMenu, true);
        document.removeEventListener("click",       this._onCtrlClick,   true);
        if (this.listObserver) { this.listObserver.disconnect(); this.listObserver = null; }
        if (this.menuObserver) { this.menuObserver.disconnect(); this.menuObserver = null; }
        this.popups.forEach(p => p.el.remove());
        this.popups      = [];
        this._msgCache   = {};
        this._tokenCache = null;
        this._callStore  = null;
        BdApi.UI.showToast("👻 GhostPeek disabled.", { type: "info" });
    }

    _startListObserver() {
        const attach = () => {
            const list = document.querySelector('[data-list-id="private-channels"]')
                      || document.querySelector('[class*="privateChannels"]');
            if (!list) { setTimeout(attach, 500); return; }
            if (this.listObserver) this.listObserver.disconnect();
            this.listObserver = new MutationObserver(() => {
                if (!document.contains(list)) { this.listObserver.disconnect(); this._startListObserver(); }
            });
            this.listObserver.observe(list, { childList: true });
        };
        attach();
    }

    _onContextMenu(e) {
        const item = e.target.closest('[data-list-item-id*="private-channels"]');
        if (!item) return;
        const channelId = this._getChannelId(item);
        if (!channelId) return;
        if (this.menuObserver) { this.menuObserver.disconnect(); this.menuObserver = null; }
        this.menuObserver = new MutationObserver((_m, obs) => {
            const menu = document.querySelector('[role="menu"]');
            if (!menu || menu.querySelector(".ghostpeek-menu-item")) return;
            obs.disconnect(); this.menuObserver = null;
            this._injectMenuItem(menu, item, channelId);
        });
        this.menuObserver.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { if (this.menuObserver) { this.menuObserver.disconnect(); this.menuObserver = null; } }, 1500);
    }

    _onCtrlClick(e) {
        if (!e.ctrlKey) return;
        const item = e.target.closest('[data-list-item-id*="private-channels"]');
        if (!item) return;
        const channelId = this._getChannelId(item);
        if (!channelId) return;
        e.preventDefault(); e.stopPropagation();
        this._showPeekPopup(item, channelId);
    }

    _injectMenuItem(menu, item, channelId) {
        const anchor = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(el => {
            const t = el.textContent.trim().toLowerCase();
            return t.startsWith("close dm") || t.startsWith("leave gr");
        });
        const sep  = Object.assign(document.createElement("div"), { className: "ghostpeek-menu-sep" });
        const peek = Object.assign(document.createElement("div"), { className: "ghostpeek-menu-item", role: "menuitem" });
        peek.setAttribute("role", "menuitem");
        peek.innerHTML = `<span style="font-size:15px;line-height:1;pointer-events:none">👻</span><span style="pointer-events:none">Peek Messages</span>`;
        peek.addEventListener("click", ev => {
            ev.preventDefault(); ev.stopPropagation();
            document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            setTimeout(() => this._showPeekPopup(item, channelId), 80);
        });
        const parent = anchor?.parentNode || menu;
        const ref    = anchor?.nextSibling ?? null;
        parent.insertBefore(sep,  ref);
        parent.insertBefore(peek, sep.nextSibling);
    }

    _getChannelId(item) {
        const m = (item.getAttribute("data-list-item-id") || "").match(/private-channels(?:-uid_\d+___)?-?(\d{10,})/);
        if (m) return m[1];
        const link = item.querySelector('a[href*="/channels/@me/"]');
        if (link) { const lm = link.href.match(/\/channels\/@me\/(\d+)/); if (lm) return lm[1]; }
        return null;
    }

    _getToken() {
        if (this._tokenCache) return this._tokenCache;
        try {
            window.webpackChunkdiscord_app.push([[Math.random()], {}, req => {
                for (const mod of Object.values(req.c)) {
                    const exp = mod?.exports;
                    if (!exp || typeof exp !== "object") continue;
                    for (const v of Object.values(exp)) {
                        if (v?._dispatchToken && typeof v.getToken === "function"
                            && typeof v.getSessionId === "function"
                            && typeof v.getMFATicket === "function") {
                            const t = v.getToken();
                            if (typeof t === "string" && t.length > 20) {
                                this._tokenCache = t;
                                return;
                            }
                        }
                    }
                }
            }]);
        } catch (_) {}
        return this._tokenCache;
    }

    _fmtDate(d) { return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); }
    _fmtTime(d) { return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

    _callDuration(startTs, endTs) {
        const s = Math.floor((new Date(endTs) - new Date(startTs)) / 1000);
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
    }

    _systemContent(msg) {
        switch (msg.type) {
            case 3:  return msg.call?.ended_timestamp
                ? `📞 Call ended (${this._callDuration(msg.timestamp, msg.call.ended_timestamp)})`
                : "📞 Started a call";
            case 6:  return "📌 Pinned a message";
            case 1:  return "➕ Added someone to the group";
            case 2:  return "➖ Removed someone from the group";
            case 7:  return "👋 Joined the server";
            default: return msg.sticker_items?.length ? `🎭 Sticker: ${msg.sticker_items[0].name}` : null;
        }
    }

    _callStoreGet(cid) {
        if (!this._callStore) this._callStore = BdApi.Data.load("GhostPeek", "callTime") || {};
        return this._callStore[cid] || 0;
    }
    _callStoreSet(cid, sec) {
        if (!this._callStore) this._callStore = BdApi.Data.load("GhostPeek", "callTime") || {};
        this._callStore[cid] = sec;
        BdApi.Data.save("GhostPeek", "callTime", this._callStore);
    }
    _callStoreClear(cid) {
        if (!this._callStore) this._callStore = BdApi.Data.load("GhostPeek", "callTime") || {};
        delete this._callStore[cid];
        BdApi.Data.save("GhostPeek", "callTime", this._callStore);
    }

    _countCallSec(msgs) {
        let s = 0;
        for (const m of msgs)
            if (m.type === 3 && m.call?.ended_timestamp)
                s += Math.floor((new Date(m.call.ended_timestamp) - new Date(m.timestamp)) / 1000);
        return s;
    }

    _formatCallTime(sec, fmt) {
        if (sec <= 0) return null;
        const H = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        const d = Math.floor(H / 24), rh = H % 24;
        switch (fmt) {
            case "h":   return `📞 ${H}h`;
            case "dh":  return d > 0 ? `📞 ${d}d ${rh}h` : `📞 ${H}h`;
            case "dhm": return d > 0 ? `📞 ${d}d ${rh}h ${m}m` : H > 0 ? `📞 ${H}h ${m}m` : `📞 ${m}m ${s}s`;
            default:    return H > 0 ? `📞 ${H}h ${m}m ${s}s` : m > 0 ? `📞 ${m}m ${s}s` : `📞 ${s}s`;
        }
    }

    _applyCallTime(el, sec, fmt) {
        const str = this._formatCallTime(sec, fmt);
        if (!str) return;
        el.textContent = str + " total";
        el.style.display = "";
    }

    _getCache(cid, ttl) {
        if (!ttl) return null;
        const e = this._msgCache[cid];
        if (!e) return null;
        if ((Date.now() - e.fetchedAt) / 1000 > ttl) { delete this._msgCache[cid]; return null; }
        return e;
    }
    _setCache(cid, patch) {
        if (!this._msgCache[cid]) this._msgCache[cid] = { fetchedAt: Date.now() };
        Object.assign(this._msgCache[cid], patch);
    }

    async _fetchBefore(cid, beforeId, token) {
        const url = `https://discord.com/api/v9/channels/${cid}/messages?limit=100`
                  + (beforeId ? `&before=${beforeId}` : "");
        const res = await fetch(url, { headers: { Authorization: token } });
        if (!res.ok) throw new Error(`API ${res.status}`);
        return (await res.json()).reverse();
    }

    async _fetchAfter(cid, afterId, token) {
        const url = `https://discord.com/api/v9/channels/${cid}/messages?limit=100&after=${afterId}`;
        const res = await fetch(url, { headers: { Authorization: token } });
        if (!res.ok) return [];
        return (await res.json()).reverse();
    }

    _esc(str) {
        return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    _buildMessages(messages, lastDateRef) {
        let html = "";

        for (const msg of messages) {
            const ts = msg.timestamp ? new Date(msg.timestamp) : null;

            if (ts) {
                const ds = this._fmtDate(ts);
                if (ds !== lastDateRef.v) {
                    lastDateRef.v = ds;
                    html += `<div class="ghostpeek-date">${this._esc(ds)}</div>`;
                }
            }

            const author     = msg.author;
            const authorName = author?.global_name || author?.username || "Unknown";
            const avatarUrl  = author?.avatar
                ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=40`
                : "https://cdn.discordapp.com/embed/avatars/0.png";
            const sysText    = this._systemContent(msg);
            const rawText    = sysText ?? (msg.content || "");

            const timeStr = ts ? `<span class="ghostpeek-msg-ts">${this._fmtTime(ts)}</span>` : "";

            let attHtml = "";
            for (const att of (msg.attachments || [])) {
                const isImg = att.content_type?.startsWith("image/") || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(att.url || "");
                const isVid = att.content_type?.startsWith("video/") || /\.(mp4|webm|mov)(\?|$)/i.test(att.url || "");
                if (isImg && att.url) {
                    attHtml += `<div style="margin-top:4px;border-radius:4px;overflow:hidden;max-width:240px;pointer-events:all">
                        <img src="${this._esc(att.proxy_url || att.url)}" class="gp-att-img" style="max-width:100%;max-height:180px;display:block;border-radius:4px;cursor:pointer" title="${this._esc(att.filename || "Image")}" data-url="${this._esc(att.url)}"></div>`;
                } else if (isVid && att.url) {
                    attHtml += `<div style="margin-top:4px;pointer-events:all">
                        <video src="${this._esc(att.proxy_url || att.url)}" controls style="max-width:240px;max-height:160px;border-radius:4px;display:block"></video></div>`;
                } else {
                    attHtml += `<div class="ghostpeek-att" data-url="${this._esc(att.url || "")}"
                        style="pointer-events:all;cursor:${att.url ? "pointer" : "default"}">📎 ${this._esc(att.filename || "file")}</div>`;
                }
            }

            let embHtml = "";
            for (const emb of (msg.embeds || [])) {
                const color = emb.color ? "#" + emb.color.toString(16).padStart(6, "0") : "#4f545c";
                const title = emb.title ? `<div style="font-weight:600;color:#dbdee1;margin-bottom:2px;font-size:12px">${this._esc(emb.title)}</div>` : "";
                const desc  = emb.description
                    ? `<div style="color:#b5bac1;font-size:11px">${this._esc(emb.description.length > 100 ? emb.description.slice(0,100)+"…" : emb.description)}</div>`
                    : (!emb.title ? `<div style="color:#00a8fc;font-size:11px">🔗 Link embed</div>` : "");
                embHtml += `<div class="ghostpeek-embed" style="border-color:${color}">${title}${desc}</div>`;
            }

            html += `<div class="ghostpeek-msg"
                data-author="${this._esc(authorName.toLowerCase())}"
                data-content="${this._esc(rawText.toLowerCase())}">
                <img class="ghostpeek-msg-av" src="${this._esc(avatarUrl)}" data-fallback="https://cdn.discordapp.com/embed/avatars/0.png">
                <div class="ghostpeek-msg-body">
                    <div class="ghostpeek-msg-author">${this._esc(authorName)}${timeStr}</div>
                    <div class="ghostpeek-msg-text${sysText ? " ghostpeek-sys" : ""}" data-raw="${this._esc(rawText)}">${this._esc(rawText)}</div>
                    ${attHtml}${embHtml}
                </div>
            </div>`;
        }

        const tpl = document.createElement("template");
        tpl.innerHTML = html;
        const frag = tpl.content;

        frag.querySelectorAll(".gp-att-img").forEach(img => {
            img.onerror = () => { img.closest("div").innerHTML = `<span style="font-size:11px;color:#72767d;font-style:italic">📎 image</span>`; };
            img.addEventListener("click", () => window.open(img.dataset.url, "_blank"));
        });
        frag.querySelectorAll(".ghostpeek-att[data-url]").forEach(el => {
            if (el.dataset.url) el.addEventListener("click", () => window.open(el.dataset.url, "_blank"));
        });
        frag.querySelectorAll(".ghostpeek-msg-av").forEach(img => {
            img.onerror = () => { img.src = img.dataset.fallback; };
        });

        return frag;
    }

    _attachSearch(searchEl, msgContainer) {
        const input   = searchEl.querySelector(".ghostpeek-search-input");
        const countEl = searchEl.querySelector(".ghostpeek-search-count");
        const prevBtn = searchEl.querySelector(".gp-prev");
        const nextBtn = searchEl.querySelector(".gp-next");

        let matches = [], cur = -1;

        const hlEl = (el, re) => {
            const raw = el.dataset.raw || "";
            if (!re) { el.textContent = raw; return; }
            el.innerHTML = raw.replace(re, m => `<span class="gp-hl">${m}</span>`);
        };

        const scrollTo = idx => {
            matches.forEach((el, i) => el.classList.toggle("gp-current", i === idx));
            matches[idx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        };

        const updateNav = () => {
            countEl.textContent = matches.length ? `${cur + 1}/${matches.length}` : "";
            prevBtn.disabled = matches.length === 0;
            nextBtn.disabled = matches.length === 0;
        };

        const run = () => {
            const q  = input.value.trim();
            const ql = q.toLowerCase();
            const re = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : null;

            matches = [];
            cur = -1;
            let lastDate = null;
            let lastDateHasVisible = false;

            const children = msgContainer.children;
            for (let i = 0; i < children.length; i++) {
                const el = children[i];

                if (el.classList.contains("ghostpeek-date")) {
                    if (lastDate) lastDate.classList.toggle("gp-hidden", !lastDateHasVisible);
                    lastDate = el;
                    lastDateHasVisible = false;
                    el.classList.remove("gp-hidden");
                    continue;
                }

                if (!el.classList.contains("ghostpeek-msg")) continue;

                el.classList.remove("gp-hidden", "gp-current");
                const textEl = el.querySelector(".ghostpeek-msg-text");

                if (!ql) {
                    if (textEl) textEl.textContent = textEl.dataset.raw || "";
                    lastDateHasVisible = true;
                    continue;
                }

                const hit = el.dataset.content?.includes(ql) || el.dataset.author?.includes(ql);
                if (hit) {
                    matches.push(el);
                    if (textEl) hlEl(textEl, re);
                    lastDateHasVisible = true;
                } else {
                    el.classList.add("gp-hidden");
                    if (textEl) textEl.textContent = textEl.dataset.raw || "";
                }
            }

            if (lastDate) lastDate.classList.toggle("gp-hidden", !lastDateHasVisible);

            if (matches.length) { cur = 0; scrollTo(0); }
            updateNav();
        };

        let debounce;
        input.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(run, 160); });
        input.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                if (!matches.length) return;
                cur = e.shiftKey ? (cur - 1 + matches.length) % matches.length : (cur + 1) % matches.length;
                scrollTo(cur); updateNav();
            } else if (e.key === "Escape") { input.value = ""; run(); }
        });
        nextBtn.addEventListener("click", () => { if (!matches.length) return; cur = (cur + 1) % matches.length; scrollTo(cur); updateNav(); });
        prevBtn.addEventListener("click", () => { if (!matches.length) return; cur = (cur - 1 + matches.length) % matches.length; scrollTo(cur); updateNav(); });
        prevBtn.disabled = true; nextBtn.disabled = true;

        return run;
    }

    async _showPeekPopup(anchorEl, channelId) {
        const settings = this.getSettings();
        const token    = this._getToken();

        const ChannelStore   = BdApi.Webpack.getStore("ChannelStore");
        const UserStore      = BdApi.Webpack.getStore("UserStore");
        const ReadStateStore = BdApi.Webpack.getStore("ReadStateStore");

        const channel = ChannelStore?.getChannel(channelId);
        const isGroup = channel?.type === 3;
        let name = "Unknown", avatarSrc = null;

        if (isGroup) {
            name = channel.name || "Group DM";
            avatarSrc = channel.icon ? `https://cdn.discordapp.com/channel-icons/${channelId}/${channel.icon}.png?size=64` : null;
        } else if (channel?.recipients?.length) {
            const user = UserStore?.getUser(channel.recipients[0]);
            if (user) {
                name = user.globalName || user.username || "Unknown";
                avatarSrc = user.avatar
                    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
                    : `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 5}.png`;
            }
        }

        let unread = 0;
        try {
            unread = ReadStateStore?.getMentionCount?.(channelId) || 0;
            if (!unread && ReadStateStore?.hasUnread?.(channelId)) unread = "•";
        } catch (_) {}

        const popup = document.createElement("div");
        popup.className = "ghostpeek-popup";

        const titlebar = document.createElement("div");
        titlebar.className = "ghostpeek-titlebar";

        const avEl = document.createElement("div"); avEl.className = "ghostpeek-avatar";
        if (avatarSrc) {
            const img = document.createElement("img"); img.src = avatarSrc;
            img.onerror = () => { avEl.textContent = isGroup ? "👥" : ""; };
            avEl.appendChild(img);
        } else { avEl.textContent = isGroup ? "👥" : ""; }

        const nameEl = document.createElement("span"); nameEl.className = "ghostpeek-username"; nameEl.textContent = name;
        titlebar.append(avEl, nameEl);

        if (unread) {
            const badge = document.createElement("span"); badge.className = "ghostpeek-badge"; badge.textContent = unread;
            titlebar.appendChild(badge);
        }

        const callTimeEl = document.createElement("span"); callTimeEl.className = "ghostpeek-call-time"; callTimeEl.style.display = "none";
        const closeBtn   = document.createElement("button"); closeBtn.className = "ghostpeek-close"; closeBtn.textContent = "✕"; closeBtn.title = "Close (Esc)";
        closeBtn.addEventListener("click", e => { e.stopPropagation(); this._removePopup(popup); });
        titlebar.append(callTimeEl, closeBtn);
        popup.appendChild(titlebar);

        const lbl = Object.assign(document.createElement("div"), { className: "ghostpeek-label", textContent: "👻 Ghost Preview — read-state untouched · Ctrl+click or right-click to open" });
        popup.appendChild(lbl);

        const searchEl = document.createElement("div"); searchEl.className = "ghostpeek-search";
        searchEl.innerHTML = `
            <span class="ghostpeek-search-icon">🔍</span>
            <input class="ghostpeek-search-input" type="text" placeholder="Search messages, names…" spellcheck="false">
            <span class="ghostpeek-search-count"></span>
            <div class="ghostpeek-search-nav">
                <button class="gp-prev" title="Previous (Shift+Enter)">↑</button>
                <button class="gp-next" title="Next (Enter)">↓</button>
            </div>`;
        popup.appendChild(searchEl);

        const ticker = document.createElement("div"); ticker.className = "ghostpeek-bgticker"; ticker.style.display = "none";
        ticker.innerHTML = `<div class="ghostpeek-spinner"></div><span class="gp-ticker-text">Scanning older history…</span>`;
        popup.appendChild(ticker);

        const footer = document.createElement("div"); footer.className = "ghostpeek-footer";
        footer.innerHTML = `<span>🔒 Read-state untouched</span><span class="gp-count">loading…</span>`;
        popup.appendChild(footer);
        const countEl = footer.querySelector(".gp-count");

        const onEsc = e => { if (e.key === "Escape") this._removePopup(popup); };
        document.addEventListener("keydown", onEsc);
        document.body.appendChild(popup);
        this.popups.push({ el: popup, onEsc });
        this._makeDraggable(popup, titlebar);
        this._positionPopup(popup, anchorEl);
        requestAnimationFrame(() => requestAnimationFrame(() => popup.classList.add("visible")));

        if (!token) {
            const err = Object.assign(document.createElement("div"), { className: "ghostpeek-loading" });
            err.innerHTML = `<span style="color:#ed4245">Could not get auth token</span>`;
            popup.insertBefore(err, footer); return;
        }

        const msgContainer = document.createElement("div"); msgContainer.className = "ghostpeek-messages";
        msgContainer.addEventListener("wheel", e => e.stopPropagation(), { passive: true });

        const topLbl    = Object.assign(document.createElement("div"), { className: "ghostpeek-top-lbl", textContent: "" });
        const olderEl   = document.createElement("div"); olderEl.className = "ghostpeek-load-older"; olderEl.style.display = "none";
        olderEl.innerHTML = `<div class="ghostpeek-spinner"></div><span>Loading older…</span>`;
        msgContainer.append(topLbl, olderEl);
        popup.insertBefore(msgContainer, footer);

        const rerunSearch = this._attachSearch(searchEl, msgContainer);
        const dateRef     = { v: null };
        const dateRefFront = { v: null };

        const st = {
            messages:     [],
            oldestId:     null,
            newestId:     null,
            reachedTop:   false,
            totalCallSec: 0,
            bgRunning:    false,
            loadingOlder: false,
        };

        const updateCount = () => {
            countEl.textContent = st.reachedTop
                ? `${st.messages.length} messages`
                : `${st.messages.length}+ messages`;
        };

        const appendToBottom = msgs => {
            msgContainer.appendChild(this._buildMessages(msgs, dateRef));
            rerunSearch();
        };

        const prependToTop = (msgs, preserveScroll) => {
            const dist = msgContainer.scrollHeight - msgContainer.scrollTop;
            const frag = this._buildMessages(msgs, dateRefFront);
            olderEl.insertAdjacentElement("afterend", (() => {
                const anchor = document.createElement("span");
                anchor.style.cssText = "display:contents";
                return anchor;
            })());
            const nextSib = olderEl.nextSibling;
            msgContainer.insertBefore(frag, nextSib);
            if (preserveScroll) msgContainer.scrollTop = msgContainer.scrollHeight - dist;
            rerunSearch();
        };

        const addCallTime = msgs => {
            const cs = this._countCallSec(msgs);
            if (cs <= 0) return;
            st.totalCallSec += cs;
            this._callStoreSet(channelId, st.totalCallSec);
            this._applyCallTime(callTimeEl, st.totalCallSec, settings.callTimeFormat);
        };

        const cached = this._getCache(channelId, settings.cacheSeconds);

        if (cached?.messages?.length) {
            st.messages     = cached.messages;
            st.oldestId     = cached.oldestId;
            st.newestId     = cached.newestId;
            st.reachedTop   = cached.reachedTop;
            st.totalCallSec = cached.totalCallSec || 0;

            if (st.reachedTop) topLbl.textContent = "⬆ Beginning of conversation";
            this._applyCallTime(callTimeEl, st.totalCallSec, settings.callTimeFormat);

            appendToBottom(cached.messages);
            updateCount();
            requestAnimationFrame(() => { msgContainer.scrollTop = msgContainer.scrollHeight; });

            this._fetchAfter(channelId, st.newestId, token).then(newer => {
                if (!newer.length) return;
                st.messages.push(...newer);
                st.newestId = newer[newer.length - 1].id;
                addCallTime(newer);
                appendToBottom(newer);
                updateCount();
                this._setCache(channelId, { messages: st.messages, newestId: st.newestId, totalCallSec: st.totalCallSec });
                const atBottom = msgContainer.scrollHeight - msgContainer.scrollTop - msgContainer.clientHeight < 80;
                if (atBottom) msgContainer.scrollTop = msgContainer.scrollHeight;
            }).catch(() => {});

        } else {
            this._callStoreClear(channelId);
            st.totalCallSec = 0;

            const loadingEl = Object.assign(document.createElement("div"), { className: "ghostpeek-loading" });
            loadingEl.innerHTML = `<div class="ghostpeek-spinner"></div><span>Loading…</span>`;
            popup.insertBefore(loadingEl, msgContainer);

            let first;
            try {
                first = await this._fetchBefore(channelId, null, token);
            } catch (err) {
                loadingEl.innerHTML = `<span style="color:#ed4245">Failed: ${err.message}</span>`;
                countEl.textContent = "error"; return;
            }
            loadingEl.remove();

            if (!first.length) {
                msgContainer.appendChild(Object.assign(document.createElement("div"), { className: "ghostpeek-empty", textContent: "No messages found." }));
                topLbl.textContent = "⬆ Beginning of conversation";
                countEl.textContent = "0 messages";
                this._setCache(channelId, { messages: [], oldestId: null, newestId: null, reachedTop: true, totalCallSec: 0 });
                return;
            }

            st.messages   = first;
            st.oldestId   = first[0].id;
            st.newestId   = first[first.length - 1].id;
            st.reachedTop = first.length < 100;

            addCallTime(first);
            if (st.reachedTop) topLbl.textContent = "⬆ Beginning of conversation";

            appendToBottom(first);
            updateCount();
            requestAnimationFrame(() => { msgContainer.scrollTop = msgContainer.scrollHeight; });
            this._setCache(channelId, { messages: st.messages, oldestId: st.oldestId, newestId: st.newestId, reachedTop: st.reachedTop, totalCallSec: st.totalCallSec });
        }

        const loadOlder = async () => {
            if (st.reachedTop || st.loadingOlder || st.bgRunning) return;
            st.loadingOlder = true;
            olderEl.style.display = "flex";
            try {
                const older = await this._fetchBefore(channelId, st.oldestId, token);
                if (!older.length) {
                    st.reachedTop = true;
                } else {
                    st.oldestId   = older[0].id;
                    if (older.length < 100) st.reachedTop = true;
                    addCallTime(older);
                    for (let i = older.length - 1; i >= 0; i--) st.messages.unshift(older[i]);
                    prependToTop(older, true);
                    this._setCache(channelId, { messages: st.messages, oldestId: st.oldestId, reachedTop: st.reachedTop, totalCallSec: st.totalCallSec });
                    updateCount();
                }
                if (st.reachedTop) topLbl.textContent = "⬆ Beginning of conversation";
            } catch (e) { console.error("[GhostPeek] loadOlder:", e); }
            finally { olderEl.style.display = "none"; st.loadingOlder = false; }
        };

        let scrollThrottle = false;
        msgContainer.addEventListener("scroll", () => {
            if (scrollThrottle || msgContainer.scrollTop > 120) return;
            scrollThrottle = true;
            setTimeout(() => { scrollThrottle = false; }, 200);
            loadOlder();
        }, { passive: true });

        if (!st.reachedTop) {
            setTimeout(() => this._bgScan(channelId, st, ticker, topLbl, updateCount, prependToTop, addCallTime, token), 1200);
        }
    }

    async _bgScan(channelId, st, ticker, topLbl, updateCount, prependToTop, addCallTime, token) {
        if (st.bgRunning || st.reachedTop) return;
        st.bgRunning = true;
        ticker.style.display = "flex";
        const tickerText = ticker.querySelector(".gp-ticker-text");

        try {
            let scanned = 0;
            while (!st.reachedTop) {
                if (!ticker.isConnected) break;

                const older = await this._fetchBefore(channelId, st.oldestId, token);
                await new Promise(r => setTimeout(r, 450));

                if (!older.length) { st.reachedTop = true; break; }
                st.oldestId  = older[0].id;
                scanned     += older.length;
                if (older.length < 100) st.reachedTop = true;

                addCallTime(older);

                for (let i = older.length - 1; i >= 0; i--) st.messages.unshift(older[i]);

                this._setCache(channelId, { messages: st.messages, oldestId: st.oldestId, reachedTop: st.reachedTop, totalCallSec: st.totalCallSec });

                if (!st.loadingOlder) prependToTop(older, false);

                updateCount();
                tickerText.textContent = `Scanning history… ${scanned.toLocaleString()} older messages found`;
            }

            if (st.reachedTop) { topLbl.textContent = "⬆ Beginning of conversation"; updateCount(); }
        } catch (e) {
            console.warn("[GhostPeek] bgScan error:", e);
        } finally {
            ticker.style.display = "none";
            st.bgRunning = false;
        }
    }

    _removePopup(popup) {
        const idx = this.popups.findIndex(p => p.el === popup);
        if (idx === -1) return;
        const { el, onEsc } = this.popups.splice(idx, 1)[0];
        document.removeEventListener("keydown", onEsc);
        el.classList.remove("visible");
        setTimeout(() => el.remove(), 180);
    }

    _makeDraggable(popup, handle) {
        let ox, oy, ol, ot, dragging = false;
        handle.addEventListener("mousedown", e => {
            if (e.target.classList.contains("ghostpeek-close")) return;
            e.preventDefault(); dragging = true;
            ox = e.clientX; oy = e.clientY;
            const r = popup.getBoundingClientRect(); ol = r.left; ot = r.top;
            const onMove = e => {
                if (!dragging) return;
                popup.style.left = `${Math.max(0, ol + e.clientX - ox)}px`;
                popup.style.top  = `${Math.max(0, ot + e.clientY - oy)}px`;
            };
            const onUp = () => {
                dragging = false;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup",   onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup",   onUp);
        });
    }

    _positionPopup(popup, anchor) {
        const r = anchor.getBoundingClientRect();
        const W = 400, H = 520, M = 8, off = (this.popups.length - 1) * 24;
        let left = r.right + M + off, top = r.top + off;
        if (left + W > window.innerWidth  - M) left = r.left - W - M + off;
        if (top  + H > window.innerHeight - M) top  = window.innerHeight - H - M;
        popup.style.left = `${Math.round(Math.max(M, left))}px`;
        popup.style.top  = `${Math.round(Math.max(M, top))}px`;
    }
};