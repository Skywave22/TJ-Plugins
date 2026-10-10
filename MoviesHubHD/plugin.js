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


    // MoviesHubHD (movieshubhd.com) - a TMDB-based streaming site.
    //   catalog : the site's own TMDB proxy (/api/tmdb?endpoint=...), direct TMDB as fallback
    //   streams : the site's player network. Most of its 15 embeds are iframes that SkyStream
    //             cannot play (or are dead, Cloudflare-walled, Turnstile/WASM-locked). Its
    //             NontonGo server is backed by the VidNest player, whose JSON API hands out
    //             direct HLS/MP4 links from several providers, so that is what this plugin uses.

    const SITE = (typeof manifest !== "undefined" && manifest && manifest.baseUrl ? String(manifest.baseUrl) : "https://www.movieshubhd.com").replace(/\/+$/, "");
    const TMDB = "https://api.themoviedb.org/3";
    const IMG = "https://image.tmdb.org/t/p";
    const KEY = "439c478a771f35c05022f9feabcca01c"; // repo-wide public TMDB key (fallback only)
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

    function parseJson(res) {
        if (!res || !res.body || Number(res.status) >= 400) return null;
        try { const j = JSON.parse(res.body); return j && typeof j === "object" ? j : null; } catch (e) { return null; }
    }

    // TMDB through the site's proxy first (what movieshubhd.com itself uses), then TMDB directly.
    let proxyBad = 0;
    async function tmdb(path) {
        const q = path.indexOf("?");
        const ep = q >= 0 ? path.slice(0, q) : path;
        const rest = q >= 0 ? "&" + path.slice(q + 1) : "";
        if (proxyBad < 3) {
            const r = await withTimeout(http_get(SITE + "/api/tmdb?endpoint=" + encodeURIComponent(ep) + rest, { "User-Agent": UA, "Referer": SITE + "/" }), 12000).catch(function () { return null; });
            const j = parseJson(r);
            if (j && !j.status_code && !j.error) { proxyBad = 0; return j; }
            proxyBad++;
        }
        const sep = q >= 0 ? "&" : "?";
        const r2 = await withTimeout(http_get(TMDB + path + sep + "api_key=" + KEY + "&language=en-US", { "User-Agent": UA }), 12000).catch(function () { return null; });
        return parseJson(r2);
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
        // a site link: https://www.movieshubhd.com/details/<id>?type=movie|tv
        const m = s.match(/\/details\/(\d+)(?:\?[^#]*type=(movie|tv))?/);
        if (m) return { type: m[2] || "movie", id: parseInt(m[1], 10), title: "" };
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
    // The rows of movieshubhd.com's home page ("Trending" is the hero carousel).
    const ROWS = [
        { name: "Trending",            path: "/trending/all/week" },
        { name: "Latest Releases",     path: "/movie/now_playing", t: "movie" },
        { name: "Hindi Movies",        path: "/discover/movie?with_original_language=hi&sort_by=popularity.desc", t: "movie" },
        { name: "Top Rated Movies",    path: "/movie/top_rated", t: "movie" },
        { name: "Top Rated TV Series", path: "/tv/top_rated", t: "tv" },
        { name: "Popular TV Series",   path: "/tv/popular", t: "tv" },
        { name: "Action",              path: "/discover/movie?with_genres=28&sort_by=popularity.desc", t: "movie" },
        { name: "Comedy",              path: "/discover/movie?with_genres=35&sort_by=popularity.desc", t: "movie" },
        { name: "Drama",               path: "/discover/movie?with_genres=18&sort_by=popularity.desc", t: "movie" },
        { name: "Horror",              path: "/discover/movie?with_genres=27&sort_by=popularity.desc", t: "movie" },
        { name: "Romance",             path: "/discover/movie?with_genres=10749&sort_by=popularity.desc", t: "movie" },
        { name: "Science Fiction",     path: "/discover/movie?with_genres=878&sort_by=popularity.desc", t: "movie" },
        { name: "Thriller",            path: "/discover/movie?with_genres=53&sort_by=popularity.desc", t: "movie" },
        { name: "Animation",           path: "/discover/movie?with_genres=16&sort_by=popularity.desc", t: "movie" }
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
            if (!Object.keys(data).length) return cb({ success: false, errorCode: "UNAVAILABLE", message: "MoviesHubHD catalog returned no content" });
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
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized MoviesHubHD url" });
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

    // ─── VidNest player API (behind the site's NontonGo server) ───
    // GET https://new.vidnest.fun/<provider>/movie/<tmdb>  |  /<provider>/tv/<tmdb>/<s>/<e>
    // -> {"encrypted":true,"data":"<base64 with a shuffled alphabet>"} -> provider JSON.
    const VN_API = "https://new.vidnest.fun";
    const VN_ALPHA = "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/";
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    // the player's own HLS relays, used for providers that return relative /hls/... paths
    const VN_RELAYS = [
        "https://long-night-d802.streamed-5.workers.dev",
        "https://blue-bush-5977.streamed-7.workers.dev",
        "https://rapid-heart-03c8.streamed-4.workers.dev",
        "https://super-flower-9c85.streamed-2.workers.dev",
        "https://flat-sky-cf20.streamed-850.workers.dev",
        "https://vidrift-cf.streamed-8.workers.dev"
    ];
    // provider path -> server name shown in the app (the player's own names)
    const VN_PROVIDERS = [
        { path: "allmovies",          name: "Lamda" },
        { path: "nextgencloudfabric", name: "Zeta" },
        { path: "onehd",              name: "Alfa" },
        { path: "flixhq",             name: "Beta" },
        { path: "rpmvid",             name: "Prime" },
        { path: "vidzee",             name: "Gama" }
    ];

    function utf8Decode(bytes) {
        let out = "", i = 0;
        while (i < bytes.length) {
            const c = bytes[i++];
            if (c < 0x80) out += String.fromCharCode(c);
            else if (c < 0xE0) out += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i++] & 0x3F));
            else if (c < 0xF0) out += String.fromCharCode(((c & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
            else {
                let cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F);
                cp -= 0x10000; out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
            }
        }
        return out;
    }

    function vnDecode(data) {
        const map = {};
        for (let i = 0; i < 64; i++) map[VN_ALPHA[i]] = i;
        const bytes = [];
        let buf = 0, bits = 0;
        for (let i = 0; i < data.length; i++) {
            const v = map[data[i]];
            if (v === undefined) continue; // '=' padding / junk
            buf = (buf << 6) | v; bits += 6;
            if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xFF); }
        }
        return utf8Decode(bytes);
    }

    async function vnFetch(prov, p) {
        const path = p.type === "movie" ? "/" + prov.path + "/movie/" + p.id : "/" + prov.path + "/tv/" + p.id + "/" + (p.s || 1) + "/" + (p.e || 1);
        const r = await withTimeout(http_get(VN_API + path, { "User-Agent": UA, "Referer": "https://vidnest.fun/", "Origin": "https://vidnest.fun" }), 14000).catch(function () { return null; });
        let j = parseJson(r);
        if (!j) return null;
        if (j.encrypted && typeof j.data === "string") {
            try { j = JSON.parse(vnDecode(j.data)); } catch (e) { return null; }
        }
        return j && typeof j === "object" ? j : null;
    }

    function cleanHeaders(h) {
        const out = {};
        Object.keys(h || {}).forEach(function (k) {
            const key = String(k).trim();
            if (/^(connection|accept|accept-encoding|host|content-length)$/i.test(key)) return;
            out[key] = String(h[k]).trim();
        });
        if (out.Origin) out.Origin = out.Origin.replace(/\/+$/, ""); // "https://x.com/" is not a valid Origin
        if (!out["User-Agent"]) out["User-Agent"] = UA;
        return out;
    }

    // relative /hls/... path -> first relay that answers with a playlist
    async function viaRelay(rel, start) {
        for (let k = 0; k < 3; k++) {
            const base = VN_RELAYS[(start + k) % VN_RELAYS.length];
            const u = base + rel;
            const r = await __tjDeadline(http_get(u, { "User-Agent": UA }), 9000);
            if (r && (Number(r.status) === 200 || Number(r.status) === 206) && /^\s*#EXTM3U/.test(String(r.body || ""))) return u;
        }
        return null;
    }

    function qualityOf(text) {
        const t = String(text || "");
        if (/\b(4k|2160p?)\b/i.test(t)) return "4K";
        const m = t.match(/\b(1080|720|480|360)p?\b/i);
        return m ? m[1] + "p" : "Auto";
    }
    function qRank(q) { return { "4K": 5, "1080p": 4, "720p": 3, "Auto": 3, "480p": 2, "360p": 1 }[q] || 0; }
    const HINDI = /hindi|\u0939\u093f\u0928\u094d\u0926\u0940/i;

    // provider JSON -> [{url, lang, quality, type, headers, subs}]
    function vnStreams(j) {
        const out = [];
        const top = j.headers || {};
        function add(x, fallbackHdr) {
            if (!x || !x.url) return;
            out.push({ url: String(x.url), lang: String(x.language || ""), quality: String(x.quality || ""), type: String(x.type || ""), headers: x.headers || fallbackHdr || {} });
        }
        if (j.url) add({ url: j.url, quality: j.quality, type: j.type }, top);
        (Array.isArray(j.streams) ? j.streams : []).forEach(function (x) { add(x, top); });
        (Array.isArray(j.sources) ? j.sources : []).forEach(function (x) { add(x, top); });
        if (j.data && j.data.stream && j.data.stream.playlist) add({ url: j.data.stream.playlist, type: "hls" }, top);
        return out;
    }

    async function loadStreams(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized MoviesHubHD url" });

            const answers = await Promise.all(VN_PROVIDERS.map(function (prov) {
                return vnFetch(prov, p).then(function (j) { return { prov: prov, j: j }; }, function () { return { prov: prov, j: null }; });
            }));

            const subs = [];
            const seenSub = {};
            const cands = [];
            let relayIdx = Math.floor(Math.random() * VN_RELAYS.length);
            const relayJobs = [];

            answers.forEach(function (a) {
                if (!a.j) return;
                // subtitles some providers return alongside the streams
                (Array.isArray(a.j.subtitles) ? a.j.subtitles : []).forEach(function (s) {
                    if (!s || !s.url) return;
                    const lang = String(s.lang || s.label || "Subtitle").replace(/\s+\d+$/, "").trim(); // "English 2" -> "English"
                    if (seenSub[lang]) return;
                    seenSub[lang] = 1;
                    let su = String(s.url);
                    if (!/^https?:/i.test(su)) su = VN_RELAYS[0] + (su.charAt(0) === "/" ? "" : "/") + su;
                    subs.push({ url: su, label: lang, lang: lang });
                });
                const per = {};
                vnStreams(a.j).slice(0, 6).forEach(function (x) {
                    const u = x.url;
                    if (/\/embed[\/.]|embed\.php/i.test(u)) return; // web player page, not a stream
                    const lang = x.lang.replace(/^original$/i, "").trim();
                    const q = qualityOf(x.quality + " " + u);
                    const isMp4 = /mp4|mkv/i.test(x.type) || /\.(mp4|mkv)(\?|$)/i.test(u.split("?")[0]);
                    let label = "MoviesHub " + a.prov.name;
                    if (lang) label += " - " + lang;
                    const tags = [];
                    if (q !== "Auto") tags.push(q);
                    if (isMp4) tags.push("MP4");
                    if (tags.length) label += " (" + tags.join(", ") + ")";
                    const n = (per[label] = (per[label] || 0) + 1);
                    if (n > 1) label += " #" + n;
                    if (n > 3) return; // the same file from mirror hosts - three is plenty
                    const cand = {
                        url: u, source: label, quality: q, headers: cleanHeaders(x.headers),
                        hindi: HINDI.test(lang) && !/sub/i.test(lang), multi: /multi|dual/i.test(lang), rank: qRank(q)
                    };
                    if (!/^https?:/i.test(u)) {
                        const rel = u.charAt(0) === "/" ? u : "/" + u;
                        const start = relayIdx++;
                        relayJobs.push(viaRelay(rel, start).then(function (abs) {
                            if (abs) { cand.url = abs; cand.headers = { "User-Agent": UA }; cand.relayed = true; cands.push(cand); }
                        }));
                        return;
                    }
                    cands.push(cand);
                });
            });
            await Promise.all(relayJobs);
            // one track per language, the useful ones first, at most 15
            const SUB_FIRST = ["English", "Hindi", "Urdu", "Arabic", "Bengali", "Tamil", "Telugu", "Malayalam", "Indonesian", "Malay", "Spanish", "French", "Portuguese", "Brazilian", "Turkish"];
            subs.sort(function (a, b) {
                const ia = SUB_FIRST.indexOf(a.label), ib = SUB_FIRST.indexOf(b.label);
                return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            });
            subs.splice(15);

            if (!cands.length) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "No MoviesHubHD server has this " + (p.type === "tv" ? "episode" : "movie") + " right now. Try again later." });
            }

            function byQ(a, b) { return b.rank - a.rank; }
            const hindi = cands.filter(function (c) { return c.hindi; }).sort(byQ);
            const multi = cands.filter(function (c) { return !c.hindi && c.multi; }).sort(byQ);
            const other = cands.filter(function (c) { return !c.hindi && !c.multi; });
            const ordered = hindi.concat(multi, other).map(function (c) {
                const st = mkStream({ url: c.url, source: c.source, quality: c.quality, headers: c.headers, subtitles: subs.length ? subs : undefined });
                st.__relayed = !!c.relayed;
                return st;
            });

            // relayed playlists were just fetched successfully - no need to probe them again
            const pre = ordered.filter(function (s) { return s.__relayed; });
            const rest = ordered.filter(function (s) { return !s.__relayed; });
            const checked = rest.length ? await verifyStreams(rest, 3) : [];
            const okSet = checked.concat(pre);
            const final = ordered.filter(function (s) { return okSet.indexOf(s) >= 0; });
            final.forEach(function (s) { try { delete s.__relayed; } catch (_) {} });

            if (!final.length) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "MoviesHubHD's servers returned links for this " + (p.type === "tv" ? "episode" : "movie") + ", but none of them is playing right now. Try again in a little while." });
            }
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
