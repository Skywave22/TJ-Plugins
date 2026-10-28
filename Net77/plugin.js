(function (__ngRawGet, __ngRawPost) {
    "use strict";

    // ── network guard (TJ-Plugins shared helper) ─────────────────────────────────
    // Many internet providers block streaming sites (fake DNS answers, cut connections), and
    // Cloudflare-protected sites often ban whole countries or VPN ranges. Then a plugin only
    // works over a VPN. This wraps this plugin's own http_get / http_post (never the shared
    // globals):
    //   1. A request that fails at network level (status 0: DNS failure, reset/refused, TLS
    //      cut, timeout), returns HTTP 451, a Cloudflare block/challenge page, or an ISP block
    //      page is retried on the site's mirror domains (first one that works wins).
    //   2. If that fails too, the request goes through the TJ-Plugins relay (geo-pass): the
    //      relay fetches the page from Cloudflare's network and hands it back. A blocked host
    //      is remembered, so later requests go straight to the relay. Video link checks
    //      (Range requests) never use the relay: the player has to reach the video directly.
    //   3. If nothing works, the user gets an error that says the site is blocked on their
    //      network and how to get around it, instead of "no results" or a raw error.
    var __NG_MIRRORS = [];
    var __NG_RELAY = {"url": "", "key": "tj-relay-2026-skystream", "config": "https://raw.githubusercontent.com/Skywave22/TJ-Plugins/main/relay.json"};
    // group 0 = this site (manifest.baseUrl + manifest.domains + known mirrors); then shared APIs with official aliases
    var __NG = { get: __ngRawGet, post: __ngRawPost, groups: [[]],
        active: {}, relayed: {}, relays: null, ready: null, fails: [] };
    var __NG_RELAY_TTL = 6 * 3600 * 1000;
    function __ngHost(u) { var m = String(u || '').match(/^https?:\/\/([^\/?#:]+)/i); return m ? m[1].toLowerCase() : ''; }
    function __ngBare(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
    function __ngSwap(u, origin) { return origin + String(u).replace(/^https?:\/\/[^\/?#]+/i, ''); }
    (function () {
        var list = [], seen = {};
        try { if (manifest && manifest.baseUrl) list.push(manifest.baseUrl); } catch (_) {}
        try { ((manifest && manifest.domains) || []).forEach(function (d) { list.push(d && d.url ? d.url : d); }); } catch (_) {}
        list = list.concat(__NG_MIRRORS);
        list.forEach(function (u) {
            var m = String(u || '').match(/^(https?:\/\/[^\/?#]+)/i);
            if (!m || seen[__ngBare(__ngHost(m[1]))]) return;
            seen[__ngBare(__ngHost(m[1]))] = 1;
            __NG.groups[0].push(m[1].replace(/^http:/i, 'https:'));
        });
    })();
    function __ngGroupOf(h) {
        h = __ngBare(h);
        if (!h) return -1;
        for (var g = 0; g < __NG.groups.length; g++) {
            if (__NG.groups[g].some(function (o) { return __ngBare(__ngHost(o)) === h; })) return g;
        }
        return -1;
    }
    function __ngInGroup(h) { return __ngGroupOf(h) >= 0; }
    var __NG_BLOCK_TEXT = /(has been|is|was) (blocked|restricted|disabled)|access (to this [a-z ]{0,20})?(is|has been) (denied|restricted|blocked)|blocked (as per|by order|under|by court|by the)|not available in your (country|region)|website (is )?blocked|prohibited for viewership|content that is prohibited/i;
    var __NG_BLOCK_WHO = /court|order|government|ministry|authority|department|telecom|regulat|commission|law|legal|isp\b|internet service provider|operator|prohibited/i;
    var __NG_BLOCK_HOST = /internetpositif|trustpositif|blockpage|block\.|blocked\.|warning\.or\.kr|lawfulblock|zapret|rkn\.gov|eais\.|safebrowse|surfsafe|netalerts/i;
    var __NG_BLOCK_TITLE = /<title>[^<]{0,80}(blocked|prohibited|restricted|access denied|surf safely|not allowed|site unavailable in your)[^<]{0,80}<\/title>/i;
    var __NG_CF_BLOCK = /cf-error-details|Attention Required! \| Cloudflare|<title>Just a moment|cf-chl-|challenge-platform|Sorry, you have been blocked|error code: 10(0[0-9]|1[0-9]|20)\b/i;
    function __ngBad(r, reqUrl) {
        if (!r) return 'no response';
        var st = Number(r.status || r.statusCode || r.code || 0);
        if (st === 0) {
            var e = String(r.error || '');
            if (/cancel/i.test(e)) return '';
            return e || 'connection failed';
        }
        if (st === 451) return 'HTTP 451';
        var body = String(r.body || '');
        // a Cloudflare ban/challenge the app could not solve (country, VPN or ISP range blocked by the site)
        if ((st === 403 || st === 503 || st === 429 || st >= 520) && __NG_CF_BLOCK.test(body.slice(0, 30000))) return 'Cloudflare block (' + st + ')';
        var fin = String(r.finalUrl || '');
        if (fin && __ngHost(fin) !== __ngHost(reqUrl) && __NG_BLOCK_HOST.test(__ngHost(fin))) return 'ISP block page';
        if (body.length < 40000 && !/cloudflare/i.test(body)) {
            if (__NG_BLOCK_TEXT.test(body) && __NG_BLOCK_WHO.test(body)) return 'ISP block page';
            if (__NG_BLOCK_TITLE.test(body) && __NG_BLOCK_WHO.test(body)) return 'ISP block page';
        }
        return '';
    }
    function __ngWhy(e) {
        e = String(e || '');
        if (/cloudflare/i.test(e)) return 'the site\'s Cloudflare protection blocks your network or country';
        if (/host lookup|ENOTFOUND|getaddrinfo|No address|EAI_|name resolution/i.test(e)) return 'DNS blocked';
        if (/refused|ECONNREFUSED/i.test(e)) return 'connection refused';
        if (/timed? ?out|timeout|ETIMEDOUT/i.test(e)) return 'timed out';
        if (/reset|ECONNRESET|closed|terminated|EOF|handshake|TLS|SSL|certificate|EPIPE|aborted/i.test(e)) return 'connection cut';
        if (/451|block page/i.test(e)) return e;
        return 'connection failed';
    }
    function __ngNote(host, why) {
        __NG.fails.push({ host: host, why: __ngWhy(why), t: Date.now() });
        if (__NG.fails.length > 60) __NG.fails.shift();
    }
    // a host that failed and was then reached another way is no longer an error
    function __ngResolved(host) {
        host = __ngBare(host);
        __NG.fails = __NG.fails.filter(function (f) { return __ngBare(f.host) !== host; });
    }
    function __ngWait(p, ms) {
        return new Promise(function (resolve) {
            var t = setTimeout(function () { resolve(null); }, ms);
            Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(null); });
        });
    }
    function __ngInit() {
        if (__NG.ready) return __NG.ready;
        __NG.ready = (async function () {
            if (typeof getPreference !== 'function') return;
            try {
                var v = await __ngWait(getPreference('tj_net_mirror'), 1500);
                var o = v ? JSON.parse(String(v)) : null;
                // only reuse it while the user has not picked another domain in the plugin settings
                if (o && o.base === __NG.groups[0][0]) {
                    Object.keys(o.active || {}).forEach(function (g) {
                        var a = o.active[g];
                        if (__ngGroupOf(__ngHost(a)) === +g) __NG.active[g] = a;
                    });
                }
                if (o && o.relayed) {
                    Object.keys(o.relayed).forEach(function (h) {
                        if (Date.now() - Number(o.relayed[h]) < __NG_RELAY_TTL) __NG.relayed[h] = Number(o.relayed[h]);
                    });
                }
            } catch (_) {}
        })();
        return __NG.ready;
    }
    function __ngSave() {
        try {
            if (typeof setPreference === 'function') {
                setPreference('tj_net_mirror', JSON.stringify({ base: __NG.groups[0][0], active: __NG.active, relayed: __NG.relayed }));
            }
        } catch (_) {}
    }
    function __ngRemember(g, origin) { __NG.active[g] = origin; __ngSave(); }
    function __ngHeaders(h, origin) {
        if (!h || typeof h !== 'object') return h;
        var out = {}, g = __ngGroupOf(__ngHost(origin));
        Object.keys(h).forEach(function (k) {
            var v = h[k];
            if (/^(referer|origin)$/i.test(k) && typeof v === 'string' && g >= 0 && __ngGroupOf(__ngHost(v)) === g) v = __ngSwap(v, origin);
            out[k] = v;
        });
        return out;
    }
    function __ngIsProbe(h) {
        return !!h && typeof h === 'object' && Object.keys(h).some(function (k) { return /^range$/i.test(k); });
    }
    async function __ngCall(method, url, headers, body) {
        try {
            var r = method === 'POST' ? await __NG.post(url, headers, body) : await __NG.get(url, headers);
            return { r: r, err: null };
        } catch (e) {
            return { r: { status: 0, statusCode: 0, body: '', error: String((e && e.message) || e) }, err: e };
        }
    }
    // Relay list = built-in url (if any) + the repo's relay.json, read once (only after a block) and cached
    // for 6 h. Editing relay.json in the GitHub repo switches every installed plugin to new relays without
    // a plugin update; several relays are tried in order (spare capacity on the free plan).
    function __ngRelayList() {
        if (__NG.relays) return __NG.relays;
        __NG.relays = (async function () {
            var list = [], key = (__NG_RELAY && __NG_RELAY.key) || '';
            if (__NG_RELAY && __NG_RELAY.url) list.push(__NG_RELAY.url);
            var cfg = null;
            try {
                if (typeof getPreference === 'function') {
                    var c = await __ngWait(getPreference('tj_net_relays'), 1500);
                    var o = c ? JSON.parse(String(c)) : null;
                    if (o && Date.now() - Number(o.t) < __NG_RELAY_TTL) cfg = o.cfg;
                }
            } catch (_) {}
            if (!cfg && __NG_RELAY && __NG_RELAY.config) {
                var res = await __ngCall('GET', __NG_RELAY.config + (__NG_RELAY.config.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / 3600000), { 'Cache-Control': 'no-cache' }, null);
                try { cfg = JSON.parse(String((res.r && res.r.body) || '')); } catch (_) { cfg = null; }
                if (cfg) {
                    // an empty list (relay not set up yet) is re-checked after 30 min instead of 6 h
                    var t = (cfg.relays && cfg.relays.length) ? Date.now() : Date.now() - __NG_RELAY_TTL + 30 * 60000;
                    try { if (typeof setPreference === 'function') setPreference('tj_net_relays', JSON.stringify({ t: t, cfg: cfg })); } catch (_) {}
                }
            }
            if (cfg && cfg.relays && cfg.relays.length) {
                cfg.relays.forEach(function (u) { if (/^https?:\/\//i.test(u) && list.indexOf(u) < 0) list.push(String(u).replace(/\/+$/, '')); });
                if (cfg.key) key = String(cfg.key);
            }
            return { list: list, key: key };
        })();
        return __NG.relays;
    }
    function __ngIsRelayHost(h) {
        h = __ngBare(h);
        return /\.workers\.dev$/.test(h) || (!!__NG_RELAY && !!__NG_RELAY.url && h === __ngBare(__ngHost(__NG_RELAY.url)));
    }
    async function __ngRelay(method, url, headers, body) {
        var rl = await __ngRelayList();
        if (!rl.list.length) return null;
        var payload = JSON.stringify({
            url: url, method: method, headers: headers && typeof headers === 'object' ? headers : {},
            body: body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body))
        });
        for (var i = 0; i < rl.list.length && i < 3; i++) {
            var res = await __ngCall('POST', rl.list[i], { 'Content-Type': 'application/json', 'x-tj-key': rl.key }, payload);
            var r = res.r, st = Number((r && (r.status || r.statusCode)) || 0);
            if (st !== 200) continue; // down or over its daily limit: next relay
            var j = null;
            try { j = JSON.parse(String(r.body || '')); } catch (_) {}
            if (!j || typeof j !== 'object') continue;
            var code = Number(j.status || 0);
            return { code: code, statusCode: code, status: code, body: String(j.body || ''), headers: j.headers || {},
                finalUrl: j.finalUrl || url, error: j.error, relayed: true };
        }
        return null;
    }
    async function __ngViaRelay(method, url, headers, body) {
        var rr = await __ngRelay(method, url, headers, body);
        if (!rr) return null;
        var b = __ngBad(rr, url);
        if (b) { __ngNote(__ngHost(url), b + ' (relay)'); return null; }
        var h = __ngBare(__ngHost(url));
        __NG.relayed[h] = Date.now();
        __ngResolved(h);
        __ngSave();
        return rr;
    }
    async function __ngRequest(method, url, headers, body) {
        await __ngInit();
        var host = __ngHost(url), g = __ngGroupOf(host), mine = g >= 0;
        var canRelay = !!__NG_RELAY && !!(__NG_RELAY.url || __NG_RELAY.config) && !__ngIsProbe(headers) && !__ngIsRelayHost(host) && !/raw\.githubusercontent\.com$/.test(host);
        var target = url, h0 = headers, act = mine ? __NG.active[g] : '';
        if (act && __ngBare(__ngHost(act)) !== __ngBare(host)) {
            target = __ngSwap(url, act);
            h0 = __ngHeaders(headers, act);
        }
        // known blocked on this network: go straight to the relay (re-checked after a few hours)
        var rh = __ngBare(__ngHost(target));
        if (canRelay && __NG.relayed[rh] && Date.now() - __NG.relayed[rh] < __NG_RELAY_TTL) {
            var quick = await __ngViaRelay(method, target, h0, body);
            if (quick) return quick;
        }
        var first = await __ngCall(method, target, h0, body);
        var bad = __ngBad(first.r, target);
        if (!bad) { if (__NG.relayed[rh]) { delete __NG.relayed[rh]; __ngSave(); } return first.r; }
        __ngNote(__ngHost(target), bad);
        if (mine) {
            var tried = __ngBare(__ngHost(target));
            var alts = __NG.groups[g].filter(function (o) { return __ngBare(__ngHost(o)) !== tried; }).slice(0, 5);
            if (alts.length) {
                // all mirrors at once; the first one that answers properly wins
                var hit = await new Promise(function (resolve) {
                    var left = alts.length;
                    alts.forEach(function (o) {
                        __ngCall(method, __ngSwap(url, o), __ngHeaders(headers, o), body).then(function (res) {
                            var b = __ngBad(res.r, __ngSwap(url, o));
                            if (!b) resolve({ o: o, r: res.r });
                            else { __ngNote(__ngHost(o), b); if (--left === 0) resolve(null); }
                        });
                    });
                });
                if (hit) { __ngRemember(g, hit.o); __ngResolved(tried); return hit.r; }
            }
        }
        if (canRelay) {
            var viaRelay = await __ngViaRelay(method, target, h0, body);
            if (viaRelay) return viaRelay;
        }
        if (first.err) throw first.err;
        return first.r;
    }
    var http_get = function (url, headers, cb) {
        return __ngRequest('GET', url, headers, null).then(function (r) { if (typeof cb === 'function') cb(r); return r; });
    };
    var http_post = function (url, headers, body, cb) {
        return __ngRequest('POST', url, headers, body).then(function (r) { if (typeof cb === 'function') cb(r); return r; });
    };
    // strong = the network itself refused the site (typical block); weak = only timeouts (may just be a slow/down site)
    function __ngStrong(why) { return why !== 'timed out' && why !== 'connection failed'; }
    function __ngExplain(name, res, t0) {
        if (!res || res.success !== false) return res;
        var recent = __NG.fails.filter(function (f) { return f.t >= t0 && !__ngIsRelayHost(f.host); });
        if (!recent.length) return res;
        var tip = ' Fix: phone Settings → Private DNS → dns.google (Android), or SkyStream Settings → Accounts, Network & Downloads → DNS over HTTPS → On' +
            (__NG.groups[0].length > 1 ? ', or pick another domain in this plugin\'s settings' : '') +
            '. If it still fails, your provider blocks the site completely: use a VPN.';
        function hostsOf(list) { var hs = []; list.forEach(function (f) { if (hs.indexOf(f.host) < 0) hs.push(f.host); }); return hs.slice(0, 3).join(', '); }
        var site = recent.filter(function (f) { return __ngInGroup(f.host); });
        var siteStrong = site.filter(function (f) { return __ngStrong(f.why); });
        if (siteStrong.length) {
            return { success: false, errorCode: 'SITE_BLOCKED',
                message: hostsOf(siteStrong) + ' is blocked on your network (' + siteStrong[siteStrong.length - 1].why +
                    ') - that is why it works with a VPN.' + tip };
        }
        if (site.length && name !== 'loadStreams') {
            return { success: false, errorCode: 'SITE_UNREACHABLE',
                message: hostsOf(site) + ' is not responding (' + site[site.length - 1].why + '). The site may be down or overloaded - ' +
                    'try again in a few minutes. If it only works with a VPN, your provider is blocking it.' + tip };
        }
        if (name === 'loadStreams') {
            var strong = recent.filter(function (f) { return __ngStrong(f.why); });
            if (strong.length) {
                return { success: false, errorCode: 'HOSTS_BLOCKED',
                    message: 'The video servers for this title (' + hostsOf(strong) + ') are blocked on your network (' +
                        strong[strong.length - 1].why + ') - that is why it works with a VPN.' + tip };
            }
        }
        return res;
    }
    function __ngWrapExports() {
        ['getHome', 'search', 'load', 'loadStreams'].forEach(function (name) {
            var f = globalThis[name];
            if (typeof f !== 'function' || f.__ng) return;
            var w = function () {
                var args = Array.prototype.slice.call(arguments), i = args.length - 1, t0 = Date.now();
                if (i >= 0 && typeof args[i] === 'function') {
                    var cb = args[i];
                    args[i] = function (res) {
                        var out = res;
                        try { out = __ngExplain(name, res, t0); } catch (_) {}
                        return cb(out);
                    };
                }
                return f.apply(this, args);
            };
            w.__ng = true;
            globalThis[name] = w;
        });
    }
    // ── end network guard ────────────────────────────────────────────────────────



    // ═══════════════════════════════════════════════════════════
    //  Net77 (net77.cc - the original NetMirror) - TJ-Plugins
    //
    //  NetMirror's own catalog: Netflix (Hollywood, Bollywood, Hindi dubbed, K-Drama,
    //  anime...) and JioHotstar, every audio language Netflix has (Hindi, English, Tamil,
    //  Telugu, Korean, Japanese...), 1080p HLS, English subtitles.
    //
    //  How the site works (and why this plugin talks to two of its domains):
    //    net77.cc  - the web site. Its pages sit behind a Cloudflare "verify you are human"
    //                wall, but its JSON endpoints do not: search.php and playlist.php.
    //                playlist.php is the one that SIGNS the video address (in=<token>),
    //                as long as the request carries a NetMirror session cookie.
    //    net52.cc  - the domain NetMirror's Android app uses. It hands out that session
    //                cookie (t_hash_t) from /verify.php, and serves the app's home rows,
    //                title details (post.php) and episode lists (episodes.php).
    //  A session is only good for playing for a few minutes, so every play opens a new
    //  one (one small request). Without a valid token the server swaps the film for a
    //  10-minute promo clip (files/220884) - that is detected and retried.
    //
    //  The master playlist net77 returns names the video server with an old host name
    //  (nm-cdnN.top, some of which no longer exist) or none at all. The plugin finds the
    //  live one: the host net77 names, the same server under its new name (freecdnN.top),
    //  and the host net52's app playlist names for the audio tracks - the first that
    //  answers is used. Video playlists need Referer https://net52.cc/; the segments
    //  need nothing.
    // ═══════════════════════════════════════════════════════════

    const SITE = (typeof manifest !== "undefined" && manifest && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, "") : "https://net77.cc";
    const APP = "https://net52.cc";
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
    const APP_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36 /OS.Gatu v3.0";
    const PLAY_REFERER = APP + "/";
    const PROMO_ID = "220884";

    function mkItem(obj)    { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj)  { try { return new StreamResult(obj); } catch (_) { return obj; } }
    function mkActor(obj)   { try { return new Actor(obj); } catch (_) { return obj; } }

    function withTimeout(promise, ms) {
        if (typeof setTimeout !== "function") return promise;
        return new Promise(function (resolve, reject) {
            const t = setTimeout(function () { reject(new Error("timeout")); }, ms);
            promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    function unix() { return Math.floor(Date.now() / 1000); }
    function clean(s) {
        return String(s == null ? "" : s).replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&#x27;/g, "'")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    }
    function num(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }
    function parseJson(s) { try { return JSON.parse(String(s || "")); } catch (_) { return null; } }
    function uuid() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    // ── catalogs ──
    const OTT = {
        nf: { name: "Netflix", tag: "Netflix", search: "/search.php", post: "/post.php", episodes: "/episodes.php", playlist: "/playlist.php",
              poster: function (id) { return "https://imgcdn.kim/poster/v/" + id + ".jpg"; },
              banner: function (id) { return "https://imgcdn.kim/poster/h/" + id + ".jpg"; },
              still:  function (id) { return "https://imgcdn.kim/epimg/150/" + id + ".jpg"; } },
        pv: { name: "Prime Video", tag: "Prime", search: "/mobile/pv/search.php", post: "/mobile/pv/post.php", episodes: "/mobile/pv/episodes.php", playlist: "/mobile/pv/playlist.php",
              // Prime's portrait posters are 1-4 MB, so cards use the site's own small 341px art
              poster: function (id) { return "https://imgcdn.kim/pv/341/" + id + ".jpg"; },
              bigPoster: function (id) { return "https://imgcdn.kim/pv/v/" + id + ".jpg"; },
              banner: function (id) { return "https://imgcdn.kim/pv/1920/" + id + ".jpg"; },
              still:  function (id) { return "https://imgcdn.kim/pvepimg/150/" + id + ".jpg"; } },
        hs: { name: "JioHotstar", tag: "Hotstar", search: "/mobile/hs/search.php", post: "/mobile/hs/post.php", episodes: "/mobile/hs/episodes.php", playlist: "/mobile/hs/playlist.php",
              poster: function (id) { return "https://imgcdn.kim/hs/v/" + id + ".jpg"; },
              banner: function (id) { return "https://imgcdn.kim/hs/h/" + id + ".jpg"; },
              still:  function (id) { return "https://imgcdn.kim/hsepimg/150/" + id + ".jpg"; } }
    };
    const OTT_ORDER = ["nf", "pv", "hs"];
    // item url = JSON { o: "nf"|"pv"|"hs", id, t?: title }  ·  episode url adds { ep: episodeId, s, e, y: year, k: "m"|"s" }
    function parseUrl(url) {
        const p = parseJson(url);
        if (p && p.id && OTT[p.o]) return p;
        return null;
    }
    function itemUrl(o, id, title) { return JSON.stringify({ o: o, id: String(id), t: title || "" }); }

    // ── session (NetMirror's t_hash_t cookie) ──
    let SESSION = null; // { h, t }
    function cookieOf(h, o) { return "t_hash_t=" + h + "; ott=" + (o || "nf") + "; hd=on"; }
    function setCookieValue(headers) {
        if (!headers) return "";
        let raw = headers["set-cookie"] || headers["Set-Cookie"] || "";
        if (Array.isArray(raw)) raw = raw.join("; ");
        const m = String(raw).match(/t_hash_t=([^;,\s]+)/i);
        return m ? m[1] : "";
    }
    let SESSION_P = null;
    function newSession() {
        if (SESSION_P) return SESSION_P;
        SESSION_P = openSession().then(function (v) { SESSION_P = null; return v; }, function (e) { SESSION_P = null; throw e; });
        return SESSION_P;
    }
    async function openSession() {
        for (let i = 0; i < 2; i++) {
            try {
                const res = await withTimeout(Promise.resolve(http_post(APP + "/verify.php", {
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Origin": APP,
                    "Referer": APP + "/verify2"
                }, "g-recaptcha-response=" + encodeURIComponent(uuid()))), 15000);
                const h = setCookieValue(res && res.headers);
                if (h && (h.indexOf("%3A%3A") > 0 || h.indexOf("::") > 0)) { SESSION = { h: h, t: Date.now() }; return SESSION; }
            } catch (_) {}
        }
        throw new Error("Could not open a NetMirror session (net52.cc/verify.php gave no cookie). The site may be down - try again in a minute.");
    }
    // details/home/search are fine with a session up to ~1 hour old; playing needs a fresh one
    async function session(maxAgeMs) {
        if (SESSION && Date.now() - SESSION.t < (maxAgeMs || 3600000)) return SESSION;
        return newSession();
    }

    async function appGet(path, o, ms, mobile) {
        const s = await session();
        const headers = {
            "User-Agent": mobile ? APP_UA : UA,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": mobile ? "text/html,application/xhtml+xml,*/*;q=0.8" : "application/json, text/javascript, */*; q=0.01",
            "Referer": APP + (mobile ? "/mobile/home?app=1" : "/home"),
            "Cookie": cookieOf(s.h, o)
        };
        const res = await withTimeout(Promise.resolve(http_get(APP + path, headers)), ms || 20000);
        return res && res.body ? String(res.body) : "";
    }
    async function appJson(path, o, ms) {
        let j = parseJson(await appGet(path, o, ms));
        if (j && j.status === "n" && /invalid user/i.test(j.error || "")) { // session expired: once more with a new one
            SESSION = null;
            j = parseJson(await appGet(path, o, ms));
        }
        return j;
    }

    // ── home: NetMirror app's rows (Netflix + JioHotstar) ──
    function parseRows(html, o, prefix) {
        const out = [];
        const parts = String(html || "").split(/<h2 class="tray-title">/);
        for (let i = 1; i < parts.length; i++) {
            const name = clean(parts[i].split("</h2>")[0].replace(/<[^>]+>/g, ""));
            const ids = [], seen = {};
            const re = /data-post="([^"']+)"/g;
            let m;
            while ((m = re.exec(parts[i])) !== null) {
                const id = m[1];
                if (!id || seen[id] || /[^A-Za-z0-9]/.test(id)) continue;
                seen[id] = 1;
                ids.push(id);
            }
            if (!name || !ids.length) continue;
            out.push({ name: (prefix || "") + name, items: ids.map(function (id) {
                return mkItem({ title: " ", url: itemUrl(o, id), posterUrl: OTT[o].poster(id), type: "movie" });
            }) });
        }
        return out;
    }
    // Netflix rows in this order (the rest after them, in the site's order)
    const NF_ORDER = [/^new on netflix/i, /^top searches/i, /^only on netflix/i, /bollywood/i, /dubbed in hindi/i,
        /k-drama/i, /^anime/i, /us tv shows$/i, /bingeworthy/i, /exciting tv/i, /critically/i, /crime/i, /real life/i, /asian/i, /epic/i, /documentar/i];
    function nfRank(name) {
        for (let i = 0; i < NF_ORDER.length; i++) if (NF_ORDER[i].test(name)) return i;
        return NF_ORDER.length;
    }
    function rowLabel(o, name) {
        if (o === "nf") return /netflix/i.test(name) ? name : "Netflix · " + name;
        return (o === "pv" ? "Prime Video · " : "Hotstar · ") + name;
    }
    // first row of each catalog: Netflix "New on Netflix", Prime "Latest Movies", Hotstar "Latest Releases"
    const HEAD_ROW = { nf: /^new on netflix/i, pv: /^latest movies/i, hs: /^latest releases/i };
    // inside All-in-one: only these rows, with titles filled in (All-in-one merges cards by title)
    const AIO_ROWS = { nf: [/^new on netflix/i, /^bollywood movies/i], pv: [/^latest movies/i], hs: [/^latest releases/i] };
    const IN_AIO = typeof manifest !== "undefined" && !!(manifest && manifest.aio);

    // id -> { t, y, k } from post.php, kept on the phone so the All-in-one rows fill fast
    let TITLES = null;
    async function titleCache() {
        if (TITLES) return TITLES;
        TITLES = {};
        try {
            if (typeof getPreference === "function") {
                const v = parseJson(await withTimeout(Promise.resolve(getPreference("net77_titles")), 1500));
                if (v && typeof v === "object") TITLES = v;
            }
        } catch (_) {}
        return TITLES;
    }
    function saveTitles() {
        try {
            if (typeof setPreference !== "function") return;
            const keys = Object.keys(TITLES);
            if (keys.length > 900) keys.slice(0, keys.length - 900).forEach(function (k) { delete TITLES[k]; });
            setPreference("net77_titles", JSON.stringify(TITLES));
        } catch (_) {}
    }
    async function withTitles(o, items) {
        const cache = await titleCache();
        const todo = items.filter(function (it) { const p = parseUrl(it.url); return p && !cache[o + ":" + p.id]; });
        for (let i = 0; i < todo.length; i += 10) {
            await Promise.all(todo.slice(i, i + 10).map(async function (it) {
                const p = parseUrl(it.url);
                try {
                    const d = await appJson(OTT[o].post + "?id=" + encodeURIComponent(p.id) + "&t=" + unix(), o, 10000);
                    if (d && d.status === "y" && d.title) cache[o + ":" + p.id] = { t: clean(d.title), y: num(d.year), k: (d.episodes || []).filter(Boolean).length ? "s" : "m" };
                } catch (_) {}
            }));
        }
        if (todo.length) saveTitles();
        return items.map(function (it) {
            const p = parseUrl(it.url), c = p && cache[o + ":" + p.id];
            if (!c) return null;
            return mkItem({ title: c.t, url: itemUrl(o, p.id, c.t), posterUrl: it.posterUrl, type: c.k === "s" ? "series" : "movie", year: c.y || undefined });
        }).filter(Boolean);
    }

    async function getHome(cb) {
        try {
            await session();
            const pages = await Promise.all(OTT_ORDER.map(function (o) {
                return appGet("/mobile/home?app=1", o, 25000, true).catch(function () { return ""; });
            }));
            const byOtt = {};
            OTT_ORDER.forEach(function (o, i) { byOtt[o] = parseRows(pages[i], o, ""); });
            byOtt.nf.sort(function (a, b) { return nfRank(a.name) - nfRank(b.name); });
            const data = {};
            if (IN_AIO) {
                for (const o of OTT_ORDER) {
                    for (const re of AIO_ROWS[o]) {
                        const r = byOtt[o].filter(function (x) { return re.test(x.name); })[0];
                        if (!r) continue;
                        const items = await withTitles(o, r.items.slice(0, 20));
                        if (items.length) data[rowLabel(o, r.name)] = items;
                    }
                }
            } else {
                // 1st row Netflix, 2nd Prime Video, 3rd Hotstar, then the rest of each catalog
                const heads = [], rest = [];
                OTT_ORDER.forEach(function (o) {
                    const h = byOtt[o].filter(function (x) { return HEAD_ROW[o].test(x.name); })[0] || byOtt[o][0];
                    if (h) heads.push({ o: o, r: h });
                    byOtt[o].forEach(function (x) { if (x !== h) rest.push({ o: o, r: x }); });
                });
                heads.concat(rest).forEach(function (x) {
                    const name = rowLabel(x.o, x.r.name);
                    if (!data[name]) data[name] = x.r.items.slice(0, 40);
                });
            }
            if (!Object.keys(data).length) return cb({ success: false, errorCode: "HOME_ERROR", message: "NetMirror's home page came back empty - try again in a minute." });
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ── search: Netflix (public on net77), Prime Video and JioHotstar ──
    async function searchOtt(o, q) {
        try {
            let body = "";
            if (o === "nf") {
                const res = await withTimeout(Promise.resolve(http_get(SITE + "/search.php?s=" + encodeURIComponent(q) + "&t=" + unix(),
                    { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": SITE + "/" })), 15000);
                body = res && res.body ? String(res.body) : "";
            }
            let j = parseJson(body);
            if (!j || !j.searchResult) j = await appJson(OTT[o].search + "?s=" + encodeURIComponent(q) + "&t=" + unix(), o, 15000);
            return ((j && j.searchResult) || []).map(function (r) {
                const id = clean(r.id);
                if (!id) return null;
                return mkItem({ title: clean(r.t) || "Untitled", url: itemUrl(o, id, clean(r.t)), posterUrl: OTT[o].poster(id),
                    type: /series/i.test(String(r.r || "")) ? "series" : "movie", year: num(r.y) || undefined });
            }).filter(Boolean);
        } catch (_) { return []; }
    }
    async function search(query, cb) {
        try {
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });
            const res = await Promise.all(OTT_ORDER.map(function (o) { return searchOtt(o, q); }));
            cb({ success: true, data: [].concat.apply([], res) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ── details ──
    function epOf(o, seriesId, title, ep, year) {
        const s = num(String(ep.s || "").replace(/\D/g, "")) || 1;
        const e = num(String(ep.ep || "").replace(/\D/g, "")) || 1;
        return mkEpisode({
            name: clean(ep.t) || ("Episode " + e),
            url: JSON.stringify({ o: o, id: String(seriesId), ep: String(ep.id), t: title, s: s, e: e, y: year || 0, k: "s" }),
            season: s, episode: e,
            posterUrl: OTT[o].still(ep.id),
            description: clean(ep.ep_desc),
            runtime: num(String(ep.time || "").replace(/\D/g, "")) || null
        });
    }
    async function seasonEpisodes(o, seriesId, seasonId, startPage, title, year) {
        const list = [];
        for (let pg = startPage, n = 0; n < 30; pg++, n++) {
            const j = await appJson(OTT[o].episodes + "?s=" + encodeURIComponent(seasonId) + "&series=" + encodeURIComponent(seriesId) + "&t=" + unix() + "&page=" + pg, o, 15000);
            ((j && j.episodes) || []).forEach(function (ep) { if (ep && ep.id) list.push(epOf(o, seriesId, title, ep, year)); });
            if (!j || Number(j.nextPageShow || 0) !== 1) break;
        }
        return list;
    }
    function runtimeMin(s) {
        const h = String(s || "").match(/(\d+)\s*h/), m = String(s || "").match(/(\d+)\s*m/);
        const t = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
        return t || null;
    }
    async function load(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "PARSE_ERROR", message: "Unknown Net77 link - open the title again from Net77's home or search." });
            const o = p.o, cfg = OTT[o];
            const d = await appJson(cfg.post + "?id=" + encodeURIComponent(p.id) + "&t=" + unix(), o, 25000);
            if (!d || d.status !== "y" || !d.title) {
                return cb({ success: false, errorCode: "NOT_FOUND", message: "NetMirror has no details for this title right now" + (d && d.error ? " (" + d.error + ")" : "") + "." });
            }
            const title = clean(d.title);
            const score = (function () { const m = String(d.match || "").match(/IMDb\s*([\d.]+)/i); return m ? Number(m[1]) : null; })();
            const common = {
                title: title,
                url: itemUrl(o, p.id, title),
                posterUrl: (cfg.bigPoster || cfg.poster)(p.id),
                bannerUrl: cfg.banner(p.id),
                year: num(d.year),
                description: clean(d.desc || d.m_desc),
                score: score,
                tags: String(d.genre || "").split(",").map(clean).filter(Boolean).slice(0, 5),
                cast: String(d.cast || d.short_cast || "").split(",").map(clean).filter(Boolean).slice(0, 12).map(function (n) { return mkActor({ name: n }); }),
                contentRating: clean(d.ua) || undefined,
                recommendations: (d.suggest || []).slice(0, 15).map(function (r) {
                    return r && r.id ? mkItem({ title: " ", url: itemUrl(o, r.id), posterUrl: cfg.poster(r.id), type: "movie" }) : null;
                }).filter(Boolean)
            };
            const eps = (d.episodes || []).filter(Boolean);
            if (!eps.length) {
                common.type = "movie";
                common.duration = runtimeMin(d.runtime);
                common.episodes = [mkEpisode({ name: "Full Movie", url: JSON.stringify({ o: o, id: String(p.id), ep: String(p.id), t: title, y: num(d.year) || 0, k: "m" }),
                    season: 1, episode: 1, posterUrl: cfg.banner(p.id), description: common.description, runtime: common.duration })];
                return cb({ success: true, data: mkItem(common) });
            }
            // post.php lists one season (usually the newest) page 1; the rest come from episodes.php
            const yr = num(d.year);
            let all = eps.map(function (ep) { return epOf(o, p.id, title, ep, yr); });
            const seasons = (d.season || []).filter(function (s) { return s && s.id; });
            const shownSeason = String(eps[0].s || "").replace(/\D/g, "");
            const jobs = [];
            if (Number(d.nextPageShow || 0) === 1 && d.nextPageSeason) jobs.push(seasonEpisodes(o, p.id, d.nextPageSeason, 2, title, yr));
            seasons.forEach(function (s) { if (String(s.s) !== shownSeason) jobs.push(seasonEpisodes(o, p.id, s.id, 1, title, yr)); });
            for (let i = 0; i < jobs.length; i += 6) {
                (await Promise.all(jobs.slice(i, i + 6))).forEach(function (l) { all = all.concat(l); });
            }
            const seen = {};
            all = all.filter(function (e) { const k = e.season + ":" + e.episode; if (seen[k]) return false; seen[k] = 1; return true; })
                .sort(function (a, b) { return a.season - b.season || a.episode - b.episode; });
            common.type = /anime/i.test(String(d.genre || "")) ? "anime" : "series";
            common.episodes = all;
            cb({ success: true, data: mkItem(common) });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ── streams ──
    const STREAM_CACHE = {};
    function b64(s) {
        try { if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(s))); } catch (_) {}
        try { return Buffer.from(s, "utf-8").toString("base64"); } catch (_) {}
        return "";
    }
    function attrs(line) {
        const o = {}, re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;
        let m;
        while ((m = re.exec(line)) !== null) o[m[1]] = m[3] != null ? m[3] : m[2];
        return o;
    }
    // net77's master -> { audio:[{lang,name,path,host,def}], video:[{res,path,host,query}] }
    // NetMirror names a server either plainly ("s21.freecdn4.top") or behind a relay
    // ("makhi1.top/s22.freecdn41.top") - "host" keeps everything before /files/.
    function splitCdnUrl(u) {
        return String(u || "").match(/^https?:\/\/(.*?)(\/files\/[^?]*)(\?.*)?$/) || String(u || "").match(/^https?:\/\/([^\/]*)(\/[^?]*)(\?.*)?$/);
    }
    function parseMaster(text) {
        const lines = String(text || "").split(/\r?\n/), out = { audio: [], video: [] };
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i].trim();
            if (/^#EXT-X-MEDIA:/.test(l) && /TYPE=AUDIO/.test(l)) {
                const a = attrs(l.slice(13));
                const m = splitCdnUrl(a.URI);
                if (m) out.audio.push({ lang: String(a.LANGUAGE || "und").toLowerCase(), name: clean(String(a.NAME || "").replace(/^\d+\.\s*/, "").replace(/^\[\d+\]\s*/, "")) || a.LANGUAGE,
                    host: m[1], path: m[2], query: m[3] || "", def: /YES/i.test(a.DEFAULT || "") });
            } else if (/^#EXT-X-STREAM-INF:/.test(l)) {
                const a = attrs(l.slice(18));
                const u = (lines[i + 1] || "").trim();
                const m = splitCdnUrl(u);
                if (m) out.video.push({ res: String(a.RESOLUTION || ""), host: m[1], path: m[2], query: m[3] || "" });
            }
        }
        return out;
    }
    function hostVariants(h) {
        if (!h) return [];
        const list = [h];
        const swap = function (x) {
            if (/nm-cdn(\d+)\.[^\/]*$/.test(x)) list.push(x.replace(/nm-cdn(\d+)\.([^\/]*)$/, "freecdn$1.$2"));
            else if (/freecdn(\d+)\.[^\/]*$/.test(x)) list.push(x.replace(/freecdn(\d+)\.([^\/]*)$/, "nm-cdn$1.$2"));
        };
        swap(h);
        if (h.indexOf("/") > 0) { const bare = h.slice(h.lastIndexOf("/") + 1); if (bare) list.push(bare); }
        return list;
    }
    async function isPlaylist(url) {
        try {
            const r = await withTimeout(Promise.resolve(http_get(url, { "User-Agent": UA, "Referer": PLAY_REFERER })), 9000);
            return !!(r && Number(r.status) === 200 && /^\s*#EXTM3U/.test(String(r.body || "")));
        } catch (_) { return false; }
    }
    function qPath(path, q) { return path.replace(/\/(\d{3,4}p)\/\1\.m3u8$/, "/" + q + "/" + q + ".m3u8"); }

    const LANG_ORDER = ["hin", "eng", "tam", "tel", "mal", "kan", "ben", "urd", "mar", "pan", "guj", "kor", "jpn"];
    const LANG_NAME = { hin: "Hindi", eng: "English", tam: "Tamil", tel: "Telugu", mal: "Malayalam", kan: "Kannada", ben: "Bengali",
        urd: "Urdu", mar: "Marathi", pan: "Punjabi", guj: "Gujarati", kor: "Korean", jpn: "Japanese", spa: "Spanish", fra: "French",
        deu: "German", ita: "Italian", por: "Portuguese", ara: "Arabic", tur: "Turkish", tha: "Thai", ind: "Indonesian", zho: "Chinese", chi: "Chinese" };

    // one signed playlist + master, with a fresh session; null result => {err}
    async function signedMaster(p, o, epId) {
        const cfg = OTT[o];
        let last = "";
        for (let attempt = 0; attempt < 2; attempt++) {
            const s = attempt === 0 ? await session(4 * 60000) : await newSession();
            const cookie = cookieOf(s.h, o);
            const pr = await withTimeout(Promise.resolve(http_get(SITE + cfg.playlist + "?id=" + encodeURIComponent(epId) + "&t=" + encodeURIComponent(p.t || "") + "&tm=" + unix(),
                { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": SITE + "/home", "Cookie": cookie })), 20000).catch(function () { return null; });
            let pl = parseJson(pr && pr.body);
            if (pl && !Array.isArray(pl)) pl = [pl];
            const item = pl && pl[0];
            const sources = (item && item.sources) || [];
            if (!sources.length) { last = "NetMirror returned no video for this " + (p.ep && p.ep !== p.id ? "episode" : "title") + (pr ? " (HTTP " + pr.status + ")" : " (no answer from " + SITE.replace(/^https?:\/\//, "") + ")"); continue; }
            const file = String(sources[0].file || "");
            if (/in=unknown/i.test(file)) { last = "NetMirror did not accept the session"; SESSION = null; continue; }
            const mUrl = /^https?:/.test(file) ? file : SITE + file;
            const mr = await withTimeout(Promise.resolve(http_get(mUrl, { "User-Agent": UA, "Referer": SITE + "/", "Cookie": cookie })), 20000).catch(function () { return null; });
            const master = parseMaster(mr && mr.body);
            if (!master.video.length) {
                if (mr && Number(mr.status) === 200 && /#EXTM3U/.test(String(mr.body || ""))) return { err: "NetMirror has no video for this " + (p.ep && p.ep !== p.id ? "episode" : "title") + " yet (it is listed, but the video has not been added - often a 'coming soon' title)" };
                last = "NetMirror's playlist was empty" + (mr ? " (HTTP " + mr.status + ")" : ""); continue;
            }
            if (master.video[0].path.indexOf("/" + PROMO_ID + "/") >= 0) { last = "NetMirror sent its promo clip instead of the video (session refused)"; SESSION = null; continue; }
            return { item: item, master: master, file: file, cookie: cookie };
        }
        return { err: last };
    }

    // Servers seen so far (newest first). A title whose playlist names no server is
    // looked for on these. Seeded with servers NetMirror used in October 2026; every
    // server the plugin finds later is added and kept (app preference "net77_hosts").
    const SEED_HOSTS = ["makhi1.top/s22.freecdn41.top", "makhi4.top/s22.freecdn41.top", "s21.freecdn4.top",
        "s0022.freecdn4.top/s21.freecdn4.top", "makhi12.top/s15.freecdn4.top", "s23.nm-cdn9.top", "s35.freecdn34.top"];
    // NetMirror's relays (makhiN.top/<server>) forward to any of its servers; the server's
    // number (s15, s22...) is stable while its domain changes (s15.nm-cdn2.top is now s15.freecdn4.top)
    const RELAYS = ["makhi1.top", "makhi4.top"];
    // server number -> its live domains (checked 2026-10-28; old names like s26.nm-cdn5.top are gone)
    const SERVER_MAP = {
        s10: ["s10.freecdn43.top", "s10.nm-cdn7.top"], s11: ["s11.nm-cdn8.top"], s12: ["s12.freecdn38.top", "s12.freecdn39.top"],
        s13: ["s13.freecdn2.top"], s14: ["s14.freecdn2.top"], s15: ["s15.freecdn4.top", "s15.freecdn13.top"], s20: ["s20.freecdn1.top"],
        s21: ["s21.freecdn4.top"], s22: ["s22.freecdn41.top"], s23: ["s23.nm-cdn9.top"], s24: ["s24.freecdn3.top"], s25: ["s25.nm-cdn6.top"],
        s26: ["s26.freecdn49.top", "s26.freecdn51.top"], s30: ["s30.freecdn31.top", "s30.freecdn35.top"],
        s35: ["s35.freecdn34.top", "s35.freecdn31.top"], s36: ["s36.freecdn34.top"]
    };
    function bareOf(h) { return String(h || "").slice(String(h || "").lastIndexOf("/") + 1); }
    function serverNo(h) { const m = bareOf(h).match(/^(s\d+)\./i); return m ? m[1].toLowerCase() : ""; }
    function expandHosts(list, known) {
        const out = [];
        const add = function (h) { if (h && out.indexOf(h) < 0) out.push(h); };
        list.forEach(function (h) { hostVariants(h).forEach(add); });
        list.forEach(function (h) {
            hostVariants(h).forEach(function (v) { const b = bareOf(v); if (b) RELAYS.forEach(function (r) { add(r + "/" + b); }); });
            const no = serverNo(h);
            if (!no) return;
            (known || []).forEach(function (k) { if (serverNo(k) === no) { add(k); const b = bareOf(k); add(b); RELAYS.forEach(function (r) { add(r + "/" + b); }); } });
            (SERVER_MAP[no] || [no + ".freecdn4.top"]).forEach(function (b) { add(b); RELAYS.forEach(function (r) { add(r + "/" + b); }); });
        });
        return out;
    }
    let KNOWN_HOSTS = null;
    async function knownHosts() {
        if (KNOWN_HOSTS) return KNOWN_HOSTS;
        const list = SEED_HOSTS.slice();
        try {
            if (typeof getPreference === "function") {
                const v = await withTimeout(Promise.resolve(getPreference("net77_hosts")), 1500);
                const saved = parseJson(v);
                if (Array.isArray(saved)) saved.slice().reverse().forEach(function (h) {
                    if (typeof h === "string" && /^[a-z0-9.-]+(\/[a-z0-9.-]+)?$/i.test(h)) { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); list.unshift(h); }
                });
            }
        } catch (_) {}
        KNOWN_HOSTS = list;
        return list;
    }
    async function learnHosts(hosts) {
        const list = await knownHosts();
        let changed = false;
        hosts.slice().reverse().forEach(function (h) {
            if (!h || !/^[a-z0-9.-]+(\/[a-z0-9.-]+)?$/i.test(h)) return;
            const i = list.indexOf(h);
            if (i === 0) return;
            if (i > 0) list.splice(i, 1);
            list.unshift(h); changed = true;
        });
        if (list.length > 16) list.length = 16;
        if (changed) { try { if (typeof setPreference === "function") setPreference("net77_hosts", JSON.stringify(list)); } catch (_) {} }
    }

    async function liveHost(sm, o) {
        const v = sm.master.video[0];
        const probePath = v.path + v.query;
        const known0 = await knownHosts();
        let cands = expandHosts([v.host].concat(sm.master.audio.length ? [sm.master.audio[0].host] : []).filter(Boolean), known0);
        async function tryList(list) {
            const seen = {}, uniq = list.filter(function (h) { if (!h || seen[h]) return false; seen[h] = 1; return true; });
            if (!uniq.length) return null;
            const oks = await Promise.all(uniq.map(function (h) { return isPlaylist("https://" + h + probePath); }));
            for (let i = 0; i < uniq.length; i++) if (oks[i]) return uniq[i];
            return null;
        }
        let host = await tryList(cands);
        if (host) { learnHosts([host]); return host; }
        const tried = cands.slice();
        // ask the app's playlist (net52) which server holds this title: its audio lines name it
        try {
            const r = await withTimeout(Promise.resolve(http_get(APP + sm.file.split("?")[0] + "?in=unknown::su",
                { "User-Agent": UA, "Referer": PLAY_REFERER, "Cookie": sm.cookie })), 15000);
            const hint = parseMaster(r && r.body);
            const extra = [], seen = [];
            hint.audio.concat(hint.video).forEach(function (x) {
                if (x.host) seen.push(x.host);
                if (x.host && x.path.indexOf("/" + PROMO_ID + "/") < 0) expandHosts([x.host], known0).forEach(function (h) { extra.push(h); });
            });
            const fresh = extra.filter(function (h) { return tried.indexOf(h) < 0; });
            host = await tryList(fresh);
            fresh.forEach(function (h) { tried.push(h); });
            if (host) { learnHosts([host]); return host; }
            if (seen.length) learnHosts(seen);
        } catch (_) {}
        // the playlist named no usable server: look for the title on the servers seen before
        try {
            const pool = (await knownHosts()).slice(0, 12);
            Object.keys(SERVER_MAP).forEach(function (k) { SERVER_MAP[k].forEach(function (b) { pool.push(RELAYS[0] + "/" + b); }); });
            const known = pool.filter(function (h, i) { return tried.indexOf(h) < 0 && pool.indexOf(h) === i; });
            host = await tryList(known);
            if (host) learnHosts([host]);
        } catch (_) {}
        return host;
    }

    // links of one catalog entry. opts: { langs: max languages, quals: max qualities per extra language }
    async function streamsFor(p, o, epId, opts) {
        const tag = OTT[o].tag;
        const sm = await signedMaster(p, o, epId);
        if (sm.err) return { err: sm.err, code: "NO_STREAMS" };
        const host = await liveHost(sm, o);
        if (!host) {
            return { code: "HOSTS_BLOCKED", err: sm.master.video[0].host
                ? "found this video, but its NetMirror server (" + sm.master.video[0].host + ") did not answer. The server may be down, or blocked on your network - try again later"
                : "found this video, but NetMirror did not say which server holds it and it was not on any server seen so far. Try again in a few minutes, or play another title first" };
        }
        const v = sm.master.video[0];
        // which qualities this title has on that server
        const QS = ["1080p", "720p", "480p"];
        const have = await Promise.all(QS.map(function (q) {
            return qPath(v.path, q) === v.path ? Promise.resolve(true) : isPlaylist("https://" + host + qPath(v.path, q) + v.query);
        }));
        const quals = QS.filter(function (q, i) { return have[i]; });
        if (!quals.length) quals.push((v.path.match(/\/(\d{3,4}p)\.m3u8$/) || [0, "720p"])[1]);

        const subs = (((sm.item && sm.item.tracks) || []).filter(function (t) { return t && /caption|subtitle/i.test(t.kind || "") && t.file; }))
            .slice(0, 10).map(function (t) {
                const f = String(t.file).replace(/\\/g, "");
                return { url: /^\/\//.test(f) ? "https:" + f : (/^https?:/.test(f) ? f : "https://subs.nfmirrorcdn.top" + f), label: clean(t.label) || "English", lang: /english|^en/i.test(t.label || "") ? "en" : undefined };
            });
        const out = [];
        const vidUrl = function (q) { return "https://" + host + qPath(v.path, q) + v.query; };
        if (!sm.master.audio.length) {
            // audio is inside the video: the video playlist itself is the link
            quals.slice(0, opts.quals || 3).forEach(function (q) {
                const st = { url: vidUrl(q), source: tag + " [" + q + "]", quality: q, headers: { "User-Agent": UA, "Referer": PLAY_REFERER } };
                if (subs.length) st.subtitles = subs;
                out.push(mkStream(st));
            });
        } else {
            // separate audio tracks: one link per language, each a small master playlist with
            // that language as the only audio. "Origin" makes the app route the playlists
            // through its local proxy, which adds the Referer to every request.
            const byLang = {};
            sm.master.audio.forEach(function (a) { if (!byLang[a.lang]) byLang[a.lang] = a; });
            const langs = LANG_ORDER.filter(function (l) { return byLang[l]; });
            sm.master.audio.forEach(function (a) { if (a.def && langs.indexOf(a.lang) < 0) langs.push(a.lang); });
            if (!langs.length) langs.push(sm.master.audio[0].lang);
            langs.slice(0, opts.langs || 5).forEach(function (l, li) {
                const a = byLang[l];
                const name = LANG_NAME[l] || a.name || l;
                quals.filter(function (q, qi) { return li === 0 ? qi < (opts.quals || 3) : qi < Math.min(2, opts.quals || 3); }).forEach(function (q) {
                    const res = q === "1080p" ? "1920x1080" : q === "720p" ? "1280x720" : "854x480";
                    const bw = q === "1080p" ? 3000000 : q === "720p" ? 1500000 : 800000;
                    const m3u8 = "#EXTM3U\n#EXT-X-VERSION:3\n" +
                        "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",LANGUAGE=\"" + l + "\",NAME=\"" + name + "\",DEFAULT=YES,AUTOSELECT=YES,URI=\"https://" + host + a.path + a.query + "\"\n" +
                        "#EXT-X-STREAM-INF:BANDWIDTH=" + bw + ",RESOLUTION=" + res + ",AUDIO=\"aud\"\n" + vidUrl(q) + "\n";
                    const st = { url: "magic_m3u8:" + b64(m3u8), source: tag + " · " + name + " [" + q + "]", quality: q,
                        headers: { "User-Agent": UA, "Referer": PLAY_REFERER, "Origin": APP } };
                    if (subs.length) st.subtitles = subs;
                    out.push(mkStream(st));
                });
            });
        }
        return out.length ? { data: out } : { err: "no playable quality for this video", code: "NO_STREAMS" };
    }

    // ── the same movie / episode in the other catalogs ──
    function normT(t) {
        return clean(t).toLowerCase().replace(/&/g, " and ").replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
            .replace(/[^a-z0-9]+/g, " ").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
    }
    async function episodeIn(o, seriesId, d, S, E) {
        const has = function (list) {
            const hit = (list || []).filter(function (ep) {
                return ep && ep.id && (num(String(ep.s || "").replace(/\D/g, "")) || 1) === S && num(String(ep.ep || "").replace(/\D/g, "")) === E;
            })[0];
            return hit ? String(hit.id) : null;
        };
        let id = has(d.episodes);
        if (id) return id;
        const season = (d.season || []).filter(function (x) { return x && x.id && num(x.s) === S; })[0];
        if (!season) return null;
        for (let pg = 1; pg <= 6; pg++) {
            const j = await appJson(OTT[o].episodes + "?s=" + encodeURIComponent(season.id) + "&series=" + encodeURIComponent(seriesId) + "&t=" + unix() + "&page=" + pg, o, 12000);
            id = has(j && j.episodes);
            if (id) return id;
            if (!j || Number(j.nextPageShow || 0) !== 1) break;
        }
        return null;
    }
    async function findOn(o, want) {
        const key = normT(want.t);
        if (!key) return null;
        const hits = (await searchOtt(o, want.t)).filter(function (h) { return normT(h.title) === key; }).slice(0, 3);
        for (const h of hits) {
            const hp = parseUrl(h.url);
            const d = await appJson(OTT[o].post + "?id=" + encodeURIComponent(hp.id) + "&t=" + unix(), o, 12000).catch(function () { return null; });
            if (!d || d.status !== "y") continue;
            const y = num(d.year), isS = (d.episodes || []).filter(Boolean).length > 0;
            if (isS !== (want.k === "s")) continue;
            if (want.y && y && Math.abs(want.y - y) > 1) continue;
            if (!isS) return { o: o, id: hp.id, ep: hp.id, t: clean(d.title) };
            const ep = await episodeIn(o, hp.id, d, want.s, want.e);
            if (ep) return { o: o, id: hp.id, ep: ep, t: clean(d.title) };
        }
        return null;
    }

    async function loadStreams(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "PARSE_ERROR", message: "Unknown Net77 link - open the title again." });
            const o = p.o, epId = String(p.ep || p.id);
            const ckey = o + ":" + epId;
            const hit = STREAM_CACHE[ckey];
            if (hit && Date.now() - hit.t < 20 * 60000) return cb({ success: true, data: hit.data });

            const kind = p.k === "s" || (p.k !== "m" && p.ep && p.ep !== p.id) ? "s" : "m";
            const want = { t: p.t, y: num(p.y) || 0, k: kind, s: num(p.s) || 1, e: num(p.e) || 1 };
            const t0 = Date.now();
            // this catalog's links, and in parallel the same title on the other two catalogs
            const main = streamsFor(p, o, epId, { langs: 5 }).catch(function (e) { return { err: String((e && e.message) || e), code: "STREAM_ERROR" }; });
            const others = OTT_ORDER.filter(function (x) { return x !== o; }).map(function (o2) {
                if (!want.t) return Promise.resolve(null);
                const lane = findOn(o2, want).then(function (m) { return m ? streamsFor(m, o2, m.ep, { langs: 3, quals: 2 }) : null; })
                    .catch(function () { return null; });
                return withTimeout(lane, 24000).catch(function () { return null; });
            });
            const first = await main;
            // don't let the extra catalogs hold the main links back for long
            const rest = await withTimeout(Promise.all(others), Math.max(3000, 26000 - (Date.now() - t0))).catch(function () { return []; });
            let out = (first && first.data) || [];
            const extra = {};
            OTT_ORDER.filter(function (x) { return x !== o; }).forEach(function (o2, i) { extra[o2] = rest[i]; });
            OTT_ORDER.forEach(function (o2) { if (o2 !== o && extra[o2] && extra[o2].data) out = out.concat(extra[o2].data); });
            if (!out.length) {
                return cb({ success: false, errorCode: (first && first.code) || "NO_STREAMS", message: "Net77 (" + OTT[o].tag + "): " + ((first && first.err) || "no links") + "." });
            }
            STREAM_CACHE[ckey] = { t: Date.now(), data: out };
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String((e && e.message) || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
    __ngWrapExports();
})(typeof http_get !== 'undefined' ? http_get : undefined, typeof http_post !== 'undefined' ? http_post : undefined);
