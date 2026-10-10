/*
 * Movies4u — SkyStream plugin (2026-10-10)
 * Site: https://new1.movies4u.garden (WordPress: Bollywood / Hollywood / Hindi dubbed / South /
 * web series / TV shows / K-drama / anime).
 * Flow:
 *   catalog : homepage + /category/<slug>/ cards (<article class="post">)
 *   search  : /lookup.php?q=&page=1&per_page=30 (the site's own JSON search)
 *   load    : post page -> "Watch Online" (m4uplay = VidHide player) + "Download Links" pages
 *             (m4ulinks.site/number/N) -> per quality / per episode Hub-Cloud + GDFlix files
 *   streams : VidHide HLS (multi-audio, subtitles), Hub-Cloud (R2 / pixel / pixeldrain), GDFlix
 * The site moves between domains: when the configured one stops answering, the current domain is
 * taken from the community domain list (phisher98/TVVVV domains.json, key "movies4u").
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


    var SITE = (typeof manifest !== 'undefined' && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, '')
        : 'https://new1.movies4u.garden';
    var DOMAINS_JSON = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=Movies4u';
    var HUBCLOUD_HOST = 'hubcloud.ist';
    var GDFLIX_HOST = 'new5.gdflix.io';   // gdflix.dev always redirects to the live newN host (fallback below)

    var ROWS = [
        { name: 'Latest Uploads',     slug: null },
        { name: 'Bollywood Movies',   slug: 'bollywood-movies' },
        { name: 'Hollywood Movies',   slug: 'hollywood-movies' },
        { name: 'Hindi Dubbed',       slug: 'hindi-dubbed-movies' },
        { name: 'South Hindi Movies', slug: 'south-hindi-movies' },
        { name: 'Web Series',         slug: 'web-series' },
        { name: 'TV Shows',           slug: 'tv-shows' },
        { name: 'K-Drama',            slug: 'k-drama' },
        { name: 'Anime / Animation',  slug: 'anime' },
        { name: 'Punjabi',            slug: 'punjabi' },
        { name: 'Action',             slug: 'action' },
        { name: 'Horror',             slug: 'horror' },
        { name: 'Comedy',             slug: 'comedy' }
    ];

    // ───────────────── helpers ─────────────────
    function decodeEntities(s) {
        return String(s == null ? '' : s)
            .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
            .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&ndash;/g, '-').replace(/&mdash;/g, '-')
            .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '...');
    }
    function stripTags(html) {
        return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    }
    function withTimeout(p, ms) {
        if (typeof setTimeout !== 'function') return p;
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    async function getText(url, extraHeaders) {
        var h = { 'User-Agent': UA, 'Accept': 'text/html,application/json,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': SITE + '/' };
        if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { h[k] = extraHeaders[k]; });
        var res = await http_get(url, h);
        var status = (res && typeof res === 'object') ? (res.status || res.statusCode || 0) : 0;
        var body = (res && typeof res === 'object') ? res.body : res;
        if (status && (status < 200 || status >= 300)) throw new Error('HTTP ' + status + ' ' + String(url).slice(0, 80));
        if (!status && !body) throw new Error('No connection to ' + String(url).replace(/^https?:\/\/([^\/]+).*/, '$1'));
        return typeof body === 'string' ? body : '';
    }
    function sameSite(u) { return String(u).indexOf(SITE) === 0; }
    function toSite(u) {   // links saved under an older domain keep working
        u = String(u || '');
        if (/^\//.test(u)) return SITE + u;
        if (/^https?:\/\/[^\/]*movies4u\.[a-z]+\//i.test(u)) return SITE + u.replace(/^https?:\/\/[^\/]+/, '');
        return u;
    }
    // site page; if the configured domain doesn't answer, switch to the current one once
    var __domainChecked = false;
    async function sitePage(pathOrUrl) {
        var u = toSite(pathOrUrl);
        try {
            var t = await getText(u);
            if (t && t.length > 500) return t;
            throw new Error('empty page');
        } catch (e) {
            if (__domainChecked) throw e;
            __domainChecked = true;
            var live = '';
            try {
                var d = JSON.parse(await withTimeout(getText(DOMAINS_JSON, { 'Referer': '' }), 8000));
                live = String(d.movies4u || '').replace(/\/+$/, '');
            } catch (_) {}
            if (!/^https?:\/\//.test(live) || live === SITE) throw e;
            var path = u.slice(SITE.length);
            SITE = live;
            return await getText(SITE + path);
        }
    }
    function mkItem(obj) { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj) {
        var s;
        try {
            s = new StreamResult({ url: obj.url, source: obj.source, headers: obj.headers, subtitles: obj.subtitles });
        } catch (_) { s = obj; }
        if (obj.subtitles && obj.subtitles.length && !s.subtitles) s.subtitles = obj.subtitles;
        return s;
    }
    function qualityOf(t) {
        var m = String(t || '').match(/\b(2160|1440|1080|720|576|480|360)p\b/i);
        if (m) return parseInt(m[1], 10);
        return /\b4k\b/i.test(String(t || '')) ? 2160 : 0;
    }
    function sizeGB(t) {
        var m = String(t || '').match(/([\d.]+)\s*(GB|MB)\b/i);
        if (!m) return 0;
        return m[2].toUpperCase() === 'GB' ? parseFloat(m[1]) : parseFloat(m[1]) / 1024;
    }
    function normWords(s) {
        return String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    }

    // "Carrie (2026) Season 1 [Hindi ORG. + Multi Audio] Complete Amazon Prime WEB Series 480p | ..."
    //   -> { name: "Carrie", year: 2026, season: "1", series: true, lang: "Hindi ORG. + Multi Audio" }
    function parseTitle(raw) {
        var t = decodeEntities(raw).replace(/\s+/g, ' ').trim().replace(/\s*[-–]\s*Movies4u\s*$/i, '');
        var ym = t.match(/\((19\d{2}|20\d{2})\)/);
        var sm = t.match(/\(Season\s*([\d\s\-–&,]+)\)/i) || t.match(/\bSeason\s*(\d+(?:\s*[-–]\s*\d+)?)/i);
        var cutAt = t.search(/\s*\((?:19|20)\d{2}\)|\s*\(Season\b|\s*\[|\s+(?:Season\s*\d|S\d{2}\b|WEB-?DL|HDRip|BluRay|HDTC|HQ-|HDTS|CAMRip|PreDVD|Dual Audio|Multi Audio|Hindi\b|English\b|Full Movie|Complete\b|UNCENSORED|iMAX|V\d\b|480p|720p|1080p)/i);
        var name = (cutAt > 0 ? t.slice(0, cutAt) : t).replace(/\s*[-–:|]+\s*$/, '').trim();
        name = name.replace(/\s+[-–]\s+(?:Netflix|Amazon|Prime|Disney|Hotstar|Apple|SonyLiv|Zee5|JioHotstar)[^()]*$/i, '').trim() || name;
        var lm = t.match(/\[([^\]]*(?:Hindi|English|Tamil|Telugu|Korean|Japanese|Multi|Dual|Dubbed|Subtitles)[^\]]*)\]/i);
        var series = !!sm || /\b(?:WEB[- ]Series|TV Show|Reality Show|Indian Show|Drama Series|K-Drama|C-Drama|Ep\s*-?\d+\s*Added|Episodes?)\b/i.test(t);
        if (/Full Movie/i.test(t) && !sm) series = false;
        return {
            name: name || t.slice(0, 80),
            year: ym ? parseInt(ym[1], 10) : undefined,
            season: sm ? sm[1].replace(/\s+/g, '').replace(/–/g, '-') : '',
            series: series,
            lang: lm ? lm[1].replace(/\s+/g, ' ').trim() : ''
        };
    }
    function displayName(pt) {
        return pt.season ? pt.name + ' (Season ' + pt.season + ')' : pt.name;
    }
    function bigPoster(u) {
        u = decodeEntities(u || '');
        return /image\.tmdb\.org\/t\/p\/w\d+\//.test(u) ? u.replace(/\/t\/p\/w\d+\//, '/t/p/w500/') : (u || PLACEHOLDER);
    }

    // ───────── catalog ─────────
    function parseCards(html) {
        var out = [], seen = {};
        var re = /<article[^>]*class="post"[^>]*>([\s\S]*?)<\/article>/g, m;
        while ((m = re.exec(html))) {
            var a = m[1];
            var href = (a.match(/<a href="([^"]+)"[^>]*class="post-thumbnail"/) || a.match(/<h2[^>]*>\s*<a href="([^"]+)"/) || [])[1];
            if (!href || seen[href]) continue;
            var title = (a.match(/aria-label="([^"]+)"/) || [])[1] || stripTags((a.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1]);
            if (!title) continue;
            seen[href] = 1;
            var img = (a.match(/<img[^>]+src="([^"]+)"/) || [])[1];
            var label = stripTags((a.match(/class="video-label">([\s\S]*?)<\/span>/) || [])[1]);
            out.push(cardItem(href, title, img, label));
        }
        return out;
    }
    function cardItem(href, title, img, label) {
        var pt = parseTitle(title);
        return mkItem({
            title: displayName(pt),
            url: toSite(href),
            posterUrl: bigPoster(img),
            type: pt.series ? 'series' : 'movie',
            year: pt.year,
            quality: label || undefined,
            description: stripTags(title)
        });
    }

    async function getHome(cb) {
        try {
            var pages = await Promise.all(ROWS.map(function (row, i) {
                var path = row.slug ? '/category/' + row.slug + '/' : '/';
                // the homepage goes first so a domain switch happens once, before the rest
                return (i === 0 ? sitePage(path) : new Promise(function (r) { setTimeout(r, 0); }).then(function () { return sitePage(path); }))
                    .catch(function () { return ''; });
            }));
            var data = {};
            ROWS.forEach(function (row, i) {
                var items = parseCards(pages[i] || '').slice(0, 24);
                if (items.length) data[row.name] = items;
            });
            if (!Object.keys(data).length) return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'Movies4u returned no content (' + SITE + ').' });
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    async function lookup(q) {
        var body = '';
        try { await sitePage('/'); } catch (_) {}   // settles the domain first
        body = await getText(SITE + '/lookup.php?q=' + encodeURIComponent(q) + '&page=1&per_page=30', { 'Referer': SITE + '/search.html?q=' + encodeURIComponent(q), 'Accept': 'application/json' });
        var j = JSON.parse(body || '{}');
        return (j && j.hits) || [];
    }
    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var words = normWords(q);
            // the search matches literally ("spider man" misses "Spider-Man"): try a few spellings
            var variants = [q, words.join('-'), words.join('')].filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });
            var lists = await Promise.all(variants.map(function (v) { return lookup(v).catch(function () { return null; }); }));
            if (lists.every(function (l) { return l === null; })) throw new Error('Movies4u search is not answering right now.');
            var seen = {}, items = [];
            lists.forEach(function (list) {
                (list || []).forEach(function (h) {
                    if (!h || !h.permalink || seen[h.permalink]) return;
                    seen[h.permalink] = 1;
                    items.push(cardItem(h.permalink, h.post_title || '', h.post_thumbnail, h.movie_quality));
                });
            });
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────── post / links pages ─────────
    function hostKind(u) {
        if (/hubcloud\./i.test(u)) return 'h';
        if (/gdflix\.|gdlink\./i.test(u)) return 'g';
        if (/m4uplay\.|\/file\/[a-z0-9]{8,}$/i.test(u) && !/gdflix/i.test(u)) return 'w';
        return '';
    }
    // walk headings and links in order: [{ head, links: [{ url, text }] }]
    function blocks(html) {
        var out = [], cur = { head: '', links: [] };
        var re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
        while ((m = re.exec(html))) {
            if (m[2] !== undefined) {
                if (cur.head || cur.links.length) out.push(cur);
                cur = { head: stripTags(m[2]), links: [] };
            } else {
                cur.links.push({ url: decodeEntities(m[3]), text: stripTags(m[4]) });
            }
        }
        if (cur.head || cur.links.length) out.push(cur);
        return out;
    }
    function postSection(html) {
        var i = html.indexOf('class="watch-links-div"');
        var j = html.indexOf('class="download-links-div"');
        var a = [i, j].filter(function (x) { return x >= 0; }).sort(function (x, y) { return x - y; })[0];
        if (a === undefined) {
            var k = html.search(/Download Links<\/span><\/h2>/i);
            if (k < 0) return '';
            a = k;
        }
        var end = html.indexOf('Watch Full Trailer', a);
        if (end < 0) end = html.indexOf('class="join-tg"', a);
        return html.slice(a, end > a ? end : a + 30000).replace(/<div class="warn-box">[\s\S]*?<\/button>/, '');
    }
    // links page (m4ulinks.site/number/N): per heading (quality or episode) Hub-Cloud / GDFlix / player links
    async function linksPage(u) {
        var html = await withTimeout(getText(u, { 'Referer': SITE + '/' }), 15000);
        var i = html.search(/class="entry-title"|<main/i);
        var body = html.slice(i > 0 ? i : 0);
        var end = body.search(/Join our Telegram Channel/i);
        if (end > 0) body = body.slice(0, end);
        return blocks(body).map(function (b) {
            return { head: b.head, files: b.links.map(function (l) { return [hostKind(l.url), l.url]; }).filter(function (f) { return f[0]; }) };
        }).filter(function (b) { return b.files.length; });
    }
    function episodeNo(head) {
        var m = String(head).match(/\bEp(?:isodes?)?\s*[:.\-]?\s*(\d{1,4})\b/i) || String(head).match(/\bE(\d{1,4})\b/);
        return m ? parseInt(m[1], 10) : 0;
    }

    function storyline(html) {
        var i = html.search(/Storyline\s*:/i);
        if (i < 0) return '';
        var m = html.slice(i, i + 4000).match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        return m ? stripTags(m[1]) : '';
    }

    // Item url    : post url
    // Episode url : post url + '#' + json { q: [[label, kind, url], ...], t: "Hindi + English" }
    //   kind: w = player (VidHide), h = Hub-Cloud, g = GDFlix
    async function load(url, cb) {
        try {
            var postUrl = toSite(String(url).split('#')[0]);
            var html = await sitePage(postUrl);
            postUrl = toSite(postUrl);
            var rawTitle = stripTags((html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<meta property="og:title" content="([^"]+)"/i) || html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
            var pt = parseTitle(rawTitle);
            var poster = decodeEntities((html.match(/<meta property="og:image" content="([^"]+)"/i) || [])[1] || '');
            var poster500 = bigPoster(poster);
            var plot = storyline(html);
            var imdb = (html.match(/IMDb Rating\s*:?-?\s*([\d.]+)\s*\/\s*10/i) || [])[1];
            var genres = ((html.match(/based on\s+([A-Za-z ,\-&]+?)(?:<|\.|$)/i) || [])[1] || '').split(/\s*,\s*/).filter(function (g) { return g && g.length < 20; });
            var trailer = (html.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/) || [])[1];
            var lang = pt.lang || stripTags((html.match(/Language:\s*([^<]+)</i) || [])[1] || '');

            var sec = blocks(postSection(html));
            var watch = [], groups = [];   // groups: { head, url } ("Download Links" buttons)
            sec.forEach(function (b) {
                b.links.forEach(function (l) {
                    var k = hostKind(l.url);
                    if (k === 'w') { if (watch.indexOf(l.url) < 0) watch.push(l.url); return; }
                    if (k) { groups.push({ head: b.head, url: l.url, direct: k }); return; }
                    if (/\/number\/\d+|m4ulinks\./i.test(l.url) && !/zip|batch|pack/i.test(l.text)) groups.push({ head: b.head, url: l.url });
                });
            });
            var seriesHeads = groups.some(function (g) { return /Season|\/E\]|Episode|Ep\s*\d/i.test(g.head); });
            var isSeries = pt.series || seriesHeads;

            var pages = {};   // links page url -> parsed blocks
            var uniq = groups.filter(function (g, i) { return !g.direct && groups.findIndex(function (x) { return x.url === g.url; }) === i; }).slice(0, 18);
            var parsed = await Promise.all(uniq.map(function (g) { return linksPage(g.url).catch(function () { return []; }); }));
            uniq.forEach(function (g, i) { pages[g.url] = parsed[i]; });

            var episodes = [];
            if (!isSeries) {
                var files = watch.map(function (w) { return ['Watch Online', 'w', w]; });
                groups.forEach(function (g) {
                    if (g.direct) { files.push([g.head, g.direct, g.url]); return; }
                    (pages[g.url] || []).forEach(function (b) {
                        b.files.forEach(function (f) { files.push([b.head || g.head, f[0], f[1]]); });
                    });
                });
                files = files.filter(function (f, i) { return files.findIndex(function (x) { return x[2] === f[2]; }) === i; });
                if (files.length) episodes.push(mkEpisode({ name: pt.name, url: postUrl + '#' + encodeURIComponent(JSON.stringify({ q: files, t: lang })), season: 1, episode: 1, posterUrl: poster500 }));
            } else {
                var defSeason = parseInt(pt.season, 10) || 1;
                var map = {};   // "s:e" -> files
                groups.forEach(function (g) {
                    var sm = String(g.head).match(/Season\s*(\d+)/i) || String(g.head).match(/\bS(\d{1,2})\b/);
                    var s = sm ? parseInt(sm[1], 10) : defSeason;
                    var label = String(g.head).replace(/^Season\s*\d+\s*/i, '').replace(/Single Episodes?\s*/i, '').replace(/^\[[^\]]*\]\s*/, '').trim() || g.head;
                    (pages[g.url] || []).forEach(function (b) {
                        var e = episodeNo(b.head);
                        if (!e) return;
                        var k = s + ':' + e;
                        (map[k] = map[k] || { s: s, e: e, f: [] });
                        b.files.forEach(function (f) { map[k].f.push([label, f[0], f[1]]); });
                    });
                });
                Object.keys(map).map(function (k) { return map[k]; })
                    .sort(function (a, b) { return (a.s - b.s) || (a.e - b.e); })
                    .forEach(function (x) {
                        episodes.push(mkEpisode({
                            name: 'Episode ' + x.e,
                            url: postUrl + '#' + encodeURIComponent(JSON.stringify({ q: x.f, t: lang })),
                            season: x.s, episode: x.e, posterUrl: poster500
                        }));
                    });
            }
            if (!episodes.length) return cb({ success: false, errorCode: 'NO_LINKS', message: 'No watch/download links have been posted for this title yet.' });

            var item = {
                title: isSeries ? pt.name : displayName(pt),
                url: postUrl,
                posterUrl: poster500,
                bannerUrl: poster || poster500,
                type: isSeries ? 'series' : 'movie',
                year: pt.year,
                score: imdb ? parseFloat(imdb) : undefined,
                description: (plot ? plot + '\n\n' : '') + (lang ? 'Audio: ' + lang : ''),
                tags: genres.length ? genres : undefined,
                episodes: episodes
            };
            if (trailer) {
                try { item.trailers = [new Trailer({ url: 'https://www.youtube.com/watch?v=' + trailer, name: 'Trailer' })]; } catch (_) {}
            }
            cb({ success: true, data: mkItem(item) });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────── player: m4uplay (VidHide) ─────────
    function unpackPacked(src) {
        var m = String(src).match(/\}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!m) return '';
        var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'), a = parseInt(m[2], 10), c = parseInt(m[3], 10), k = m[4].split('|');
        function enc(n) {
            return (n < a ? '' : enc(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
        }
        var dict = {};
        while (c--) dict[enc(c)] = k[c] || enc(c);
        return p.replace(/\b\w+\b/g, function (w) { return dict.hasOwnProperty(w) ? dict[w] : w; });
    }
    async function vidhide(pageUrl) {
        var origin = (String(pageUrl).match(/^https?:\/\/[^\/]+/) || [''])[0];
        var html = await withTimeout(getText(pageUrl, { 'Referer': SITE + '/' }), 15000);
        var packed = (html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)[^<]*?\)\)/) || [])[0];
        var js = packed ? unpackPacked(packed) : html;
        var lm = js.match(/var\s+links\s*=\s*(\{[^}]*\})/);
        var links = {};
        try { links = lm ? JSON.parse(lm[1]) : {}; } catch (_) {}
        if (!lm) {
            var fm = js.match(/file\s*:\s*"([^"]+\.m3u8[^"]*)"/);
            if (fm) links = { hls: fm[1] };
        }
        var subs = [], tr = /\{\s*file\s*:\s*"([^"]+\.vtt[^"]*)"\s*,\s*label\s*:\s*"([^"]*)"[^}]*\}/g, t;
        while ((t = tr.exec(js))) subs.push({ url: t[1].indexOf('/') === 0 ? origin + t[1] : t[1], label: t[2], lang: t[2].slice(0, 2).toLowerCase() });
        var out = [];
        ['hls4', 'hls2', 'hls3', 'hls'].forEach(function (k) {
            var u = links[k];
            if (!u) return;
            if (u.indexOf('/') === 0) u = origin + u;
            if (!/^https?:\/\//.test(u) || out.some(function (o) { return o.url === u; })) return;
            out.push({ url: u, headers: { 'User-Agent': UA, 'Referer': origin + '/', 'Origin': origin }, subtitles: subs });
        });
        return out;
    }

    // ───────── file hosts (shared with PikaHD / KatDrama) ─────────
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
                var px = (d2.match(/https:\/\/pixel\.hubcloud\.[a-z]+\/\?id=[^"'\s<>]+/) || [])[0];
                if (px) out.push(px);
                if (!out.length) {
                    var pds = d2.match(/https:\/\/pixeldrain\.(?:com|dev)\/u\/[A-Za-z0-9]{6,}/g) || [];
                    pds.forEach(function (pd) {
                        var u = 'https://pixeldrain.com/api/file/' + pd.split('/u/')[1] + '?download';
                        if (out.indexOf(u) < 0) out.push(u);
                    });
                }
            } else if (/r2\.cloudflarestorage\.com|pixel\.hubcloud|pixeldrain/.test(dl)) {
                out.push(dl);
            }
        } catch (_) {}
        return out;
    }

    // GDFlix "instant" links (instant.busycdn.xyz/…) now redirect to a wrapper page
    // (fastdl-*.pages.dev/?url=<direct Google file URL>) that the player can't play: unwrap it.
    async function unwrapInstant(u) {
        try {
            var r = await withTimeout(http_get(u, { 'User-Agent': UA, 'Range': 'bytes=0-0' }), 12000);
            var fu = String((r && r.finalUrl) || '');
            var m = fu.match(/[?&]url=([^&#]+)/);
            if (m) { var inner = decodeURIComponent(m[1]); if (/^https?:\/\//i.test(inner)) return inner; }
            if (fu && fu !== u && !/\.pages\.dev\//i.test(fu) && /^https?:/i.test(fu)) return fu;
            if (/\.pages\.dev\//i.test(fu)) return null;   // wrapper without a usable link
        } catch (_) {}
        return u;
    }

    async function resolveGdflix(pageUrl) {
        var g = await resolveGdflixRaw(pageUrl);
        if (g && g.instant && g.instant.length) {
            var un = await Promise.all(g.instant.slice(0, 3).map(unwrapInstant));
            g.instant = un.filter(function (x, i) { return x && un.indexOf(x) === i; });
        }
        return g;
    }

    async function resolveGdflixRaw(pageUrl) {
        var instant = [], direct = [];
        try {
            var fid = (String(pageUrl).match(/\/file\/([A-Za-z0-9]+)/) || [])[1];
            if (!fid) return { instant: instant, urls: direct, r2: [] };
            var pageUrlRef = 'https://' + GDFLIX_HOST + '/file/' + fid;
            // gd.kmhd.me / gdlink.dev / gd.kmhd.eu are only redirectors: go to the live host directly,
            // then through gdflix.dev (which always points at the current newN host) if that fails.
            var html = '';
            var pages = [pageUrlRef, 'https://gdflix.dev/file/' + fid];
            for (var pi = 0; pi < pages.length && !/busycdn\.xyz|r2\.dev/.test(html); pi++) {
                try { html = await withTimeout(getText(pages[pi], { 'Referer': 'https://' + GDFLIX_HOST + '/' }), 12000); } catch (_) { html = ''; }
            }
            try {
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

    // ───────── streams ─────────
    async function loadStreams(url, cb) {
        try {
            var hash = String(url).split('#')[1];
            var ref = null;
            try { ref = hash ? JSON.parse(decodeURIComponent(hash)) : null; } catch (_) {}
            if (!ref || !ref.q) return cb({ success: false, errorCode: 'BAD_URL', message: 'Open the title again to refresh its links.' });
            var langs = String(ref.t || '').replace(/\s*\((?:ORG|LiNE|Studio|Clean|HQ)[^)]*\)/gi, '').replace(/\bORG\b\.?/gi, '').replace(/\s*&\s*/g, ' + ').replace(/\s+/g, ' ').replace(/\s+\+\s+/g, ' + ').trim();
            var multi = /\+|multi|dual/i.test(langs) ? ' - ' + langs : '';
            var files = ref.q.slice(0, 24);
            var all = [];
            await Promise.all(files.map(function (f, idx) {
                var label = String(f[0] || '').replace(/^[-:\s]+|[-:\s]+$/g, '').trim();
                var q = qualityOf(label), gb = sizeGB(label);
                var base = { q: q, gb: gb, order: idx };
                if (f[1] === 'w') {
                    return vidhide(f[2]).then(function (list) {
                        list.forEach(function (s, i) {
                            all.push(Object.assign({}, base, s, { rank: 0, q: 9999, source: 'Movies4u Player' + (i ? ' #' + (i + 1) : '') + multi }));
                        });
                    }, function () {});
                }
                if (f[1] === 'h') {
                    return resolveHubcloud(f[2]).then(function (links) {
                        links.forEach(function (u, i) {
                            var tag = /r2\.cloudflarestorage|r2\.dev/.test(u) ? '' : /pixeldrain/.test(u) ? ' (PixelDrain)' : ' (Pixel)';
                            all.push(Object.assign({}, base, { url: u, rank: 1 + i * 0.1, source: 'HubCloud • ' + label + tag, headers: { 'User-Agent': UA } }));
                        });
                    }, function () {});
                }
                if (f[1] === 'g') {
                    return resolveGdflix(f[2]).then(function (g) {
                        (g.instant || []).forEach(function (u) { all.push(Object.assign({}, base, { url: u, rank: 2, source: 'GDFlix Instant • ' + label, headers: { 'User-Agent': UA } })); });
                        (g.urls || []).forEach(function (u) {
                            if (/drive\.google\.com\/open/.test(u)) return;
                            all.push(Object.assign({}, base, { url: u, rank: 3, source: 'GDFlix • ' + label, headers: { 'User-Agent': UA } }));
                        });
                    }, function () {});
                }
                return null;
            }));
            // player first, then 1080p > 720p > 480p > 2160p (4K is huge), files over 8 GB last
            function qv(s) { return s.q === 9999 ? 1e6 : (s.gb > 8 ? -1000 : 0) + (s.q === 2160 ? 100 : s.q); }
            all.sort(function (a, b) { return (qv(b) - qv(a)) || (a.gb - b.gb) || (a.rank - b.rank) || (a.order - b.order); });
            var seen = {}, list = [];
            all.forEach(function (s) {
                var k = String(s.url).split('?')[0];
                if (/r2\.cloudflarestorage/.test(s.url)) k = s.url;   // signed URLs share a path prefix
                if (seen[k]) return;
                seen[k] = 1;
                list.push(mkStream({ url: s.url, source: s.source, headers: s.headers, subtitles: s.subtitles }));
            });
            var verified = list.length ? await verifyStreams(list, 3) : [];
            if (!verified.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'The file servers for this title are still uploading or offline - try again later or pick another episode.' });
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
