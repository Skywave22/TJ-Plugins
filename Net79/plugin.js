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
    var __NG_MIRRORS = ["https://net27.cc", "https://netmirrors.vip", "https://net77.cc"];
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
    //  Net79 (net79.cc "NetMirror" web) - TJ-Plugins
    //
    //  net79.cc (mirrors net27.cc, netmirrors.vip, net77.cc) is an Astro site whose own
    //  server indexes MovieBox (aoneroom) and maps it to TMDB. Everything here
    //  uses the site's open JSON API (browser User-Agent, no login):
    //    catalog : /api/catalog/hero | discover (Netflix, Prime, Crunchyroll,
    //              K-Drama, genres...) + the server-rendered /explore/<x> grids
    //    search  : /api/catalog/search-hybrid?q=
    //    details : /api/catalog/title/<type>/<tmdbId>, /api/catalog/season/<id>/<n>
    //              (MovieBox-only titles: h5-api.aoneroom.com /detail)
    //    streams : /api/embed-tmdb/<tmdbId>?type&se&ep[&dub&dubdp]
    //              /api/embed-direct/<subjectId>?type&se&ep&dp   (MovieBox-only)
    //              /api/variants-tmdb/<type>/<id>  -> audio languages (dubs)
    //  Streams are MovieBox MP4 files (360p-1080p) on *.hakunaymatata.com plus
    //  subtitles. Each quality is listed twice: direct (the CDN wants MovieBox's
    //  own Referer) and through the site's own video proxy (a Cloudflare Worker
    //  that adds the headers itself - what net79.cc's player uses for everyone).
    // ═══════════════════════════════════════════════════════════

    const SITE = (typeof manifest !== "undefined" && manifest && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, "") : "https://net79.cc";
    const H5 = "https://h5-api.aoneroom.com/wefeed-h5api-bff";
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    const WORKER = "https://streamhub-proxy.1545zoya.workers.dev";
    // MovieBox's file CDN answers 426 to mirror-site Referers (moviebox.ph,
    // movieboxonline.net, videodownloader.site ...); its own web player's origin passes.
    const DIRECT_HEADERS = { "User-Agent": UA, "Referer": "https://h5.aoneroom.com/" };
    const PROXY_HEADERS = { "User-Agent": UA };

    function mkItem(obj)    { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj)  { try { return new StreamResult(obj); } catch (_) { return obj; } }
    function mkActor(obj)   { try { return new Actor(obj); } catch (_) { return obj; } }
    function mkTrailer(obj) { try { return new Trailer(obj); } catch (_) { return obj; } }

    function withTimeout(promise, ms) {
        if (typeof setTimeout !== "function") return promise;
        return new Promise(function (resolve, reject) {
            const t = setTimeout(function () { reject(new Error("timeout")); }, ms);
            promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }

    const API_HEADERS = { "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": SITE + "/" };
    async function getText(url, headers) {
        const res = await http_get(url, headers || { "User-Agent": UA, "Referer": SITE + "/" });
        if (!res || Number(res.status) >= 400 || !res.body) return null;
        return String(res.body);
    }
    async function api(path, ms) {
        try {
            const res = await withTimeout(http_get(SITE + path, API_HEADERS), ms || 20000);
            if (!res || !res.body || Number(res.status) >= 400) return null;
            return JSON.parse(res.body);
        } catch (_) { return null; }
    }
    async function h5(path) {
        try {
            const res = await withTimeout(http_get(H5 + path, { "User-Agent": UA, "Accept": "application/json", "x-source": "null", "Origin": SITE, "Referer": SITE + "/" }), 12000);
            const j = res && res.body ? JSON.parse(res.body) : null;
            return j && Number(j.code) === 0 ? j.data : null;
        } catch (_) { return null; }
    }

    function num(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }
    function score(v) { const n = parseFloat(v); return n ? Math.round(n * 10) / 10 : null; }
    function bigImg(u, size) { return String(u || "").replace(/\/t\/p\/(w\d+|original)\//, "/t/p/" + (size || "w500") + "/"); }
    function htmlDecode(s) {
        return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    }
    // url = JSON: { k:"t", type, id }  (TMDB title)  |  { k:"n", sid, dp, type }  (MovieBox-only title)
    function parseUrl(url) {
        try {
            const p = JSON.parse(String(url || ""));
            if (p && p.k === "t" && p.id && (p.type === "movie" || p.type === "tv")) return p;
            if (p && p.k === "n" && p.sid) return p;
        } catch (_) {}
        return null;
    }
    function isAnimeItem(it) {
        return it && it.type === "tv" && /animation|anime/i.test(JSON.stringify(it.genres || it.genre || ""));
    }

    function tmdbItem(r, forcedType) {
        if (!r || !r.tmdbId || !r.title) return null;
        const t = forcedType || (r.type === "tv" ? "tv" : "movie");
        return mkItem({
            title: r.title,
            url: JSON.stringify({ k: "t", type: t, id: Number(r.tmdbId), title: r.title }),
            posterUrl: bigImg(r.poster || r.backdrop, "w500"),
            bannerUrl: r.backdrop ? bigImg(r.backdrop, "w1280") : undefined,
            type: t === "movie" ? "movie" : (isAnimeItem(r) ? "anime" : "series"),
            year: num(r.year),
            description: r.overview || "",
            score: score(r.rating)
        });
    }

    // ─────────────────────────── catalog ───────────────────────────
    // Same rows as net79.cc's home page (its discover calls), plus its
    // server-rendered "explore" grids (MovieBox catalog, newest first).
    const ROWS = [
        { name: "Top 10 Today",            path: "/api/catalog/trending?window=day", top: 10 },
        { name: "New Releases",            path: "/api/catalog/discover?type=movie&sort=release&year_from=2025&year_to=2026" },
        { name: "Popular on Netflix",      path: "/api/catalog/discover?platform=Netflix&type=movie" },
        { name: "Netflix Series",          path: "/api/catalog/discover?platform=Netflix&type=tv" },
        { name: "Popular on Prime Video",  path: "/api/catalog/discover?platform=PrimeVideo&type=movie" },
        { name: "Anime",                   path: "/api/catalog/discover?platform=Crunchyroll&type=tv", anime: true },
        { name: "Latest Movies",           explore: "movie" },
        { name: "Latest Series",           explore: "tv" },
        { name: "Hindi Dubbed",            explore: "hindi-dubbed" },
        { name: "Popular K-Dramas",        path: "/api/catalog/discover?type=tv&country=KR&sort=popularity" },
        { name: "Action Blockbusters",     path: "/api/catalog/discover?type=movie&genre=28" },
        { name: "Comedies",                path: "/api/catalog/discover?type=movie&genre=35" }
    ];

    // /explore/<x> cards: <a href="/native/<subjectId>?dp=<detailPath>&amp;t=..."> <img src> title / year / Movie|Series
    function parseExplore(html) {
        const out = [], seen = {};
        const re = /href="\/native\/(\d+)\?dp=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        while ((m = re.exec(html || ""))) {
            const sid = m[1], dp = decodeURIComponent(m[2]), inner = m[3];
            if (seen[sid]) continue;
            seen[sid] = 1;
            const img = (inner.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
            const texts = [];
            inner.replace(/>([^<>]+)</g, function (_, t) { t = htmlDecode(t); if (t) texts.push(t); return _; });
            const title = texts[0] || "";
            if (!title) continue;
            const year = texts.filter(function (t) { return /^\d{4}$/.test(t); })[0];
            const series = texts.some(function (t) { return /^series$/i.test(t); });
            const type = series ? "tv" : "movie";
            out.push(mkItem({
                title: title,
                url: JSON.stringify({ k: "n", sid: sid, dp: dp, type: type, title: title }),
                posterUrl: htmlDecode(img),
                type: series ? "series" : "movie",
                year: num(year)
            }));
        }
        return out;
    }

    async function getHome(cb) {
        try {
            const lists = await Promise.all(ROWS.map(function (row) {
                if (row.explore) {
                    return withTimeout(getText(SITE + "/explore/" + row.explore), 20000)
                        .then(parseExplore).catch(function () { return []; });
                }
                const path = row.path + (/discover\?/.test(row.path) ? "&region=IN" : ""); // as the site asks
                return api(path).then(function (j) {
                    return ((j && j.items) || []).filter(function (r) { return r && (r.poster || r.backdrop); }).slice(0, row.top || 40).map(function (r) {
                        const it = tmdbItem(r);
                        if (it && row.anime && it.type === "series") it.type = "anime";
                        return it;
                    }).filter(Boolean);
                });
            }));
            const data = {}, shown = {};
            ROWS.forEach(function (row, i) {
                let list = lists[i] || [];
                // the explore grids all open with the same newest titles: show each title once
                if (row.explore) {
                    list = list.filter(function (it) { if (shown[it.url]) return false; shown[it.url] = 1; return true; });
                    if (list.length < 8) return;
                }
                if (list.length) data[row.name] = list;
            });
            if (!Object.keys(data).length) return cb({ success: false, errorCode: "UNAVAILABLE", message: "net79.cc returned no content. Try again later." });
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    async function search(query, cb) {
        try {
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });
            // each page is one TMDB result page minus the titles the site cannot play, so
            // pages are small: read up to 5
            const sp = function (pg) { return api("/api/catalog/search-hybrid?q=" + encodeURIComponent(q) + (pg > 1 ? "&page=" + pg : ""), 15000); };
            const first = await sp(1);
            const total = Math.min(Number((first && first.totalPages) || 1), 5), more = [];
            for (let pg = 2; pg <= total; pg++) more.push(sp(pg));
            const pages = [first].concat(await Promise.all(more));
            const seen = {}, out = [];
            pages.forEach(function (j) {
                ((j && j.items) || []).forEach(function (r) {
                    if (r && r.cta && /coming soon/i.test(r.cta)) return; // not on the site yet
                    const it = tmdbItem(r);
                    if (it && !seen[it.url]) { seen[it.url] = 1; out.push(it); }
                });
            });
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── details ───────────────────────────
    function castOf(list) {
        return (list || []).slice(0, 12).map(function (c) {
            return mkActor({ name: c.name, role: c.character || "", image: c.photo || "" });
        });
    }
    function recsOf(list) { return (list || []).slice(0, 15).map(function (r) { return tmdbItem(r); }).filter(Boolean); }

    function epFrom(id, title, s, ep) {
        return mkEpisode({
            name: ep.name || ("Episode " + ep.episode),
            url: JSON.stringify({ k: "t", type: "tv", id: id, s: s, e: ep.episode, title: title }),
            season: s,
            episode: ep.episode,
            posterUrl: ep.still || "",
            description: ep.overview || "",
            rating: score(ep.rating),
            runtime: ep.runtime ? num(ep.runtime) : null,
            airDate: ep.airDate || null
        });
    }

    async function loadTmdb(p, cb) {
        const d = await api("/api/catalog/title/" + p.type + "/" + p.id, 25000);
        if (!d || !d.ok) return cb({ success: false, errorCode: "NOT_FOUND", message: "net79.cc has no details for this title right now." });
        const url = JSON.stringify({ k: "t", type: p.type, id: Number(p.id), title: d.title || p.title || "" });
        const common = {
            title: d.title || p.title || "Unknown",
            url: url,
            posterUrl: bigImg(d.poster, "w500"),
            bannerUrl: d.backdrop ? bigImg(d.backdrop, "w1280") : undefined,
            year: num(d.year),
            description: d.overview || "",
            score: score(d.rating),
            tags: (d.genres || []).map(function (g) { return g.name; }).slice(0, 5),
            cast: castOf(d.cast),
            trailers: d.trailerKey ? [mkTrailer({ url: "https://www.youtube.com/watch?v=" + d.trailerKey, name: "Trailer" })] : [],
            recommendations: recsOf(d.recommendations),
            contentRating: d.certification && d.certification.rating ? String(d.certification.rating) : undefined
        };
        if (p.type === "movie") {
            common.type = "movie";
            common.duration = d.runtime ? num(d.runtime) : null;
            // the app only shows Play when there is at least one episode
            common.episodes = [mkEpisode({ name: "Full Movie", url: url, season: 1, episode: 1,
                posterUrl: d.backdrop ? bigImg(d.backdrop, "w780") : common.posterUrl, description: d.overview || "",
                runtime: common.duration })];
            return cb({ success: true, data: mkItem(common) });
        }
        const today = new Date().toISOString().slice(0, 10);
        const seasons = (d.seasons || []).filter(function (s) { return s.season_number > 0 && s.episode_count > 0; })
            .sort(function (a, b) { return a.season_number - b.season_number; }).slice(0, 40);
        const bySeason = {};
        const init = num(d.initialSeason);
        if (init && (d.initialEpisodes || []).length) bySeason[init] = d.initialEpisodes;
        const todo = seasons.filter(function (s) { return !bySeason[s.season_number]; });
        for (let i = 0; i < todo.length; i += 6) {
            const batch = await Promise.all(todo.slice(i, i + 6).map(function (s) {
                return api("/api/catalog/season/" + p.id + "/" + s.season_number, 15000);
            }));
            batch.forEach(function (sj, k) {
                const sn = todo[i + k].season_number;
                if (sj && sj.ok && (sj.episodes || []).length) bySeason[sn] = sj.episodes;
                else {
                    // season list failed: numbered episodes from the count
                    const n = todo[i + k].episode_count, list = [];
                    for (let e = 1; e <= n; e++) list.push({ episode: e });
                    bySeason[sn] = list;
                }
            });
        }
        const episodes = [];
        seasons.forEach(function (s) {
            (bySeason[s.season_number] || []).forEach(function (ep) {
                if (!ep || !ep.episode) return;
                if (ep.airDate && ep.airDate > today) return; // not aired yet
                episodes.push(epFrom(Number(p.id), common.title, s.season_number, ep));
            });
        });
        if (!episodes.length) return cb({ success: false, errorCode: "NO_EPISODES", message: "No aired episodes for this show yet." });
        common.type = isAnimeItem(d) ? "anime" : "series";
        common.episodes = episodes;
        cb({ success: true, data: mkItem(common) });
    }

    // MovieBox-only titles (explore grids): MovieBox's H5 detail for seasons,
    // net79's /api/native/meta as a fallback for the text.
    async function loadNative(p, cb) {
        const res = await Promise.all([h5("/detail?detailPath=" + encodeURIComponent(p.dp || "")),
            api("/api/native/meta?dp=" + encodeURIComponent(p.dp || "") + "&id=" + encodeURIComponent(p.sid))]);
        const d = res[0], meta = res[1] || {};
        const sub = (d && d.subject) || {};
        const title = sub.title || meta.title || p.title || "Unknown";
        const seasons = ((d && d.resource && d.resource.seasons) || []).filter(function (s) { return s.se > 0 && s.maxEp > 0; });
        const isTv = seasons.length ? true : (Number(sub.subjectType) === 2 || meta.type === "tv" || p.type === "tv");
        const base = { k: "n", sid: String(p.sid), dp: p.dp || "", title: title };
        const poster = (sub.cover && sub.cover.url) || String(meta.poster || "").replace(/\?.*$/, "") || "";
        const common = {
            title: title,
            url: JSON.stringify(Object.assign({ type: isTv ? "tv" : "movie" }, base)),
            posterUrl: poster,
            year: num(String(sub.releaseDate || meta.year || "").slice(0, 4)),
            description: sub.description || meta.description || "",
            score: score(sub.imdbRatingValue),
            tags: String(sub.genre || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 5),
            cast: ((d && d.stars) || []).slice(0, 12).map(function (c) {
                return mkActor({ name: c.name, role: c.character || "", image: (c.avatarUrl || "") });
            })
        };
        if (!isTv) {
            common.type = "movie";
            common.duration = sub.duration ? Math.round(Number(sub.duration) / 60) || null : null;
            common.episodes = [mkEpisode({ name: "Full Movie", url: JSON.stringify(Object.assign({ type: "movie" }, base)), season: 1, episode: 1, posterUrl: poster })];
            return cb({ success: true, data: mkItem(common) });
        }
        const list = seasons.length ? seasons : [{ se: 1, maxEp: 1 }];
        const episodes = [];
        list.forEach(function (s) {
            for (let e = 1; e <= Math.min(Number(s.maxEp), 2000); e++) {
                episodes.push(mkEpisode({ name: "Episode " + e, season: Number(s.se), episode: e, posterUrl: poster,
                    url: JSON.stringify(Object.assign({ type: "tv", s: Number(s.se), e: e }, base)) }));
            }
        });
        common.type = /anim/i.test(sub.genre || "") ? "anime" : "series";
        common.episodes = episodes;
        cb({ success: true, data: mkItem(common) });
    }

    async function load(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized Net79 url" });
            if (p.k === "n") return await loadNative(p, cb);
            return await loadTmdb(p, cb);
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────
    const STREAM_CACHE = {};

    function unproxy(u) {
        // "/api/proxy/video?url=<enc>" -> the real (CloudFront-signed) subtitle file
        const m = String(u || "").match(/[?&]url=([^&]+)/);
        if (/\/api\/proxy\//.test(String(u || "")) && m) { try { return decodeURIComponent(m[1]); } catch (_) {} }
        if (/^\//.test(String(u || ""))) return SITE + u;
        return String(u || "");
    }
    function subsOf(j) {
        const out = [], seen = {};
        (j.captions || []).forEach(function (c) {
            const url = unproxy(c.url);
            const lang = String(c.lang || c.lan || "").toLowerCase();
            if (!/^https?:/.test(url) || seen[lang + url]) return;
            seen[lang + url] = 1;
            out.push({ url: url, label: c.name || c.lanName || lang || "Subtitle", lang: lang || "und" });
        });
        // English first, then Hindi, then the rest
        out.sort(function (a, b) {
            function r(x) { return x.lang === "en" ? 0 : x.lang === "hi" ? 1 : 2; }
            return r(a) - r(b);
        });
        return out.slice(0, 25);
    }
    function proxied(fileUrl, j) {
        if (j && j.exp && j.sig) return WORKER + "/?url=" + encodeURIComponent(fileUrl) + "&exp=" + j.exp + "&sig=" + encodeURIComponent(j.sig);
        return SITE + "/api/proxy/video?url=" + encodeURIComponent(fileUrl); // 302 -> worker with a fresh signature
    }
    // the app's StreamResult constructor drops "quality" (it reads the [1080p] in the label); keep it anyway
    function withQ(st, q) { try { if (st && st.quality == null) st.quality = q; } catch (_) {} return st; }
    function qLabel(r) { r = Number(r) || 0; return r >= 2160 ? "4K" : r ? r + "p" : "Auto"; }

    // one MovieBox answer -> stream entries
    function streamsFrom(j, lang, primary) {
        if (!j || !j.ok || j.mode !== "proxy") return [];
        const files = (j.streams || []).filter(function (s) { return s && s.url; })
            .sort(function (a, b) { return Number(b.resolution) - Number(a.resolution); });
        if (!files.length && j.mp4) files.push({ url: j.mp4, resolution: Number(j.resolution) || 0 });
        const subs = subsOf(j);
        const out = [];
        // dubs: the 360p file is left out when better ones exist (keeps the list short)
        const pick = primary ? files.slice(0, 4) : files.filter(function (f, i) { return i === 0 || Number(f.resolution) >= 480; }).slice(0, 2);
        pick.forEach(function (f) {
            const q = qLabel(f.resolution);
            const size = Number(f.size) ? " · " + (Number(f.size) / 1073741824).toFixed(2) + " GB" : "";
            const o = { url: f.url, source: "Net79 " + lang + " [" + q + "]" + size, quality: q, headers: DIRECT_HEADERS };
            if (subs.length) o.subtitles = subs;
            out.push(withQ(mkStream(o), q));
        });
        // the site's own video proxy: the two best qualities for the main audio, the best one for dubs
        pick.slice(0, primary ? 2 : 1).forEach(function (f) {
            const q = qLabel(f.resolution);
            const o = { url: proxied(f.url, j), source: "Net79 " + lang + " [" + q + "] · Proxy", quality: q, headers: PROXY_HEADERS };
            if (subs.length) o.subtitles = subs;
            out.push(withQ(mkStream(o), q));
        });
        return out;
    }

    const LANGS = { en: "English", hi: "Hindi", ko: "Korean", ja: "Japanese", zh: "Chinese", cn: "Chinese", ta: "Tamil", te: "Telugu",
        ml: "Malayalam", kn: "Kannada", bn: "Bengali", ur: "Urdu", pa: "Punjabi", mr: "Marathi", es: "Spanish", fr: "French",
        de: "German", it: "Italian", pt: "Portuguese", ru: "Russian", tr: "Turkish", th: "Thai", id: "Indonesian", ar: "Arabic", tl: "Filipino" };
    const DUB_ORDER = [/hindi/i, /english/i, /original/i, /tamil/i, /telugu/i, /malayalam|kannada|bengali|urdu|punjabi|marathi/i];
    function dubRank(lang) {
        for (let i = 0; i < DUB_ORDER.length; i++) if (DUB_ORDER[i].test(lang)) return i;
        return DUB_ORDER.length;
    }
    function wantedDub(lang) { return dubRank(lang) < DUB_ORDER.length; }
    function cleanLang(l) {
        l = String(l || "").trim();
        if (/^default$/i.test(l)) return "";
        return l.replace(/\s+dub$/i, "").replace(/^original audio$/i, "Original");
    }

    async function streamsTmdb(p) {
        const se = p.type === "tv" ? (p.s || 1) : 1, ep = p.type === "tv" ? (p.e || 1) : 1;
        const base = "/api/embed-tmdb/" + p.id + "?type=" + p.type + "&se=" + se + "&ep=" + ep;
        const first = await Promise.all([
            api(base, 40000),
            api("/api/variants-tmdb/" + p.type + "/" + p.id + "?se=" + se + "&ep=" + ep, 20000),
            api("/api/catalog/title/" + p.type + "/" + p.id, 15000)
        ]);
        const main = first[0], vars = first[1] || {};
        const catVars = ((first[2] && first[2].catalog && first[2].catalog.variants) || []);
        const variants = (vars.variants || []);
        const mainSid = String((main && main.subjectId) || vars.defaultSubjectId || "");
        const mainVar = variants.filter(function (v) { return String(v.dubSubjectId) === mainSid; })[0];
        let mainLang = cleanLang(mainVar && mainVar.language);
        if (!mainLang) {
            const cv = catVars.filter(function (v) { return String(v.subjectId) === mainSid; })[0];
            if (cv && cv.corner) mainLang = String(cv.corner).trim();
        }
        // the main file is the original audio: name it after the title's language
        if (!mainLang && first[2] && LANGS[first[2].originalLanguage]) mainLang = LANGS[first[2].originalLanguage];
        // other audio tracks (subtitle-only variants "Arabic sub" etc. are skipped)
        const dubs = variants.filter(function (v) {
            return v && v.dubSubjectId && String(v.dubSubjectId) !== mainSid && /dub|original/i.test(v.language || "") && !/\bsub\b/i.test(v.language || "") && wantedDub(v.language || "");
        }).sort(function (a, b) { return dubRank(a.language) - dubRank(b.language); }).slice(0, 4);
        const dubRes = await Promise.all(dubs.map(function (v) {
            return api(base + "&dub=" + encodeURIComponent(v.dubSubjectId) + "&dubdp=" + encodeURIComponent(v.detailPath || ""), 40000);
        }));
        if (!mainLang && dubs.length) mainLang = "Default";
        let out = streamsFrom(main, mainLang ? "· " + mainLang : "", true);
        const seenSid = {}; seenSid[mainSid] = 1;
        dubRes.forEach(function (j, i) {
            // when a dub is missing for this episode the server falls back to the default audio
            if (!j || !j.ok || seenSid[String(j.subjectId)] || String(j.subjectId) !== String(dubs[i].dubSubjectId)) return;
            seenSid[String(j.subjectId)] = 1;
            out = out.concat(streamsFrom(j, "· " + cleanLang(dubs[i].language), false));
        });
        return { list: out, err: main && main.error };
    }

    async function streamsNative(p) {
        const se = p.type === "tv" ? (p.s || 1) : 0, ep = p.type === "tv" ? (p.e || 1) : 0;
        function path(sid, dp) {
            return "/api/embed-direct/" + encodeURIComponent(sid) + "?type=" + (p.type === "tv" ? "tv" : "movie") +
                (p.type === "tv" ? "&se=" + se + "&ep=" + ep : "") + (dp ? "&dp=" + encodeURIComponent(dp) : "");
        }
        const main = await api(path(p.sid, p.dp), 40000);
        const dubsAll = ((main && main.dubs) || []).map(function (d) {
            return { sid: String(d.subjectId), lang: d.lanName || d.lanCode || "", dp: d.detailPath || "", original: !!d.original };
        });
        const mainD = dubsAll.filter(function (d) { return d.sid === String(p.sid); })[0];
        const dubs = dubsAll.filter(function (d) {
            return d.sid !== String(p.sid) && /dub|original/i.test(d.lang) && !/\bsub\b/i.test(d.lang) && wantedDub(d.lang);
        }).sort(function (a, b) { return dubRank(a.lang) - dubRank(b.lang); }).slice(0, 4);
        const dubRes = await Promise.all(dubs.map(function (d) { return api(path(d.sid, d.dp), 40000); }));
        let mainLang = cleanLang(mainD && mainD.lang);
        if (!mainLang && dubs.length) mainLang = "Default";
        let out = streamsFrom(main, mainLang ? "· " + mainLang : "", true);
        dubRes.forEach(function (j, i) { out = out.concat(streamsFrom(j, "· " + cleanLang(dubs[i].lang), false)); });
        return { list: out, err: main && main.error };
    }

    async function loadStreams(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized Net79 url" });
            const ckey = [p.k, p.id || p.sid, p.type, p.s || 0, p.e || 0].join(":");
            const hit = STREAM_CACHE[ckey];
            if (hit && Date.now() - hit.t < 15 * 60000) return cb({ success: true, data: hit.data });
            const r = p.k === "n" ? await streamsNative(p) : await streamsTmdb(p);
            if (!r.list.length) {
                return cb({ success: false, errorCode: "NO_STREAMS",
                    message: r.err ? String(r.err) : ("net79.cc has no video for this " + (p.type === "tv" ? "episode" : "movie") + " right now.") });
            }
            STREAM_CACHE[ckey] = { t: Date.now(), data: r.list };
            cb({ success: true, data: r.list });
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
