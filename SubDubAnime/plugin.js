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
    //  SubDubAnime (subdubanime.site) — SkyStream plugin
    //
    //  Hindi/English dubbed + subbed anime. The Blogger site is a
    //  client-side shell over a dedicated API:
    //
    //    GET https://blakiteapi.xyz/api/getAllAnime.php
    //      -> { success, data: { movies, series, dramas } }
    //         each: { <zeroPaddedTmdbId>: {
    //           tmdbId, title, language, type,
    //           IMAGES: { poster, backdrop },
    //           TMDB_DATA: { genres, synopsis, rating, releaseDate },
    //           seasons: { "1": { status, totalEpisodes } } } }
    //
    //    GET https://blakiteapi.xyz/api/get.php?tmdbId=<id>          (movies)
    //    GET https://blakiteapi.xyz/api/get.php?id=<s>-<e>&tmdbId=..  (series)
    //      -> { data: { dataId, quality, qid, format, ranges } }
    //
    //  Stream URL (from their /watch/player.js):
    //    https://hugh.cdn.rumble.cloud/video/<dataId>.<code>.tar
    //      ?r_file=chunklist.m3u8
    //      &r_type=application%2Fvnd.apple.mpegurl
    //      &r_range=<start-end of the quality's range>
    //    codes: oaa=240p baa=360p caa=480p gaa=720p haa=1080p
    //    `quality` is only the player's default (usually 480p). For HLS the
    //    `ranges` field lists every rendition ("<start>-<end> (1080p)"),
    //    and for MP4 `qid` is the highest code available (5 = 1080p);
    //    all of those are served (checked 2026-10: 240p..1080p, 206/200).
    // ═══════════════════════════════════════════════════════════

    const API = "https://blakiteapi.xyz";
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // Plain headers only: spoofed X-Forwarded-For / CF-Connecting-IP / True-Client-IP
    // don't change the caller's location, and Cloudflare answers them with HTTP 403.

    const QCODES = { "240p": "oaa", "360p": "baa", "480p": "caa", "720p": "gaa", "1080p": "haa" };

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

    let catalogCache = null, catalogTs = 0;
    async function catalog() {
        const now = Date.now();
        if (catalogCache && now - catalogTs < 1800000) return catalogCache; // 30 min
        const r = await withTimeout(http_get(API + "/api/getAllAnime.php", { "User-Agent": UA }), 25000);
        const j = JSON.parse((r && r.body) || "{}");
        const d = (j && j.data) || {};
        catalogCache = {
            movies: d.movies || {},
            series: d.series || {},
            dramas: d.dramas || {}
        };
        catalogTs = now;
        return catalogCache;
    }

    function yearOf(s) {
        const m = String(s || "").match(/^(\d{4})/);
        return m ? parseInt(m[1], 10) : null;
    }

    // The upstream API embeds a TMDB snapshot. The app's item parser requires
    // description to be a string and every tag to be a string - one malformed
    // value would fail the whole dashboard - so normalise defensively.
    function toText(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }
    function toScore(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
    function toTags(v) {
        if (!Array.isArray(v)) return [];
        return v.map(function (g) { return typeof g === "string" ? g : (g && (g.name || g.title)) || ""; })
            .filter(Boolean).slice(0, 4);
    }

    function entryToItem(entry, cat) {
        if (!entry || !entry.tmdbId || !entry.title) return null;
        const img = entry.IMAGES || {};
        const tmd = entry.TMDB_DATA || {};
        const url = JSON.stringify({ cat: cat, id: String(entry.tmdbId), t: entry.title });
        const isSeries = cat !== "movies";
        return mkItem({
            title: entry.title,
            url: url,
            posterUrl: img.poster || "",
            bannerUrl: img.backdrop || img.poster || "",
            type: isSeries ? "tv" : "movie",
            year: yearOf(tmd.releaseDate),
            description: toText(tmd.synopsis).slice(0, 400),
            score: toScore(tmd.rating),
            tags: toTags(tmd.genres)
        });
    }

    // flattened entries of a category, newest first
    function sortedEntries(obj, field) {
        const arr = [];
        for (const k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) arr.push(obj[k]);
        }
        arr.sort(function (a, b) {
            return String(b[field] || "").localeCompare(String(a[field] || ""));
        });
        return arr;
    }

    // ─────────────────────────── home ──────────────────────────────

    async function getHome(cb) {
        try {
            const c = await catalog();
            const home = {};

            const latest = sortedEntries(c.series, "updatedAt").slice(0, 24)
                .map(function (e) { return entryToItem(e, "series"); })
                .filter(function (x) { return !!x; });
            if (latest.length) home["Latest Anime"] = latest;

            const ongoing = sortedEntries(c.series, "updatedAt").filter(function (e) {
                const s = e.seasons || {};
                for (const n in s) if (s[n] && s[n].status === "Ongoing") return true;
                return false;
            }).slice(0, 24).map(function (e) { return entryToItem(e, "series"); })
              .filter(function (x) { return !!x; });
            if (ongoing.length) home["Ongoing"] = ongoing;

            const completed = sortedEntries(c.series, "updatedAt").filter(function (e) {
                const s = e.seasons || {};
                let any = false, allDone = false;
                for (const n in s) { any = true; if (s[n] && s[n].status === "Completed") allDone = true; }
                return any && allDone;
            }).slice(0, 24).map(function (e) { return entryToItem(e, "series"); })
              .filter(function (x) { return !!x; });
            if (completed.length) home["Completed"] = completed;

            const movies = sortedEntries(c.movies, "updatedAt").slice(0, 24)
                .map(function (e) { return entryToItem(e, "movies"); })
                .filter(function (x) { return !!x; });
            if (movies.length) home["Anime Movies"] = movies;

            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "API_ERROR", message: "SubDubAnime catalog unavailable" });
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── search ────────────────────────────

    async function search(query, cb) {
        try {
            if (!query || !String(query).trim()) return cb({ success: true, data: [] });
            const q = String(query).trim().toLowerCase();
            const c = await catalog();
            const out = [];
            ["series", "movies", "dramas"].forEach(function (cat) {
                const arr = sortedEntries(c[cat], "updatedAt");
                for (let i = 0; i < arr.length; i++) {
                    if (String(arr[i].title || "").toLowerCase().indexOf(q) >= 0) {
                        const it = entryToItem(arr[i], cat);
                        if (it && out.length < 30) out.push(it);
                    }
                }
            });
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────── detail + episodes ─────────────────────

    async function load(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.cat || !p.id) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized SubDubAnime url" });

            const c = await catalog();
            const entry = c[p.cat] && (c[p.cat][String(p.id).padStart(10, "0")] || c[p.cat][String(p.id)]);
            if (!entry) return cb({ success: false, errorCode: "NOT_FOUND", message: "Title not in catalog (try search)" });

            const img = entry.IMAGES || {};
            const tmd = entry.TMDB_DATA || {};
            const title = entry.title;
            const episodes = [];

            if (p.cat === "movies") {
                episodes.push(mkEpisode({
                    name: "Full Movie",
                    url: JSON.stringify({ cat: "movies", id: String(entry.tmdbId), t: title }),
                    season: 1,
                    episode: 1,
                    posterUrl: img.poster || "",
                    description: toText(tmd.synopsis)
                }));
            } else {
                const seasons = entry.seasons || {};
                const nums = Object.keys(seasons).map(function (n) { return parseInt(n, 10); })
                    .filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; });
                if (!nums.length) return cb({ success: false, errorCode: "NO_EPISODES", message: "No seasons listed for this anime yet." });
                for (let si = 0; si < nums.length; si++) {
                    const s = nums[si];
                    const info = seasons[String(s)] || {};
                    const total = parseInt(info.totalEpisodes, 10) || 0;
                    for (let e = 1; e <= total; e++) {
                        episodes.push(mkEpisode({
                            name: "S" + s + " E" + (e < 10 ? "0" + e : e) + (info.status === "Ongoing" && si === nums.length - 1 ? "" : ""),
                            url: JSON.stringify({ cat: p.cat, id: String(entry.tmdbId), s: s, e: e, t: title }),
                            season: s,
                            episode: e,
                            posterUrl: img.poster || "",
                            description: title + " — Season " + s + ", Episode " + e
                        }));
                    }
                }
            }
            if (!episodes.length) return cb({ success: false, errorCode: "NO_EPISODES", message: "No episodes listed yet." });

            cb({
                success: true,
                data: mkItem({
                    title: title,
                    url: url,
                    posterUrl: img.poster || "",
                    bannerUrl: img.backdrop || img.poster || "",
                    type: p.cat === "movies" ? "movie" : "tv",
                    year: yearOf(tmd.releaseDate),
                    description: toText(tmd.synopsis).slice(0, 700),
                    score: toScore(tmd.rating),
                    tags: toTags(tmd.genres),
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "DETAIL_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

    const QORDER = ["240p", "360p", "480p", "720p", "1080p"];
    const CDN = "https://hugh.cdn.rumble.cloud/video/";

    // Every rendition the episode has, highest first: [{q, url, hls}]
    function allRenditions(data) {
        const out = [];
        const id = String(data.dataId);
        if (String(data.format || "").toUpperCase() === "M3U8") {
            const lines = String(data.ranges || "").split("\n");
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^(\d+)-(\d+)\s*\(([^)]+)\)/);
                if (!m) continue;
                const q = m[3].toLowerCase(), code = QCODES[q];
                if (!code) continue;
                out.push({ q: q, hls: true, url: CDN + id + "." + code +
                    ".tar?r_file=chunklist.m3u8&r_type=application%2Fvnd.apple.mpegurl&r_range=" + m[1] + "-" + m[2] });
            }
        } else {
            const top = Math.max(1, Math.min(5, parseInt(data.qid, 10) || 0)) ||
                        (QORDER.indexOf(String(data.quality || "").toLowerCase()) + 1) || 3;
            for (let k = 0; k < top; k++) {
                out.push({ q: QORDER[k], hls: false, url: CDN + id + "." + QCODES[QORDER[k]] + ".mp4" });
            }
        }
        out.sort(function (x, y) { return QORDER.indexOf(y.q) - QORDER.indexOf(x.q); });
        return out;
    }

    // ── stream verification (TJ-Plugins shared helper) ─────────────────────────
    // Each candidate is requested once, with the exact headers the player will send.
    //   ok      -> HLS playlist / DASH manifest / media bytes  -> listed first
    //   unknown -> 401/403/426/429/timeout (often an IP/region block that works on a phone)
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
        // Freshly minted Google download links ignore Range and stream the whole
        // file; probing them only burns data (and crashes the CLI, which buffers it).
        if (/^https:\/\/video-downloads\.googleusercontent\.com\//i.test(u)) return "ok";
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
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.cat || !p.id) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized episode url" });

            let apiUrl;
            if (p.cat === "movies") {
                apiUrl = API + "/api/get.php?tmdbId=" + encodeURIComponent(String(p.id));
            } else {
                apiUrl = API + "/api/get.php?id=" + encodeURIComponent((p.s || 1) + "-" + (p.e || 1)) +
                         "&tmdbId=" + encodeURIComponent(String(p.id));
            }
            const r = await withTimeout(http_get(apiUrl, { "User-Agent": UA, "Referer": API + "/" }), 20000);
            let j;
            try { j = JSON.parse((r && r.body) || "{}"); } catch (e) { j = {}; }
            const data = j && j.data;
            if (!data || !data.dataId) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "This episode is not uploaded yet — try the previous episode or another anime." });
            }

            // 240p only if nothing better exists
            let rends = allRenditions(data);
            if (rends.length > 1) rends = rends.filter(function (x) { return x.q !== "240p"; });
            const candidates = rends.slice(0, 4).map(function (x) {
                return mkStream({
                    url: x.url,
                    source: "SubDub - " + x.q + (x.hls ? " - HLS" : ""),
                    headers: { "User-Agent": UA }
                });
            });
            // Higher renditions exist for many episodes but not all (the CDN 403s
            // the missing ones), so list only verified extras; the API's default
            // quality is always kept as the fallback.
            const defQ = String(data.quality || "").toLowerCase();
            const streams = candidates.length ? await verifyStreams(candidates, 0) : [];
            if (!streams.some(function (st) { return String(st.source).indexOf(" " + defQ) >= 0; })) {
                const d = rends.filter(function (x) { return x.q === defQ; })[0];
                if (d) streams.push(mkStream({ url: d.url, source: "SubDub - " + d.q + (d.hls ? " - HLS" : ""), headers: { "User-Agent": UA } }));
            }
            if (!streams.length) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "This episode's video is not available on the server right now — try another episode." });
            }

            cb({ success: true, data: streams });
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
