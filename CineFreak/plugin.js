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
    //  CineFreak (cinefreak.net) — SkyStream plugin
    //
    //  WordPress download site with its own streaming backend.
    //
    //  SEARCH   GET /search-api.php?q=<query>&pg=<page>
    //           -> { results: [ { t: title, l: slug, i: poster,
    //                c: category, q: quality, tmdb: tmdbId } ],
    //                total, page, total_pages }
    //
    //  DETAIL   GET https://cinefreak.net/<slug>/
    //           page embeds a minified player dataset:
    //             const dataset = {"type":"movie","is_combo":false,
    //               "sources":{"1080p":"cd4a0171","720p":"d23b7aee",...}};
    //           or for series:
    //             const dataset={"type":"series","is_combo":!1,
    //               "seasons":[{ "episodes":[ { "ep_num":"01",
    //                 "sources":{...} }, ... ] }, ...]};
    //           (!1 / !0 are minified false / true -> fixed before parse)
    //
    //  PREPARE  GET  stream-prepare.php?action=status&r720p=<tok>... -> {state}
    //           POST stream-prepare.php?action=start&...  (when not "ready")
    //  PLAYBACK GET https://subtitle.yagaverse.net/stream-api.php
    //             ?key=pushpa&r480p=<tok>&r720p=<tok>&r1080p=<tok>
    //             &id=<primary token>
    //           -> { videoUrl, resolutions: [ { quality, url } ],
    //                audioTracks, subtitleTracks }
    //           The URLs are DIRECT files on Cloudflare R2
    //           (pub-*.r2.dev) — verified HTTP 206 on Range with no
    //           Referer/Origin needed. User-Agent only.
    //
    //  APP CONTRACT (SkyStream engine): every exported function takes a
    //  callback and MUST resolve exactly once with
    //      { success: true, data: <payload> }   on success
    //      { success: false, errorCode, message } on failure
    //  Returning a raw Map is rejected by the engine
    //  (JsPluginException UNKNOWN_ERROR) — envelope is mandatory.
    //  Episode objects use `name` (not `title`) + int season/episode.
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
    const STREAM_API = "https://subtitle.yagaverse.net/stream-api.php";
    const STREAM_KEY = "pushpa";

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
    async function indexPage(q, pg) {
        const url = INDEX_API + "?q=" + encodeURIComponent(q) + "&pg=" + pg;
        const r = await withTimeout(http_get(url, { "User-Agent": UA, "Accept": "application/json", "Origin": SITE, "Referer": SITE + "/" }), 15000);
        let j = null;
        try { j = JSON.parse((r && r.body) || "null"); } catch (_) { j = null; }
        if (!j || !Array.isArray(j.hits)) throw new Error("index unavailable (HTTP " + ((r && r.status) || 0) + ")");
        return j.hits.map(function (h) { return h && h.document; }).filter(Boolean);
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

    // The player script declares `const dataset = {...};` (older builds were minified:
    // `const dataset={..."is_combo":!1...}`), so accept both spellings.
    function extractDataset(html) {
        const m = /const\s+dataset\s*=\s*\{/.exec(html);
        if (!m) return null;
        let raw = sliceObject(html, m.index + m[0].length - 1);
        if (!raw) return null;
        raw = raw.replace(/:\s*!0\b/g, ":true").replace(/:\s*!1\b/g, ":false");
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    async function load(url, cb) {
        try {
            let p = null;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.slug) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized item url" });
            const slug = String(p.slug);
            await ensureSite();
            const html = await fetchHtml(SITE + "/" + slug + "/");

            const tM = html.match(/<meta property="og:title" content="([^"]*)"/);
            const title = tM ? cleanTitle(tM[1]) : cleanTitle(slug.replace(/-/g, " "));
            // og:image on this site is a rank-math SEO overlay URL that
            // returns 404 HTML (renders as a black square). The real poster
            // is the first TMDB/cineimg image embedded in the page body.
            let poster = "";
            const imgScan = /https:\/\/(?:image\.tmdb\.org|cineimg\.xyz)\/[^"'\s)]+\.(?:jpg|jpeg|png|webp)/g;
            let im, firstImg = null;
            while ((im = imgScan.exec(html)) !== null) { firstImg = im[0]; break; }
            if (firstImg) {
                poster = fixPoster(firstImg);
            } else {
                const imgM = html.match(/<meta property="og:image" content="([^"]*)"/);
                if (imgM && imgM[1].indexOf("admin-ajax") < 0) poster = fixPoster(imgM[1]);
            }

            const dM = html.match(/<meta (?:property="og:description"|name="description") content="([^"]*)"/);
            const description = dM ? decodeEntities(dM[1]).replace(/\s+/g, " ").trim() : "";
            const yM = (tM ? tM[1] : slug).match(/\b(19[3-9]\d|20[0-4]\d)\b/);
            const year = yM ? parseInt(yM[1], 10) : undefined;

            const data = extractDataset(html);
            const isSeries = !!(data && data.type === "series");
            const episodes = [];

            if (isSeries && Array.isArray(data.seasons) && data.seasons.length) {
                for (let si = 0; si < data.seasons.length; si++) {
                    const season = data.seasons[si] || {};
                    const eps = season.episodes || [];
                    const sName = String(season.season_name || ("Season " + (si + 1)));
                    for (let ei = 0; ei < eps.length; ei++) {
                        const ep = eps[ei] || {};
                        if (!ep.sources) continue;
                        const num = parseInt(String(ep.ep_num || (ei + 1)), 10) || (ei + 1);
                        const epTitle = String(ep.ep_title || ("Episode " + num));
                        const meta = String(ep.ep_meta || "");
                        episodes.push(mkEpisode({
                            name: sName + " · " + epTitle + (meta ? " · " + meta : ""),
                            // carry the player tokens so playback doesn't need the site again
                            url: JSON.stringify({ slug: slug, s: si, e: ei, src: ep.sources }),
                            season: si + 1,
                            episode: num
                        }));
                    }
                }
            }
            if (!episodes.length) {
                // movie (or series post without per-episode data): single play-all
                episodes.push(mkEpisode({
                    name: title,
                    url: JSON.stringify({ slug: slug, s: -1, e: -1, src: (data && data.sources) || undefined }),
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

    // ─────────────────────────── streams ───────────────────────────

    function qualityNum(q) {
        const m = String(q || "").match(/(\d{3,4})/);
        return m ? parseInt(m[1], 10) : 0;
    }

    const PREPARE_API = "https://subtitle.yagaverse.net/stream-prepare.php";

    function prepareQuery(sources) {
        return ["480p", "720p", "1080p"].filter(function (q) { return sources[q]; })
            .map(function (q) { return "r" + q + "=" + encodeURIComponent(sources[q]); }).join("&");
    }

    /**
     * Since Oct 2026 the site only streams files that were "prepared" (copied to its R2
     * bucket). The web player asks ?action=status first and, when the file is not ready,
     * POSTs ?action=start and polls. Do the same, within the app's 90 s budget.
     * Returns "ready", or a user-facing reason why it is not.
     */
    async function ensurePrepared(sources) {
        const q = prepareQuery(sources);
        if (!q) return "ready";
        const status = async function () {
            try { return await fetchJson(PREPARE_API + "?action=status&" + q, JSON_HEADERS); } catch (e) { return {}; }
        };
        let st = await status();
        if (!st || !st.state) return "ready"; // check unavailable: the web player then just tries to play
        if (st.state === "ready") return "ready";
        if (st.state === "unavailable") return st.message || "Streaming is unavailable for this title (download-only).";
        if (st.state === "limited") return st.message || "CineFreak is rate-limiting stream preparation. Try again shortly.";
        if (st.state !== "uploading") {
            try {
                const r = await withTimeout(http_post(PREPARE_API + "?action=start&" + q, JSON_HEADERS, ""), 15000);
                st = JSON.parse((r && r.body) || "{}") || {};
            } catch (e) { st = {}; }
            if (st.state === "ready") return "ready";
        }
        const deadline = Date.now() + 55000;
        while (Date.now() < deadline) {
            await new Promise(function (ok) { setTimeout(ok, 4000); });
            st = await status();
            if (st && st.state === "ready") return "ready";
            if (st && (st.state === "failed" || st.state === "unavailable" || st.state === "error")) break;
        }
        const pct = st && st.progress ? " (" + st.progress + "% done)" : "";
        return "CineFreak is preparing this video for streaming" + pct + ". Try again in a minute.";
    }

    async function resolveSources(sources) {
        if (!sources) return [];
        const params = [];
        params.push("key=" + encodeURIComponent(STREAM_KEY));
        const qs = Object.keys(sources);
        for (const q of qs) {
            params.push("r" + encodeURIComponent(q) + "=" + encodeURIComponent(sources[q]));
        }
        const primary = sources["720p"] || sources["1080p"] || sources["480p"] || sources[qs[0]];
        if (primary) params.push("id=" + encodeURIComponent(primary));
        const j = await withTimeout(fetchJson(STREAM_API + "?" + params.join("&")), 25000);
        if (!j) return [];
        const out = [];
        const resolutions = (j.resolutions || []).slice()
            .sort(function (a, b) { return qualityNum(b.quality) - qualityNum(a.quality); });
        for (const r of resolutions) {
            if (!r || !r.url) continue;
            out.push(mkStream({
                url: String(r.url),
                source: "CineFreak · " + String(r.quality || "Auto") + (langOf(r.url) ? " · " + langOf(r.url) : ""),
                headers: STREAM_HEADERS
            }));
        }
        if (!out.length && j.videoUrl) {
            out.push(mkStream({
                url: String(j.videoUrl),
                source: "CineFreak",
                headers: STREAM_HEADERS
            }));
        }
        return out.slice(0, 10);
    }

    async function loadStreams(url, cb) {
        try {
            let p = null;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.slug) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized episode url" });
            const slug = String(p.slug);

            let sources = (p.src && typeof p.src === "object" && Object.keys(p.src).length) ? p.src : null;
            let data = null;
            if (!sources) {
                await ensureSite();
                const html = await fetchHtml(SITE + "/" + slug + "/");
                data = extractDataset(html);
                if (!data) return cb({ success: false, errorCode: "NO_STREAMS", message: "No stream data on this page (download-only post?)" });
            }
            if (!sources && p.s >= 0 && Array.isArray(data.seasons) && data.seasons[p.s]) {
                const eps = data.seasons[p.s].episodes || [];
                const ep = eps[p.e] || eps[0];
                sources = ep && ep.sources;
            }
            if (!sources && data) sources = data.sources;

            if (!sources) return cb({ success: false, errorCode: "NO_STREAMS", message: "This post has no online player (download links only)." });
            const prep = await ensurePrepared(sources);
            if (prep !== "ready") return cb({ success: false, errorCode: "NOT_READY", message: prep });

            const streams = await resolveSources(sources);
            if (!streams.length) return cb({ success: false, errorCode: "NO_STREAMS", message: "No playable source right now — try again in a moment." });
            cb({ success: true, data: streams });
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
