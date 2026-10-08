/*
 * PikaHD — SkyStream plugin (2026-10-08)
 * Site: https://new.pikahd.co (anime: Hindi dubbed / dual audio / English subbed).
 * Same platform as KatMovieHD (SvelteKit __data.json + links.kmhd.me / HubCloud / GDFlix
 * file hosts), so this plugin shares the KatMovieHD engine; only the site and rows differ.
 * Fix: WP REST API /wp-json is dead. Migrated to SvelteKit __data.json (devalue format).
 * Flow:
 *   catalog : /__data.json?x-sveltekit-invalidated=01 + /category/[slug]/__data.json
 *   search  : /__data.json?x-sveltekit-invalidated=01&q=QUERY
 *   load    : /[slug]/__data.json -> post_content HTML -> kmhd play/file + gdflix direct
 *   watch   : links.kmhd.me/play/__data.json?id=PLAY_ID -> info:{FILE_ID:{name, streamtape_res, streamwish_res}}
 *   download: gdflix.dev / gd.kmhd.eu / hubcloud.ist resolvers (updated hosts)
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
        : 'https://new.pikahd.co';
    if (SITE.slice(-1) === '/') SITE = SITE.slice(0, -1);
    var KMHD = 'https://links.kmhd.me';

    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    // Plain headers only: spoofed X-Forwarded-For / CF-Connecting-IP / True-Client-IP
    // don't change the caller's location, and Cloudflare answers them with HTTP 403.
    function mergeGeoHeaders(base) { return Object.assign({}, base || {}); }

    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=PikaHD';

    var HUBCLOUD_HOST = 'hubcloud.ist';
    var GDFLIX_HOST = 'new4.gdflix.io';
    var GD_KEY = 'acbe2066696a1d44345698deb3d9ebf9ae9bbdfd';

    // Working hosts: StreamTape, StreamWish, HubCloud, GDFlix (GDFlix kept as fallback for titles that only have GDFlix)
    var TOUCHME_CODES = ['streamtape_res', 'streamwish_res', 'hubdrive_res', 'gdflix_res'];
    var PRIORITY_CODES = ['streamtape_res', 'streamwish_res', 'hubdrive_res']; // user requested these 3
    // Common request headers (no spoofed IP/country headers — Cloudflare 403s them)
    var GEO_HEADERS = Object.assign({}, {
        'Accept-Language': 'en-US,en;q=0.9,en-IN;q=0.8,en-PK;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    });

    var ROWS = [
        { name: 'Latest Uploads',      slug: null },
        { name: 'Anime Hindi Dubbed',  slug: 'anime-hindi-dubbed' },
        { name: 'Dual Audio',          slug: 'dual-audio' },
        { name: 'Anime English Subbed', slug: 'anime-eng-subbed' },
        { name: 'Animated Movies',     slug: 'animated' },
        { name: 'Japanese',            slug: 'japanese' },
        { name: 'Action',              slug: 'action' },
        { name: 'Fantasy',             slug: 'fantasy' },
        { name: 'Romance',             slug: 'romance' },
        { name: 'Comedy',              slug: 'comedy' }
    ];

    // ───────────────── helpers ─────────────────

    function decodeEntities(s) {
        return String(s == null ? '' : s)
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, '-').replace(/&#8212;|&mdash;/g, '-')
            .replace(/&#8217;|&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
    }
    function stripTags(html) {
        return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    }
    async function getText(url, extraHeaders) {
        var h = {
            'User-Agent': UA,
            'Accept': 'text/html,application/json,*/*;q=0.8',
            'Referer': SITE + '/',
            'Accept-Language': GEO_HEADERS['Accept-Language'],
            'Cache-Control': GEO_HEADERS['Cache-Control'],
        };
        if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { h[k] = extraHeaders[k]; });
        var res = await http_get(url, h);
        var body = (res && typeof res === 'object') ? res.body : res;
        var status = (res && typeof res === 'object') ? (res.status || res.statusCode || 0) : 0;
        if (status && (status < 200 || status >= 300)) throw new Error('HTTP ' + status + ' ' + url.slice(0, 80));
        return typeof body === 'string' ? body : '';
    }
    function withTimeout(p, ms) {
        if (typeof setTimeout !== 'function') return p;
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    function mkItem(obj) { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj) {
        var s;
        try {
            s = new StreamResult({ url: obj.url, source: obj.source || obj.quality, headers: obj.headers });
            s.quality = obj.quality;
        } catch (_) { s = obj; }
        return s;
    }
    function qualityFromText(t) {
        var m = String(t || '').match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i) || String(t || '').match(/\b4k\b/i);
        if (!m) return '';
        var q = m[1] ? m[1].toLowerCase() : m[0].toLowerCase();
        return q === '4k' ? '2160p' : q;
    }
    function sizeFromText(t) {
        var m = String(t || '').match(/([\d.]+)\s*(GB|MB)/i);
        return m ? (m[1] + m[2].toUpperCase()) : '';
    }
    function parseTitle(raw) {
        var t = decodeEntities(raw).replace(/\s+/g, ' ').trim();
        var y2 = t.match(/\b(19\d{2}|20\d{2})\b/);
        var year = y2 ? parseInt(y2[1], 10) : undefined;
        var sm = t.match(/^(.*?\(Season\s*\d+\))/i);
        var base = sm ? sm[1] : t;
        var cut = base.split(/\s+(?=(?:Hindi|English|Dual|Dubbed|ORG|Clean|Full|All\s+Episodes|Complete|TCRip|HDRip|WEB|BluRay|AMZN|Netflix|JioHotstar|Prime|1080p|720p|480p|2160p|4K|10bit|x265|x264|DD\b|5\.1))/i)[0];
        cut = cut.replace(/\s*[-–|:]+\\s*$/, '').replace(/\s*\|.*$/, '').trim();
        if (!cut || cut.length < 2) cut = t.split(/\s+(?:Hindi|English|Dual|Dubbed)/i)[0].trim();
        return { name: cut || t.slice(0, 80), year: year };
    }

    // ───────── SvelteKit devalue parser ─────────
    // __data.json is NDJSON: each line is {"type":"chunk","id":N,"data":[...devalue array...]}
    // devalue array: indices are references. Object values that are numbers are pointers.
    function devalueResolve(arr) {
        var resolved = new Array(arr.length);
        var resolving = new Set();
        function get(idx) {
            if (idx < 0 || idx >= arr.length) return idx;
            if (resolved[idx] !== undefined) return resolved[idx];
            if (resolving.has(idx)) return null;
            resolving.add(idx);
            var val = arr[idx];
            if (typeof val === 'number') {
                resolved[idx] = val;
            } else if (Array.isArray(val)) {
                var outA = val.map(function (item) {
                    if (typeof item === 'number') return get(item);
                    if (item && typeof item === 'object') return resolveValue(item);
                    return item;
                });
                resolved[idx] = outA;
            } else if (val && typeof val === 'object') {
                var outO = {};
                for (var k in val) {
                    var vv = val[k];
                    if (typeof vv === 'number') outO[k] = get(vv);
                    else if (vv && typeof vv === 'object') outO[k] = resolveValue(vv);
                    else outO[k] = vv;
                }
                resolved[idx] = outO;
            } else {
                resolved[idx] = val;
            }
            resolving.delete(idx);
            return resolved[idx];
        }
        function resolveValue(v) {
            if (typeof v === 'number') return get(v);
            if (Array.isArray(v)) {
                return v.map(function (item) {
                    if (typeof item === 'number') return get(item);
                    if (item && typeof item === 'object') return resolveValue(item);
                    return item;
                });
            }
            if (v && typeof v === 'object') {
                var out = {};
                for (var kk in v) {
                    var vvv = v[kk];
                    if (typeof vvv === 'number') out[kk] = get(vvv);
                    else if (vvv && typeof vvv === 'object') out[kk] = resolveValue(vvv);
                    else out[kk] = vvv;
                }
                return out;
            }
            return v;
        }
        for (var i = 0; i < arr.length; i++) if (resolved[i] === undefined) get(i);
        return resolved;
    }

    function extractChunks(text) {
        var chunks = [];
        var lines = String(text || '').split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            try {
                var obj = JSON.parse(line);
                if (obj && obj.type === 'chunk' && obj.data) chunks.push(obj.data);
            } catch (e) {}
        }
        return chunks;
    }

    function resolveAllChunks(text) {
        var rawChunks = extractChunks(text);
        var resolvedList = [];
        for (var i = 0; i < rawChunks.length; i++) {
            try {
                var res = devalueResolve(rawChunks[i]);
                resolvedList.push(res);
            } catch (e) {}
        }
        return resolvedList;
    }

    function findItemsInResolved(resolvedList) {
        for (var ci = 0; ci < resolvedList.length; ci++) {
            var res = resolvedList[ci];
            for (var ri = 0; ri < res.length; ri++) {
                var v = res[ri];
                if (!v) continue;
                if (v.items && Array.isArray(v.items)) return v;
                if (v.success && v.data && v.data.items) return v.data;
                if (v.data && v.data.items) return v.data;
            }
        }
        return null;
    }

    function findPostContentInResolved(resolvedList) {
        for (var ci = 0; ci < resolvedList.length; ci++) {
            var res = resolvedList[ci];
            for (var ri = 0; ri < res.length; ri++) {
                var v = res[ri];
                if (!v) continue;
                if (v.post_content && typeof v.post_content === 'string') return v.post_content;
                if (v.data && v.data.post_content) return v.data.post_content;
            }
        }
        return null;
    }

    function findPlayDataInResolved(resolvedList) {
        for (var ci = 0; ci < resolvedList.length; ci++) {
            var res = resolvedList[ci];
            for (var ri = 0; ri < res.length; ri++) {
                var v = res[ri];
                if (!v) continue;
                if (v._id && v.info) return v;
            }
        }
        return null;
    }

    async function fetchSvelteItems(url) {
        var txt = await withTimeout(getText(url), 12000);
        var resolvedList = resolveAllChunks(txt);
        var data = findItemsInResolved(resolvedList);
        return data || { items: [], page: 1, perPage: 0, totalItems: 0, totalPages: 0 };
    }

    async function fetchPostContent(slug) {
        var url = SITE + '/' + slug + '/__data.json?x-sveltekit-invalidated=01';
        var txt = await withTimeout(getText(url), 12000);
        var resolvedList = resolveAllChunks(txt);
        var content = findPostContentInResolved(resolvedList);
        if (content) return content;
        // fallback HTML parse
        try {
            var html = await withTimeout(getText(SITE + '/' + slug), 12000);
            var m = html.match(/"post_content":"([\s\S]*?)"\},"error"/);
            if (m) {
                var unescaped = m[1].replace(/\\u003C/g, '<').replace(/\\u003E/g, '>').replace(/\\u002F/g, '/').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
                return unescaped;
            }
            return html;
        } catch (e) {
            return '';
        }
    }

    async function fetchPlayData(playId) {
        var url = KMHD + '/play/__data.json?x-sveltekit-invalidated=01&id=' + encodeURIComponent(playId);
        var txt = await withTimeout(getText(url, { 'Referer': KMHD + '/', 'Origin': KMHD }), 12000);
        var resolvedList = resolveAllChunks(txt);
        var playData = findPlayDataInResolved(resolvedList);
        if (playData) return playData;
        // fallback: try HTML page script extraction
        try {
            var html = await withTimeout(getText(KMHD + '/play?id=' + playId, { 'Referer': KMHD + '/' }), 12000);
            var info = {};
            var re = /(\w+):\{name:"([^"]+)"((?:,[a-z_]+:"[^"]*")*)\}/g;
            var mm;
            while ((mm = re.exec(html)) !== null) {
                var fname = mm[2];
                if (!/(?:\.|\s)(mkv|mp4|avi)\b/i.test(fname)) continue;
                var rest = mm[3] || '';
                var st = (rest.match(/streamtape_res:"([^"]*)"/) || [])[1];
                var sw = (rest.match(/streamwish_res:"([^"]*)"/) || [])[1];
                if (st === 'None') st = null;
                if (sw === 'None') sw = null;
                info[mm[1]] = { name: fname, streamtape_res: st, streamwish_res: sw };
            }
            if (Object.keys(info).length) return { _id: playId, name: 'Play ' + playId, info: info };
        } catch (e) {}
        return null;
    }

    // ───────── kmhd link parsing ─────────
    function parseKmhdLinks(contentHtml) {
        var out = [];
        var re = /<a[^>]+href=["'](?:https?:\/\/links\.kmhd\.(?:me|eu))?\/(play|file|pack)\/?(?:\?id=|=)?([A-Za-z0-9_-]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        var m;
        while ((m = re.exec(contentHtml)) !== null) {
            var label = stripTags(m[3]);
            out.push({ kind: m[1], id: m[2], label: label });
        }
        var re2 = /<a[^>]+href=["'](https?:\/\/(?:gdflix\.dev|gd\.kmhd\.eu|new\d*\.gdflix\.io)\/file\/[A-Za-z0-9]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        while ((m = re2.exec(contentHtml)) !== null) {
            var label2 = stripTags(m[2]);
            out.push({ kind: 'gdflix_direct', id: m[1], label: label2, url: m[1] });
        }
        // Extra hosts found in Idiots 2026 and other CAMRip titles: 1xplayer iframe, bbupload, gofile
        var reIframe = /<iframe[^>]+src=["'](https?:\/\/(?:vd\.)?1xplayer\.com\/[^"']+)["']/gi;
        while ((m = reIframe.exec(contentHtml)) !== null) {
            out.push({ kind: '1xplayer', id: m[1], label: '1XPlayer', url: m[1] });
        }
        var reGoFile = /<a[^>]+href=["'](https?:\/\/(?:download\.bbupload\.to\/download\?v=[A-Za-z0-9]+|gofile\.io\/d\/[A-Za-z0-9]+|bbupload\.to\/[^"']+))["'][^>]*>([\s\S]*?)<\/a>/gi;
        while ((m = reGoFile.exec(contentHtml)) !== null) {
            var label3 = stripTags(m[2]) || 'GoFile';
            out.push({ kind: 'gofile', id: m[1], label: label3, url: m[1] });
        }
        return out;
    }

    function parsePlayInfoFromData(playData) {
        var episodes = [];
        var info = playData.info || {};
        var keys = Object.keys(info);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = info[k];
            if (!v || !v.name) continue;
            if (!/(?:\.|\s)(mkv|mp4|avi)\b/i.test(v.name)) continue;
            var sem = v.name.match(/S(\d{1,2})\s?E(\d{1,3})/i);
            episodes.push({
                key: k,
                name: v.name,
                season: sem ? parseInt(sem[1], 10) : 1,
                episode: sem ? parseInt(sem[2], 10) : episodes.length + 1,
                quality: qualityFromText(v.name),
                streamtape: v.streamtape_res && v.streamtape_res !== 'None' ? v.streamtape_res : null,
                streamwish: v.streamwish_res && v.streamwish_res !== 'None' ? v.streamwish_res : null
            });
        }
        return episodes;
    }

    // ───────── direct host resolvers ─────────
    async function resolveHubcloud(pageUrl) {
        var out = [];
        try {
            var html = await withTimeout(getText(pageUrl, { 'Referer': 'https://' + HUBCLOUD_HOST + '/' }), 15000);
            var dl = (html.match(/id=["']download["'][^>]*href=["']([^"']+)["']/) ||
                      html.match(/href=["']([^"']*hubcloud\.php[^"']+)["']/) || [])[1];
            if (!dl) return out;
            dl = dl.replace(/&amp;/g, '&');
            if (/hubcloud\.php|gamerxyt/.test(dl)) {
                var d2 = await withTimeout(getText(dl, { 'Referer': pageUrl }), 15000);
                var r2 = (d2.match(/https:\/\/[^"'\s<>]*r2\.cloudflarestorage\.com[^"'\s<>]+/) || [])[0];
                if (r2) out.push(r2.replace(/&amp;/g, '&'));
                var px = (d2.match(/https:\/\/pixel\.hubcloud\.cx\/\?id=[^"'\s<>]+/) || [])[0];
                if (px) out.push(px);
                if (!out.length) {
                    var pd = (d2.match(/https:\/\/pixeldrain\.(?:com|dev)\/u\/[A-Za-z0-9]+/) || [])[0];
                    if (pd) {
                        var mm = pd.match(/\/u\/([A-Za-z0-9]+)/);
                        if (mm) out.push('https://pixeldrain.com/api/file/' + mm[1] + '?download');
                    }
                }
            } else if (/r2\.cloudflarestorage\.com|pixel\.hubcloud|pixeldrain/.test(dl)) {
                out.push(dl);
            }
        } catch (_) {}
        return out;
    }

    async function resolveGdflix(pageUrl) {
        var instant = [], direct = [];
        try {
            var fid = (String(pageUrl).match(/\/file\/([A-Za-z0-9]+)/) || [])[1];
            if (!fid) return { instant: instant, urls: direct, r2: [] };
            var pageUrlRef = 'https://' + GDFLIX_HOST + '/file/' + fid;
            try {
                var html = await withTimeout(getText(pageUrl, { 'Referer': 'https://' + GDFLIX_HOST + '/' }), 12000);
                var r2m = html.match(/https:\/\/pub-[^\s"']+\.r2\.dev\/[^\s"']+\?token=[^\s"']+/g);
                if (r2m) {
                    for (var i = 0; i < r2m.length; i++) {
                        var u = r2m[i].replace(/&amp;/g, '&');
                        if (direct.indexOf(u) < 0) direct.push(u);
                    }
                }
                var instantM = html.match(/https:\/\/[^"']*busycdn\.xyz\/[^"']+/g);
                if (instantM) {
                    for (var j = 0; j < instantM.length; j++) {
                        var iu = instantM[j].replace(/&amp;/g, '&');
                        if (instant.indexOf(iu) < 0) instant.push(iu);
                    }
                }
                if (direct.length || instant.length) {
                    return { instant: instant, urls: direct, r2: direct };
                }
            } catch (e) {}
            function post(action, pathBase) {
                return withTimeout(http_post('https://' + GDFLIX_HOST + '/' + pathBase + '/' + fid, {
                    'User-Agent': UA,
                    'Referer': pageUrlRef,
                    'x-token': GDFLIX_HOST,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }, 'action=' + action + '&key=' + GD_KEY + '&action_token='), 15000).then(function (r) {
                    try { return JSON.parse((r && r.body) || '{}'); } catch (_) { return {}; }
                });
            }
            var res = await Promise.all([
                post('instant', 'mfile').catch(function () { return {}; }),
                post('direct', 'file').catch(function () { return {}; })
            ]);
            var iu2 = String(res[0].url || '').replace(/&amp;/g, '&');
            if (!res[0].error && iu2.indexOf('http') === 0) instant.push(iu2);
            var u2 = String(res[1].url || '').replace(/&amp;/g, '&');
            if (!res[1].error && u2.indexOf('http') === 0) {
                // drive.google.com/open?id=X is a page; unwrap it through the
                // usercontent confirm form into a direct (ranged) file URL.
                var gid = (u2.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || [])[1];
                if (/drive\.google\.com/.test(u2) && gid) {
                    try {
                        var chtml = await withTimeout(getText('https://drive.usercontent.google.com/download?id=' + gid + '&export=download', { 'Referer': 'https://drive.google.com/' }), 10000);
                        var action = (chtml.match(/action="([^"]+)"/) || [])[1] || '';
                        var fields = [], fr = /name="([^"]+)"\s+value="([^"]*)"/g, fm;
                        while ((fm = fr.exec(chtml))) fields.push(fm[1] + '=' + encodeURIComponent(fm[2]));
                        if (action && fields.length) direct.push(action + '?' + fields.join('&'));
                    } catch (_) {}
                } else {
                    direct.push(u2);
                }
            }
        } catch (_) {}
        return { instant: instant, urls: direct, r2: direct };
    }

    async function extractStreamTape(embedUrl) {
        var html;
        try {
            html = await withTimeout(getText(embedUrl, { 'Referer': 'https://streamtape.com/' }), 12000);
        } catch (_) { return null; }
        var s = html.match(/robotlink'\)\.innerHTML\s*=\s*'([^']*)'\s*\+\s*\('([^']+)'\)\.substring\(2\)\.substring\(1\)/);
        if (s) {
            var built = s[1] + s[2].substring(2).substring(1);
            return built.indexOf('//') === 0 ? 'https:' + built : built;
        }
        var m = html.match(/id="robotlink"[^>]*>([^<]+)</);
        if (m) {
            var u = m[1].trim().replace(/^\/(?=[^\/])/, '//');
            if (u.indexOf('//') === 0) return 'https:' + u;
            if (u.indexOf('http') === 0) return u;
        }
        return null;
    }

    // ───────── KMHD touchme API — key to getting ALL mirrors ─────────
    // POST https://links.kmhd.me/api/touchme/{fileId}?c={code} → {status:"Done", linkId:"https://..."}
    async function touchMe(fileId, code) {
        if (!fileId || !code) return null;
        try {
            var url = KMHD + '/api/touchme/' + encodeURIComponent(fileId) + '?c=' + encodeURIComponent(code);
            var res = await withTimeout(http_post(url, {
                'User-Agent': UA,
                'Referer': KMHD + '/play?id=xxx',
                'Origin': KMHD,
                'Accept': 'application/json',
                'Accept-Language': GEO_HEADERS['Accept-Language'],
                'Cache-Control': 'no-cache'
            }, ''), 10000);
            var body = (res && res.body) || '';
            var j = null;
            try { j = JSON.parse(body); } catch (e) { return null; }
            if (j && j.status === 'Done' && j.linkId) return j.linkId;
            return null;
        } catch (_) { return null; }
    }

    async function fetchAllMirrors(fileId) {
        var out = {};
        try {
            var results = await Promise.all(TOUCHME_CODES.map(function (code) {
                return touchMe(fileId, code).then(function (link) { return { code: code, link: link }; });
            }));
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                if (r.link) out[r.code] = r.link;
            }
        } catch (_) {}
        return out;
    }

    // ───────── catalog ─────────
    function postToItemFromSvelte(item) {
        if (!item || !item.slug) return null;
        var pt = parseTitle(item.post_title || item.slug || '');
        var url = SITE + '/' + item.slug;
        var thumb = item.thumbnail_image || PLACEHOLDER;
        var cats = item.categories || [];
        var isSeries = cats.indexOf('tv-series-dubbed') >= 0 || cats.indexOf('series') >= 0 || /\bSeason\s*\d+|\bS\d{1,2}\b|\[S\d+\s*E(?:pisode|P)?\s*\d+|\bEpisodes?\s*\d+/i.test(item.post_title || '') || /web[- ]series/i.test(item.post_title || '');
        return mkItem({
            title: pt.name,
            url: url,
            posterUrl: thumb,
            bannerUrl: thumb,
            type: isSeries ? 'series' : 'movie',
            year: pt.year
        });
    }

    async function fetchCategory(slug) {
        var url = slug ? SITE + '/category/' + slug + '/__data.json?x-sveltekit-invalidated=01' : SITE + '/__data.json?x-sveltekit-invalidated=01';
        try {
            var data = await fetchSvelteItems(url);
            return data.items || [];
        } catch (e) {
            console.error('Category fetch failed:', slug, e && e.message);
            return [];
        }
    }

    async function getHome(cb) {
        try {
            var settled = await Promise.all(ROWS.map(function (row) {
                return fetchCategory(row.slug).then(function (v) { return v; }, function (e) { console.error('Row failed:', row.name, e && e.message); return []; });
            }));
            var data = {};
            for (var i = 0; i < ROWS.length; i++) {
                if (settled[i] && settled[i].length) {
                    var items = settled[i].slice(0, 20).map(postToItemFromSvelte).filter(Boolean);
                    if (items.length) data[ROWS[i].name] = items;
                }
            }
            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'PikaHD returned no content (' + SITE + ')' });
            }
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String((e && e.message) || e) });
        }
    }

    // The site's search is a literal substring match ("spider man" misses
    // "Spider-Man"), so query a few spellings at once and keep titles that
    // contain every word of the query, ignoring punctuation.
    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var words = normWords(q);
            var longest = words.slice().sort(function (a, b) { return b.length - a.length; })[0] || q;
            var variants = [q, words.join('-'), longest].filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });
            var pages = await Promise.all(variants.map(function (v) {
                return fetchSvelteItems(SITE + '/__data.json?x-sveltekit-invalidated=01&q=' + encodeURIComponent(v) + '&page=1')
                    .then(function (d) { return d.items || []; }, function () { return []; });
            }));
            var seen = {}, all = [];
            pages.forEach(function (list) {
                list.forEach(function (it) { if (it && it.slug && !seen[it.slug]) { seen[it.slug] = 1; all.push(it); } });
            });
            var matching = all.filter(function (it) {
                var t = ' ' + normWords(it.post_title || it.slug).join(' ') + ' ';
                var tj = t.replace(/ /g, '');
                return words.every(function (w) { return t.indexOf(' ' + w) >= 0 || tj.indexOf(w) >= 0; });
            });
            var items = (matching.length ? matching : all).map(postToItemFromSvelte).filter(Boolean);
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────── load ─────────
    // Item url:     SITE/<slug>
    // Episode url:  SITE/<slug>#<json>  where json = { p: playId, k: fileKey, f: [[fileId, label], ...] }
    //   p/k  -> links.kmhd.me play entry (StreamTape code + touchme mirrors of that file)
    //   f    -> quality files from the post's /file/ links (touchme -> HubCloud / GDFlix / StreamTape)
    function splitUrl(url) {
        var s = String(url || '');
        var hash = '';
        var hi = s.indexOf('#');
        if (hi >= 0) { hash = s.slice(hi + 1); s = s.slice(0, hi); }
        var m = s.match(/\/([^\/\?#]+)\/?(?:\?.*)?$/);
        var ref = null;
        if (hash) { try { ref = JSON.parse(decodeURIComponent(hash)); } catch (_) { ref = null; } }
        return { slug: m ? m[1] : null, ref: ref };
    }

    function seasonOf(title, slug) {
        var m = String(title || '').match(/Season\s*(\d+)/i) || String(slug || '').match(/-s(\d{1,2})(?:-|$)/i);
        return m ? parseInt(m[1], 10) : 1;
    }

    function fileLinks(html) {
        var out = [];
        var re = /<a[^>]+href=["'](?:https?:\/\/links\.kmhd\.(?:me|eu))?\/file\/([A-Za-z0-9_-]+)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
        while ((m = re.exec(html))) out.push({ id: m[1], label: stripTags(m[2]).replace(/\s+/g, ' ').trim(), at: m.index });
        return out;
    }

    // Episodes of one post: [{ season, episode, name, ref }]
    async function postEpisodes(content, slug, title) {
        var season = seasonOf(title, slug);
        var links = parseKmhdLinks(content);
        var play = null;
        for (var i = 0; i < links.length; i++) if (links[i].kind === 'play') { play = links[i]; break; }
        var files = fileLinks(content);

        // "Episode N" markers in the download section -> per-episode quality files
        // "Episode 01", "Ep 01" or "E01:" (PikaHD/KatDrama posts use the short form)
        var marks = [], mre = /(?:\bEpisode|\bEp\.?|\bE)\s*0*(\d{1,3})\b(?![^<]{0,6}Added)/gi, mm;
        var dlAt = content.search(/DOWNLOAD LINKS|Single Episodes? Link/i);
        while ((mm = mre.exec(content))) if (mm.index > dlAt) marks.push({ ep: parseInt(mm[1], 10), at: mm.index });
        var byEp = {};
        if (marks.length && files.length) {
            files.forEach(function (f) {
                var cur = null;
                for (var j = 0; j < marks.length; j++) if (marks[j].at < f.at) cur = marks[j].ep;
                if (cur != null) (byEp[cur] = byEp[cur] || []).push([f.id, f.label]);
            });
        }

        var eps = [];
        if (play) {
            var pd = null;
            try { pd = await fetchPlayData(play.id); } catch (_) {}
            var list = pd && pd.info ? parsePlayInfoFromData(pd) : [];
            list.forEach(function (e) {
                var sem = /S\d{1,2}\s?E\d{1,3}/i.test(e.name);
                var s = sem ? e.season : season;
                eps.push({ season: s, episode: e.episode, name: e.name, ref: { p: play.id, k: e.key, f: byEp[e.episode] || [] } });
            });
            // a movie's play entry has one file; attach the quality files to it
            if (eps.length === 1 && !Object.keys(byEp).length) eps[0].ref.f = files.map(function (f) { return [f.id, f.label]; });
        }
        if (!eps.length && Object.keys(byEp).length) {
            Object.keys(byEp).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
                eps.push({ season: season, episode: n, name: 'Episode ' + n, ref: { f: byEp[n] } });
            });
        }
        if (!eps.length && files.length) {
            eps.push({ season: 1, episode: 1, name: title, ref: { f: files.map(function (f) { return [f.id, f.label]; }) } });
        }
        return eps;
    }

    function storyline(content) {
        var c = String(content || '');
        var i = c.search(/Storyline\s*:/i);
        if (i < 0) return '';
        var m = c.slice(i, i + 4000).match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        if (!m) return '';
        // "Marshals (TV Series 2026–): With the Yellowstone..." -> drop the leading label
        return stripTags(m[1]).replace(/\s+/g, ' ').replace(/^[^:]{0,80}\)\s*:\s*/, '').trim();
    }

    async function load(url, cb) {
        try {
            var p = splitUrl(url);
            if (!p.slug) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized PikaHD URL: ' + url });
            var content = await fetchPostContent(p.slug);
            if (!content) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'This post could not be loaded from PikaHD right now.' });

            var rawTitle = (content.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i) || [])[1] || p.slug.replace(/-/g, ' ');
            var pt = parseTitle(stripTags(rawTitle));
            var imgs = content.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
            var poster = PLACEHOLDER;
            for (var ii = 0; ii < imgs.length; ii++) {
                var src = (imgs[ii].match(/src=["']([^"']+)["']/i) || [])[1] || '';
                if (src && !/\.th\.|screenshot|Kat-\d{4}/i.test(src)) { poster = src; break; }
            }
            var baseItemUrl = SITE + '/' + p.slug;
            var eps = await postEpisodes(content, p.slug, stripTags(rawTitle) + ' ' + p.slug);

            // Other seasons of the same show live in separate posts — merge them in.
            var isSeries = eps.length > 1 || /season|-s\d+/i.test(rawTitle + ' ' + p.slug);
            if (isSeries) {
                try {
                    var baseName = (p.slug.match(/^(.+?)-(?:s|season-)\d+/) || [])[1];
                    baseName = baseName ? baseName.replace(/-/g, ' ') : pt.name.replace(/\(Season\s*\d+\)/i, '').trim();
                    var sd = await withTimeout(fetchSvelteItems(SITE + '/__data.json?x-sveltekit-invalidated=01&q=' + encodeURIComponent(baseName) + '&page=1'), 8000);
                    var bl = normWords(baseName);
                    var related = (sd.items || []).filter(function (it) {
                        if (!it.slug || it.slug === p.slug) return false;
                        if (!/season\s*\d+/i.test(it.post_title || '')) return false;
                        var tw = normWords(parseTitle(it.post_title || '').name.replace(/\(Season\s*\d+\)/i, ''));
                        return tw.join(' ') === bl.join(' ');
                    }).slice(0, 4);
                    var more = await Promise.all(related.map(function (it) {
                        return withTimeout(fetchPostContent(it.slug), 9000).then(function (c) {
                            return c ? withTimeout(postEpisodes(c, it.slug, it.post_title), 9000) : [];
                        }).catch(function () { return []; });
                    }));
                    more.forEach(function (list, idx) {
                        list.forEach(function (e) { e.slug = related[idx].slug; eps.push(e); });
                    });
                } catch (e) { /* merging is best-effort */ }
            }

            var seen = {}, episodes = [];
            eps.sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); });
            eps.forEach(function (e) {
                var key = e.season + ':' + e.episode;
                if (seen[key]) return;
                seen[key] = 1;
                episodes.push(mkEpisode({
                    name: isSeries ? ('Episode ' + e.episode) : (pt.name || e.name),
                    url: SITE + '/' + (e.slug || p.slug) + '#' + encodeURIComponent(JSON.stringify(e.ref)),
                    season: e.season,
                    episode: e.episode,
                    posterUrl: poster
                }));
            });
            if (!episodes.length) {
                return cb({ success: false, errorCode: 'NO_LINKS', message: 'No download/stream links have been posted for this title yet.' });
            }
            var desc = storyline(content);
            var imdb = (content.match(/IMDb Rating\s*:?-?\s*([\d.]+)\s*\/\s*10/i) || [])[1];
            cb({
                success: true,
                data: mkItem({
                    title: pt.name,
                    url: baseItemUrl,
                    posterUrl: poster,
                    bannerUrl: poster,
                    type: isSeries ? 'series' : 'movie',
                    year: pt.year,
                    score: imdb ? parseFloat(imdb) : undefined,
                    description: desc || undefined,
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────── streams ─────────
    function normWords(s) {
        return String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    }

    async function streamsForFile(fileId, label, codes) {
        var out = [];
        var mirrors = {};
        var res = await Promise.all(codes.map(function (c) {
            return touchMe(fileId, c).then(function (l) { return [c, l]; }, function () { return [c, null]; });
        }));
        res.forEach(function (r) { if (r[1] && r[1] !== 'None') mirrors[r[0]] = r[1]; });
        var q = qualityFromText(label) || label || '';
        var jobs = [];
        if (mirrors.streamtape_res) jobs.push(extractStreamTape(mirrors.streamtape_res.indexOf('http') === 0 ? mirrors.streamtape_res : 'https://streamtape.com/e/' + mirrors.streamtape_res).then(function (d) {
            if (d) out.push({ url: d, source: 'StreamTape • ' + q, headers: { 'User-Agent': UA, 'Referer': 'https://streamtape.com/' }, rank: 1 });
        }, function () {}));
        if (mirrors.hubdrive_res) jobs.push(resolveHubcloud(mirrors.hubdrive_res).then(function (links) {
            links.forEach(function (u, i) { out.push({ url: u, source: 'HubCloud • ' + q + (i ? ' #' + (i + 1) : ''), headers: { 'User-Agent': UA }, rank: 0 }); });
        }, function () {}));
        if (mirrors.gdflix_res) jobs.push(resolveGdflix(mirrors.gdflix_res).then(function (g) {
            (g.instant || []).forEach(function (u) { out.push({ url: u, source: 'GDFlix Instant • ' + q, headers: { 'User-Agent': UA }, rank: 2 }); });
            (g.urls || []).forEach(function (u) {
                if (/drive\.google\.com\/open/.test(u)) return; // a Drive page, not a file
                out.push({ url: u, source: 'GDFlix • ' + q, headers: { 'User-Agent': UA }, rank: 3 });
            });
        }, function () {}));
        await Promise.all(jobs);
        return out;
    }

    async function loadStreams(url, cb) {
        try {
            var p = splitUrl(url);
            var ref = p.ref;
            if (!ref && p.slug) {
                // plain item url (older saved episodes): rebuild from the post
                var content = await fetchPostContent(p.slug);
                var eps = content ? await postEpisodes(content, p.slug, p.slug) : [];
                ref = eps.length ? eps[0].ref : null;
            }
            if (!ref) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized PikaHD episode: ' + url });

            var jobs = [];
            var playQ = '';
            if (ref.p && ref.k) {
                jobs.push(fetchPlayData(ref.p).then(function (pd) {
                    var e = pd && pd.info && pd.info[ref.k];
                    playQ = e ? (qualityFromText(e.name) || '') : '';
                    var tasks = [streamsForFile(ref.k, playQ || 'Auto', ['hubdrive_res', 'gdflix_res'])];
                    if (e && e.streamtape_res && e.streamtape_res !== 'None') {
                        tasks.push(extractStreamTape('https://streamtape.com/e/' + e.streamtape_res).then(function (d) {
                            return d ? [{ url: d, source: 'StreamTape • ' + (playQ || 'Auto'), headers: { 'User-Agent': UA, 'Referer': 'https://streamtape.com/' }, rank: 1 }] : [];
                        }, function () { return []; }));
                    }
                    return Promise.all(tasks).then(function (r) { return [].concat.apply([], r); });
                }, function () { return []; }));
            }
            (ref.f || []).slice(0, 6).forEach(function (f) {
                jobs.push(streamsForFile(f[0], f[1], ['hubdrive_res', 'gdflix_res', 'streamtape_res']).catch(function () { return []; }));
            });
            var all = [].concat.apply([], await Promise.all(jobs));

            // best quality first, then host reliability
            function qv(s) { var m = String(s.source).match(/(\d{3,4})p/); return m ? parseInt(m[1], 10) : 0; }
            var seen = {}, list = [];
            all.sort(function (a, b) { return (qv(b) - qv(a)) || (a.rank - b.rank); }).forEach(function (s) {
                var k = String(s.url).split('?')[0];
                if (seen[k]) return;
                seen[k] = 1;
                list.push(mkStream({ url: s.url, source: s.source, headers: s.headers }));
            });
            var verified = list.length ? await verifyStreams(list, 3) : [];
            if (!verified.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS', message: 'The file servers for this title are still uploading or offline - try again later or pick another quality/episode.' });
            }
            cb({ success: true, data: verified });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
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

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

    __ngWrapExports();
})(typeof http_get !== 'undefined' ? http_get : undefined, typeof http_post !== 'undefined' ? http_post : undefined);
