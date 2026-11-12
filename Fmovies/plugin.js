/*
 * FMoviess — SkyStream plugin
 * Site:   https://fmoviess.tv
 * Flow:
 *   catalog  : fmoviess.tv SSR pages (trending / movies / tv / search)
 *   metadata : TMDB api (same public key the site's own player uses)
 *   streams  : moviesapi.to vidora API (direct HLS + subtitles), vixsrc.to, nxsha.space servers
 *
 * Exports: getHome / search / load / loadStreams
 */

(function (__ngRawGet, __ngRawPost) {

    'use strict';

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


    // Dynamic base URL: the app injects the domain picked in the settings gear.
    var SITE = (typeof manifest !== 'undefined' && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, '')
        : 'https://fmoviess.tv';
    if (SITE.slice(-1) === '/') SITE = SITE.slice(0, -1);

    var TMDB_KEY = 'e716f19ab4d25edc5247239a8f3494f8'; // public key shipped in the player bundle
    var TMDB = 'https://api.themoviedb.org/3';
    var TMDB_IMG = 'https://image.tmdb.org/t/p';

    var VIDORA = 'https://moviesapi.to/api/vidora/v1';
    var PLAYER_KEY = '3a67e8866ae1d2bb9e81fe7f73315a56eb3bdf5e3e755c7554c8be6910aa6b13';
    var PLAYER_REFERER = 'https://moviesapi.to/';

    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    // Plain headers only: spoofed X-Forwarded-For / CF-Connecting-IP / True-Client-IP
    // don't change the caller's location, and Cloudflare answers them with HTTP 403.
    function mergeGeoHeaders(base) { return Object.assign({}, base || {}); }

    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=FMoviess';

    var MAX_SEASON_FETCH = 10; // fetch per-season details for shows with up to N seasons

    // ─────────────────────────── helpers ───────────────────────────

    function decodeEntities(s) {
        return String(s == null ? '' : s)
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#x27;|&#0?39;/g, "'").replace(/&apos;/g, "'")
            .replace(/&nbsp;/g, ' ');
    }

    async function getText(url, headers) {
        var res = await http_get(url, Object.assign({
            'User-Agent': UA,
            'Accept': 'text/html,application/json,*/*;q=0.8'
        }, headers || {}));
        var body = (res && typeof res === 'object') ? res.body : res;
        var status = (res && typeof res === 'object') ? (res.status || res.statusCode || 0) : 0;
        if (status && (status < 200 || status >= 300)) throw new Error('HTTP ' + status + ' ' + url.slice(0, 80));
        return typeof body === 'string' ? body : '';
    }

    async function getJson(url, headers) {
        var body = await getText(url, Object.assign({ 'Accept': 'application/json' }, headers || {}));
        try { return JSON.parse(body); } catch (e) { throw new Error('Bad JSON from ' + url.slice(0, 70)); }
    }

    function mkItem(obj)      { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj)   { try { return new Episode(obj); }       catch (_) { return obj; } }
    function mkStream(obj) {
        var s;
        try {
            s = new StreamResult({ url: obj.url, source: obj.source || obj.quality, headers: obj.headers, subtitles: obj.subtitles });
            s.quality = obj.quality;
        } catch (_) { s = obj; }
        return s;
    }

    // ─────────────────────── catalog scraping ───────────────────────
    // Cards on every list page:  <a ... href="/(movie|tv)/{id}/{slug}" ...>
    //   <img ... src="https://image.tmdb.org/t/p/...jpg" alt="Title">
    //   <h3 ...>Title</h3>  ...  Movie • 2026 / TV • 2025

    function parseCards(html) {
        var out = [];
        var seen = {};
        var re = /<a\b[^>]*href="\/(movie|tv)\/(\d+)\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            var type = m[1] === 'tv' ? 'series' : 'movie';
            var id = m[2], slug = m[3], inner = m[4];

            if (seen[id + '|' + type]) continue;
            seen[id + '|' + type] = 1;

            var posterM = inner.match(/src="(https:\/\/image\.tmdb\.org\/t\/p\/[^"]+)"/i);
            var titleM = inner.match(/<h3[^>]*>([^<]+)<\/h3>/i)
                       || inner.match(/alt="([^"]{2,120})"/);
            var yearM = inner.match(/(?:Movie|TV)(?:<!-- -->)?\s*(?:•|&bull;)\s*(?:<!-- -->)?(\d{4})/i);

            var title = titleM ? decodeEntities(titleM[1]).trim() : slug.replace(/-/g, ' ');
            if (/^(poster|image|cover)$/i.test(title)) title = slug.replace(/-/g, ' ');

            out.push({
                type: type,
                tmdbId: id,
                slug: slug,
                title: title,
                posterUrl: posterM ? posterM[1] : PLACEHOLDER,
                year: yearM ? parseInt(yearM[1], 10) : undefined
            });
        }
        return out;
    }

    function toUrl(card) {
        return SITE + '/' + (card.type === 'series' ? 'tv' : 'movie') + '/' + card.tmdbId + '/' + card.slug;
    }

    function cardToItem(card) {
        return mkItem({
            title: card.title,
            url: toUrl(card),
            posterUrl: card.posterUrl,
            bannerUrl: card.posterUrl,
            type: card.type,
            year: card.year,
            syncData: { tmdb: String(card.tmdbId) }
        });
    }

    async function fetchPage(path) {
        var html = await getText(SITE + path, { 'Referer': SITE + '/' });
        return parseCards(html);
    }

    // ─────────────────────────── getHome ───────────────────────────

    // "Latest Updated" — shows with an episode airing today (TMDB schedule)
    async function latestUpdated() {
        var tryPaths = ['/tv/airing_today', '/tv/on_the_air'];
        for (var i = 0; i < tryPaths.length; i++) {
            try {
                var d = await tmdb(tryPaths[i] + '?page=1');
                var results = (d && d.results) || [];
                if (!results.length) continue;
                return results.slice(0, 20).map(function (r) {
                    var name = r.name || r.original_name || 'tv';
                    var slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                    return mkItem({
                        title: name,
                        url: SITE + '/tv/' + r.id + '/' + slug,
                        posterUrl: r.poster_path ? (TMDB_IMG + '/w500' + r.poster_path) : PLACEHOLDER,
                        bannerUrl: r.backdrop_path ? (TMDB_IMG + '/w1280' + r.backdrop_path) : undefined,
                        type: 'series',
                        year: r.first_air_date ? parseInt(String(r.first_air_date).slice(0, 4), 10) : undefined,
                        score: r.vote_average || undefined,
                        description: r.overview || undefined,
                        syncData: { tmdb: String(r.id) }
                    });
                });
            } catch (_) { /* try the next schedule endpoint */ }
        }
        return [];
    }

    async function getHome(cb) {
        try {
            var defs = [
                { name: 'Trending',        path: '/trending' },
                { name: 'Latest Movies',   path: '/movies' },
                { name: 'Latest TV Shows', path: '/tv' }
            ];
            var pageRows = await Promise.all(defs.map(function (d) {
                return fetchPage(d.path).then(
                    function (v) { return v; },
                    function (e) { console.error('Row failed:', d.name, e && e.message); return null; }
                );
            }));
            var updated = await latestUpdated().catch(function () { return []; });

            var data = {};
            for (var i = 0; i < defs.length; i++) {
                if (pageRows[i] && pageRows[i].length) {
                    data[defs[i].name] = pageRows[i].slice(0, 20).map(cardToItem);
                }
            }
            if (updated.length) data['Latest Updated'] = updated;

            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'FMoviess returned no content (' + SITE + ')' });
            }
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── search ───────────────────────────

    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var cards = await fetchPage('/search?q=' + encodeURIComponent(q));
            cb({ success: true, data: cards.slice(0, 30).map(cardToItem) });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── load ───────────────────────────

    // item urls:  https://fmoviess.tv/movie/{id}/{slug}
    //              https://fmoviess.tv/tv/{id}/{slug}
    function parseItemUrl(url) {
        var m = String(url || '').match(/\/(movie|tv)\/(\d+)(?:\/([a-z0-9-]+))?/i);
        if (!m) return null;
        return {
            kind: m[1] === 'tv' ? 'tv' : 'movie',
            tmdbId: m[2],
            slug: m[3] || '',
            season: null,
            episode: null
        };
    }

    async function tmdb(path) {
        return getJson(TMDB + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + TMDB_KEY);
    }

    async function load(url, cb) {
        try {
            var p = parseItemUrl(url);
            if (!p) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized FMoviess URL: ' + url });

            var det;
            try {
                det = await tmdb('/' + (p.kind === 'tv' ? 'tv' : 'movie') + '/' + p.tmdbId);
            } catch (_) { det = null; }

            var title, poster, banner, description, year, score, runtime, status;
            if (det && det.id) {
                title = det.title || det.name || p.slug.replace(/-/g, ' ');
                poster = det.poster_path ? (TMDB_IMG + '/w500' + det.poster_path) : PLACEHOLDER;
                banner = det.backdrop_path ? (TMDB_IMG + '/w1280' + det.backdrop_path) : poster;
                description = det.overview || '';
                var d = det.release_date || det.first_air_date || '';
                year = d ? parseInt(d.slice(0, 4), 10) : undefined;
                score = det.vote_average || undefined;
                runtime = det.runtime || det.episode_run_time && det.episode_run_time[0] || undefined;
                status = det.status === 'Released' || det.status === 'Ended' || det.in_production === false ? 'completed' : 'ongoing';
            } else {
                // fallback: scrape the site detail page og tags
                var html = await getText(url);
                title = (html.match(/<meta property="og:image:alt" content="([^"]*)"/) || [])[1]
                     || (html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1]
                     || p.slug.replace(/-/g, ' ');
                poster = (html.match(/<meta property="og:image" content="([^"]*)"/) || [])[1] || PLACEHOLDER;
                banner = poster;
                description = decodeEntities((html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || '');
                year = parseInt((title.match(/\((19\d{2}|20\d{2})\)/) || [])[1], 10) || undefined;
            }

            var item = {
                title: decodeEntities(title),
                url: SITE + '/' + (p.kind === 'tv' ? 'tv' : 'movie') + '/' + p.tmdbId + (p.slug ? '/' + p.slug : ''),
                posterUrl: poster,
                bannerUrl: banner,
                type: p.kind === 'tv' ? 'series' : 'movie',
                year: year,
                score: score,
                duration: runtime || undefined,
                status: status,
                description: description || undefined,
                syncData: { tmdb: String(p.tmdbId) }
            };

            var episodes = [];

            if (p.kind === 'tv') {
                var seasons = (det && det.seasons) || [];
                if (!seasons.length && det && det.number_of_seasons) {
                    for (var si = 1; si <= det.number_of_seasons; si++) seasons.push({ season_number: si, episode_count: null });
                }
                var real = seasons.filter(function (s) { return s.season_number > 0; });

                if (real.length && real.length <= MAX_SEASON_FETCH) {
                    // fetch season details in parallel -> real episode names, stills, air dates
                    var seasonLists = await Promise.all(real.map(function (s) {
                        return tmdb('/tv/' + p.tmdbId + '/season/' + s.season_number).then(
                            function (v) { return v && v.episodes ? v.episodes : null; },
                            function () { return null; }
                        );
                    }));
                    for (var i = 0; i < real.length; i++) {
                        var sn = real[i].season_number;
                        var eps = seasonLists[i];
                        if (eps && eps.length) {
                            for (var j = 0; j < eps.length; j++) {
                                episodes.push(episodeFromApi(p, sn, eps[j], poster));
                            }
                        } else {
                            var count = real[i].episode_count || 0;
                            for (var k = 0; k < count; k++) {
                                episodes.push(plainEpisode(p, sn, k + 1, poster));
                            }
                        }
                    }
                } else {
                    // too many seasons / no details — build from counts only
                    for (var i2 = 0; i2 < real.length; i2++) {
                        var snum = real[i2].season_number;
                        var cnt = real[i2].episode_count || 0;
                        for (var k2 = 0; k2 < cnt; k2++) {
                            episodes.push(plainEpisode(p, snum, k2 + 1, poster));
                        }
                    }
                }

                if (!episodes.length) {
                    return cb({ success: false, errorCode: 'NO_EPISODES',
                                message: 'No episode list available for this show (TMDB did not respond)' });
                }
            }

            // Movies get a single pseudo-episode (SkyStream's play button needs one)
            if (p.kind === 'movie') {
                episodes = [mkEpisode({
                    name: item.title,
                    url: item.url,
                    season: 1,
                    episode: 1,
                    posterUrl: poster,
                    runtime: runtime || undefined,
                    dubStatus: 'none',
                    playbackPolicy: 'none'
                })];
            }

            item.episodes = episodes;
            cb({ success: true, data: mkItem(item) });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    function episodeUrl(p, season, ep) {
        return SITE + '/tv/' + p.tmdbId + (p.slug ? '/' + p.slug : '') + '?season=' + season + '&episode=' + ep;
    }

    function parseEpisodeQuery(url) {
        var m = String(url || '').match(/[?&]season=(\d+)&episode=(\d+)/);
        return m ? { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) } : null;
    }

    function episodeFromApi(p, season, ep, showPoster) {
        return mkEpisode({
            name: ep.name && ep.name.trim() ? ('E' + ep.episode_number + ' • ' + decodeEntities(ep.name)) : ('Episode ' + ep.episode_number),
            url: episodeUrl(p, season, ep.episode_number),
            season: season,
            episode: ep.episode_number,
            posterUrl: ep.still_path ? (TMDB_IMG + '/w300' + ep.still_path) : showPoster,
            description: ep.overview ? decodeEntities(ep.overview) : undefined,
            airDate: ep.air_date || undefined,
            runtime: ep.runtime || undefined,
            rating: ep.vote_average || undefined,
            dubStatus: 'none',
            playbackPolicy: 'none'
        });
    }

    function plainEpisode(p, season, ep, showPoster) {
        return mkEpisode({
            name: 'Episode ' + ep,
            url: episodeUrl(p, season, ep),
            season: season,
            episode: ep,
            posterUrl: showPoster,
            dubStatus: 'none',
            playbackPolicy: 'none'
        });
    }

    // ─────────────────────────── loadStreams ───────────────────────────

    // quality label from HLS RESOLUTION=WxH — exact height (960p, 640p…)
    // so SkyStream sorts qualities correctly between standards
    function qualityFromResolution(w, h) {
        if (!h) return 'Auto';
        var std = { 2160: '2160p/4K', 1080: '1080p', 720: '720p', 480: '480p' };
        return std[h] ? std[h] : (h + 'p');
    }


    // ── Server A: moviesapi.to "vidora" (direct HLS + subtitles) ──
    async function vidoraStreams(kind, tmdbId, season, episode) {
        var apiUrl = kind === 'tv'
            ? VIDORA + '/tv/' + tmdbId + '/' + season + '/' + episode
            : VIDORA + '/movie/' + tmdbId;

        var data = null;
        try {
            var res = await http_get(apiUrl, {
                'User-Agent': UA,
                'Accept': 'application/json',
                'x-player-key': PLAYER_KEY,
                'Referer': PLAYER_REFERER,
                'Origin': PLAYER_REFERER.slice(0, -1)
            });
            var body = (res && typeof res === 'object') ? res.body : res;
            try { data = JSON.parse(typeof body === 'string' ? body : JSON.stringify(body)); }
            catch (_) { data = null; }
        } catch (_) { return []; }

        if (!data || !data.result || !data.sources || !data.sources[0] || !data.sources[0].url) {
            return [];
        }

        var master = data.sources[0].url;
        var subs = [];
        (data.sources[0].tracks || []).forEach(function (t) {
            if (t && t.file && t.label) subs.push({ url: t.file, label: t.label, lang: t.label });
        });
        var headers = { 'Referer': PLAYER_REFERER, 'User-Agent': UA };

        var streams = [mkStream({
            url: master,
            quality: 'MoviesAPI • Auto',
            headers: headers,
            subtitles: subs.length ? subs : undefined
        })];

        // split master into per-quality options
        try {
            var body2 = await getText(master, { 'Referer': PLAYER_REFERER });
            var lines = body2.split('\n');
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].indexOf('#EXT-X-STREAM-INF') === 0) {
                    var resM = lines[i].match(/RESOLUTION=(\d+)x(\d+)/i);
                    var bwM = lines[i].match(/BANDWIDTH=(\d+)/);
                    var next = '';
                    for (var j = i + 1; j < lines.length; j++) {
                        var t = lines[j].trim();
                        if (t && t.charAt(0) !== '#') { next = t; break; }
                    }
                    if (!next) continue;
                    if (next.indexOf('http') !== 0) {
                        next = master.slice(0, master.lastIndexOf('/') + 1) + next;
                    }
                    var q = resM ? qualityFromResolution(parseInt(resM[1], 10), parseInt(resM[2], 10))
                                 : (bwM ? Math.round(parseInt(bwM[1], 10) / 1000) + ' kbps' : 'Auto');
                    streams.push(mkStream({
                        url: next,
                        quality: 'MoviesAPI • ' + q,
                        headers: headers,
                        subtitles: subs.length ? subs : undefined
                    }));
                }
            }
        } catch (_) { /* master unreadable — Auto option above still stands */ }

        return streams;
    }

    // ── Server B: vixsrc.to (multi-audio HLS masters) ──
    //  /api/{movie|tv}/... -> {"src":"/embed/{id}?token=.."} ->
    //  embed page exposes window.masterPlaylist + window.streams ->
    //  /playlist/{id}?token=..&expires=..&h=1 -> master m3u8
    async function vixsrcStreams(kind, tmdbId, season, episode) {
        var referer = kind === 'tv'
            ? 'https://vixsrc.to/tv/' + tmdbId + '/' + season + '/' + episode
            : 'https://vixsrc.to/movie/' + tmdbId;
        var apiUrl = kind === 'tv'
            ? 'https://vixsrc.to/api/tv/' + tmdbId + '/' + season + '/' + episode
            : 'https://vixsrc.to/api/movie/' + tmdbId;

        var page = '';
        try {
            var api = await getText(apiUrl, { 'Referer': referer, 'Accept': 'application/json' });
            var src = (JSON.parse(api) || {}).src;
            if (!src) return [];
            page = await getText('https://vixsrc.to' + src, { 'Referer': referer });
        } catch (_) { return []; }

        var token = (page.match(/'token'\s*:\s*'([^']+)'/) || [])[1];
        var expires = (page.match(/'expires'\s*:\s*'([^']+)'/) || [])[1];
        if (!token || !expires) return [];
        var canFHD = /window\.canPlayFHD\s*=\s*true/.test(page);

        var streams = [];
        var servers = [];
        try {
            var sj = (page.match(/window\.streams\s*=\s*(\[[^\]]+\])/) || [])[1];
            if (sj) {
                JSON.parse(sj.replace(/\\"/g, '"')).forEach(function (s) {
                    if (s && s.url) servers.push({ name: s.name || 'Server', url: s.url });
                });
            }
        } catch (_) { servers = []; }
        if (!servers.length) {
            servers.push({ name: 'Server 1', url: 'https://vixsrc.to/playlist/' + tmdbId });
        }

        for (var i = 0; i < servers.length && i < 3; i++) {
            try {
                var u = servers[i].url;
                u += (u.indexOf('?') >= 0 ? '&' : '?')
                   + 'token=' + encodeURIComponent(token)
                   + '&expires=' + encodeURIComponent(expires)
                   + '&asn=' + (canFHD ? '&h=1' : '');
                var pl = await getText(u, { 'Referer': referer });
                if (pl.indexOf('#EXTM3U') === 0) {
                    streams.push(mkStream({
                        url: u,
                        quality: 'VixSrc • ' + (servers[i].name || ('Server ' + (i + 1))) + ' • Auto',
                        headers: { 'Referer': referer, 'User-Agent': UA }
                    }));
                }
            } catch (_) { /* this vixsrc server failed — try the next */ }
        }
        return streams;
    }

    // ── Server C: nxsha.space (the multi-server backend behind ScreenScape / RiveStream) ──
    // Covers TV episodes and the movies MoviesAPI has not encoded. The query is AES-encrypted
    // in-plugin with nxsha's passphrase; replies are decrypted through the app's crypto bridge.
    function withTimeout(promise, ms) { return __tjDeadline(promise, ms); }
    const NX_BASE = "https://nxsha.space";
    // AES passphrase from nxsha.space front-end bundle (rotated 2026-10; was "S8x!Jk4ZP1uG8$my").
    let NX_PASS = "38c8cd65d781936f4b9fe1fd985234fd7335699855051abf76ea3493bcfc0120";

    function nxMd5(str, raw) {
        const msg = raw ? str : unescape(encodeURIComponent(str));
        const n = msg.length;
        const words = [];
        for (let i = 0; i < n; i++) words[i >> 2] = (words[i >> 2] || 0) | (msg.charCodeAt(i) << ((i % 4) << 3));
        words[n >> 2] = (words[n >> 2] || 0) | (0x80 << ((n % 4) << 3));
        const wl = (((n + 8) >> 6) + 1) << 4;
        for (let i = 0; i < wl; i++) words[i] = words[i] || 0;
        words[wl - 2] = n << 3;
        const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
                   5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
                   4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
                   6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
        function rl(v, c) { return (v << c) | (v >>> (32 - c)); }
        let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        for (let i = 0; i < wl; i += 16) {
            const M = words.slice(i, i + 16);
            const oa = a, ob = b, oc = c, od = d;
            for (let j = 0; j < 64; j++) {
                let f, g;
                if (j < 16)      { f = (b & c) | (~b & d);  g = j; }
                else if (j < 32) { f = (d & b) | (~d & c);  g = (5 * j + 1) % 16; }
                else if (j < 48) { f = b ^ c ^ d;           g = (3 * j + 5) % 16; }
                else             { f = c ^ (b | ~d);        g = (7 * j) % 16; }
                const tmp = d;
                d = c; c = b;
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
        for (let i = 0; i < 255; i++) {
            exp[i] = x; log[x] = i;
            x = (x ^ ((x << 1) ^ (x & 0x80 ? 0x11b : 0))) & 255; // multiply by 0x03
        }
        exp[255] = 1; log[0] = 0; // sentinels (inverse of 1 = exp[255 - 0])
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
                    t[c * 4]     = nxXtime(a0) ^ (nxXtime(a1) ^ a1) ^ a2 ^ a3;
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
        // CryptoJS OpenSSL KDF: D_i = MD5(D_{i-1} || pass || salt)
        const passB = [];
        for (let i = 0; i < pass.length; i++) passB.push(pass.charCodeAt(i) & 255);
        const saltB = Array.from(salt);
        const d = [];
        let prev = [];
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
        const out = [0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]; // "Salted__"
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

    async function nxDecode0(b64url) {
        try {
            let std = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
            while (std.length % 4 !== 0) std += "=";
            const bin = atob(std);
            const bytes = [];
            for (let i = 16; i < bin.length; i++) bytes.push(bin.charCodeAt(i)); // skip "Salted__" + 8-byte salt
            const salt = [];
            for (let i = 8; i < 16; i++) salt.push(bin.charCodeAt(i));
            const derived = nxEvp(NX_PASS, salt, 32, 16);
            const ctB64 = nxBytesToB64(bytes);
            const keyB64 = nxBytesToB64(derived.key);
            const ivB64 = nxBytesToB64(derived.iv);
            const plain = await crypto.decryptAES(ctB64, keyB64, ivB64, { mode: "cbc" });
            const o = JSON.parse(String(plain));
            delete o._req_ts; delete o._req_salt;
            return o;
        } catch (e) { return null; }
    }

    // nxsha rotates its passphrase now and then. When a reply no longer decrypts, read the
    // current one from nxsha's own player bundle (embed page -> its chunks -> the 64-hex
    // passphrase) and keep it for the rest of the session.
    let NX_REFRESH = null, NX_REFRESH_AT = 0;
    function nxRefreshPass(sample) {
        if (NX_REFRESH) return NX_REFRESH;
        if (Date.now() - NX_REFRESH_AT < 10 * 60000) return Promise.resolve(false);
        NX_REFRESH_AT = Date.now();
        NX_REFRESH = (async function () {
            const h = { "User-Agent": UA, "Referer": NX_BASE + "/" };
            const seen = {}, cands = [];
            async function grab(paths) {
                const todo = paths.filter(function (p) { if (seen[p]) return false; seen[p] = 1; return true; }).slice(0, 16);
                const bodies = await Promise.all(todo.map(function (p) {
                    return withTimeout(http_get(NX_BASE + "/_next/" + p, h), 7000).then(function (r) { return String((r && r.body) || ""); }, function () { return ""; });
                }));
                const next = [];
                bodies.forEach(function (b) {
                    b.replace(/"([0-9a-f]{64})"/g, function (_, k) { if (cands.indexOf(k) < 0) cands.push(k); return _; });
                    b.replace(/"(static\/chunks\/[A-Za-z0-9_.-]+\.js)"/g, function (_, c) { next.push(c); return _; });
                });
                return next;
            }
            try {
                const pg = await withTimeout(http_get(NX_BASE + "/embed/movie/27205", h), 7000);
                const first = [];
                String((pg && pg.body) || "").replace(/\/_next\/(static\/chunks\/[A-Za-z0-9_.-]+\.js)/g, function (_, c) { first.push(c); return _; });
                const more = await grab(first);
                if (!cands.length) await grab(more);
            } catch (e) {}
            const old = NX_PASS;
            for (let i = 0; i < cands.length; i++) {
                if (cands[i] === old) continue;
                NX_PASS = cands[i];
                if (await nxDecode0(sample) !== null) return true;
            }
            NX_PASS = old;
            return false;
        })().then(function (ok) { NX_REFRESH = null; return ok; }, function () { NX_REFRESH = null; return false; });
        return NX_REFRESH;
    }

    async function nxDecode(b64url) {
        let o = await nxDecode0(b64url);
        if (o === null && b64url && await nxRefreshPass(b64url)) o = await nxDecode0(b64url);
        return o || {};
    }


    // Server names as screenscape.me / nxsha show them.
    const NX_PRETTY = {
        "nitro": "Nitro", "mbox": "MbPly", "mhbox": "MhPly", "rive-citadel": "Citadel", "bdxs": "BlueMulti",
        "watchout": "Watchout", "rive-primevids": "Prism", "stvv": "Stvvid", "imovr": "Topflix", "awsind": "AwsPly",
        "castle": "CastVid", "ophim": "Ophm", "yomovies": "StreamX", "showbox-online": "Xuhd", "vidapi": "VidPi",
        "levi": "Hevily", "toonstream": "TunWatch", "tamilblasters": "TamBlast", "rive-flowcast": "River",
        "hdhub4u": "4K-BK", "hdhub4u-direct": "4K-BKL", "k4khdhub-direct": "4K-HubLink", "k4khdhub": "4K-Hub",
        "filmyfly": "FlyVid", "filmyfly-direct": "FlyVid Direct", "streamflix": "StremFx", "rive-hindicast": "Hindicast",
        "moviesdrive": "MD-4K", "xdownloader": "XDrop", "purstream": "PureWave", "vixolity": "Vixo", "movone": "MovOne",
        "em-8": "VidHindi"
    };
    // Vietnamese hard-subbed and page/embed-only providers are not playable as files.
    const NX_SKIP = /^(ophim)$/;

    async function nxServers(p) {
        const q1 = nxEncode({ tmdbId: String(p.id), imdb_id: "", type: p.type, season: p.s || 0, episode: p.e || 0 });
        const r1 = await withTimeout(http_get(NX_BASE + "/api/servers?q=" + q1, { "User-Agent": UA, "Referer": NX_BASE + "/" }), 10000);
        if (!r1 || !r1.body || Number(r1.status) >= 400) return [];
        const sv = await nxDecode(JSON.parse(r1.body)._hash);
        return (sv.servers || []).filter(function (x) { return x && x.scraper && !NX_SKIP.test(x.scraper); });
    }

    async function nxSources(p, srv) {
        try {
            const q2 = nxEncode({ ex_lang: true, provider: srv.scraper, tmdbId: String(p.id), imdb_id: "", type: p.type, season: p.s || 0, episode: p.e || 0 });
            const r2 = await withTimeout(http_get(NX_BASE + "/api/sources?q=" + q2, { "User-Agent": UA, "Referer": NX_BASE + "/" }), 11000);
            if (!r2 || !r2.body || Number(r2.status) >= 400) return [];
            const so = await nxDecode(JSON.parse(r2.body)._hash);
            return (so.sources || []).map(function (x) { return { scraper: srv.scraper, server: srv.name, src: x }; });
        } catch (e) { return []; }
    }

    function cleanLabel(item) {
        let lb = String(item.src.label || item.src.quality || "").replace(/\s+/g, " ").trim();
        lb = lb.replace(/\s*:\s*[\d,p]+\s*$/i, "")
               .replace(/^\[([^\]]+)\]\s*-\s*/, "$1 ")
               .replace(/\s*[|·]\s*/g, " · ")
               .replace(/\b(hguider|tcloud|dcloud|ipcloud|watchout|vixolity|nitro|darkmatter #?\d*|hubcloud|hubdrive|hubcdn|hblinks|fsl|direct r2|\d+\s*gbps|sply-\d+|s\d+e\d+)\b/ig, "")
               .replace(/\[\s*\]|\(\s*\)/g, "")
               .replace(/^Purstream · pulse · /i, "")
               .replace(/^XDownloader · /i, "")
               .replace(/\s{2,}/g, " ").replace(/^[\s·-]+|[\s·-]+$/g, "");
        return lb;
    }



    function nxQuality(t) {
        const m = String(t || "").match(/\b(2160|1080|720|480|360)p?\b/i);
        if (/\b4k\b/i.test(String(t || ""))) return "4K";
        return m ? (m[1] === "2160" ? "4K" : m[1] + "p") : "Auto";
    }
    async function nxshaStreams(kind, tmdbId, season, episode) {
        const p = { id: tmdbId, type: kind, s: season || 0, e: episode || 0 };
        const servers = await nxServers(p).catch(function () { return []; });
        if (!servers.length) return [];
        const all = [].concat.apply([], await Promise.all(servers.map(function (sv) { return nxSources(p, sv); })));
        const seen = {}, perSrv = {}, perLabel = {}, out = [];
        all.forEach(function (it) {
            const src = it.src || {};
            if (!src.url || src.isEmbed || /embed/i.test(src.type || "")) return;
            const raw = String(src.label || src.quality || "");
            if (/\bsub\b/i.test(raw) && !/dub/i.test(raw)) return;           // subtitle-only file
            const key = String(src.url).split("?")[0];
            if (seen[key]) return; seen[key] = 1;
            const size = (raw.match(/\b\d+(\.\d+)?\s*GB\b/i) || [])[0];
            // HDHub-type scrapers answer episode requests with season packs
            if (kind === "tv" && (/hdhub|4k-?bk|4k-?hub/i.test(String(it.scraper) + " " + String(it.server)) || (size && parseFloat(size) > 4))) return;
            if ((perSrv[it.scraper] = (perSrv[it.scraper] || 0) + 1) > 2) return;
            const name = NX_PRETTY[it.scraper] || String(it.server || it.scraper).replace(/\s*-?\s*\[.*?\]\s*/g, "").trim();
            const lb = cleanLabel(it);
            const q = nxQuality(lb + " " + (src.quality || ""));
            let label = "Nxsha " + name;
            const lang = lb.replace(/\b(4k|2160p?|1080p?|720p?|480p?|360p?|auto)\b/ig, "").replace(/\[\s*NX\s*\]/ig, "").replace(/\s*:\s*/g, " ")
                .replace(/\s*·\s*(·\s*)*/g, " · ").replace(/(\s+-)+\s*$/, "").replace(/^[\s·:-]+|[\s·:-]+$/g, "").replace(/\s{2,}/g, " ").trim();
            if (lang) label += " - " + lang;
            if (size && lang.indexOf(size) < 0) label += " [" + size + "]";
            const n = (perLabel[label] = (perLabel[label] || 0) + 1);
            if (n > 1) label += " #" + n;
            const hdr = Object.assign({ "User-Agent": UA, "Referer": NX_BASE + "/" }, (src.headers && typeof src.headers === "object") ? src.headers : {});
            out.push(mkStream({ url: src.url, source: label + (q !== "Auto" ? " • " + q : ""), quality: q, headers: hdr }));
        });
        const rank = function (q) { return q === "4K" ? 2160 : (parseInt(q, 10) || 0); };
        out.sort(function (a, b) { return rank(b.quality) - rank(a.quality); });
        return out.slice(0, 16);
    }

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
            var p = parseItemUrl(url);
            if (!p) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized FMoviess URL: ' + url });

            var epq = parseEpisodeQuery(url);
            var kind = p.kind;
            var season = epq ? epq.season : null;
            var episode = epq ? epq.episode : null;
            if (kind === 'tv' && !epq) {
                return cb({ success: false, errorCode: 'BAD_URL', message: 'Episode information missing in URL' });
            }

            // both providers in parallel — different CDNs, so if one is blocked
            // or dead in the user's region the other still plays
            var both = await Promise.all([
                vidoraStreams(kind, p.tmdbId, season, episode).then(
                    function (v) { return v; }, function () { return []; }),
                vixsrcStreams(kind, p.tmdbId, season, episode).then(
                    function (v) { return v; }, function () { return []; }),
                nxshaStreams(kind, p.tmdbId, season, episode).then(
                    function (v) { return v; }, function () { return []; })
            ]);

            var streams = both[0].concat(both[1], both[2]);
            if (streams.length) streams = await verifyStreams(streams, 4);
            // MoviesAPI first (direct HLS + subtitles), then vixsrc, then nxsha's servers

            if (!streams.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS',
                            message: 'No stream available for this title yet (provider has not encoded it — try another title or retry later).' });
            }
            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── export ───────────────────────────

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

    __ngWrapExports();
})(typeof http_get !== 'undefined' ? http_get : undefined, typeof http_post !== 'undefined' ? http_post : undefined);
