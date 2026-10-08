(function (__ngRawGet, __ngRawPost) {
    "use strict";

    // ── network guard (TJ-Plugins shared helper) ─────────────────────────────────
    // Many internet providers block streaming sites, either with fake DNS answers or by
    // cutting the connection based on the site name. Then the plugin only works over a VPN.
    // This wraps this plugin's own http_get / http_post (never the shared globals):
    //   1. A request to the site that fails at network level (status 0: DNS failure,
    //      connection reset/refused, TLS cut, timeout), returns HTTP 451, or lands on an
    //      ISP block page is retried on the site's mirror domains. The first one that works
    //      is used for the rest of the session and remembered with setPreference.
    //   2. If nothing works, the error the user sees says the site is blocked on their
    //      network and how to get around it, instead of "no results" or a raw error.
    var __NG_MIRRORS = [];
    // group 0 = this site (manifest.baseUrl + manifest.domains + known mirrors); then shared APIs with official aliases
    var __NG = { get: __ngRawGet, post: __ngRawPost, groups: [[], ['https://api.themoviedb.org', 'https://api.tmdb.org']], active: {}, ready: null, fails: [] };
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
    var __NG_BLOCK_TEXT = /(has been|is|was) (blocked|restricted|disabled)|access (to this [a-z ]{0,20})?(is|has been) (denied|restricted|blocked)|blocked (as per|by order|under|by court|by the)|not available in your (country|region)|website (is )?blocked/i;
    var __NG_BLOCK_WHO = /court|order|government|ministry|authority|department|telecom|regulat|commission|law|legal|isp\b|internet service provider|operator/i;
    var __NG_BLOCK_HOST = /internetpositif|trustpositif|blockpage|block\.|blocked\.|warning\.or\.kr|lawfulblock|zapret|rkn\.gov|eais\.|safebrowse|surfsafe|netalerts/i;
    function __ngBad(r, reqUrl) {
        if (!r) return 'no response';
        var st = Number(r.status || r.statusCode || r.code || 0);
        if (st === 0) {
            var e = String(r.error || '');
            if (/cancel/i.test(e)) return '';
            return e || 'connection failed';
        }
        if (st === 451) return 'HTTP 451';
        var fin = String(r.finalUrl || '');
        if (fin && __ngHost(fin) !== __ngHost(reqUrl) && __NG_BLOCK_HOST.test(__ngHost(fin))) return 'ISP block page';
        var body = String(r.body || '');
        if (body.length < 40000 && __NG_BLOCK_TEXT.test(body) && __NG_BLOCK_WHO.test(body) && !/cloudflare/i.test(body)) return 'ISP block page';
        return '';
    }
    function __ngWhy(e) {
        e = String(e || '');
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
                if (o && o.base === __NG.groups[0][0] && o.active) {
                    Object.keys(o.active).forEach(function (g) {
                        var a = o.active[g];
                        if (__ngGroupOf(__ngHost(a)) === +g) __NG.active[g] = a;
                    });
                }
            } catch (_) {}
        })();
        return __NG.ready;
    }
    function __ngRemember(g, origin) {
        __NG.active[g] = origin;
        try { if (typeof setPreference === 'function') setPreference('tj_net_mirror', JSON.stringify({ base: __NG.groups[0][0], active: __NG.active })); } catch (_) {}
    }
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
    async function __ngCall(method, url, headers, body) {
        try {
            var r = method === 'POST' ? await __NG.post(url, headers, body) : await __NG.get(url, headers);
            return { r: r, err: null };
        } catch (e) {
            return { r: { status: 0, statusCode: 0, body: '', error: String((e && e.message) || e) }, err: e };
        }
    }
    async function __ngRequest(method, url, headers, body) {
        await __ngInit();
        var host = __ngHost(url), g = __ngGroupOf(host), mine = g >= 0;
        var target = url, h0 = headers, act = mine ? __NG.active[g] : '';
        if (act && __ngBare(__ngHost(act)) !== __ngBare(host)) {
            target = __ngSwap(url, act);
            h0 = __ngHeaders(headers, act);
        }
        var first = await __ngCall(method, target, h0, body);
        var bad = __ngBad(first.r, target);
        if (!bad) return first.r;
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
                if (hit) { __ngRemember(g, hit.o); return hit.r; }
            }
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
    // strong = the network itself refused the site (typical ISP block); weak = only timeouts (may just be a slow/down site)
    function __ngStrong(why) { return why !== 'timed out' && why !== 'connection failed'; }
    function __ngExplain(name, res, t0) {
        if (!res || res.success !== false) return res;
        var recent = __NG.fails.filter(function (f) { return f.t >= t0; });
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
                    '), usually by your internet provider - that is why it works with a VPN.' + tip };
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


    // ═══════════════════════════════════════════════════════════════════
    // CineJoy (cinejoy.pk) — SkyStream plugin v1
    //
    // Site architecture (2026-09):
    // - SvelteKit frontend, TMDB ids in URL /movie/{tmdbId}-{slug} and
    //   /series/{tmdbId}-{slug} + watch /watch/movie/{id} and
    //   /watch/tv/{id}/{s}/{e}
    // - TMDB key extracted from _app/immutable/chunks/BJh85vmL.js:
    //   8476a7ab80ad76f0936744df0430e67c (client-side)
    // - Stream API: GET https://api.wing.st/servers → 4 servers
    //   Nebula, Solara, Lisbon (4k), Athens — all status ok
    //   POST https://api.wing.st/g with encrypted binary body V(C[470])
    //   where C = UW(o,W,d) — JSON {path, payload} encrypted via
    //   Kotlin WASM GC /hls/b8f613c2e97aa394cfa5.wasm (36k) +
    //   /hls/hxqvpnrw.wasm (46k). The WASM uses
    //   kotlin.wasm.internal.* and legacy_exceptions, not runnable in
    //   Node 20 / wasmtime 49 without patching. Decrypt via jW().
    //   Playwright scraper (gauravsuman007) intercepts MASTER_PLAYLIST_RE
    //   /\.m3u8/ after 4000ms grace.
    //
    // Plugin strategy:
    // - Catalog/search/load use TMDB directly with CineJoy's own key,
    //   mirroring site's own source.
    // - loadStreams: Attempt wing.st servers list for labeling, but since
    //   WASM GC decryption cannot run in QuickJS, fallback to proven
    //   multi-source chain used by CineHD: VidLove JSON API
    //   (api.vidlove.cc), VidRock AES-GCM API (vidrock.net), NxSha
    //   CryptoJS-AES (nxsha.space). These return same content as CineJoy
    //   and are verified live 2026-09.
    // - Host order: HubCloud > StreamWish > StreamTape first, then all other verified servers;
    //   GDFlix/KatDrive/SendCM/1Fichier/Fast are skipped.
    // - Episode fix: 800/801/900/901 -> 1,2,3,4 via fixEpisode(e) = e>=800 ? (e%100)+1 + (floor(e/100)-8)*2 : e
    //   Applied in parseUrl() and load() episode building.
    // - No spoofed IP/country headers (Cloudflare answers them with 403).
    // ═══════════════════════════════════════════════════════════════════

    const TMDB = "https://api.themoviedb.org/3";
    const IMG = "https://image.tmdb.org/t/p";
    const KEY = "8476a7ab80ad76f0936744df0430e67c"; // CineJoy's own key from BJh85vmL.js
    const FALLBACK_KEY = "439c478a771f35c05022f9feabcca01c";
    const SITE = (typeof manifest !== "undefined" && manifest.baseUrl) ? manifest.baseUrl.replace(/\/+$/, "") : "https://cinejoy.pk";
    const WING = "https://api.wing.st";
    const VLA = "https://api.vidlove.cc";
    const PLAYER_REF = "https://player.vidlove.cc/";
    const VROCK = "https://vidrock.net";
    const NX_BASE = "https://nxsha.space";
    // AES passphrase from nxsha.space front-end bundle (rotated 2026-10).
    const NX_PASS = "f4488ab4da401203d23baa129fc546153898162524635d6776826d0c867ccaa3";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // Plain headers only: spoofed X-Forwarded-For / CF-Connecting-IP / True-Client-IP
    // don't change the caller's location, and Cloudflare answers them with HTTP 403.
    function mergeGeoHeaders(base) { return Object.assign({}, base || {}); }

    const GEO_HEADERS = {
        "User-Agent": UA,
        "Referer": SITE + "/",
        "Origin": SITE,
        "Accept-Language": "en-PK,en;q=0.9,ur-PK;q=0.8,en-US;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    };
    const STREAM_HEADERS = {
        "User-Agent": UA,
        "Referer": PLAYER_REF,
        "Origin": SITE,
        "Accept-Language": "en-PK,en;q=0.9,ur-PK;q=0.8",
        "Accept": "*/*",
    };

    function mkItem(o) { try { return new MultimediaItem(o); } catch (_) { return o; } }
    function mkEpisode(o) { try { return new Episode(o); } catch (_) { return o; } }
    function mkStream(o) { try { return new StreamResult(o); } catch (_) { return o; } }

    async function tmdb(path, useFallback) {
        const sep = path.indexOf("?") >= 0 ? "&" : "?";
        const key = useFallback ? FALLBACK_KEY : KEY;
        const res = await http_get(TMDB + path + sep + "api_key=" + key, { "User-Agent": UA, "Accept-Language": "en-PK,en;q=0.9,ur-PK;q=0.8" });
        if (!res || !res.body) {
            if (!useFallback) return tmdb(path, true);
            return null;
        }
        try { return JSON.parse(res.body); } catch (e) { return null; }
    }

    function poster(p, size) { return p ? IMG + "/" + (size || "w500") + p : ""; }
    function yearOf(d) { const m = String(d || "").match(/^(\d{4})/); return m ? parseInt(m[1], 10) : null; }
    function mediaTypeOf(r) {
        if (r.media_type === "movie" || r.media_type === "tv") return r.media_type;
        return r.first_air_date || r.name ? "tv" : "movie";
    }
    function tmdbToItem(r) {
        if (!r || !r.id) return null;
        const type = mediaTypeOf(r);
        const title = r.title || r.name || "Unknown";
        const url = JSON.stringify({ type: type, id: r.id, title: title });
        return mkItem({
            title: title,
            url: url,
            posterUrl: poster(r.poster_path, "w500"),
            bannerUrl: poster(r.backdrop_path, "w780"),
            type: type,
            year: yearOf(r.release_date || r.first_air_date),
            description: r.overview || "",
            score: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null
        });
    }

    function fixEpisode(e) {
        const n = parseInt(e, 10);
        if (isNaN(n)) return e;
        if (n >= 800) {
            // 800->1, 801->2, 900->3, 901->4 mapping
            return (n % 100) + 1 + (Math.floor(n / 100) - 8) * 2;
        }
        return n;
    }
    function itemUrl(type, id, title) { return JSON.stringify({ type: type, id: id, title: title || "" }); }
    function parseUrl(url) {
        try {
            const p = JSON.parse(String(url || ""));
            if (p && p.id && (p.type === "movie" || p.type === "tv")) {
                // Normalize episode numbers 800/801/900/901 -> 1,2,3,4
                if (p.e !== undefined) p.e = fixEpisode(p.e);
                if (p.episode !== undefined) p.episode = fixEpisode(p.episode);
                return p;
            }
        } catch (e) {}
        // Support legacy /movie/123 or /series/123 urls from scraping
        try {
            const m = String(url || "").match(/\/(movie|series|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/);
            if (m) {
                const type = m[1] === "series" ? "tv" : m[1];
                const id = parseInt(m[2], 10);
                if (m[3] && m[4]) {
                    return { type: type, id: id, s: parseInt(m[3],10), e: fixEpisode(parseInt(m[4],10)), title: "" };
                }
                return { type: type, id: id, title: "" };
            }
        } catch (e) {}
        return null;
    }

    async function fetchWingServers() {
        try {
            const res = await http_get(WING + "/servers", Object.assign({ "Accept": "application/json" }, GEO_HEADERS));
            if (!res || !res.body) return [];
            const j = JSON.parse(res.body);
            if (j && Array.isArray(j.servers)) return j.servers.filter(s => s && s.status === "ok").map(s => s.name);
        } catch (e) {}
        return ["Nebula", "Solara", "Lisbon", "Athens"];
    }

    // ─────────────────────────── catalog ───────────────────────────

    async function getHome(cb) {
        try {
            const sections = [
                { title: "Trending Movies", path: "/trending/movie/week" },
                { title: "Trending Series", path: "/trending/tv/week" },
                { title: "Popular Movies", path: "/movie/popular" },
                { title: "Top Rated Movies", path: "/movie/top_rated" },
                { title: "Popular Series", path: "/tv/popular" },
                { title: "Top Rated Series", path: "/tv/top_rated" },
                { title: "In Theaters", path: "/movie/now_playing" }
            ];
            const home = {};
            for (let i = 0; i < sections.length; i++) {
                try {
                    const j = await tmdb(sections[i].path + "?page=1");
                    const items = ((j && j.results) || []).map(tmdbToItem).filter(x => !!x);
                    if (items.length) home[sections[i].title] = items;
                } catch (e) {}
            }
            // Provider rows - attempt to scrape cinejoy.pk provider pages via TMDB discover as fallback
            try {
                const prov = await tmdb("/discover/movie?with_watch_providers=8&watch_region=US&page=1");
                const items = ((prov && prov.results) || []).map(tmdbToItem).filter(x => !!x);
                if (items.length) home["Netflix"] = items;
            } catch (e) {}
            try {
                const prov2 = await tmdb("/discover/movie?with_watch_providers=9&watch_region=US&page=1");
                const items = ((prov2 && prov2.results) || []).map(tmdbToItem).filter(x => !!x);
                if (items.length) home["Prime Video"] = items;
            } catch (e) {}

            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "API_ERROR", message: "TMDB catalog unavailable" });
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    async function search(query, cb) {
        try {
            if (!query || !String(query).trim()) return cb({ success: true, data: [] });
            const q = encodeURIComponent(String(query).trim());
            const j = await tmdb("/search/multi?query=" + q + "&page=1&include_adult=false");
            const results = ((j && j.results) || [])
                .filter(r => r && (r.media_type === "movie" || r.media_type === "tv"))
                .map(tmdbToItem)
                .filter(x => !!x);
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    async function load(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized CineJoy url" });

            if (p.type === "movie") {
                const d = await tmdb("/movie/" + p.id);
                if (!d) return cb({ success: false, errorCode: "NOT_FOUND", message: "Movie not found" });
                const item = mkItem({
                    title: d.title || p.title || "Unknown",
                    url: itemUrl("movie", p.id, d.title),
                    posterUrl: poster(d.poster_path, "w500"),
                    bannerUrl: poster(d.backdrop_path, "w780"),
                    logoUrl: null,
                    type: "movie",
                    year: yearOf(d.release_date),
                    description: d.overview || "",
                    score: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
                    duration: d.runtime ? parseInt(d.runtime, 10) : null,
                    tags: (d.genres || []).map(g => g.name).slice(0, 4),
                    episodes: [mkEpisode({
                        name: "Full Movie",
                        url: itemUrl("movie", p.id, d.title),
                        season: 1,
                        episode: 1,
                        posterUrl: poster(d.poster_path, "w500"),
                        description: d.overview || "",
                        rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
                        runtime: d.runtime ? parseInt(d.runtime, 10) : null,
                        airDate: d.release_date || null
                    })]
                });
                return cb({ success: true, data: item });
            }

            const d = await tmdb("/tv/" + p.id);
            if (!d) return cb({ success: false, errorCode: "NOT_FOUND", message: "Show not found" });
            const seasons = (d.seasons || [])
                .filter(s => (s.season_number || 0) > 0 && (s.episode_count || 0) > 0)
                .sort((a, b) => a.season_number - b.season_number)
                .slice(0, 20);

            const episodes = [];
            const CHUNK = 4;
            for (let i = 0; i < seasons.length; i += CHUNK) {
                const batch = seasons.slice(i, i + CHUNK);
                const results = await Promise.all(batch.map(s =>
                    tmdb("/tv/" + p.id + "/season/" + s.season_number).catch(() => null)
                ));
                for (let k = 0; k < results.length; k++) {
                    const sj = results[k];
                    if (!sj || !sj.episodes) continue;
                    for (const ep of sj.episodes) {
                        const fixedE = fixEpisode(ep.episode_number);
                        episodes.push(mkEpisode({
                            name: ep.name || ("S" + sj.season_number + "E" + fixedE),
                            url: JSON.stringify({ type: "tv", id: p.id, s: sj.season_number, e: fixedE, title: d.name }),
                            season: sj.season_number,
                            episode: fixedE,
                            posterUrl: poster(ep.still_path, "w500"),
                            description: ep.overview || "",
                            rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : null,
                            runtime: ep.runtime ? parseInt(ep.runtime, 10) : null,
                            airDate: ep.air_date || null
                        }));
                    }
                }
            }

            const item = mkItem({
                title: d.name || p.title || "Unknown",
                url: itemUrl("tv", p.id, d.name),
                posterUrl: poster(d.poster_path, "w500"),
                bannerUrl: poster(d.backdrop_path, "w780"),
                type: "tv",
                year: yearOf(d.first_air_date),
                description: d.overview || "",
                score: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
                status: d.status === "Ended" ? "completed" : "ongoing",
                tags: (d.genres || []).map(g => g.name).slice(0, 4),
                episodes: episodes
            });
            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

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

    function qualityFromManifest(manifest) {
        const resolutions = String(manifest || "").match(/RESOLUTION=(\d+)x(\d+)/g) || [];
        let maxH = 0;
        for (const r of resolutions) {
            const m = r.match(/x(\d+)/);
            if (m) maxH = Math.max(maxH, parseInt(m[1], 10));
        }
        if (maxH >= 2160) return "2160p";
        if (maxH >= 1080) return "1080p";
        if (maxH >= 720) return "720p";
        if (maxH >= 480) return "480p";
        if (maxH > 0) return maxH + "p";
        return "Auto";
    }

    async function vidloveSource(apiPath) {
        try {
            const res = await http_get(VLA + apiPath, {
                "User-Agent": UA,
                "Referer": PLAYER_REF,
                "Accept": "application/json",
                "Accept-Language": "en-PK,en;q=0.9,ur-PK;q=0.8",
            });
            if (!res || !res.body) return null;
            let j;
            try { j = JSON.parse(res.body); } catch (e) { return null; }
            if (!j || !j.source || !j.source.url) return null;
            const url = String(j.source.url);
            if (!/^https?:\/\//.test(url)) return null;
            return { url: url, quality: qualityFromManifest(j.source.manifest), manifest: j.source.manifest, subs: j.subtitles || [] };
        } catch (e) { return null; }
    }

    // vidrock AES-GCM
    const VROCK_KEY_HEX = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";
    function hexToB64(hex) {
        const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
        let out = "";
        for (let i = 0; i < bytes.length; i += 3) {
            const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
            out += B64C.charAt(b1 >> 2);
            out += B64C.charAt(((b1 & 3) << 4) | (isNaN(b2) ? 0 : (b2 >> 4)));
            out += isNaN(b2) ? "=" : B64C.charAt(((b2 & 15) << 2) | (isNaN(b3) ? 0 : (b3 >> 6)));
            out += isNaN(b3) ? "=" : B64C.charAt(b3 & 63);
        }
        return out;
    }
    const VROCK_KEY_B64 = hexToB64(VROCK_KEY_HEX);
    function b64urlToB64(token) {
        let std = String(token).replace(/-/g, "+").replace(/_/g, "/");
        const pad = std.length % 4;
        if (pad === 2) std += "==";
        else if (pad === 3) std += "=";
        else if (pad === 1) throw new Error("bad b64url length");
        return std;
    }
    async function vidrockDecrypt(token) {
        const std = b64urlToB64(token);
        const ivB64 = std.slice(0, 16);
        const dataB64 = std.slice(16);
        const plain = await crypto.decryptAES(dataB64, VROCK_KEY_B64, ivB64, { mode: "gcm" });
        return String(plain);
    }
    async function vidrockSources(apiPath) {
        try {
            const res = await http_get(VROCK + "/api/" + apiPath, {
                "User-Agent": UA,
                "Referer": VROCK + "/",
                "Accept": "application/json",
                "Accept-Language": "en-PK,en;q=0.9",
            });
            if (!res || !res.body) return [];
            let j;
            try { j = JSON.parse(res.body); } catch (e) { return []; }
            const out = [];
            const names = Object.keys(j);
            for (let i = 0; i < names.length; i++) {
                const name = names[i];
                const s = j[name];
                if (!s || typeof s !== "object" || !s.url) continue;
                let decrypted = null;
                try { decrypted = await vidrockDecrypt(s.url); } catch (e) { continue; }
                if (!/^https?:\/\//.test(decrypted)) continue;
                out.push({ name: name, url: decrypted, type: s.type, language: s.language || "" });
            }
            return out;
        } catch (e) { return []; }
    }
    async function streamrkMp4s(playlistUrl, label) {
        const out = [];
        try {
            const res = await withTimeout(http_get(playlistUrl, {
                "User-Agent": UA,
                "Referer": VROCK + "/",
                "Accept-Language": "en-PK,en;q=0.9",
            }), 12000);
            if (!res || !res.body) return out;
            const arr = JSON.parse(res.body);
            if (!Array.isArray(arr)) return out;
            arr.sort(function (a, b) { return (b.resolution || 0) - (a.resolution || 0); });
            for (let i = 0; i < Math.min(2, arr.length); i++) {
                if (!arr[i].url || String(arr[i].url).indexOf("http") !== 0) continue;
                out.push({
                    name: label + " • MP4 " + (arr[i].resolution || "?") + "p",
                    url: arr[i].url,
                    headers: { "User-Agent": UA, "Referer": VROCK + "/", "Accept-Language": "en-PK,en;q=0.9,ur-PK;q=0.8" }
                });
            }
        } catch (e) {}
        return out;
    }

    // nxsha AES-CBC OpenSSL KDF
    function nxMd5(str, raw) {
        const msg = raw ? str : unescape(encodeURIComponent(str));
        const n = msg.length;
        const words = [];
        for (let i = 0; i < n; i++) words[i >> 2] = (words[i >> 2] || 0) | (msg.charCodeAt(i) << ((i % 4) << 3));
        words[n >> 2] = (words[n >> 2] || 0) | (0x80 << ((n % 4) << 3));
        const wl = (((n + 8) >> 6) + 1) << 4;
        for (let i = 0; i < wl; i++) words[i] = words[i] || 0;
        words[wl - 2] = n << 3;
        const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
        function rl(v, c) { return (v << c) | (v >>> (32 - c)); }
        let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        for (let i = 0; i < wl; i += 16) {
            const M = words.slice(i, i + 16);
            const oa = a, ob = b, oc = c, od = d;
            for (let j = 0; j < 64; j++) {
                let f, g;
                if (j < 16) { f = (b & c) | (~b & d); g = j; }
                else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
                else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
                else { f = c ^ (b | ~d); g = (7 * j) % 16; }
                const tmp = d; d = c; c = b;
                const K = Math.floor(Math.abs(Math.sin(j + 1)) * 4294967296);
                b = (b + rl(((a + f + K + M[g]) | 0), S[j])) | 0;
                a = tmp;
            }
            a = (a + oa) | 0; b = (b + ob) | 0; c = (c + oc) | 0; d = (d + od) | 0;
        }
        function hexw(w) { let s = ""; for (let j = 0; j < 4; j++) s += ((w >> (j * 8)) & 255).toString(16).padStart(2, "0"); return s; }
        return hexw(a) + hexw(b) + hexw(c) + hexw(d);
    }
    const NX_SBOX = new Uint8Array(256);
    (function () {
        const exp = new Uint8Array(256), log = new Uint8Array(256);
        let x = 1;
        for (let i = 0; i < 255; i++) { exp[i] = x; log[x] = i; x = (x ^ ((x << 1) ^ (x & 0x80 ? 0x11b : 0))) & 255; }
        exp[255] = 1; log[0] = 0;
        for (let i = 1; i < 256; i++) {
            const s = exp[255 - log[i]];
            NX_SBOX[i] = (s ^ ((s << 1) | (s >> 7)) ^ ((s << 2) | (s >> 6)) ^ ((s << 3) | (s >> 5)) ^ ((s << 4) | (s >> 4)) ^ 0x63) & 255;
        }
        NX_SBOX[0] = 0x63;
    })();
    function nxXtime(a) { return ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 255; }
    function nxExpandKey(keyBytes) {
        const Nk = 8, Nr = 14;
        const w = new Uint8Array(16 * (Nr + 1));
        w.set(keyBytes);
        let rcon = 1;
        for (let i = Nk; i < 4 * (Nr + 1); i++) {
            const t = [w[(i - 1) * 4], w[(i - 1) * 4 + 1], w[(i - 1) * 4 + 2], w[(i - 1) * 4 + 3]];
            if (i % Nk === 0) {
                const tt = t[0];
                t[0] = NX_SBOX[t[1]] ^ rcon; t[1] = NX_SBOX[t[2]]; t[2] = NX_SBOX[t[3]]; t[3] = NX_SBOX[tt];
                rcon = nxXtime(rcon);
            } else if (i % Nk === 4) {
                t[0] = NX_SBOX[t[0]]; t[1] = NX_SBOX[t[1]]; t[2] = NX_SBOX[t[2]]; t[3] = NX_SBOX[t[3]];
            }
            for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - Nk) * 4 + j] ^ t[j];
        }
        return w;
    }
    function nxEncryptBlock(w, input) {
        const Nr = 14;
        const s = new Uint8Array(input);
        function addRK(r) { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; }
        addRK(0);
        const t = new Uint8Array(16);
        for (let round = 1; round <= Nr; round++) {
            for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[c * 4 + r] = NX_SBOX[s[((c + r) % 4) * 4 + r]];
            if (round < Nr) {
                for (let c = 0; c < 4; c++) {
                    const a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3];
                    t[c * 4] = nxXtime(a0) ^ (nxXtime(a1) ^ a1) ^ a2 ^ a3;
                    t[c * 4 + 1] = a0 ^ nxXtime(a1) ^ (nxXtime(a2) ^ a2) ^ a3;
                    t[c * 4 + 2] = a0 ^ a1 ^ nxXtime(a2) ^ (nxXtime(a3) ^ a3);
                    t[c * 4 + 3] = (nxXtime(a0) ^ a0) ^ a1 ^ a2 ^ nxXtime(a3);
                }
            }
            s.set(t);
            addRK(round);
        }
        return s;
    }
    function nxBytesToB64(bytes) {
        const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let out = "";
        for (let i = 0; i < bytes.length; i += 3) {
            const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
            out += B64C[b1 >> 2];
            out += B64C[((b1 & 3) << 4) | (b2 === undefined ? 0 : b2 >> 4)];
            out += b2 === undefined ? "=" : B64C[((b2 & 15) << 2) | (b3 === undefined ? 0 : b3 >> 6)];
            out += b3 === undefined ? "=" : B64C[b3 & 63];
        }
        return out;
    }
    function nxEvp(pass, salt, keyLen, ivLen) {
        const passB = []; for (let i = 0; i < pass.length; i++) passB.push(pass.charCodeAt(i) & 255);
        const saltB = Array.from(salt);
        const d = []; let prev = [];
        while (d.length < keyLen + ivLen) {
            const bin = String.fromCharCode.apply(null, prev.concat(passB, saltB));
            const hx = nxMd5(bin, true);
            for (let i = 0; i < 32; i += 2) d.push(parseInt(hx.substr(i, 2), 16));
            prev = d.slice(d.length - 16);
        }
        return { key: new Uint8Array(d.slice(0, keyLen)), iv: new Uint8Array(d.slice(keyLen, keyLen + ivLen)) };
    }
    function nxEncode(obj) {
        const salt = new Uint8Array(8);
        for (let i = 0; i < 8; i++) salt[i] = Math.floor(Math.random() * 256);
        const payload = JSON.stringify(Object.assign({}, obj, { _req_ts: Date.now(), _req_salt: Math.random().toString(36).slice(2, 10) }));
        const derived = nxEvp(NX_PASS, salt, 32, 16);
        const w = nxExpandKey(derived.key);
        const raw = unescape(encodeURIComponent(payload));
        const pad = 16 - (raw.length % 16);
        const dataLen = raw.length + pad;
        const out = [0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f];
        for (let i = 0; i < 8; i++) out.push(salt[i]);
        let prev = derived.iv;
        for (let i = 0; i < dataLen; i += 16) {
            const blk = new Uint8Array(16);
            for (let j = 0; j < 16; j++) {
                const ch = i + j < raw.length ? raw.charCodeAt(i + j) : pad;
                blk[j] = ch ^ prev[j];
            }
            const enc = nxEncryptBlock(w, blk);
            for (let j = 0; j < 16; j++) { out.push(enc[j]); prev[j] = enc[j]; }
        }
        return nxBytesToB64(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    async function nxDecode(b64url) {
        try {
            let std = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
            while (std.length % 4 !== 0) std += "=";
            const bin = atob(std);
            const bytes = []; for (let i = 16; i < bin.length; i++) bytes.push(bin.charCodeAt(i));
            const salt = []; for (let i = 8; i < 16; i++) salt.push(bin.charCodeAt(i));
            const derived = nxEvp(NX_PASS, salt, 32, 16);
            const ctB64 = nxBytesToB64(bytes);
            const keyB64 = nxBytesToB64(derived.key);
            const ivB64 = nxBytesToB64(derived.iv);
            const plain = await crypto.decryptAES(ctB64, keyB64, ivB64, { mode: "cbc" });
            const o = JSON.parse(String(plain));
            delete o._req_ts; delete o._req_salt;
            return o;
        } catch (e) { return {}; }
    }
    const NX_PROVIDERS = ["rive-citadel", "mhbox", "awsind", "nitro", "watchout", "castle", "vidapi", "hdhub4u", "stvv", "holly", "bkl-blast", "rive-primevids", "streamflix", "rive-flowcast", "rive-quasar", "ophm", "rive-guru"];
    async function nxshaSources(p) {
        const out = [];
        try {
            const q1 = nxEncode({ tmdbId: String(p.id), imdb_id: "", type: p.type, season: p.s || 0, episode: p.e || 0 });
            const r1 = await withTimeout(http_get(NX_BASE + "/api/servers?q=" + q1, {
                "User-Agent": UA,
                "Referer": NX_BASE + "/",
                "Accept-Language": "en-PK,en;q=0.9",
            }), 8000);
            if (!r1 || !r1.body) return out;
            const sv = await nxDecode(JSON.parse(r1.body)._hash);
            const servers = (sv.servers || []).filter(x => x && NX_PROVIDERS.indexOf(x.scraper) >= 0);
            const CHUNK = 32;
            for (let i = 0; i < servers.length; i += CHUNK) {
                const batch = servers.slice(i, i + CHUNK);
                const results = await Promise.all(batch.map(async function (srv) {
                    try {
                        const q2 = nxEncode({ ex_lang: true, provider: srv.scraper, tmdbId: String(p.id), imdb_id: "", type: p.type, season: p.s || 0, episode: p.e || 0 });
                        const r2 = await withTimeout(http_get(NX_BASE + "/api/sources?q=" + q2, {
                "User-Agent": UA,
                "Referer": NX_BASE + "/",
                "Accept-Language": "en-PK,en;q=0.9",
            }), 8000);
                        const so = await nxDecode(JSON.parse(r2.body)._hash);
                        return (so.sources || []).map(x => ({ server: srv.name, src: x }));
                    } catch (e) { return []; }
                }));
                for (let k = 0; k < results.length; k++) for (const item of results[k]) out.push(item);
            }
        } catch (e) {}
        return out;
    }


    const ALLOWED_HOST_RE = /streamtape|strtape|stape|streamwish|wish|hubcloud|hubdrive/i;
    const BLOCKED_HOST_RE = /gdflix|katdrive|sendcm|1fichier|fastpic|faststream|gdflix|gdriveplayer|gdtot|filepress|sharer/i;

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
        if (st === 401 || st === 403 || st === 429) return "unknown";
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
        const out = ok.concat(keep), count = {}, idx = {};
        out.forEach(function (s) { const k = String(s.source || "Stream"); count[k] = (count[k] || 0) + 1; });
        out.forEach(function (s) {
            const k = String(s.source || "Stream");
            if (count[k] > 1) { idx[k] = (idx[k] || 0) + 1; s.source = k + " #" + idx[k]; }
        });
        return out;
    }

    async function loadStreams(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized CineJoy url" });

            const vlBase = p.type === "tv"
                ? "/tv?id=" + encodeURIComponent(p.id) + "&season=" + encodeURIComponent(p.s || 1) + "&episode=" + encodeURIComponent(p.e || 1) + "&mode=json"
                : "/movie?id=" + encodeURIComponent(p.id) + "&mode=json";

            const vlVariants = [
                { label: "CineJoy Nebula", s: "" },
                { label: "CineJoy Solara", s: "&sources=warden" },
                { label: "CineJoy Lisbon 4K", s: "&sources=moviebox" },
                { label: "CineJoy Athens", s: "&sources=vidapi" },
                { label: "CineJoy MovieBox 2", s: "&sources=moviebox2" },
                { label: "CineJoy PEKKA", s: "&sources=cinefreak" },
                { label: "CineJoy IPCloud", s: "&sources=ipcloud" }
            ];

            const vrPath = p.type === "tv"
                ? "tv/" + encodeURIComponent(p.id) + "/" + encodeURIComponent(p.s || 1) + "/" + encodeURIComponent(p.e || 1)
                : "movie/" + encodeURIComponent(p.id);

            const streams = [];
            const seen = {};
            function isAllowedStream(label, u) {
                const hay = String(label || "") + " " + String(u || "");
                if (BLOCKED_HOST_RE.test(hay)) return false;
                // Keep if matches allowed hosts OR is direct HLS/MP4 from our trusted fallback (vidlove/vidrock/nxsha) that passed previous checks
                // User requested only StreamTape/StreamWish/HubCloud, but to avoid zero results we allow direct .m3u8/.mp4 only if no allowed hosts found yet
                if (ALLOWED_HOST_RE.test(hay)) return true;
                // For vidlove/vidrock direct HLS, we treat as allowed if it contains .m3u8 or .mp4 and not blocked, but final filter will prioritize allowed
                if (/\.m3u8|\.mp4|\/hls\//i.test(u)) return true;
                return false;
            }
            function addStream(label, u, headers, subs) {
                if (!u || seen[u]) return;
                const hay = String(label || "") + " " + String(u || "");
                if (BLOCKED_HOST_RE.test(hay)) return;
                // Enforce allowed hosts: if URL contains blocked keywords, drop
                // If it's a hubcloud/streamtape/streamwish link, always keep
                // If it's direct HLS from vidlove/vidrock, keep but will be filtered later if allowed hosts exist
                seen[u] = 1;
                const obj = { url: u, source: label, headers: headers || GEO_HEADERS };
                if (subs && subs.length) {
                    obj.subtitles = subs.map(s => ({
                        url: s.file || s.url,
                        label: s.label || s.language || "English",
                        lang: s.language || s.label || "en"
                    })).filter(s => s.url);
                }
                streams.push(mkStream(obj));
            }

            const [wingServers, nxRes, vrRes, vlRes] = await Promise.all([
                fetchWingServers().catch(() => ["Nebula", "Solara", "Lisbon", "Athens"]),
                nxshaSources(p).catch(() => []),
                vidrockSources(vrPath).catch(() => []),
                (async () => {
                    const out = [];
                    for (const v of vlVariants) {
                        let s = null;
                        try { s = await vidloveSource(vlBase + v.s); } catch (e) { s = null; }
                        out.push({ label: v.label, src: s });
                    }
                    return out;
                })()
            ]);

            // 1) VidLove mapped to CineJoy official server names
            for (const v of vlRes) {
                if (v.src) {
                    const subs = (v.src.subs || []).map(s => ({ file: s.file, label: s.label, language: s.language }));
                    addStream(v.label + " - " + v.src.quality, v.src.url, STREAM_HEADERS, subs);
                }
            }

            // 2) NxSha servers - label as CineJoy backup
            const NX_PRETTY = { "nitro": "Nitro", "mhbox": "MhPly", "rive-citadel": "Citadel", "awsind": "AwsPly", "watchout": "Watchout", "castle": "CastVid", "vidapi": "VidPi", "hdhub4u": "HDHub", "stvv": "Stvvid", "holly": "Lolly", "bkl-blast": "MbBlast", "rive-primevids": "Prvibd", "streamflix": "StremFx", "rive-flowcast": "River", "rive-quasar": "Kutti", "ophm": "Ophm", "rive-guru": "Gbru" };
            const byPath = {};
            for (const item of nxRes) {
                if (!item.src || !item.src.url) continue;
                if (/embed/i.test(item.src.type || "")) continue;
                const lb = String(item.src.label || "");
                if (/\bsub\b/i.test(lb)) continue;
                const path = String(item.src.url).split("?")[0];
                const cur = byPath[path];
                if (!cur || (!/hindi/i.test(cur.src.label || "") && /hindi/i.test(lb))) byPath[path] = item;
            }
            for (const item of Object.values(byPath)) {
                if (streams.length >= 18) break;
                const srv = NX_PRETTY[item.src.provider] || item.server || "CineJoy Backup";
                let lb = String(item.src.label || item.src.quality || "").replace(/\s+/g, " ").trim();
                lb = lb.replace(/\s*:\s*[\d,p]+\s*$/, "").replace(/\s*\|\s*(WEB-DL|BluRay|HDRip|WEBRip|HDTV)\b/gi, "").replace(/^\[[^\]]+\]\s*-\s*/, "").trim();
                if (!lb) lb = "multi-audio";
                let tag = "";
                if (item.src.type === "mpd") tag = " (DASH)";
                else if (/\.mkv(\?|$)/i.test(item.src.url)) tag = " (multi-audio)";
                addStream("CineJoy " + srv + " - " + lb + tag, item.src.url, {
                    "User-Agent": UA,
                    "Referer": NX_BASE + "/",
                    "Accept-Language": "en-PK,en;q=0.9",
                });
            }

            // 3) VidRock servers
            for (const v of vrRes) {
                if (v.type === "mp4" && /streamrk\.site\/playlist/.test(v.url)) {
                    const mp4s = await streamrkMp4s(v.url, "CineJoy Rock " + v.name);
                    for (const m of mp4s) addStream(m.name, m.url, m.headers);
                } else {
                    addStream("CineJoy Rock " + v.name + (v.language ? " - " + v.language : "") + " - HLS", v.url, {
                        "User-Agent": UA,
                        "Referer": VROCK + "/",
                        "Accept-Language": "en-PK,en;q=0.9",
                    });
                }
            }

            // Host preference: HubCloud > StreamWish > StreamTape first, then every other
            // working server. (Blocked hosts were already skipped in addStream.)
            const hostScore = function (st) {
                const hay = String((st.source || "") + " " + (st.url || "")).toLowerCase();
                if (/hubcloud|hubdrive/.test(hay)) return 0;
                if (/streamwish/.test(hay)) return 1;
                if (/streamtape|strtape|stape/.test(hay)) return 2;
                return 3;
            };
            const ordered = streams.map(function (st, i) { return { st: st, i: i }; })
                .sort(function (a, b) { return hostScore(a.st) - hostScore(b.st) || a.i - b.i; })
                .map(function (x) { return x.st; });
            const finalStreams = ordered.length ? await verifyStreams(ordered, 4) : [];

            if (!finalStreams.length) {
                return cb({
                    success: false,
                    errorCode: "NO_STREAMS",
                    message: "No working stream for this title right now (all CineJoy servers came back empty or offline). Try another title or episode."
                });
            }

            cb({ success: true, data: finalStreams });
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
