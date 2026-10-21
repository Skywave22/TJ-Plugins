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
    var __NG = { get: __ngRawGet, post: __ngRawPost, groups: [[], ['https://api.themoviedb.org', 'https://api.tmdb.org']],
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
        if (res.errorCode === 'NEEDS_UPDATE' || res.errorCode === 'CHECK_FAILED') return res;
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
    //  CineFreak (cinefreak.ch) — SkyStream plugin (v10, 2026-10-20)
    //
    //  CATALOG  search.yagaverse.net/api/search (the site's own index; q=* = newest).
    //  DETAIL   SITE/<slug>/ — episodes and qualities come from the download section:
    //             series: <div class="cft-it" data-k="es01e05"> (packs: data-k="ps01e01-12")
    //             movies: <h4 class="movie-title">… 720p [1.1 GB]</h4> + its buttons
    //           every button links a CineCloud file page (new5.cinecloud.site/f/<code>).
    //           A hidden <div aria-hidden="true"> block holds decoy links: removed first.
    //           `const dataset` only has episode names now, plus the player code ("m" / "e0_3").
    //  STREAMS  Since 2026-10-11/12 both video paths need a Cloudflare Turnstile token:
    //             1. CineCloud: GET /f/<code>/n -> {n}; POST /f/<code>/unlock ts=&bc=n -> {ok, html}
    //                (the server buttons: Fast Cloud, Instant, Resumable, Stream Online)
    //             2. CineFreak player: POST wp-json/cf/v1/pl/<key> op=play&ep=<code>[&ts=]
    //                -> 401 {need:"ts"} | {state:"ready", url:<player>} | {state:"uploading"}
    //           Tokens come from SkyStream's solveCaptcha (app v2.9.0+), asked on a page of the
    //           same host without its own widget, so nothing else spends the single-use token.
    //
    //  APP CONTRACT: every exported function calls cb exactly once with
    //      { success: true, data } or { success: false, errorCode, message }.
    // ═══════════════════════════════════════════════════════════

    // Dynamic base URL: the app injects the domain the user picked in the
    // plugin's settings gear (mirrors), so never hardcode the primary host.
    // CineFreak moves between domains (cinefreak.net -> cinefreak.ch -> ...). The current one is
    // read from a public community domain list and cached for 12 h; a domain the user typed in
    // the plugin settings always wins over it.
    const DEFAULT_SITES = ["https://cinefreak.ch", "https://cinefreak.net"];
    let SITE = (typeof manifest !== "undefined" && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, "")
        : DEFAULT_SITES[0];
    const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
    const DOMAIN_TTL  = 12 * 3600 * 1000;
    // Catalog + search index used by the site itself. It lives on a separate host from the
    // site domain, so home and search keep working where the site domain is blocked.
    const INDEX_API   = "https://search.yagaverse.net/api/search";
    
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // Plain headers only: spoofed X-Forwarded-For / CF-Connecting-IP / True-Client-IP
    // don't change the caller's location, and Cloudflare answers them with HTTP 403.
    function mergeGeoHeaders(base) { return Object.assign({}, base || {}); }


    const HTML_HEADERS = mergeGeoHeaders({
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": SITE + "/"
    }, false);
    const JSON_HEADERS = mergeGeoHeaders({
        "User-Agent": UA,
        "Accept": "application/json",
        "Referer": SITE + "/"
    }, false);
    const STREAM_HEADERS = mergeGeoHeaders({ "User-Agent": UA }, false);

    let __siteReady = null;
    function useSite(origin) {
        const m = String(origin || "").match(/^https?:\/\/[^\/?#]+/i);
        if (!m) return;
        const o = m[0].replace(/^http:/i, "https:").toLowerCase();
        SITE = o;
        try {
            const g = __NG.groups[0];
            if (!g.some(function (x) { return __ngBare(__ngHost(x)) === __ngBare(__ngHost(o)); })) g.unshift(o);
        } catch (_) {}
    }
    /** Resolve the live site domain once per session (never blocks for more than ~6 s). */
    function ensureSite() {
        if (__siteReady) return __siteReady;
        __siteReady = withTimeout((async function () {
            if (DEFAULT_SITES.indexOf(SITE) < 0) return;           // user-chosen domain wins
            let cached = null;
            try {
                if (typeof getPreference === "function") cached = JSON.parse((await withTimeout(getPreference("tj_cf_domain"), 1500)) || "null");
            } catch (_) { cached = null; }
            if (cached && cached.u && Date.now() - Number(cached.t || 0) < DOMAIN_TTL) return useSite(cached.u);
            const r = await withTimeout(http_get(DOMAINS_URL, { "User-Agent": UA, "Accept": "application/json" }), 6000);
            let j = {};
            try { j = JSON.parse((r && r.body) || "{}"); } catch (_) { j = {}; }
            const u = j.cinefreak || j.CineFreak || j.Cinefreak;
            if (u && /^https?:\/\/[a-z0-9.-]*cinefreak[a-z0-9.-]*\.[a-z]{2,}/i.test(u)) {
                useSite(u);
                try { if (typeof setPreference === "function") setPreference("tj_cf_domain", JSON.stringify({ u: SITE, t: Date.now() })); } catch (_) {}
            } else if (cached && cached.u) {
                useSite(cached.u);
            }
        })(), 6500).catch(function () {});
        return __siteReady;
    }

    // ─────────────────────────── helpers ───────────────────────────

    function mkItem(obj)    { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj)  { try { return new StreamResult(obj); } catch (_) { return obj; } }

    function withTimeout(promise, ms) {
        return Promise.race([
            Promise.resolve(promise),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })
        ]);
    }

    async function fetchHtml(url) {
        const r = await withTimeout(http_get(url, Object.assign({}, HTML_HEADERS, { "Referer": SITE + "/" })), 25000);
        return (r && r.body) || "";
    }

    async function fetchJson(url, headers) {
        const r = await withTimeout(http_get(url, headers || JSON_HEADERS), 25000);
        try { return JSON.parse((r && r.body) || "{}"); } catch (e) { return {}; }
    }

    function decodeEntities(s) {
        return String(s || "")
            .replace(/&#0?38;|&amp;/g, "&")
            .replace(/&#0?8211;|&ndash;/g, "–")
            .replace(/&quot;/g, "\"")
            .replace(/&#0?39;|&apos;/g, "'")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    }

    // "Moana (2026) English WEB-DL 480p, 720p & 1080p | HEVC | Full Movie
    //  Download & Watch Online – GDrive | ESub | CineFreak details"
    //   -> "Moana (2026) English"
    function cleanTitle(t) {
        let s = decodeEntities(t).replace(/\s+details\s*$/i, "");
        s = s.replace(/\s*[–|-]\s*(GDrive|ESub|CineFreak|HD).*$/i, "");
        s = s.replace(/\s*\|\s*(HEVC|ESub|GDrive|CineFreak).*$/i, "");
        s = s.replace(/\b(WEB-?DL|BluRay|HDRip|HDTV|WEBRip|DVDRip)\b.*$/i, "");
        s = s.replace(/\s*(?:Download|Watch\s+Online)\b.*$/i, "");
        s = s.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
        s = s.replace(/\s*&\s*$/, "").replace(/\s*,\s*$/, "").trim();
        // "Name (2017) Dual Audio [Hindi & English] Netflix Web series Season 1" -> "Name (2017) Season 1"
        const ym = s.match(/^(.+?\((?:19|20)\d{2}\))(.*)$/);
        if (ym) { const sm = ym[2].match(/\bSeason\s*\d+/i); s = ym[1] + (sm ? " " + sm[0] : ""); }
        return s || decodeEntities(t);
    }

    // ─────────────────────── poster fix ────────────────────────────
    // External image hosts (image.tmdb.org, cineimg.xyz, …) are blocked on
    // some ISPs — route every external poster through the weserv.nl image
    // proxy (reachable everywhere). Same-site URLs pass through unchanged.
    function fixPoster(u) {
        const s = decodeEntities(u || "");
        if (!s || s.indexOf("http") !== 0) return s;
        if (/^https?:\/\/(?:www\.)?cinefreak\.[a-z]+\//i.test(s)) return s;
        if (s.indexOf("images.weserv.nl/") !== -1) return s;
        return "https://images.weserv.nl/?url=" + encodeURIComponent(s.replace(/^https?:\/\//, ""));
    }

    // ─────────────────────── language labels ───────────────────────
    // Stream files are named like "CINEFREAK.TOP - Title [Hindi] 720p
    // ESub.mkv". Dual-audio files (e.g. "[Hindi-Malayalam]") contain BOTH
    // audio tracks in ONE file — labelled as Dual Audio so users switch
    // language via the PLAYER's audio-track menu, not by picking a stream.
    function langOf(url) {
        let s = "";
        try { s = decodeURIComponent(String(url || "")); } catch (e) { s = String(url || ""); }
        const known = ["Hindi", "English", "Bengali", "Bangla", "Tamil", "Telugu", "Kannada",
                       "Malayalam", "Punjabi", "Marathi", "Urdu", "Turkish", "Chinese", "Mandarin",
                       "Cantonese", "Japanese", "Korean", "Spanish", "Indonesian", "Arabic", "French"];
        const found = [];
        const addLang = function (tag) {
            for (let i = 0; i < known.length; i++) {
                if (tag.toLowerCase() === known[i].toLowerCase()) {
                    if (found.indexOf(known[i]) < 0) found.push(known[i]);
                    return;
                }
            }
        };
        // bracket tags, including hyphen/slash/comma separated lists:
        // [Hindi], [Hindi-Malayalam], [Hindi/Tamil], [Hindi, Telugu] ...
        const bracketRe = /\[([A-Za-z][A-Za-z \-+/,&]{1,30})\]/g;
        let m;
        while ((m = bracketRe.exec(s)) !== null) {
            m[1].split(/[\-+/,& ]+/).forEach(function (tok) {
                if (tok.length >= 3) addLang(tok);
            });
        }
        if (!found.length) {
            for (let i = 0; i < known.length; i++) {
                if (found.indexOf(known[i]) < 0 && new RegExp("\\b" + known[i] + "\\b", "i").test(s)) found.push(known[i]);
            }
        }
        const dual = found.length >= 2 || /\bdual[ ._-]*audio\b|multi[ ._-]*audio/i.test(s);
        if (dual) {
            // Hindi first when present (Hindi-first site)
            found.sort(function (a, b) { return (b === "Hindi" ? 1 : 0) - (a === "Hindi" ? 1 : 0); });
            return found.slice(0, 2).join(" + ") + " (Dual Audio)";
        }
        return found[0] || null;
    }

    // ───────────────────── home (category rows) ────────────────────

    const HOME_CATS = [
        { row: "Hindi Movies",   path: "/hindi-movies/",        type: "movie" },
        { row: "English Movies", path: "/english-movies/",      type: "movie" },
        { row: "Hindi Dubbed",   path: "/hindi-dubbed-movies/", type: "movie" },
        { row: "Web Series",     path: "/web-series/",          type: "tv"    },
        { row: "K-Drama",        path: "/k-drama/",             type: "tv"    },
        { row: "Dual Audio",     path: "/dual-audio/",          type: "movie" }
    ];

    function parseCards(html, forcedType) {
        const out = [], seen = {};
        // any host: after a mirror failover the cards link to whichever domain answered
        const anchorRe = /<a[^>]+href="https?:\/\/[^\/"]+\/([a-z0-9][a-z0-9-]*)\/"[^>]*class="movie-card"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        while ((m = anchorRe.exec(html)) !== null) {
            const slug = m[1];
            if (seen[slug]) continue;
            const block = m[2];
            const img = block.match(/<img[^>]*\ssrc="([^"]+)"/);
            if (!img) continue;
            seen[slug] = 1;
            const labM = m[0].match(/aria-label="([^"]*)"/);
            const h3 = block.match(/<h3 class="movie-card-title">([\s\S]*?)<\/h3>/);
            const rawTitle = (labM && labM[1]) || (h3 && h3[1]) || slug;
            out.push(mkItem({
                title: cleanTitle(rawTitle),
                url: JSON.stringify({ slug: slug }),
                posterUrl: fixPoster(img[1]),
                bannerUrl: fixPoster(img[1]),
                type: forcedType || "movie"
            }));
        }
        return out;
    }

    // ─────────────── catalog index (search.yagaverse.net) ───────────────
    // Typesense-style JSON: { found, hits: [{ document: { title, slug, thumb, cats[], quality } }] },
    // 30 hits per page, q=* returns the newest uploads first.
    const TV_RE = /web[- ]?series|tv show|k-?drama|c-?drama|season|episode|\bS\d{1,2}\b|series/i;
    function docToItem(d) {
        if (!d || !d.slug) return null;
        const cats = (d.cats || []).join(" ");
        const isTv = TV_RE.test(cats) || /season\s*\d|web series|all episodes|\bS\d{1,2}\b/i.test(d.title || "");
        const poster = d.thumb ? fixPoster(d.thumb) : "";
        return mkItem({
            title: cleanTitle(d.title || d.slug),
            url: JSON.stringify({ slug: String(d.slug).replace(/^\/+|\/+$/g, "") }),
            posterUrl: poster,
            bannerUrl: poster,
            type: isTv ? "tv" : "movie"
        });
    }
    // Search (2026-10-12): the site answers SITE/search-api.php?q=&pg= itself ({results:[{t,l,i,c,q,d}]},
    // q=* = newest first). Since 2026-10-14 it wants a key in X-CF-ST, from a POST st=1 (kept 5 h).
    // The old public index (search.yagaverse.net) is empty now and stays only as a fallback.
    let __stKey = null;
    async function searchKey(fresh) {
        if (__stKey !== null && !fresh) return __stKey;
        try {
            const r = await withTimeout(http_post(SITE + "/search-api.php", {
                "User-Agent": UA, "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded",
                "Origin": SITE, "Referer": SITE + "/fast-search/"
            }, "st=1"), 10000);
            __stKey = String((JSON.parse((r && r.body) || "{}") || {}).k || "");
        } catch (_) { __stKey = ""; }
        return __stKey;
    }
    async function siteSearchPage(q, pg, retried) {
        await ensureSite();
        const k = await searchKey(!!retried);
        const url = SITE + "/search-api.php?q=" + encodeURIComponent(String(q).normalize ? String(q).normalize("NFC") : q) + "&pg=" + pg;
        const r = await withTimeout(http_get(url, { "User-Agent": UA, "Accept": "application/json", "Referer": SITE + "/fast-search/", "X-CF-ST": k }), 15000);
        let j = null;
        try { j = JSON.parse((r && r.body) || "null"); } catch (_) { j = null; }
        if (j && j.renew && !retried) return siteSearchPage(q, pg, true);
        if (!j || !Array.isArray(j.results)) throw new Error("site search unavailable (HTTP " + ((r && r.status) || 0) + ")");
        return j.results.filter(function (x) { return x && x.l; }).map(function (x) {
            let slug = String(x.l);
            try { slug = decodeURIComponent(slug); } catch (_) {}
            return { slug: slug, title: x.t, thumb: x.i, cats: String(x.c || "").split(",").map(function (c) { return c.trim(); }).filter(Boolean) };
        });
    }
    async function yagaPage(q, pg) {
        const url = INDEX_API + "?q=" + encodeURIComponent(q) + "&pg=" + pg;
        const r = await withTimeout(http_get(url, { "User-Agent": UA, "Accept": "application/json", "Origin": SITE, "Referer": SITE + "/" }), 15000);
        let j = null;
        try { j = JSON.parse((r && r.body) || "null"); } catch (_) { j = null; }
        if (!j || !Array.isArray(j.hits)) throw new Error("index unavailable (HTTP " + ((r && r.status) || 0) + ")");
        return j.hits.map(function (h) { return h && h.document; }).filter(Boolean);
    }
    /** One page of results: the site's search first, the old public index when that fails or is empty. */
    async function indexPage(q, pg) {
        let list = null, err = null;
        try { list = await siteSearchPage(q, pg); } catch (e) { err = e; }
        if (list && list.length) return list;
        try { const y = await yagaPage(q, pg); if (y.length) return y; } catch (e) { err = err || e; }
        if (list) return list;
        throw err || new Error("search unavailable");
    }

    const INDEX_ROWS = [
        { row: "Hindi Movies",   re: /^Hindi Movies$/i },
        { row: "English Movies", re: /^English Movies$/i },
        { row: "Hindi Dubbed",   re: /^Hindi Dubbed/i },
        { row: "Dual Audio",     re: /^Dual Audio$/i },
        { row: "Web Series",     re: /^(WEB-?Series|TV Show)$/i },
        { row: "K-Drama",        re: /^(K-?Drama|Korean|C-?Drama|Chinese)$/i },
        { row: "South Indian",   re: /^(Tamil|Telugu|Malayalam|Kannada)$/i },
        { row: "Bangla",         re: /^Bangla/i },
        { row: "Anime & Animation", re: /^(Anime|Animation)$/i }
    ];

    async function homeFromIndex() {
        const pages = await Promise.all([1, 2, 3, 4, 5, 6].map(function (pg) {
            return indexPage("*", pg).catch(function () { return []; });
        }));
        const docs = [], seen = {};
        pages.forEach(function (list) { list.forEach(function (d) { if (d && d.slug && !seen[d.slug]) { seen[d.slug] = 1; docs.push(d); } }); });
        if (!docs.length) return null;
        const rows = {};
        const latest = docs.filter(function (d) { return d.thumb; }).slice(0, 24).map(docToItem).filter(Boolean);
        if (latest.length) rows["Latest Uploads"] = latest;
        INDEX_ROWS.forEach(function (r) {
            const items = docs.filter(function (d) {
                return d.thumb && (d.cats || []).some(function (c) { return r.re.test(String(c).trim()); });
            }).slice(0, 24).map(docToItem).filter(Boolean);
            if (items.length >= 4) rows[r.row] = items;
        });
        return Object.keys(rows).length ? rows : null;
    }

    async function homeFromSite() {
        await ensureSite();
        const rows = {};
        await Promise.all(HOME_CATS.map(async function (c) {
            try {
                const html = await withTimeout(fetchHtml(SITE + c.path), 25000);
                const items = parseCards(html, c.type);
                if (items.length) rows[c.row] = items;
            } catch (e) { /* row skipped */ }
        }));
        return Object.keys(rows).length ? rows : null;
    }

    async function getHome(cb) {
        try {
            ensureSite();   // warm up the domain lookup for the detail page; home doesn't need it
            let rows = null;
            try { rows = await homeFromIndex(); } catch (_) { rows = null; }
            if (!rows) rows = await homeFromSite();
            if (!rows) {
                return cb({ success: false, errorCode: "HOME_ERROR", message: "CineFreak catalog unavailable right now." });
            }
            cb({ success: true, data: rows });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── search ────────────────────────────

    async function searchSite(q) {
        await ensureSite();
        const url = SITE + "/search-api.php?q=" + encodeURIComponent(q) + "&pg=1";
        const j = await withTimeout(fetchJson(url, Object.assign({}, JSON_HEADERS, { "Referer": SITE + "/" })), 25000);
        const results = (j && j.results) || [];
        const out = [];
        for (let i = 0; i < results.length && out.length < 30; i++) {
            const r = results[i] || {};
            if (!r.l) continue;
            const isTv = /series|drama|show|anime|tv\b/i.test(String(r.c || ""));
            out.push(mkItem({
                title: cleanTitle(r.t),
                url: JSON.stringify({ slug: String(r.l) }),
                posterUrl: fixPoster(r.i),
                bannerUrl: fixPoster(r.i),
                type: isTv ? "tv" : "movie"
            }));
        }
        return out;
    }

    async function search(query, cb) {
        try {
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });
            let out = [];
            try {
                const pages = await Promise.all([1, 2].map(function (pg) {
                    return indexPage(q, pg).catch(function (e) { if (pg === 1) throw e; return []; });
                }));
                const seen = {};
                pages.forEach(function (list) { list.forEach(function (d) {
                    if (!d || !d.slug || seen[d.slug]) return;
                    seen[d.slug] = 1;
                    const it = docToItem(d);
                    if (it) out.push(it);
                }); });
            } catch (_) {
                out = await searchSite(q);
            }
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── detail ────────────────────────────

    /** Cut the balanced {...} literal that starts at html[i] (string-aware). */
    function sliceObject(html, i) {
        let depth = 0, inStr = false, esc = false;
        for (let k = i; k < html.length; k++) {
            const ch = html[k];
            if (inStr) {
                if (esc) esc = false;
                else if (ch === "\\") esc = true;
                else if (ch === "\"") inStr = false;
                continue;
            }
            if (ch === "\"") inStr = true;
            else if (ch === "{") depth++;
            else if (ch === "}") { depth--; if (depth === 0) return html.slice(i, k + 1); }
        }
        return null;
    }

    // The player script declares `const dataset = {...};`. Since 2026-10-11 it only holds episode
    // names (no file codes); it is used here just to tell movies from series.
    function extractDataset(html) {
        const m = /(?:const|let|var)\s+dataset\s*=\s*\{/.exec(html);
        if (!m) return null;
        let raw = sliceObject(html, m.index + m[0].length - 1);
        if (!raw) return null;
        raw = raw.replace(/:\s*!0\b/g, ":true").replace(/:\s*!1\b/g, ":false");
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    /** Remove every balanced <div ... aria-hidden="true"> block (the page's hidden decoy links). */
    function stripHiddenBlocks(html) {
        let out = String(html || "");
        for (let guard = 0; guard < 50; guard++) {
            const m = /<div\b[^>]*\baria-hidden="true"[^>]*>/i.exec(out);
            if (!m) break;
            const re = /<(\/?)div\b[^>]*>/gi;
            re.lastIndex = m.index;
            let depth = 0, end = -1, t;
            while ((t = re.exec(out)) !== null) {
                depth += t[1] ? -1 : 1;
                if (depth === 0) { end = re.lastIndex; break; }
            }
            out = out.slice(0, m.index) + (end < 0 ? "" : out.slice(end));
            if (end < 0) break;
        }
        return out;
    }

    /** The balanced <div>...</div> that starts at html[i]. */
    function divBlock(html, i) {
        const re = /<(\/?)div\b[^>]*>/gi;
        re.lastIndex = i;
        let depth = 0, t;
        while ((t = re.exec(html)) !== null) {
            depth += t[1] ? -1 : 1;
            if (depth === 0) return html.slice(i, re.lastIndex);
        }
        return "";
    }

    function stripTags(s) { return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }

    const CLOUD_RE = /https?:\/\/[a-z0-9.-]*(?:cinecloud|neodrive)[a-z0-9.-]*\/(?:f|x|d|w|gp)\/[A-Za-z0-9_-]+/i;

    /** Cloud links inside a piece of HTML: [[label, url], ...] (watch link first). */
    function cloudLinks(html, heading) {
        const out = [];
        const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const attrs = m[1];
            if (/tabindex="-1"/i.test(attrs)) continue;                 // decoy
            const hM = attrs.match(/href="([^"]+)"/i);
            if (!hM || !CLOUD_RE.test(hM[1])) continue;
            const href = decodeEntities(hM[1]);
            const watch = /cfs-watch|dlbtn-watch/i.test(attrs) || /\bwatch\b/i.test(stripTags(m[2]));
            const bM = m[2].match(/<b\b[^>]*>([\s\S]*?)<\/b>/i);
            const ariaM = attrs.match(/aria-label="([^"]*)"/i);
            let q = stripTags(bM ? bM[1] : "") || (ariaM ? ariaM[1].replace(/^(Download|Watch)\s*/i, "") : "");
            if (!/\d{3,4}p/i.test(q)) { const hq = String(heading || "").match(/\b(\d{3,4}p)\b/i); q = hq ? hq[1] : q; }
            const label = watch ? ("Watch" + (q && /\d{3,4}p/i.test(q) ? " " + q : "")) : (q || "Download");
            if (!out.some(function (x) { return x[1] === href; })) out.push([label, href]);
        }
        out.sort(function (a, b) { return (/^Watch/.test(b[0]) ? 1 : 0) - (/^Watch/.test(a[0]) ? 1 : 0); });
        return out;
    }

    /** Series rows: <div class="cft-it" data-k="es01e05"> / packs data-k="ps01e01-12". */
    function parseSeriesRows(html) {
        const rows = [];
        const re = /<div class="cft-it\b[^"]*"\s+data-k="([ep])s(\d+)e(\d+)(?:-(\d+))?"[^>]*>/gi;
        const marks = [];
        let m;
        while ((m = re.exec(html)) !== null) marks.push({ i: m.index, end: re.lastIndex, k: m[1], s: +m[2], e: +m[3], e2: m[4] ? +m[4] : 0 });
        for (let j = 0; j < marks.length; j++) {
            const mk = marks[j];
            const seg = divBlock(html, mk.i) || html.slice(mk.end, j + 1 < marks.length ? marks[j + 1].i : mk.end + 3000);
            const links = cloudLinks(seg, "");
            if (!links.length) continue;
            const nameM = seg.match(/class="cft-info"[^>]*>\s*<b>([\s\S]*?)<\/b>/i);
            const metas = [];
            const metaRe = /<span(?![^>]*cft-seen)[^>]*>([^<]{2,60})<\/span>/gi;
            const mi = seg.indexOf('class="cft-meta"');
            const metaBlock = (mi < 0 ? "" : seg.slice(mi, seg.indexOf("</div>", mi) > 0 ? seg.indexOf("</div>", mi) : mi + 3000))
                .replace(/<svg\b[\s\S]*?<\/svg>/gi, "");
            let mm;
            while ((mm = metaRe.exec(metaBlock)) !== null) metas.push(stripTags(mm[1]));
            rows.push({ pack: mk.k === "p", s: mk.s || 1, e: mk.e, e2: mk.e2,
                        name: stripTags(nameM ? nameM[1] : "") || ("Episode " + mk.e), meta: metas.join(" · "), links: links });
        }
        return rows;
    }

    /** Movie blocks: <h4 class="movie-title">… 720p [1.1 GB]</h4> followed by its buttons. */
    function parseMovieLinks(html) {
        const out = [];
        const re = /<h4 class="movie-title">([\s\S]*?)<\/h4>/gi;
        const heads = [];
        let m;
        while ((m = re.exec(html)) !== null) heads.push({ i: m.index, end: re.lastIndex, t: stripTags(m[1]) });
        for (let j = 0; j < heads.length; j++) {
            const seg = html.slice(heads[j].end, j + 1 < heads.length ? heads[j + 1].i : heads[j].end + 4000);
            const t = heads[j].t;
            const q = (t.match(/\b(\d{3,4}p)\b/i) || [])[1] || "";
            const size = (t.match(/\[([\d.]+\s*[GM]B)\]/i) || [])[1] || "";
            const hevc = /hevc|x265/i.test(t) ? " HEVC" : "";
            cloudLinks(seg, t).forEach(function (l) {
                const label = /^Watch/.test(l[0]) ? "Watch " + q : (q + hevc + (size ? " [" + size + "]" : ""));
                if (!out.some(function (x) { return x[1] === l[1]; })) out.push([label.trim(), l[1]]);
            });
        }
        return out;
    }

    /** CineFreak's player code ("e<season idx>_<episode idx>") for season S, episode E. */
    function playCode(data, S, E) {
        if (!data || !Array.isArray(data.seasons)) return "";
        for (let si = 0; si < data.seasons.length; si++) {
            const sn = parseInt((String(data.seasons[si].season_name || "").match(/\d+/) || [String(si + 1)])[0], 10);
            if (sn !== S && !(data.seasons.length === 1)) continue;
            const eps = data.seasons[si].episodes || [];
            for (let ei = 0; ei < eps.length; ei++) {
                const nums = String(eps[ei].ep_num || "").match(/\d+/g) || [];
                const a = parseInt(nums[0] || "0", 10), b = parseInt(nums[nums.length - 1] || "0", 10);
                if (E >= a && E <= b && typeof eps[ei].sources === "string") return eps[ei].sources;
            }
        }
        return "";
    }

    async function load(url, cb) {
        try {
            let p = null;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.slug) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized item url" });
            const slug = String(p.slug);
            await ensureSite();
            const rawHtml = await fetchHtml(SITE + "/" + slug + "/");
            const html = stripHiddenBlocks(rawHtml);

            const tM = html.match(/<meta property="og:title" content="([^"]*)"/);
            const title = tM ? cleanTitle(tM[1]) : cleanTitle(slug.replace(/-/g, " "));
            // og:image on this site is a rank-math SEO overlay URL that returns 404 HTML.
            // The real poster is the first TMDB/cineimg image embedded in the page body.
            let poster = "";
            const imgM0 = html.match(/https:\/\/(?:image\.tmdb\.org|cineimg\.xyz)\/[^"'\s)]+\.(?:jpg|jpeg|png|webp)/);
            if (imgM0) {
                poster = fixPoster(imgM0[0]);
            } else {
                const imgM = html.match(/<meta property="og:image" content="([^"]*)"/);
                if (imgM && imgM[1].indexOf("admin-ajax") < 0) poster = fixPoster(imgM[1]);
            }

            const dM = html.match(/<meta (?:property="og:description"|name="description") content="([^"]*)"/);
            const description = dM ? decodeEntities(dM[1]).replace(/\s+/g, " ").trim() : "";
            const yM = (tM ? tM[1] : slug).match(/\b(19[3-9]\d|20[0-4]\d)\b/);
            const year = yM ? parseInt(yM[1], 10) : undefined;

            const data = extractDataset(html);
            const rows = parseSeriesRows(html);
            const isSeries = rows.length > 0 || !!(data && data.type === "series");
            const episodes = [];

            if (rows.length) {
                // single episodes win over a pack covering the same numbers
                const singles = rows.filter(function (r) { return !r.pack; });
                const keep = rows.filter(function (r) {
                    if (!r.pack) return true;
                    return !singles.some(function (x) { return x.s === r.s && x.e >= r.e && x.e <= (r.e2 || r.e); });
                });
                keep.sort(function (a, b) { return (a.s - b.s) || (a.e - b.e) || ((a.pack ? 1 : 0) - (b.pack ? 1 : 0)); });
                keep.forEach(function (r) {
                    episodes.push(mkEpisode({
                        name: r.name + (r.meta ? " · " + r.meta : ""),
                        url: JSON.stringify({ slug: slug, s: r.s, e: r.e, P: playCode(data, r.s, r.e) || undefined, L: r.links }),
                        season: r.s,
                        episode: r.e
                    }));
                });
            }
            if (!episodes.length) {
                let links = parseMovieLinks(html);
                if (!links.length) links = cloudLinks(html, "");
                episodes.push(mkEpisode({
                    name: title,
                    url: JSON.stringify({ slug: slug, s: -1, e: -1, P: (data && typeof data.sources === "string") ? data.sources : "m", L: links }),
                    season: 1,
                    episode: 1
                }));
            }

            cb({
                success: true,
                data: mkItem({
                    title: title,
                    url: url,
                    posterUrl: poster,
                    bannerUrl: poster,
                    type: isSeries ? "tv" : "movie",
                    description: description,
                    year: year,
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "DETAIL_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── Turnstile bypass ───────────────────────────
    //
    // Since 2026-10-11/12 CineFreak's player (wp-json/cf/v1/pl/<key>) and its file host CineCloud
    // (/f/<code>/unlock) only answer after a Cloudflare Turnstile check. SkyStream 2.9+ solves
    // Turnstile itself (solveCaptcha: a hidden browser page; if the check wants a click it ticks it,
    // and when a person is waiting the check is shown to them). The token is single-use, so it is
    // asked for on a page of the same host that has no widget of its own (a page's own widget
    // would spend the token first).

    // Inside All-in-one: other sites have sources too, so never put a check sheet in front of the
    // person there, try one file only, and stay inside its 30 s per-site budget.
    const IN_AIO = typeof manifest !== "undefined" && !!manifest && manifest.aio === true;
    const UPDATE_MSG = "CineFreak now asks for a Cloudflare check before every video. Update SkyStream to v2.9.0 or newer, which can pass it.";
    const COOKIES = {};       // host -> { name: value }
    const CK_PREF = "tj_cf_cookies";
    const CK_TTL = 3 * 3600 * 1000;

    function hostOf(u) { const m = String(u || "").match(/^https?:\/\/([^\/?#:]+)/i); return m ? m[1].toLowerCase() : ""; }
    function rememberCookies(u, res) {
        if (!res || !res.headers) return;
        let sc = res.headers["set-cookie"] || res.headers["Set-Cookie"];
        if (!sc) return;
        if (!Array.isArray(sc)) sc = String(sc).split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
        const h = hostOf(u);
        const jar = COOKIES[h] || (COOKIES[h] = {});
        sc.forEach(function (c) {
            const m = String(c).match(/^\s*([^=;\s]+)=([^;]*)/);
            if (!m) return;
            if (/max-age=0|expires=thu, 01 jan 1970/i.test(c)) delete jar[m[1]]; else jar[m[1]] = m[2];
        });
    }
    function cookieHeader(u) {
        const jar = COOKIES[hostOf(u)];
        if (!jar) return "";
        return Object.keys(jar).map(function (k) { return k + "=" + jar[k]; }).join("; ");
    }
    async function loadSavedCookies() {
        try {
            if (typeof getPreference !== "function") return;
            const saved = JSON.parse((await withTimeout(getPreference(CK_PREF), 1500)) || "null");
            if (saved && saved.t && Date.now() - saved.t < CK_TTL && saved.c) {
                Object.keys(saved.c).forEach(function (h) { COOKIES[h] = Object.assign({}, saved.c[h], COOKIES[h] || {}); });
            }
        } catch (_) {}
    }
    function saveCookies() {
        try { if (typeof setPreference === "function") setPreference(CK_PREF, JSON.stringify({ t: Date.now(), c: COOKIES })); } catch (_) {}
    }

    /** GET/POST with this plugin's own cookie jar; never throws. */
    async function req(method, u, headers, body, ms) {
        const h = Object.assign({ "User-Agent": UA }, headers || {});
        const ck = cookieHeader(u);
        if (ck) h["Cookie"] = h["Cookie"] ? h["Cookie"] + "; " + ck : ck;
        try {
            const r = await withTimeout(method === "POST" ? http_post(u, h, body || "") : http_get(u, h), ms || 15000);
            rememberCookies(u, r);
            return { status: (r && (r.status || r.statusCode)) || 0, body: (r && r.body) || "", finalUrl: (r && r.finalUrl) || u, headers: (r && r.headers) || {} };
        } catch (e) { return { status: 0, body: "", finalUrl: u, headers: {} }; }
    }

    /** A Turnstile token for siteKey, solved on pageUrl by SkyStream. Throws a user-facing reason. */
    async function turnstileToken(siteKey, pageUrl, ms) {
        let p = null;
        // __ssAsync carries this plugin's identity, so SkyStream knows a person is waiting and can
        // show them the check if it doesn't pass by itself; the global solveCaptcha doesn't.
        try { if (!IN_AIO && typeof __ssAsync === "function") p = __ssAsync("solve_captcha", { siteKey: siteKey, url: pageUrl }); } catch (_) { p = null; }
        if (!p) {
            if (typeof solveCaptcha !== "function") throw new Error(UPDATE_MSG);
            p = solveCaptcha(siteKey, pageUrl);
        }
        let t;
        try { t = await withTimeout(Promise.resolve(p), ms || 60000); }
        catch (e) { throw new Error("The Cloudflare check did not pass: " + String((e && e.message) || e)); }
        if (typeof t !== "string" || t === "mock_captcha_token" || t.length < 40) throw new Error(UPDATE_MSG);
        return t;
    }

    /** The video address inside a player page (JW Player setup, <video>/<source>, ?id=, plain links). */
    function mediaIn(html, pageUrl) {
        const s = String(html || "").replace(/\\\//g, "/");
        const found = [];
        const add = function (u, label) {
            u = decodeEntities(String(u || "").trim());
            if (/^\/\//.test(u)) u = "https:" + u;
            if (/^\//.test(u)) u = cloudOrigin(pageUrl) + u;
            if (!/^https?:\/\//i.test(u) || found.some(function (x) { return x.url === u; })) return;
            found.push({ url: u, label: label || "" });
        };
        let m;
        const fileRe = /["']?(?:file|src|source|url|videoUrl|hls|stream)["']?\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4|mkv|webm)(?:\?[^"']*)?)["']/gi;
        while ((m = fileRe.exec(s)) !== null) add(m[1]);
        const tagRe = /<(?:source|video)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
        while ((m = tagRe.exec(s)) !== null) add(m[1]);
        const qRe = /"(?:label|quality)"\s*:\s*"([^"]+)"[^{}]*?"(?:file|src|url)"\s*:\s*"([^"]+)"|"(?:file|src|url)"\s*:\s*"([^"]+)"[^{}]*?"(?:label|quality)"\s*:\s*"([^"]+)"/gi;
        while ((m = qRe.exec(s)) !== null) add(m[2] || m[3], m[1] || m[4]);
        const plainRe = /https?:\/\/[^\s"'<>()]+?\.(?:m3u8|mp4|mkv)(?:\?[^\s"'<>()]*)?/gi;
        while ((m = plainRe.exec(s)) !== null) add(m[0]);
        const r2Re = /https?:\/\/[^\s"'<>()]*(?:r2\.dev|r2\.cloudflarestorage\.com|workers\.dev|googleusercontent\.com)[^\s"'<>()]*/gi;
        while ((m = r2Re.exec(s)) !== null) add(m[0]);
        const id = (String(pageUrl).match(/[?&](?:id|url|file)=([^&#]+)/) || [])[1];
        if (id) { try { const d = decodeURIComponent(id); if (/^https?:\/\/.+\.(?:m3u8|mp4|mkv)/i.test(d)) add(d); } catch (_) {} }
        return found.filter(function (x) {
            return !/\.(?:jpg|png|webp|vtt|srt)(?:\?|$)/i.test(x.url) && !/thumbnail|poster|preview/i.test(x.url)
                && !/[?&](?:id|url)=https?(?::|%3A)/i.test(x.url);   // a player wrapper, not the file
        });
    }
    function subsIn(html) {
        const out = [];
        const re = /["'](?:file|src)["']\s*:\s*["']([^"']+\.(?:vtt|srt))["'][^}]*?["']label["']\s*:\s*["']([^"']*)["']/gi;
        let m;
        while ((m = re.exec(String(html || "").replace(/\\\//g, "/"))) !== null) out.push({ url: m[1], label: m[2] || "Sub", lang: m[2] || "und" });
        return out;
    }

    // ─────────────────────────── streams ───────────────────────────
    //
    // Route 1 – CineCloud file pages (/f/<code>): after the Turnstile unlock they list the servers
    //   (Fast Cloud = direct file, Instant / Instant V2 = Google or worker link,
    //    Cloud [Resumable] = R2 link, Stream Online = /x/<code> iframe with ?id=<file url>).
    // Route 2 – CineFreak's own player API: POST {op:"play", ep} (+ ts) -> {state:"ready", url}.

    function qualityNum(q) {
        const m = String(q || "").match(/(\d{3,4})p/i);
        if (m) return parseInt(m[1], 10);
        return /\b4k\b|2160/i.test(String(q || "")) ? 2160 : 0;
    }

    function cloudOrigin(u) { const m = String(u || "").match(/^https?:\/\/[^\/]+/i); return m ? m[0] : "https://new5.cinecloud.site"; }
    function absUrl(base, href) {
        href = decodeEntities(String(href || "").trim());
        if (/^https?:\/\//i.test(href)) return href;
        if (/^\/\//.test(href)) return "https:" + href;
        if (/^\//.test(href)) return cloudOrigin(base) + href;
        return "";
    }
    function isWrapper(u) { return /(?:cinecloud|neodrive)[^\/]*\/(?:f|x|d|w|gp|fc|fastdl)\//i.test(u); }
    function isFileUrl(u) {
        return /googleusercontent\.com|workers\.dev|r2\.dev|r2\.cloudflarestorage\.com|cloudflarestorage|pixeldrain|\.(?:mkv|mp4|m3u8)(?:[?#]|$)|response-content-disposition/i.test(u)
            || (/\.dev\//i.test(u) && !/\/\?id=/i.test(u));
    }
    function anchors(html, base) {
        const out = [];
        const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const h = m[1].match(/href\s*=\s*["']([^"']+)["']/i);
            if (!h) continue;
            const href = absUrl(base, h[1]);
            if (!href) continue;
            const cls = (m[1].match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
            out.push({ href: href, cls: cls, text: stripTags(m[2]) });
        }
        return out;
    }
    function pixeldrainDirect(u) {
        const m = String(u).match(/pixeldrain\.[a-z]+\/(?:u|l|api\/file)\/([A-Za-z0-9]+)/i);
        return m ? "https://pixeldrain.com/api/file/" + m[1] + "?download" : u;
    }
    function iframeTarget(html, pageUrl) {
        const m = String(html || "").match(/<iframe\b[^>]*\b(?:data-cf-src|data-src|src)\s*=\s*["']([^"']+)["']/i);
        if (!m) return "";
        const src = absUrl(pageUrl, m[1]);
        const id = (src.match(/[?&]id=([^&#]+)/) || [])[1];
        if (id) { try { const d = decodeURIComponent(id); if (/^https?:\/\//i.test(d)) return d; } catch (_) {} }
        return isFileUrl(src) ? src : "";
    }
    /** A link on an intermediate page (Instant / Resumable) that is the real file. */
    function fileLinkIn(html, base) {
        const pick = anchors(html, base).filter(function (a) {
            return !isWrapper(a.href) && (/download-now|instant-download|btn-instant2|fsl-btn/i.test(a.cls) || isFileUrl(a.href));
        })[0];
        if (pick) return pick.href;
        const m = String(html).match(/https?:\/\/[^\s"'<>]*(?:googleusercontent\.com|r2\.cloudflarestorage\.com|r2\.dev|workers\.dev)[^\s"'<>]*/i);
        if (m) return decodeEntities(m[0]);
        const loc = String(html).match(/(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i);
        return loc && !isWrapper(loc[1]) ? loc[1] : "";
    }
    function hasServers(html) { return /server-btn|fsl-btn|instant-download|download-now|\/(?:w|gp|d|x)\/[A-Za-z0-9_-]{6,}/i.test(String(html || "")); }

    /** Server buttons (from the file page or its unlock answer) -> [{url, tag}]. */
    async function serversFrom(html, fUrl, deadline) {
        const out = [];
        const add = function (u, tag) {
            if (!u || !/^https?:\/\//i.test(u) || isWrapper(u)) return;
            u = pixeldrainDirect(u);
            if (!out.some(function (x) { return x.url === u; })) out.push({ url: u, tag: tag });
        };
        const jobs = [];
        anchors(html, fUrl).forEach(function (a) {
            const t = a.text.toLowerCase();
            if (/telegram|t\.me\/|facebook|whatsapp|\/tutorial|how to|terms-conditions|privacy-policy|\/abuse/i.test(a.href + " " + t)) return;
            if (/fast cloud|\[fsl\]/i.test(t) || /fsl-btn/i.test(a.cls) || (/\.dev\//i.test(a.href) && !isWrapper(a.href) && !/\/\?id=/i.test(a.href))) {
                if (!isWrapper(a.href)) { add(a.href, "Fast Cloud"); return; }
            }
            if (/pixeldrain/i.test(a.href + " " + t + " " + a.cls)) { add(a.href, "Pixeldrain"); return; }
            if (/\/x\//i.test(a.href) || /stream online|watch online/i.test(t)) {
                jobs.push(req("GET", a.href, { "Referer": fUrl }).then(function (pg) {
                    add(iframeTarget(pg.body, a.href), "Stream");
                    mediaIn(pg.body, a.href).forEach(function (x) { add(x.url, "Stream"); });
                }));
                return;
            }
            const tag = (/\/gp\//i.test(a.href) || /instant.*v2/i.test(t) || /btn-instant2/i.test(a.cls)) ? "Instant V2"
                : (/\/w\//i.test(a.href) || /instant/i.test(t)) ? "Instant"
                : (/\/d\//i.test(a.href) || /resumable/i.test(t)) ? "Resumable" : "";
            if (tag) {
                if (!isWrapper(a.href) && isFileUrl(a.href)) { add(a.href, tag); return; }
                jobs.push(req("GET", a.href, { "Referer": fUrl }).then(function (pg) {
                    let u = (pg.finalUrl && pg.finalUrl !== a.href && !isWrapper(pg.finalUrl) && isFileUrl(pg.finalUrl)) ? pg.finalUrl : "";
                    if (!u) u = fileLinkIn(pg.body, a.href);
                    add(u, tag);
                }));
                return;
            }
            if (isFileUrl(a.href) && !isWrapper(a.href)) add(a.href, "Direct");
        });
        const left = Math.max(3000, Math.min(20000, deadline - Date.now()));
        await withTimeout(Promise.all(jobs), left).catch(function () {});
        return out;
    }

    /**
     * One CineCloud file: its page, unlocked with a Turnstile token when the servers are hidden.
     * Returns { items, size, name, why }.
     */
    async function resolveCloudFile(link, deadline) {
        const fUrl = link.replace(/\/(?:x|w|d|gp)\//i, "/f/").replace(/[?#].*$/, "");
        const origin = cloudOrigin(fUrl);
        const res = { items: [], size: "", name: "", why: "" };
        const pg = await req("GET", fUrl, { "Referer": SITE + "/", "Accept": "text/html,application/xhtml+xml,*/*;q=0.8" });
        const sizeM = pg.body.match(/File Size[\s\S]{0,200}?<td[^>]*>([^<]+)<\/td>/i);
        res.size = sizeM ? stripTags(sizeM[1]) : "";
        const nameM = pg.body.match(/<h1[^>]*file-title[^>]*>([\s\S]*?)<\/h1>/i);
        res.name = nameM ? stripTags(nameM[1]) : "";
        if (pg.status === 403 && /cloudflare/i.test(pg.body) && !/cf-turnstile/i.test(pg.body)) { res.why = "CineCloud blocked this network"; return res; }
        if (/cannot be found|File not Found/i.test(pg.body)) { res.why = "file removed"; return res; }

        let html = pg.body;
        const keyM = html.match(/data-sitekey="(0x4[^"]+)"/i);
        if (keyM && /\/unlock/.test(html)) {
            const path = fUrl.replace(origin, "");
            const nonce = await req("GET", fUrl + "/n", { "Referer": fUrl, "Accept": "application/json" });
            let bc = "";
            try { bc = String((JSON.parse(nonce.body || "{}") || {}).n || ""); } catch (_) { bc = ""; }
            let ts;
            try {
                ts = await turnstileToken(keyM[1], origin + "/terms-conditions", Math.max(IN_AIO ? 8000 : 15000, deadline - Date.now() - (IN_AIO ? 6000 : 12000)));
            } catch (e) { res.why = String((e && e.message) || e); return res; }
            const un = await req("POST", fUrl + "/unlock", {
                "Referer": fUrl, "Origin": origin, "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded"
            }, "ts=" + encodeURIComponent(ts) + "&bc=" + encodeURIComponent(bc));
            let j = null;
            try { j = JSON.parse(un.body || "{}"); } catch (_) { j = null; }
            if (!j || !j.ok || !j.html) { res.why = "CineCloud: " + String((j && j.message) || ("unlock failed (HTTP " + un.status + ")")); return res; }
            html = String(j.html);
            void path;
        } else if (!hasServers(html)) {
            res.why = "no servers on the file page";
        }
        res.items = await serversFrom(html, fUrl, deadline);
        if (!res.items.length && !res.why) res.why = "no playable server";
        return res;
    }

    /** CineFreak's own player. Returns { items, why }. */
    async function playRoute(pageHtml, postUrl, ep, deadline) {
        const out = { items: [], why: "" };
        const apiM = pageHtml.match(/PLAY_API\s*=\s*"([^"]+)"/);
        const keyM = pageHtml.match(/TS_SITE_KEY\s*=\s*"([^"]+)"/);
        if (!apiM || !ep) { out.why = "no player on this page"; return out; }
        const api = apiM[1].replace(/\\\//g, "/");
        const hdr = { "Referer": postUrl, "Origin": SITE, "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" };
        const call = async function (op, ts) {
            const r = await req("POST", api, hdr, "op=" + op + "&ep=" + encodeURIComponent(ep) + (ts ? "&ts=" + encodeURIComponent(ts) : ""));
            let j = {};
            try { j = JSON.parse(r.body || "{}") || {}; } catch (_) { j = {}; }
            j.__status = r.status;
            return j;
        };
        let st = await call("play");
        if (st.need === "ts") {
            if (!keyM) { out.why = "player check key not found"; return out; }
            let ts;
            try { ts = await turnstileToken(keyM[1], postUrl, Math.max(IN_AIO ? 8000 : 15000, deadline - Date.now() - (IN_AIO ? 4000 : 15000))); }
            catch (e) { out.why = String((e && e.message) || e); return out; }
            st = await call("play", ts);
            saveCookies();
        }
        if (st.state && st.state !== "ready" && st.state !== "uploading" && st.state !== "failed" && st.state !== "error") {
            out.why = st.message || ("CineFreak: " + st.state); return out;
        }
        if (st.state !== "ready" && !st.need) {
            if (st.state !== "uploading") st = await call("prep");
            while (st.state === "uploading" && Date.now() < deadline - 12000) {
                await new Promise(function (ok) { setTimeout(ok, 4000); });
                st = await call("stat");
            }
            if (st.state === "uploading") { out.why = "CineFreak is preparing this video (" + (st.progress || 0) + "%). Try again in a minute."; return out; }
        }
        if (st.state !== "ready" || !st.url) { out.why = st.message || (st.need ? "the Cloudflare check was not accepted" : "player gave no address"); return out; }
        const playerUrl = String(st.url).replace(/\\\//g, "/");
        const direct = /\.(?:m3u8|mp4|mkv)(?:[?#]|$)/i.test(playerUrl);
        if (direct) { out.items.push({ url: playerUrl, tag: "Player", referer: SITE + "/" }); return out; }
        const pg = await req("GET", playerUrl, { "Referer": postUrl, "Accept": "text/html,*/*" });
        const subs = subsIn(pg.body);
        mediaIn(pg.body, playerUrl).forEach(function (x) {
            out.items.push({ url: x.url, tag: "Player" + (x.label ? " " + x.label : ""), referer: cloudOrigin(playerUrl) + "/", subs: subs });
        });
        // a player that fetches its source from a JSON endpoint next to it
        if (!out.items.length) {
            const apiU = (pg.body.match(/["'](\/[^"']*(?:source|play|stream|video)[^"']*\.(?:json|php)[^"']*|\/api\/[^"']+)["']/i) || [])[1];
            if (apiU) {
                const jr = await req("GET", cloudOrigin(playerUrl) + apiU, { "Referer": playerUrl, "Accept": "application/json" });
                mediaIn(jr.body, playerUrl).forEach(function (x) { out.items.push({ url: x.url, tag: "Player", referer: cloudOrigin(playerUrl) + "/", subs: subs }); });
            }
        }
        if (!out.items.length) { out.why = "player page had no video address"; try { console.log("[CineFreak] player page: " + playerUrl + " :: " + pg.body.slice(0, 1500)); } catch (_) {} }
        return out;
    }

    const TAG_RANK = { "Fast Cloud": 0, "Stream": 1, "Player": 1, "Resumable": 2, "Instant": 3, "Instant V2": 4, "Pixeldrain": 5, "Direct": 6 };

    /** Order the file links: 1080p, 720p, 480p, 4K, then the rest; the Watch link last. */
    function pickOrder(links) {
        const pref = function (l) {
            const q = qualityNum(l[0]);
            if (/^Watch/.test(l[0])) return 50;
            return q === 1080 ? 0 : q === 720 ? 1 : q === 480 ? 2 : q === 2160 ? 3 : 4;
        };
        return links.slice().sort(function (a, b) { return pref(a) - pref(b); });
    }

    async function loadStreams(url, cb) {
        const t0 = Date.now();
        const deadline = t0 + (IN_AIO ? 28000 : 80000);   // the app gives a function 90 s, All-in-one 30 s
        try {
            let p = null;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.slug) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized episode url" });
            const slug = String(p.slug);
            await loadSavedCookies();
            await ensureSite();
            const postUrl = SITE + "/" + slug + "/";
            const page = await req("GET", postUrl, { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": SITE + "/" }, null, 20000);
            const html = stripHiddenBlocks(page.body);

            let links = Array.isArray(p.L) && p.L.length ? p.L : null;
            let ep = p.P || "";
            if (!links || !ep) {
                const rows = parseSeriesRows(html);
                const old = !Array.isArray(p.L);
                if (rows.length && p.s >= 0) {
                    const S = old ? p.s + 1 : p.s, E = old ? p.e + 1 : p.e;
                    const want = rows.filter(function (r) { return r.s === S && (r.e === E || (r.pack && E >= r.e && E <= r.e2)); });
                    if (!links) links = (want[0] || rows[0]).links;
                    if (!ep) ep = playCode(extractDataset(html), S, E);
                } else {
                    if (!links) { links = parseMovieLinks(html); if (!links.length) links = cloudLinks(html, ""); }
                    if (!ep) { const d = extractDataset(html); ep = (d && typeof d.sources === "string") ? d.sources : "m"; }
                }
            }

            const lang = langOf(slug.replace(/-/g, " "));
            const why = [];
            const found = [];   // {url, tag, q, size, referer, subs}

            // Route 1: CineCloud files, best quality first, while time allows
            const order = pickOrder(links || []);
            let tried = 0;
            for (let i = 0; i < order.length && tried < (IN_AIO ? 1 : 2); i++) {
                if (Date.now() > deadline - (IN_AIO ? 20000 : 25000)) break;
                if (/^Watch/.test(order[i][0]) && found.length) break;
                tried++;
                let r;
                try { r = await withTimeout(resolveCloudFile(order[i][1], deadline), Math.max(10000, deadline - Date.now() - 5000)); }
                catch (e) { r = { items: [], why: "timed out" }; }
                const q = qualityNum(order[i][0]) || qualityNum(r.name);
                r.items.forEach(function (it) { found.push({ url: it.url, tag: it.tag, q: q, size: (order[i][0].match(/\[([^\]]+)\]/) || [])[1] || r.size }); });
                if (r.why) why.push(order[i][0] + ": " + r.why);
                // stop on: old app, blocked host, or a rejected check (no second check sheet for nothing)
                if (r.why === UPDATE_MSG || /blocked this network|Cloudflare check|CineCloud: /.test(r.why || "")) break;
                // a second quality costs another check: only while the first one went fast
                if (found.length && Date.now() - t0 > 30000) break;
            }

            // Route 2: CineFreak's player
            if (!found.length && Date.now() < deadline - (IN_AIO ? 8000 : 20000) && why.indexOf(UPDATE_MSG) < 0 && !why.some(function (w) { return w.indexOf(UPDATE_MSG) >= 0; })) {
                let r;
                try { r = await withTimeout(playRoute(page.body, postUrl, ep, deadline), Math.max(10000, deadline - Date.now())); }
                catch (e) { r = { items: [], why: "timed out" }; }
                r.items.forEach(function (it) { found.push({ url: it.url, tag: it.tag, q: qualityNum(it.tag), referer: it.referer, subs: it.subs }); });
                if (r.why) why.push("Player: " + r.why);
            }

            const seen = {};
            const streams = [];
            found.forEach(function (x) {
                if (seen[x.url]) return;
                seen[x.url] = 1;
                const qLabel = x.q ? (x.q === 2160 ? "4K" : x.q + "p") : "Auto";
                const headers = { "User-Agent": UA };
                if (x.referer) headers["Referer"] = x.referer;
                else if (/cinecloud|neodrive/i.test(x.url)) headers["Referer"] = cloudOrigin(x.url) + "/";
                const o = {
                    url: x.url,
                    source: "CineFreak · " + x.tag + " · " + qLabel + (x.size ? " · " + x.size : "") + (lang ? " · " + lang : ""),
                    headers: headers
                };
                if (x.q) o.quality = x.q;
                if (x.subs && x.subs.length) o.subtitles = x.subs;
                const rk = TAG_RANK[x.tag] != null ? TAG_RANK[x.tag] : TAG_RANK[String(x.tag).split(" ")[0]];
                streams.push({ q: x.q || 0, rank: rk == null ? 9 : rk, s: mkStream(o) });
            });
            streams.sort(function (a, b) { return (b.q - a.q) || (a.rank - b.rank); });
            if (!streams.length) {
                try { console.log("[CineFreak] no streams: " + why.join(" | ")); } catch (_) {}
                const upd = why.some(function (w) { return w.indexOf(UPDATE_MSG) >= 0; });
                if (upd) return cb({ success: false, errorCode: "NEEDS_UPDATE", message: UPDATE_MSG });
                const checkFail = why.some(function (w) { return /Cloudflare check|not accepted|unlock failed|CineCloud: /i.test(w); });
                const msg = "No playable CineFreak source right now" + (why.length ? " (" + why.slice(0, 3).join("; ") + ")" : "") + ".";
                return cb({ success: false, errorCode: checkFail ? "CHECK_FAILED" : "NO_STREAMS", message: msg });
            }
            cb({ success: true, data: streams.slice(0, 20).map(function (x) { return x.s; }) });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── exports ───────────────────────────

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

    __ngWrapExports();
})(typeof http_get !== 'undefined' ? http_get : undefined, typeof http_post !== 'undefined' ? http_post : undefined);
