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


    // Bingr (bingr.one) - a TMDB-based streaming site (movies, TV shows, anime).
    //   catalog : TMDB, with the rows of the site's home page
    //   streams : the watch page (/watch/movie/<tmdb>, /watch/tv/<tmdb>/<s>/<e>) carries a session token
    //             and the first server's sources as a "v1." payload (custom stream cipher, below).
    //             Every other server comes from /api/sources?kind=&t=<token>&provider=<id>&tmdb=&s=&e=,
    //             same payload format. Servers: Prism (multi-audio: Original/Hindi/Telugu/French..., from
    //             the MovieBox CDN through DASH->HLS bridges), Edge, Nimbus, Citadel (Hindi/Tamil/English...),
    //             Flux, Pulse, Volt. All links are plain HLS that play without special headers.

    const BASE = "https://bingr.one";
    const TMDB = "https://api.themoviedb.org/3";
    const IMG = "https://image.tmdb.org/t/p";
    const KEY = "439c478a771f35c05022f9feabcca01c"; // repo-wide public TMDB key
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

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

    function parseJson(res) {
        if (!res || !res.body || Number(res.status) >= 400) return null;
        try { const j = JSON.parse(res.body); return j && typeof j === "object" ? j : null; } catch (e) { return null; }
    }

    async function tmdb(path) {
        const sep = path.indexOf("?") >= 0 ? "&" : "?";
        const r = await withTimeout(http_get(TMDB + path + sep + "api_key=" + KEY + "&language=en-US", { "User-Agent": UA }), 14000).catch(function () { return null; });
        return parseJson(r);
    }

    function img(p, size) { return p ? IMG + "/" + (size || "w500") + p : ""; }
    function yearOf(d) { const m = String(d || "").match(/^(\d{4})/); return m ? parseInt(m[1], 10) : null; }
    function score(v) { return v ? Math.round(v * 10) / 10 : null; }
    function itemUrl(type, id, title) { return JSON.stringify({ type: type, id: id, title: title || "" }); }

    function parseUrl(url) {
        const s = String(url || "");
        try {
            const p = JSON.parse(s);
            if (p && p.id && (p.type === "movie" || p.type === "tv")) return p;
        } catch (e) {}
        // a site link: https://bingr.one/movie/<id>, /tv/<id>, /watch/movie/<id>, /watch/tv/<id>/<s>/<e>
        const m = s.match(/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/);
        if (m) return m[3] ? { type: "tv", id: parseInt(m[2], 10), s: parseInt(m[3], 10), e: parseInt(m[4], 10), title: "" } : { type: m[1], id: parseInt(m[2], 10), title: "" };
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
    // The rows of bingr.one's home page (its "endpoint" list is TMDB discover; anime rows use TMDB's
    // Japanese-animation filter instead of the site's AniList feed).
    const ANIME = "/discover/tv?with_genres=16&with_original_language=ja";
    const ROWS = [
        { name: "Trending",                   path: "/trending/all/week" },
        { name: "Popular Movies",             path: "/movie/popular", t: "movie" },
        { name: "Popular TV Shows",           path: "/tv/popular", t: "tv" },
        { name: "Blockbuster Action Movies",  path: "/discover/movie?with_genres=28&sort_by=popularity.desc", t: "movie" },
        { name: "Top Rated Movies",           path: "/discover/movie?sort_by=vote_average.desc&vote_count.gte=1000", t: "movie" },
        { name: "Top Rated TV Shows",         path: "/discover/tv?sort_by=vote_average.desc&vote_count.gte=500", t: "tv" },
        { name: "Top Rated Anime",            path: ANIME + "&sort_by=vote_average.desc&vote_count.gte=200", t: "tv" },
        { name: "Hindi Movies",               path: "/discover/movie?with_original_language=hi&sort_by=popularity.desc&vote_count.gte=20", t: "movie" },
        { name: "Spine-Chilling Horror",      path: "/discover/movie?with_genres=27&sort_by=popularity.desc", t: "movie" },
        { name: "Crime & Thriller Series",    path: "/discover/tv?with_genres=80,9648&sort_by=popularity.desc", t: "tv" },
        { name: "Sci-Fi & Fantasy Movies",    path: "/discover/movie?with_genres=878&sort_by=popularity.desc", t: "movie" },
        { name: "Action Anime",               path: ANIME + "&with_keywords=&sort_by=popularity.desc", t: "tv" },
        { name: "Heartwarming Romance",       path: "/discover/movie?with_genres=10749&sort_by=popularity.desc", t: "movie" },
        { name: "Binge-Worthy Comedy Series", path: "/discover/tv?with_genres=35&sort_by=popularity.desc", t: "tv" }
    ];

    async function getHome(cb) {
        try {
            const lists = await Promise.all(ROWS.map(function (row) {
                return withTimeout(tmdb(row.path + (row.path.indexOf("?") >= 0 ? "&" : "?") + "page=1"), 25000).catch(function () { return null; });
            }));
            const data = {};
            ROWS.forEach(function (row, i) {
                const res = (lists[i] && lists[i].results) || [];
                const items = res.map(function (r) { return toItem(r, row.t); }).filter(Boolean);
                if (items.length) data[row.name] = items;
            });
            if (!Object.keys(data).length) return cb({ success: false, errorCode: "UNAVAILABLE", message: "Bingr catalog returned no content" });
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
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized Bingr url" });
            const extra = "?append_to_response=credits,videos,recommendations";

            if (p.type === "movie") {
                const d = await tmdb("/movie/" + p.id + extra);
                if (!d || !d.id) return cb({ success: false, errorCode: "NOT_FOUND", message: "Movie not found" });
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
            if (!d || !d.id) return cb({ success: false, errorCode: "NOT_FOUND", message: "Show not found" });
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
                            url: JSON.stringify({ type: "tv", id: d.id, s: sj.season_number, e: ep.episode_number, title: d.name }),
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
    //   ok      -> HLS playlist / media bytes                      -> listed first
    //   unknown -> 401/403/429/timeout (often a regional block)     -> kept last, "(may not play)"
    //   dead    -> 404/410/451/5xx, DNS failure, HTML error page    -> dropped
    function __tjDeadline(promise, ms) {
        return new Promise(function (resolve) {
            const t = setTimeout(function () { resolve(null); }, ms);
            Promise.resolve(promise).then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(null); });
        });
    }
    async function __tjProbe(s) {
        const u = String((s && s.url) || "");
        if (!/^https?:\/\//i.test(u)) return "ok";
        const h = Object.assign({}, s.headers || {}, { "Range": "bytes=0-2047" });
        const r = await __tjDeadline(http_get(u, h), 9000);
        if (!r) return "unknown";
        const st = Number(r.status || r.statusCode || 0);
        const body = String(r.body || "").replace(/^\uFEFF/, "").replace(/^\s+/, "").slice(0, 600);
        if (st === 200 || st === 206) {
            if (/^#EXTM3U/.test(body)) {
                // a master playlist can be fine while its variants are gone (Citadel's proxy): check the first one
                if (/#EXT-X-STREAM-INF/i.test(body)) {
                    const lines = String(r.body || "").split(/\r?\n/);
                    let child = "";
                    for (let i = 0; i < lines.length; i++) { if (/^#EXT-X-STREAM-INF/i.test(lines[i])) { for (let j = i + 1; j < lines.length; j++) { const l = lines[j].trim(); if (l && l.charAt(0) !== "#") { child = l; break; } } break; } }
                    if (child) {
                        if (!/^https?:\/\//i.test(child)) child = child.charAt(0) === "/" ? u.replace(/^(https?:\/\/[^\/]+).*$/, "$1") + child : u.replace(/[?#].*$/, "").replace(/[^\/]*$/, "") + child;
                        const cr = await __tjDeadline(http_get(child, s.headers || {}), 9000);
                        if (cr) {
                            const cs = Number(cr.status || cr.statusCode || 0);
                            if (cs === 404 || cs === 410 || cs >= 500) return "dead";
                            if ((cs === 200 || cs === 206) && !/^\s*#EXTM3U/.test(String(cr.body || ""))) return "dead";
                        }
                    }
                }
                return "ok";
            }
            if (/<MPD[\s>]/i.test(body)) return "ok";
            if (/^<(!doctype|html|head|body)/i.test(body)) return "dead";
            return "ok";
        }
        if (st === 0) {
            const err = String(r.error || "");
            if (/too ?large|exceed/i.test(err)) return "ok";
            return /host lookup|ENOTFOUND|getaddrinfo|No address/i.test(err) ? "dead" : "unknown";
        }
        if (st === 401 || st === 403 || st === 426 || st === 429) return "unknown";
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

    // ─── Bingr payload: "v1." + base64url(iv[12] | data), data XOR-ed with a keystream ───
    // keystream: 4 x FNV-1a(seed_n, key + iv) as state, then an sfc32-style generator, one 32-bit word
    // per 4 bytes (little-endian). Ported from the site's player (module "D").
    const BK = "vY7#qL2!mZ9@wK4$";
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function b64Bytes(s) {
        s = String(s).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+\/]/g, "");
        const out = new Uint8Array(Math.floor(s.length * 3 / 4));
        let bits = 0, acc = 0, o = 0;
        for (let i = 0; i < s.length; i++) {
            acc = (acc << 6) | B64.indexOf(s.charAt(i)); bits += 6;
            if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
        }
        return out.subarray(0, o);
    }
    function utf8Text(b) {
        let s = "", i = 0;
        while (i < b.length) {
            let c = b[i++];
            if (c >= 0xf0 && i + 2 < b.length + 1) { c = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); continue; }
            if (c >= 0xe0) c = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
            else if (c >= 0xc0) c = ((c & 31) << 6) | (b[i++] & 63);
            s += String.fromCharCode(c);
        }
        return s;
    }
    function bingrDecode(payload) {
        const p = String(payload || "").trim();
        if (p.indexOf("v1.") !== 0) throw new Error("bad payload");
        const all = b64Bytes(p.slice(3)), iv = all.subarray(0, 12), d = new Uint8Array(all.subarray(12));
        const st = [];
        for (let n = 0; n < 4; n++) {
            let l = (0x811c9dc5 ^ Math.imul(0x9e3779b9, n)) >>> 0;
            for (let x = 0; x < BK.length; x++) l = Math.imul(l ^ BK.charCodeAt(x), 0x1000193) >>> 0;
            for (let x = 0; x < iv.length; x++) l = Math.imul(l ^ iv[x], 0x1000193) >>> 0;
            st.push(l);
        }
        let a = st[0], b = st[1], c = st[2], dd = st[3], k = 0;
        for (let t = 0; t < d.length; t++) {
            if ((t & 3) === 0) {
                c >>>= 0; dd >>>= 0;
                let e = ((a >>>= 0) + (b >>>= 0)) | 0;
                a = b ^ (b >>> 9);
                b = (c + (c << 3)) | 0;
                c = (c << 21) | (c >>> 11);
                dd = (dd + 1) | 0;
                e = (e + dd) | 0;
                c = (c + e) | 0;
                k = e >>> 0;
            }
            d[t] ^= (k >>> ((t & 3) * 8)) & 255;
        }
        const txt = utf8Text(d);
        return JSON.parse(txt.slice(0, txt.lastIndexOf("}") + 1));
    }

    // Next.js streams its page data as self.__next_f.push([1,"..."]) string chunks
    function rscText(html) {
        let out = "";
        const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\[\s\S])*)"\]\)/g;
        let m;
        while ((m = re.exec(html))) { try { out += JSON.parse('"' + m[1] + '"'); } catch (_) {} }
        return out;
    }

    function watchUrl(p) { return BASE + (p.type === "tv" ? "/watch/tv/" + p.id + "/" + (p.s || 1) + "/" + (p.e || 1) : "/watch/movie/" + p.id); }

    async function bingrSession(p) {
        const page = watchUrl(p);
        const r = await withTimeout(http_get(page, { "User-Agent": UA, "Accept": "text/html,*/*" }), 20000);
        if (!r || Number(r.status) >= 400) throw new Error("watch page " + (r ? r.status : "timeout"));
        const rsc = rscText(String(r.body || ""));
        const token = (rsc.match(/"token":"([^"]+)"/) || [])[1] || "";
        const blob = (rsc.match(/v1\.[A-Za-z0-9_-]{60,}/) || [])[0];
        let first = null;
        if (blob) { try { first = bingrDecode(blob); } catch (_) {} }
        return { page: page, token: token, first: first, servers: (first && first.servers) || [] };
    }

    async function bingrServer(p, sess, id) {
        const q = ["kind=" + (p.type === "tv" ? "tv" : "movie"), "t=" + encodeURIComponent(sess.token), "provider=" + encodeURIComponent(id), "tmdb=" + p.id];
        if (p.type === "tv") q.push("s=" + (p.s || 1), "e=" + (p.e || 1));
        const r = await withTimeout(http_get(BASE + "/api/sources?" + q.join("&"), { "User-Agent": UA, "Referer": sess.page, "Accept": "*/*" }), 16000);
        if (!r || Number(r.status) >= 400) return null;
        try { return bingrDecode(r.body); } catch (_) { return null; }
    }

    const LANG_NAMES = { ptbr: "Portuguese (BR)", "pt-br": "Portuguese (BR)", esla: "Spanish (Latin America)", "es-la": "Spanish (Latin America)", ar: "Arabic", hi: "Hindi", en: "English" };
    const LANG_ORDER = ["hindi", "multi", "original", "english", "tamil", "telugu", "kannada", "malayalam", "bengali"];
    function langRank(l) { const i = LANG_ORDER.indexOf(String(l || "").toLowerCase().split(" ")[0]); return i < 0 ? LANG_ORDER.length : i; }
    function qRank(q) { const m = String(q || "").match(/(\d{3,4})p/); return m ? parseInt(m[1], 10) : (/4k/i.test(q) ? 2160 : 600); }
    function qLabel(q) { const m = String(q || "").match(/(2160|1440|1080|720|576|480|360|240)p/i); return m ? m[1] + "p" : (/4k/i.test(q) ? "4K" : "Auto"); }

    function toStreams(j, fallbackLabel) {
        const server = (j && j.provider && j.provider.label) || fallbackLabel || "Server";
        return ((j && j.streams) || []).filter(function (s) { return s && /^https?:\/\//i.test(s.url || ""); }).map(function (s) {
            let lang = s.language && s.language !== "undefined" ? String(s.language) : "";
            lang = LANG_NAMES[lang.toLowerCase()] || lang;
            const subs = (s.subtitles || []).filter(function (x) { return x && x.url; }).slice(0, 24).map(function (x) {
                return { url: x.url, label: x.label || x.lang || "Subtitle", lang: x.lang || x.label || "" };
            });
            const headers = Object.assign({ "User-Agent": UA, "Referer": BASE + "/" }, (s.headers && typeof s.headers === "object") ? s.headers : {});
            const q = qLabel(s.quality);
            return { url: s.url, source: server + (lang ? " · " + lang : "") + (q !== "Auto" ? " · " + q : ""), quality: q, headers: headers, subtitles: subs, lang: lang, rank: qRank(s.quality) };
        });
    }

    async function loadStreams(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized Bingr url" });
            if (p.type === "tv" && !p.s) { p.s = 1; p.e = 1; }

            const sess = await bingrSession(p);
            if (!sess.token && !sess.first) return cb({ success: false, errorCode: "NO_STREAMS", message: "Bingr has no player for this " + (p.type === "tv" ? "episode" : "movie") + "." });

            const firstId = sess.first && sess.first.provider ? sess.first.provider.id : "";
            const others = sess.servers.filter(function (s) { return s && s.id && s.id !== firstId; });
            const results = await Promise.all(others.map(function (s) {
                return bingrServer(p, sess, s.id).then(function (j) { return toStreams(j, s.label); }).catch(function () { return []; });
            }));
            let cands = toStreams(sess.first);
            results.forEach(function (l) { cands = cands.concat(l); });
            const seen = {};
            cands = cands.filter(function (c) { if (seen[c.url]) return false; seen[c.url] = 1; return true; });
            if (!cands.length) return cb({ success: false, errorCode: "NO_STREAMS", message: "No Bingr server has this " + (p.type === "tv" ? "episode" : "movie") + " right now." });

            // Hindi first, then multi/original/English and the other dubs; best quality first inside each
            cands.sort(function (a, b) { return (langRank(a.lang) - langRank(b.lang)) || (b.rank - a.rank); });
            const list = cands.slice(0, 40).map(function (c) { return mkStream({ url: c.url, source: c.source, quality: c.quality, headers: c.headers, subtitles: c.subtitles }); });
            const final = await verifyStreams(list, 4);
            if (!final.length) return cb({ success: false, errorCode: "NO_STREAMS", message: "Bingr returned links, but none is playing right now. Try again in a little while." });
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
