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
    //  ZXCStream (zxcstream.com) - TJ-Plugins
    //
    //  zxcstream.com is a front end over TMDB (its rows are TMDB company / network
    //  pages: Netflix, HBO, Disney+, Apple TV+, Marvel, A24...). This plugin rebuilds it:
    //    - catalog / search / details: TMDB, same rows as the site's home page
    //    - streams: the site's "Main Server" = vidstuck.cc, its own ad-free player.
    //      Orion (original audio + Hindi dub), Atlas and Daedalus,
    //      kept under vidstuck's rate limit (see below).
    // ═══════════════════════════════════════════════════════════

    const TMDB = "https://api.themoviedb.org/3";
    const IMG = "https://image.tmdb.org/t/p";
    const KEY = "439c478a771f35c05022f9feabcca01c"; // repo-wide public TMDB key
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // ─────────────────────────── helpers ───────────────────────────

    function mkItem(obj)    { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj)  { try { return new StreamResult(obj); } catch (_) { return obj; } }

    function withTimeout(promise, ms) {
        if (typeof setTimeout !== "function") return promise;
        return new Promise(function (resolve, reject) {
            const t = setTimeout(function () { reject(new Error("timeout")); }, ms);
            promise.then(
                function (v) { clearTimeout(t); resolve(v); },
                function (e) { clearTimeout(t); reject(e); }
            );
        });
    }

    async function tmdb(path) {
        const sep = path.indexOf("?") >= 0 ? "&" : "?";
        const res = await http_get(TMDB + path + sep + "api_key=" + KEY + "&language=en-US", { "User-Agent": UA });
        if (!res || !res.body || Number(res.status) >= 400) return null;
        try { return JSON.parse(res.body); } catch (e) { return null; }
    }

    function img(p, size) { return p ? IMG + "/" + (size || "w500") + p : ""; }
    function yearOf(d) { const m = String(d || "").match(/^(\d{4})/); return m ? parseInt(m[1], 10) : null; }
    function score(v) { return v ? Math.round(v * 10) / 10 : null; }
    function itemUrl(type, id, title) { return JSON.stringify({ type: type, id: id, title: title || "" }); }

    function parseUrl(url) {
        try {
            const p = JSON.parse(String(url || ""));
            if (p && p.id && (p.type === "movie" || p.type === "tv")) return p;
        } catch (e) {}
        return null;
    }

    function isAnime(r) {
        const g = r.genre_ids || (r.genres || []).map(function (x) { return x.id; });
        return g.indexOf(16) >= 0 && (r.original_language === "ja" || (r.origin_country || []).indexOf("JP") >= 0);
    }

    function appType(tmdbType, r) {
        if (tmdbType === "movie") return "movie";
        return r && isAnime(r) ? "anime" : "series";
    }

    function toItem(r, forced) {
        if (!r || !r.id) return null;
        const t = forced || (r.media_type === "movie" || r.media_type === "tv" ? r.media_type : (r.first_air_date || r.name ? "tv" : "movie"));
        if (t !== "movie" && t !== "tv") return null;
        const title = r.title || r.name || "";
        if (!title) return null;
        return mkItem({
            title: title,
            url: itemUrl(t, r.id, title),
            posterUrl: img(r.poster_path, "w500"),
            bannerUrl: img(r.backdrop_path, "w1280"),
            type: appType(t, r),
            year: yearOf(r.release_date || r.first_air_date),
            description: r.overview || "",
            score: score(r.vote_average)
        });
    }

    // ─────────────────────────── catalog ───────────────────────────
    // Same rows as zxcstream.com's home page: Top 10 (All / Movies / TV), then its
    // provider tiles (TMDB networks and companies), plus popular / top-rated lists.
    const ROWS = [
        { name: "Top 10 Today",        path: "/trending/all/day", top: 10 },
        { name: "Top 10 Movies",       path: "/trending/movie/day", t: "movie", top: 10 },
        { name: "Top 10 TV Shows",     path: "/trending/tv/day", t: "tv", top: 10 },
        { name: "Trending This Week",  path: "/trending/all/week" },
        { name: "Popular Movies",      path: "/movie/popular", t: "movie" },
        { name: "Popular TV Shows",    path: "/tv/popular?without_genres=10767,10763", t: "tv" },
        { name: "Netflix",             path: "/discover/tv?with_networks=213&sort_by=popularity.desc", t: "tv" },
        { name: "HBO",                 path: "/discover/tv?with_networks=49&sort_by=popularity.desc", t: "tv" },
        { name: "Disney+",             path: "/discover/tv?with_networks=2739&sort_by=popularity.desc", t: "tv" },
        { name: "Apple TV+",           path: "/discover/tv?with_networks=2552&sort_by=popularity.desc", t: "tv" },
        { name: "Marvel Studios",      path: "/discover/movie?with_companies=420&sort_by=popularity.desc", t: "movie" },
        { name: "Amazon MGM Studios",  path: "/discover/movie?with_companies=210099&sort_by=popularity.desc", t: "movie" },
        { name: "A24",                 path: "/discover/movie?with_companies=41077&sort_by=popularity.desc", t: "movie" },
        { name: "Blumhouse",           path: "/discover/movie?with_companies=3172&sort_by=popularity.desc", t: "movie" },
        { name: "Shudder",             path: "/discover/movie?with_companies=142877&sort_by=popularity.desc", t: "movie" },
        { name: "Now Playing",         path: "/movie/now_playing", t: "movie" },
        { name: "Top Rated Movies",    path: "/movie/top_rated", t: "movie" },
        { name: "Top Rated TV Shows",  path: "/tv/top_rated", t: "tv" }
    ];

    async function getHome(cb) {
        try {
            const lists = await Promise.all(ROWS.map(function (row) {
                return withTimeout(tmdb(row.path + (row.path.indexOf("?") >= 0 ? "&" : "?") + "page=1"), 14000).catch(function () { return null; });
            }));
            const data = {};
            ROWS.forEach(function (row, i) {
                const res = (lists[i] && lists[i].results) || [];
                let items = res.map(function (r) { return toItem(r, row.t); }).filter(Boolean);
                if (row.top) items = items.slice(0, row.top);
                if (items.length) data[row.name] = items;
            });
            if (!Object.keys(data).length) return cb({ success: false, errorCode: "UNAVAILABLE", message: "ZXCStream catalog (TMDB) returned no content" });
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    async function search(query, cb) {
        try {
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });
            const pages = await Promise.all([1, 2].map(function (pg) {
                return tmdb("/search/multi?query=" + encodeURIComponent(q) + "&page=" + pg + "&include_adult=false").catch(function () { return null; });
            }));
            const seen = {}, out = [];
            pages.forEach(function (j) {
                ((j && j.results) || []).forEach(function (r) {
                    if (!r || (r.media_type !== "movie" && r.media_type !== "tv")) return;
                    const it = toItem(r);
                    if (it && !seen[it.url]) { seen[it.url] = 1; out.push(it); }
                });
            });
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    function castOf(d) {
        return (((d.credits || {}).cast) || []).slice(0, 12).map(function (c) {
            try { return new Actor({ name: c.name, role: c.character || "", image: img(c.profile_path, "w185") }); }
            catch (_) { return { name: c.name, role: c.character || "", image: img(c.profile_path, "w185") }; }
        });
    }

    function trailerOf(d) {
        const v = (((d.videos || {}).results) || []).filter(function (x) { return x.site === "YouTube" && /Trailer|Teaser/i.test(x.type); })[0];
        if (!v) return null;
        const u = "https://www.youtube.com/watch?v=" + v.key;
        try { return new Trailer({ url: u, name: v.name || "Trailer" }); } catch (_) { return { url: u, name: v.name || "Trailer" }; }
    }

    function recsOf(d, t) {
        return (((d.recommendations || {}).results) || []).slice(0, 15).map(function (r) { return toItem(r, t); }).filter(Boolean);
    }

    async function load(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized ZXCStream url" });
            const extra = "?append_to_response=credits,videos,recommendations,external_ids";

            if (p.type === "movie") {
                const d = await tmdb("/movie/" + p.id + extra);
                if (!d || !d.id) return cb({ success: false, errorCode: "NOT_FOUND", message: "Movie not found on TMDB" });
                const u = itemUrl("movie", d.id, d.title);
                return cb({ success: true, data: mkItem({
                    title: d.title || p.title || "Unknown",
                    url: u,
                    posterUrl: img(d.poster_path, "w500"),
                    bannerUrl: img(d.backdrop_path, "w1280"),
                    type: "movie",
                    year: yearOf(d.release_date),
                    description: d.overview || "",
                    score: score(d.vote_average),
                    duration: d.runtime ? parseInt(d.runtime, 10) : null,
                    tags: (d.genres || []).map(function (g) { return g.name; }).slice(0, 5),
                    cast: castOf(d),
                    trailers: trailerOf(d) ? [trailerOf(d)] : [],
                    recommendations: recsOf(d, "movie"),
                    // the app only shows Play when there is at least one episode
                    episodes: [mkEpisode({
                        name: "Full Movie",
                        url: u,
                        season: 1,
                        episode: 1,
                        posterUrl: img(d.backdrop_path || d.poster_path, "w780"),
                        description: d.overview || "",
                        runtime: d.runtime ? parseInt(d.runtime, 10) : null,
                        airDate: d.release_date || null
                    })]
                }) });
            }

            const d = await tmdb("/tv/" + p.id + extra);
            if (!d || !d.id) return cb({ success: false, errorCode: "NOT_FOUND", message: "Show not found on TMDB" });
            const seasons = (d.seasons || [])
                .filter(function (s) { return (s.season_number || 0) > 0 && (s.episode_count || 0) > 0; })
                .sort(function (a, b) { return a.season_number - b.season_number; })
                .slice(0, 30);
            const today = new Date().toISOString().slice(0, 10);
            const episodes = [];
            for (let i = 0; i < seasons.length; i += 6) {
                const batch = await Promise.all(seasons.slice(i, i + 6).map(function (s) {
                    return tmdb("/tv/" + d.id + "/season/" + s.season_number).catch(function () { return null; });
                }));
                batch.forEach(function (sj) {
                    ((sj && sj.episodes) || []).forEach(function (ep) {
                        if (ep.air_date && ep.air_date > today) return; // not aired yet
                        episodes.push(mkEpisode({
                            name: ep.name || ("Episode " + ep.episode_number),
                            url: JSON.stringify({ type: "tv", id: d.id, s: sj.season_number, e: ep.episode_number, title: d.name, rt: ep.runtime || (d.episode_run_time || [])[0] || null }),
                            season: sj.season_number,
                            episode: ep.episode_number,
                            posterUrl: img(ep.still_path, "w500"),
                            description: ep.overview || "",
                            rating: score(ep.vote_average),
                            runtime: ep.runtime ? parseInt(ep.runtime, 10) : null,
                            airDate: ep.air_date || null
                        }));
                    });
                });
            }
            if (!episodes.length) return cb({ success: false, errorCode: "NO_EPISODES", message: "No aired episodes for this show yet." });
            cb({ success: true, data: mkItem({
                title: d.name || p.title || "Unknown",
                url: itemUrl("tv", d.id, d.name),
                posterUrl: img(d.poster_path, "w500"),
                bannerUrl: img(d.backdrop_path, "w1280"),
                type: appType("tv", d),
                year: yearOf(d.first_air_date),
                description: d.overview || "",
                score: score(d.vote_average),
                status: /Ended|Canceled/i.test(d.status || "") ? "completed" : "ongoing",
                tags: (d.genres || []).map(function (g) { return g.name; }).slice(0, 5),
                cast: castOf(d),
                trailers: trailerOf(d) ? [trailerOf(d)] : [],
                recommendations: recsOf(d, "tv"),
                episodes: episodes
            }) });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────


    // ── stream verification (TJ-Plugins shared helper) ─────────────────────────
    // Each candidate is requested once, with the exact headers the player will send.
    //   ok      -> HLS playlist / DASH manifest / media bytes  -> listed first
    //   unknown -> 401/403/429/timeout (often an IP/region block that works on a phone)
    //              -> kept after the verified ones, labelled "(may not play)"
    //   dead    -> 404/410/451/5xx, DNS failure, HTML error page -> dropped
    function __tjDeadline(promise, ms) {
        return new Promise(function (resolve) {
            const t = setTimeout(function () { resolve(null); }, ms);
            Promise.resolve(promise).then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(null); });
        });
    }
    async function __tjProbe(s) {
        const u = String((s && s.url) || "");
        if (!/^https?:\/\//i.test(u)) return "ok"; // magnet:, magic_m3u8:, MAGIC_PROXY… resolved by the app
        const h = Object.assign({}, s.headers || {}, { "Range": "bytes=0-2047" });
        const r = await __tjDeadline(http_get(u, h), 9000);
        if (!r) return "unknown";
        const st = Number(r.status || r.statusCode || 0);
        const body = String(r.body || "").replace(/^\uFEFF/, "").replace(/^\s+/, "").slice(0, 600);
        if (st === 200 || st === 206) {
            if (/^#EXTM3U/.test(body) || /<MPD[\s>]/i.test(body)) return "ok";
            if (/^<(!doctype|html|head|body)/i.test(body)) return "dead";
            if (/^PK\u0003\u0004|^Rar!\u001a|^7z\u00bc\u00af/.test(body)) return "dead"; // ZIP/RAR/7z archive, not a video
            return "ok";
        }
        if (st === 0) {
            const err = String(r.error || "");
            // The app refuses bodies over 8 MB (it hangs up on the Content-Length):
            // a server that ignores Range and sends a huge body is serving the file.
            if (/too ?large|exceed/i.test(err)) return "ok";
            return /host lookup|ENOTFOUND|getaddrinfo|No address/i.test(err) ? "dead" : "unknown";
        }
        if (st === 401 || st === 403 || st === 426 || st === 427 || st === 429) return "unknown"; // 427 = MhPly proxy passing on the CDN's rate limit
        return "dead";
    }
    async function verifyStreams(list, maxUnverified) {
        const verdicts = await Promise.all(list.map(__tjProbe));
        const ok = [], unknown = [];
        list.forEach(function (s, i) {
            if (verdicts[i] === "ok") ok.push(s);
            else if (verdicts[i] === "unknown") unknown.push(s);
        });
        const keep = unknown.slice(0, Math.max(0, (maxUnverified == null ? 4 : maxUnverified) - Math.min(ok.length, 2)));
        keep.forEach(function (s) { s.source = String(s.source || "Stream") + " (may not play)"; });
        return ok.concat(keep);
    }

    // ─── vidstuck.cc = zxcstream.com's "Main Server" (its own ad-free player) ───
    // zxcstream.com/watch/<type>/<id> embeds vidstuck.cc/embed/... Its player asks the
    // vidstuck backend two things per server:
    //   POST /backend/qwerty {id,type,server[,s,e]}            -> { ts, token }
    //   GET  /backend/servers/<server>?id&type&server&ts&token&title&year&date[...]
    // Field names are obfuscated (map below, from their bundle) and every link comes back
    // CryptoJS-AES encrypted with a fixed passphrase. The backend wants a browser
    // User-Agent plus Origin (Cloudflare answers "error code: 1010" without them).
    //
    // RATE LIMIT: vidstuck.cc allows about 20 requests per 10 seconds per user, and that
    // counts the API calls, the app's link checks and the player's first requests. Going
    // over it gets HTTP 429 for 10 s, which made most servers "fail". So this plugin keeps
    // its vidstuck traffic small: one token per server (reused for the Hindi dub), only the
    // servers that give different files, no extra link checks on vidstuck links, and a
    // 15-minute cache per episode.
    // Servers used: Orion (MovieBox DASH, original audio + Hindi dub), Atlas (HLS via
    // vidstuck's edge), Daedalus (direct HLS, H.264). Andromeda returns the same MovieBox
    // file as Orion, so it is only asked when Orion has nothing. Ursa's upstream answers
    // 403 to every video segment, so it is left out.
    const VS = "https://vidstuck.cc";
    const VS_PASS = "7f4c9e2a81d63b05c4f7a9e8126d3b50e1a8c7f23d9465ab0c6e9f1d4a7b832c";
    const F = {
        id: "a7f39c821d604e5b91e547b", type: "c81b306d28147a35632e816b", path: "6b491e258d392e7561a9384c",
        s: "d8427b5c38a2f957c3613e85b", e: "91c6ea753d1f785c92346b713d", ts: "61d9a5274c8e3b2f38c291e6",
        token: "c492f7a183d01e436c538a716d", title: "5e28c9147a06d1e29f3674b392a1", year: "b731e6c94f8675f8341c306e",
        date: "e164931a39e5814b3027", latest: "e9543416ad739e5814b3027", imdb: "f35a81943265e871c4933a725f"
    };
    const SV = {
        orion:     { id: "orion",     name: "Orion" },
        andromeda: { id: "andromeda", name: "Andromeda" },
        atlas:     { id: "atlas",     name: "Atlas" },
        daedalus:  { id: "daedalus",  name: "Daedalus" }
    };

    // API calls: browser identity + Origin. Video links: User-Agent + Referer only, so the
    // player (libVLC sends only those two) opens them directly, without the app's proxy.
    function vsHeaders(json) {
        const h = { "User-Agent": UA, "Origin": VS, "Referer": VS + "/", "Accept": "application/json, text/plain, */*" };
        if (json) h["Content-Type"] = "application/json";
        return h;
    }
    const PLAY_HEADERS = { "User-Agent": UA, "Referer": VS + "/" };

    // ── CryptoJS AES (passphrase / OpenSSL KDF) decrypt ──
    function md5Raw(msg) {
        const n = msg.length, words = [];
        for (let i = 0; i < n; i++) words[i >> 2] = (words[i >> 2] || 0) | (msg.charCodeAt(i) << ((i % 4) << 3));
        words[n >> 2] = (words[n >> 2] || 0) | (0x80 << ((n % 4) << 3));
        const wl = (((n + 8) >> 6) + 1) << 4;
        for (let i = 0; i < wl; i++) words[i] = words[i] || 0;
        words[wl - 2] = n << 3;
        const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22, 5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
                   4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23, 6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
        function rl(v, c) { return (v << c) | (v >>> (32 - c)); }
        let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        for (let i = 0; i < wl; i += 16) {
            const M = words.slice(i, i + 16), oa = a, ob = b, oc = c, od = d;
            for (let j = 0; j < 64; j++) {
                let f, g;
                if (j < 16)      { f = (b & c) | (~b & d); g = j; }
                else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
                else if (j < 48) { f = b ^ c ^ d;          g = (3 * j + 5) % 16; }
                else             { f = c ^ (b | ~d);       g = (7 * j) % 16; }
                const tmp = d; d = c; c = b;
                const K = Math.floor(Math.abs(Math.sin(j + 1)) * 4294967296);
                b = (b + rl(((a + f + K + M[g]) | 0), S[j])) | 0;
                a = tmp;
            }
            a = (a + oa) | 0; b = (b + ob) | 0; c = (c + oc) | 0; d = (d + od) | 0;
        }
        const out = [];
        [a, b, c, d].forEach(function (w) { for (let j = 0; j < 4; j++) out.push((w >> (j * 8)) & 255); });
        return out;
    }
    function bytesToB64(bytes) {
        const C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let o = "";
        for (let i = 0; i < bytes.length; i += 3) {
            const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
            o += C[b1 >> 2] + C[((b1 & 3) << 4) | (b2 === undefined ? 0 : b2 >> 4)];
            o += b2 === undefined ? "=" : C[((b2 & 15) << 2) | (b3 === undefined ? 0 : b3 >> 6)];
            o += b3 === undefined ? "=" : C[b3 & 63];
        }
        return o;
    }
    async function vsDecrypt(b64) {
        try {
            const bin = atob(String(b64 || "").replace(/\s+/g, ""));
            if (bin.slice(0, 8) !== "Salted__") return "";
            const salt = bin.slice(8, 16), pass = VS_PASS;
            let d = [], prev = [];
            while (d.length < 48) {
                prev = md5Raw(String.fromCharCode.apply(null, prev) + pass + salt);
                d = d.concat(prev);
            }
            const ct = [];
            for (let i = 16; i < bin.length; i++) ct.push(bin.charCodeAt(i));
            const plain = await crypto.decryptAES(bytesToB64(ct), bytesToB64(d.slice(0, 32)), bytesToB64(d.slice(32, 48)), { mode: "cbc" });
            return String(plain || "").trim();
        } catch (e) { return ""; }
    }

    // TMDB facts the vidstuck player sends along (title, year, release date, imdb id).
    async function mediaInfo(p) {
        const d = await tmdb("/" + p.type + "/" + p.id + "?append_to_response=external_ids");
        if (!d || !d.id) return { title: p.title || "", year: "", date: "", latest: "", imdb: "" };
        const date = (p.type === "movie" ? d.release_date : d.first_air_date) || "";
        return {
            title: d.title || d.name || p.title || "",
            year: date ? date.slice(0, 4) : "",
            date: date,
            latest: p.type === "tv" ? (d.last_air_date || "") : "",
            imdb: d.imdb_id || ((d.external_ids || {}).imdb_id) || "",
            runtime: d.runtime || ((d.episode_run_time || [])[0]) || null
        };
    }

    function qs(o) {
        return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== null && o[k] !== ""; })
            .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(String(o[k])); }).join("&");
    }

    function sleep(ms) { return new Promise(function (r) { if (typeof setTimeout === "function") setTimeout(r, ms); else r(); }); }

    // vidstuck requests skip the network guard: its rate-limit answer (429, a Cloudflare
    // "Access denied" page) is not a block, and must not be reported as one.
    const VS_STATE = { limited: 0, netErr: "" };
    // Self-throttle: at most 12 vidstuck requests per 10 s from this plugin, so the app's
    // own link check and the player's first requests still fit under the ~20 / 10 s limit
    // (matters when several episodes are opened one after another).
    const VS_TIMES = [];
    async function vsSlot() {
        for (let guard = 0; guard < 30; guard++) {
            const now = Date.now();
            while (VS_TIMES.length && now - VS_TIMES[0] > 10000) VS_TIMES.shift();
            if (VS_TIMES.length < 12) { VS_TIMES.push(now); return; }
            await sleep(10050 - (now - VS_TIMES[0]));
        }
    }
    async function vsReq(method, url, body) {
        for (let i = 0; i < 2; i++) {
            await vsSlot();
            const call = method === "POST" ? __ngRawPost(url, vsHeaders(true), body) : __ngRawGet(url, vsHeaders(false));
            const r = await withTimeout(Promise.resolve(call), method === "POST" ? 12000 : 15000).catch(function (e) { return { status: 0, error: String((e && e.message) || e) }; });
            const st = Number((r && (r.status || r.statusCode)) || 0);
            if (st === 429 || st === 503) {
                VS_STATE.limited = Date.now();
                if (i === 0) {
                    const ra = parseInt(((r && r.headers) || {})["retry-after"] || ((r && r.headers) || {})["Retry-After"] || "10", 10);
                    await sleep(Math.min(Math.max(ra || 10, 3), 11) * 1000 + Math.floor(Math.random() * 800));
                    continue;
                }
            }
            if (st === 0) VS_STATE.netErr = String((r && r.error) || "connection failed");
            return r;
        }
        return null;
    }

    // One token per server and episode; vidstuck accepts it again for the same server
    // (Orion's original audio and its Hindi dub share one).
    const TOKENS = {};
    async function vsToken(p, path) {
        const key = [p.type, p.id, p.s || 0, p.e || 0, path].join(":");
        const c = TOKENS[key];
        if (c && Date.now() - c.t < 4 * 60000) return c.tk;
        const body = {}; body[F.id] = String(p.id); body[F.type] = p.type; body[F.path] = path;
        if (p.type === "tv") { body[F.s] = Number(p.s) || 1; body[F.e] = Number(p.e) || 1; }
        const r = await vsReq("POST", VS + "/backend/qwerty", JSON.stringify(body));
        if (!r || Number(r.status) >= 400 || !r.body) return null;
        let tk = null;
        try { tk = JSON.parse(r.body); } catch (_) {}
        if (!tk || !tk.token) return null;
        TOKENS[key] = { t: Date.now(), tk: tk };
        return tk;
    }

    // One vidstuck source / subtitle request. Returns the parsed JSON (links decrypted) or null.
    async function vsCall(p, info, path, endpoint, dub, retried) {
        try {
            const tk = await vsToken(p, path);
            if (!tk) return null;
            const q = {};
            q[F.id] = String(p.id); q[F.path] = path; q[F.type] = p.type; q[F.ts] = String(tk.ts); q[F.token] = tk.token;
            q[F.title] = info.title; q[F.year] = info.year; q[F.date] = info.date;
            if (p.type === "tv") { q[F.s] = String(Number(p.s) || 1); q[F.e] = String(Number(p.e) || 1); if (info.latest) q[F.latest] = info.latest; }
            if (dub) { q.dubCode = dub; q.dubType = "0"; }
            if (info.imdb && endpoint !== "subtitle") q[F.imdb] = info.imdb;
            const url = VS + (endpoint === "subtitle" ? "/backend/subtitle?" : "/backend/servers/" + path + "?") + qs(q);
            let r2 = await vsReq("GET", url);
            if (r2 && Number(r2.status) === 401) { // token expired: fetch a fresh one once
                delete TOKENS[[p.type, p.id, p.s || 0, p.e || 0, path].join(":")];
                return retried ? null : vsCall(p, info, path, endpoint, dub, true);
            }
            if (!r2 || Number(r2.status) >= 400 || !r2.body) return null;
            const j = JSON.parse(r2.body);
            if (j && Array.isArray(j.links)) {
                const dec = await Promise.all(j.links.map(function (l) { return vsDecrypt(l && l.link); }));
                j.links = j.links.map(function (l, i) { return Object.assign({}, l, { link: dec[i] }); })
                    .filter(function (l) { return l.link && /^(https?:\/\/|\/)/.test(l.link); })
                    .map(function (l) { return Object.assign(l, { link: l.link.charAt(0) === "/" ? VS + l.link : l.link }); });
            }
            return j;
        } catch (e) { return null; }
    }

    function qualityFromHeight(v) {
        if (v >= 1800) return "4K";
        if (v >= 900) return "1080p";
        if (v >= 600) return "720p";
        if (v >= 420) return "480p";
        if (v >= 300) return "360p";
        return "Auto";
    }
    function qualityFrom(l) {
        const m = String((l && l.link) || "").match(/\/(2160|1080|720|480|360)\//);
        // Daedalus labels three qualities on one 720p file: trust the path
        return qualityFromHeight(m ? parseInt(m[1], 10) : parseInt(l && l.resolution, 10));
    }

    // Reads a DASH manifest once: its best height (for the quality label the app sorts on)
    // and whether it really is a manifest. MovieBox video segments are HEVC.
    async function mpdInfo(url) {
        const r = await vsReq("GET", url);
        const body = String((r && r.body) || "");
        if (!r || Number(r.status) >= 400 || !/<MPD[\s>]/i.test(body)) return null;
        let best = 0;
        body.replace(/<Representation[^>]*\bheight="(\d+)"/g, function (_, h) { best = Math.max(best, parseInt(h, 10) || 0); return _; });
        return { q: qualityFromHeight(best) };
    }

    const STREAM_CACHE = {};

    async function loadStreams(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized ZXCStream url" });
            const ckey = [p.type, p.id, p.s || 0, p.e || 0].join(":");
            const hit = STREAM_CACHE[ckey];
            if (hit && Date.now() - hit.t < 15 * 60000) return cb({ success: true, data: hit.data });
            VS_STATE.limited = 0; VS_STATE.netErr = "";

            const info = await mediaInfo(p);
            // (no subtitle request: it costs two more vidstuck calls, and the app has its
            // own subtitle search in the player)
            const atlasP = vsCall(p, info, "atlas", "servers");
            const daedP = vsCall(p, info, "daedalus", "servers");

            // Orion first; its Hindi dub (same token) when Orion lists one. Andromeda only as
            // a stand-in when Orion has nothing (it serves the same MovieBox file).
            function empty(j) { return !j || j.success === false || !(j.links || []).length; }
            let orion = await vsCall(p, info, "orion", "servers");
            let mainSv = SV.orion;
            // Orion's first lookup of a title sometimes comes back empty: one more try costs a
            // single request (the token is reused)
            if (empty(orion)) { await sleep(1500); orion = await vsCall(p, info, "orion", "servers"); }
            if (empty(orion)) {
                orion = await vsCall(p, info, "andromeda", "servers");
                mainSv = SV.andromeda;
            }
            const hasHindi = mainSv === SV.orion && ((orion && orion.dubs) || []).some(function (d) {
                return d && !d.original && Number(d.type) === 0 && String(d.lanCode || d.lang) === "hi";
            });
            const hindi = hasHindi ? await vsCall(p, info, "orion", "servers", "hi") : null;
            const res = await Promise.all([atlasP, daedP]);
            const atlas = res[0], daed = res[1];

            function firstLink(j) { return (j && j.success !== false && (j.links || [])[0]) || null; }
            const out = [];
            function push(link, label, q, needsCheck) {
                if (!link || !link.link || out.some(function (s) { return s.url === link.link; })) return;
                if (q && q !== "Auto") label += " [" + q + "]";
                const st = mkStream({ url: link.link, source: label, quality: q || "Auto", headers: PLAY_HEADERS });
                st.__check = !!needsCheck;
                out.push(st);
            }

            // DASH manifests: read once for the quality label (also proves they answer)
            const hiL = firstLink(hindi), orL = firstLink(orion);
            const mi = await Promise.all([hiL ? mpdInfo(hiL.link) : null, orL ? mpdInfo(orL.link) : null]);
            if (hiL && mi[0]) push(hiL, "Orion - Hindi Dub", mi[0].q);
            if (orL && mi[1]) push(orL, mainSv.name + (mainSv === SV.orion ? " - Original Audio" : ""), mi[1].q);
            // Daedalus: direct H.264 HLS, not on vidstuck (works on phones without HEVC)
            const dl = firstLink(daed);
            if (dl) push(dl, "Daedalus", qualityFrom(dl), true);
            ((atlas && atlas.success !== false && atlas.links) || []).slice(0, 2).forEach(function (l, i) {
                push(l, "Atlas" + (i ? " #2" : ""), qualityFrom(l));
            });

            // Only links that are not on vidstuck are checked here (a check there costs part of
            // the rate limit the player needs); vidstuck links were just issued.
            const toCheck = out.filter(function (s) { return s.__check; });
            const checked = toCheck.length ? await verifyStreams(toCheck, 1) : [];
            const final = out.filter(function (s) { return !s.__check || checked.indexOf(s) >= 0; });
            final.forEach(function (s) { try { delete s.__check; } catch (_) {} });

            if (!final.length) {
                let msg = "No ZXCStream server has this " + (p.type === "tv" ? "episode" : "movie") + " right now. Try again later.";
                if (VS_STATE.limited) msg = "ZXCStream's server (vidstuck.cc) is limiting requests right now. Wait 15 seconds and try again.";
                else if (VS_STATE.netErr) msg = "Could not reach ZXCStream's server vidstuck.cc (" + VS_STATE.netErr + "). If it works with a VPN, your network blocks it.";
                return cb({ success: false, errorCode: "NO_STREAMS", message: msg });
            }
            STREAM_CACHE[ckey] = { t: Date.now(), data: final };
            cb({ success: true, data: final });
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
