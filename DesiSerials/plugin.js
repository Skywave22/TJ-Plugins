/*
 * DesiSerials — SkyStream plugin
 * Site:   https://www.desi-serials.to   (desiserials.us now only shows "DesiSerials is now Desi-Serials.to!")
 *         WordPress (porto theme); the REST API is locked, so everything is HTML scraping.
 * Source: daily Hindi TV serials / reality shows (Star Plus, Colors, Zee, Sony, Sab, Star Bharat, & TV)
 *
 * Model:
 *   show    = category page /watch-online/<channel>/<show>/            -> MultimediaItem (series)
 *             (completed shows: /watch-online/<channel>/<channel>-completed-shows/<show>/)
 *   episode = post /<slug>/<id>/  (15 per category page, /page/N/)    -> Episode (by air date)
 *   poster  = show artwork (Yoast JSON-LD thumbnailUrl / latest-episodes thumbnails)
 *
 * Flow:
 *   home    : /  ("Current <Channel> Shows" tabs)  +  /latest-episodes/ (50 newest, with artwork)
 *   search  : show index = home + the 7 channel hubs (current + completed shows), matched locally
 *   streams : episode page -> "<Name> 720p HD Quality Online Links" -> tvarticles.org/vidd.php?id=N
 *             -> iframe:
 *               - flow.tvlogy.to/{embed,plyr,nflix}020A/<id>/ : plyr/nflix pages carry a tokenised HLS
 *                 URL (token = base64 "UA||IP" -> the player must send the same User-Agent + Referer)
 *               - vkspeed.com / vkprime.com embed-<id>.html   : P.A.C.K.E.R. JW Player -> MP4 (360p/192p)
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


    var SITE = (typeof manifest !== 'undefined' && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, '')
        : 'https://www.desi-serials.to';
    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    var MAX_PAGES = 12;          // 12 x 15 = the latest 180 episodes of a show
    var TVLOGY = 'https://flow.tvlogy.to';

    // channel slug (in /watch-online/<slug>/) -> display name + hub page listing its completed shows
    var CHANNELS = [
        { slug: 'star-plus',   name: 'Star Plus',   hub: '/star-plus-hdepisodes/' },
        { slug: 'colors',      name: 'Colors TV',   hub: '/color-tv-hd/' },
        { slug: 'zee-tv',      name: 'Zee TV',      hub: '/zee-tv/' },
        { slug: 'sony-tv',     name: 'Sony TV',     hub: '/sony-tv/' },
        { slug: 'sab-tv',      name: 'Sab TV',      hub: '/sab-tv-hd/' },
        { slug: 'star-bharat', name: 'Star Bharat', hub: '/star-bharat/' },
        { slug: 'and-tv',      name: '& TV',        hub: '/and-tv/' }
    ];
    var CH_NAME = {};
    CHANNELS.forEach(function (c) { CH_NAME[c.slug] = c.name; });
    var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

    // ─────────────────────────── helpers ───────────────────────────

    function decodeEntities(s) {
        return String(s == null ? '' : s)
            .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
            .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
            .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
    }

    function stripTags(html) {
        return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    }

    function originOf(u) {
        var m = String(u || '').match(/^(https?:\/\/[^\/?#]+)/i);
        return m ? m[1] : SITE;
    }

    function absUrl(u, base) {
        u = decodeEntities(String(u || '').trim());
        if (/^https?:\/\//i.test(u)) return u;
        if (u.indexOf('//') === 0) return 'https:' + u;
        return originOf(base) + (u.charAt(0) === '/' ? '' : '/') + u;
    }

    // every desi-serials.* link is rewritten onto the configured base URL
    function siteUrl(u) {
        return absUrl(u, SITE).replace(/^https?:\/\/(?:www\.)?desi-serials\.[a-z]+/i, SITE);
    }

    function key(s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, ''); }

    function initials(t) {
        return String(t || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean)
            .map(function (w) { return /^\d+$/.test(w) ? w : w.charAt(0); }).join('');
    }

    function fullImage(u) { return u ? String(u).replace(/-\d+x\d+(\.(?:jpe?g|png|webp))(\?.*)?$/i, '$1') : ''; }

    async function get(url, referer, extra) {
        var h = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Referer': referer || SITE + '/' };
        if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        var res = await http_get(url, h);
        if (!res || typeof res !== 'object') res = { status: 200, body: String(res || '') };
        return { status: Number(res.status || res.statusCode || 0), body: String(res.body || ''), finalUrl: res.finalUrl || url };
    }

    async function page(url) {
        var r = await get(url);
        if (r.status >= 400 || !r.body) throw new Error('HTTP ' + r.status + ' for ' + url);
        return r.body;
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }

    // small in-memory cache (the show index needs 8 pages; reuse it while the app is open)
    var CACHE = {};
    function cached(k, ttlMs, fn) {
        var c = CACHE[k];
        if (c && Date.now() - c.t < ttlMs) return c.p;
        var p = Promise.resolve().then(fn);
        CACHE[k] = { t: Date.now(), p: p };
        p.catch(function () { if (CACHE[k] && CACHE[k].p === p) delete CACHE[k]; });
        return p;
    }

    function mkItem(o)    { try { return new MultimediaItem(o); } catch (_) { return o; } }
    function mkEpisode(o) { try { return new Episode(o); }        catch (_) { return o; } }
    function mkStream(o) {
        var s;
        try { s = new StreamResult({ url: o.url, source: o.source, headers: o.headers }); s.quality = o.quality; }
        catch (_) { s = o; }
        return s;
    }

    // "Anupamaa – Episode – 6th October 2026 Watch Online" -> { iso: '2026-10-06', label: '6 Oct 2026' }
    function titleDate(t) {
        var m = String(t || '').match(/(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})/i);
        if (!m) return null;
        var mi = -1;
        for (var i = 0; i < 12; i++) if (MONTHS[i].indexOf(m[2].toLowerCase()) === 0) { mi = i; break; }
        if (mi < 0) return null;
        var d = +m[1], mon = MONTHS[mi];
        return {
            iso: m[3] + '-' + (mi < 9 ? '0' : '') + (mi + 1) + '-' + (d < 10 ? '0' : '') + d,
            label: d + ' ' + mon.charAt(0).toUpperCase() + mon.slice(1, 3) + ' ' + m[3]
        };
    }

    // show name of an episode title ("Udne Ki Aasha - Episode - 6th October 2026 Watch O...")
    function showNameOf(t) {
        t = decodeEntities(t);
        var m = t.match(/^(.*?)\s+[-–—]\s+(?:Episode|Ep\b|Grand|Finale|Full|Special|Launch|Promo)/i) || t.match(/^(.*?)\s+[-–—]\s+/);
        return (m ? m[1] : t).trim();
    }

    function jsonLdShowUrl(html) {
        // Yoast BreadcrumbList: position 3 = the show (Home > Channel > Show > Episode)
        var m = html.match(/"position":3,"name":"[^"]*","item":"([^"]+)"/);
        return m ? siteUrl(m[1].replace(/\\\//g, '/')) : '';
    }

    function jsonLdThumb(html) {
        var m = html.match(/"thumbnailUrl":"([^"]+)"/) || html.match(/<meta property="og:image" content="([^"]+)"/);
        return m ? absUrl(m[1].replace(/\\\//g, '/'), SITE) : '';
    }

    // ─────────────────────────── catalog ───────────────────────────

    var SHOW_LINK = /<a[^>]+href="((?:https?:)?\/\/(?:www\.)?desi-serials\.[a-z]+\/watch-online\/([a-z0-9-]+)\/((?:[a-z0-9-]+\/)?[a-z0-9-]+)\/?)"[^>]*>([^<]{2,120})<\/a>/gi;

    function parseShowLinks(html) {
        var out = [], seen = {}, m;
        SHOW_LINK.lastIndex = 0;
        while ((m = SHOW_LINK.exec(html))) {
            var path = m[3], last = path.split('/').pop();
            if (/completed-shows$|^page$/.test(last)) continue;
            var url = siteUrl(m[1]).replace(/\/?$/, '/');
            if (seen[url]) continue;
            seen[url] = 1;
            var name = stripTags(m[4]);
            if (!name || /^(read more|more|view all)$/i.test(name)) continue;
            out.push({
                title: name, url: url, channel: m[2],
                completed: /completed/.test(path),
                awards: /awards|concert/i.test(path + ' ' + name)
            });
        }
        return out;
    }

    // /latest-episodes/ -> [{ title, url, show, poster }]
    function parseLatest(html) {
        var out = [], re = /<article\b[^>]*>([\s\S]*?)<\/article>/gi, m;
        while ((m = re.exec(html))) {
            var a = m[1];
            var link = a.match(/<h3[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
            if (!link || /\/watch-online\/|\/author\//.test(link[1])) continue;
            var img = a.match(/<img[^>]+(?:data-oi|data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i);
            var title = stripTags(link[2]);
            out.push({ title: title, url: siteUrl(link[1]), show: showNameOf(title), poster: img ? fullImage(absUrl(img[1], SITE)) : '' });
        }
        return out;
    }

    function latestEpisodes() {
        return cached('latest', 10 * 60e3, function () {
            return page(SITE + '/latest-episodes/').then(parseLatest);
        });
    }

    function homeShows() {
        return cached('home', 10 * 60e3, function () {
            return page(SITE + '/').then(function (h) {
                return parseShowLinks(h).filter(function (s) { return !s.completed && CH_NAME[s.channel]; });
            });
        });
    }

    // every show the site lists: current (home tabs) + completed (channel hubs)
    function showIndex() {
        return cached('index', 30 * 60e3, async function () {
            var lists = await Promise.all([homeShows().catch(function () { return []; })].concat(CHANNELS.map(function (c) {
                return page(SITE + c.hub).then(parseShowLinks).catch(function () { return []; });
            })));
            var seen = {}, all = [];
            lists.forEach(function (l) { l.forEach(function (s) { if (!seen[s.url]) { seen[s.url] = 1; all.push(s); } }); });
            return all;
        });
    }

    var POSTERS = {};
    function showPoster(url) {
        if (POSTERS[url]) return POSTERS[url];
        var p = withTimeout(page(url), 10000).then(jsonLdThumb).catch(function () { return ''; });
        POSTERS[url] = p;
        return p;
    }

    // fill posters: latest-episodes artwork first, then the show pages themselves (capped)
    async function attachPosters(shows, latest, cap) {
        var art = {};
        latest.forEach(function (e) { var k = key(e.show); if (e.poster && !art[k]) art[k] = e.poster; });
        shows.forEach(function (s) { s.posterUrl = s.posterUrl || art[key(s.title)] || ''; });
        var missing = shows.filter(function (s) { return !s.posterUrl; }).slice(0, cap);
        await Promise.all(missing.map(function (s) {
            return showPoster(s.url).then(function (p) { s.posterUrl = p; });
        }));
        return shows;
    }

    function toItem(s) {
        var ch = CH_NAME[s.channel] || '';
        return mkItem({
            title: s.title,
            url: s.url,
            posterUrl: s.posterUrl || '',
            type: 'series',
            description: (ch ? ch + ' • ' : '') + (s.completed ? 'Completed show' : 'Currently airing')
        });
    }

    // ─────────────────────────── getHome ───────────────────────────

    async function getHome(cb) {
        try {
            var res = await Promise.all([
                homeShows(),
                latestEpisodes().catch(function () { return []; })
            ]);
            var shows = res[0].map(function (s) { return Object.assign({}, s); }), latest = res[1];
            if (!shows.length && !latest.length) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'Could not read the DesiSerials home page.' });

            await attachPosters(shows, latest, 30);
            var byKey = {};
            shows.forEach(function (s) { byKey[key(s.title)] = s; });

            var data = {};
            // Trending = shows with a new episode, newest first
            var trending = [], tSeen = {};
            latest.forEach(function (e) {
                var s = byKey[key(e.show)];
                if (!s || tSeen[s.url]) return;
                tSeen[s.url] = 1;
                trending.push(toItem(Object.assign({}, s, { posterUrl: e.poster || s.posterUrl })));
            });
            if (trending.length) data['Trending'] = trending.slice(0, 15);

            var eps = latest.map(function (e) {
                var d = titleDate(e.title), s = byKey[key(e.show)];
                return mkItem({
                    title: e.show + (d ? ' • ' + d.label.replace(/ \d{4}$/, '') : ''),
                    url: e.url,
                    posterUrl: e.poster || (s && s.posterUrl) || '',
                    type: 'series',
                    description: e.title
                });
            });
            if (eps.length) data['Latest Episodes'] = eps.slice(0, 40);

            CHANNELS.forEach(function (c) {
                var list = shows.filter(function (s) { return s.channel === c.slug && !s.awards; }).map(toItem);
                if (list.length) data[c.name] = list;
            });
            var awards = shows.filter(function (s) { return s.awards; }).map(toItem);
            if (awards.length) data['Awards & Concerts'] = awards;

            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'SITE_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── search ───────────────────────────

    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var res = await Promise.all([showIndex(), latestEpisodes().catch(function () { return []; })]);
            var qk = key(q), words = q.toLowerCase().split(/\s+/).map(key).filter(function (w) { return w.length > 1; });
            var scored = [];
            res[0].forEach(function (s) {
                var tk = key(s.title), score = 0;
                if (tk === qk) score = 100;
                else if (tk.indexOf(qk) === 0) score = 80;
                else if (qk.length > 2 && tk.indexOf(qk) >= 0) score = 60;
                else if (words.length && words.every(function (w) { return tk.indexOf(w) >= 0; })) score = 40;
                else if (qk.length >= 3 && initials(s.title).indexOf(qk) === 0) score = 50;   // kbc, yrkkh, tmkoc
                if (!score) return;
                if (!s.completed) score += 10;
                if (s.awards) score -= 5;
                scored.push({ s: Object.assign({}, s), score: score });
            });
            var num = function (t) { var m = t.match(/(\d+)\s*$/); return m ? +m[1] : -1; };   // newest season first
            scored.sort(function (a, b) { return b.score - a.score || num(b.s.title) - num(a.s.title) || a.s.title.localeCompare(b.s.title); });
            var shows = scored.slice(0, 40).map(function (x) { return x.s; });
            await attachPosters(shows, res[1], 12);
            cb({ success: true, data: shows.map(toItem) });
        } catch (e) {
            cb({ success: false, errorCode: 'SEARCH_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── load ───────────────────────────

    function parseEpisodeList(html) {
        var out = [], re = /<article\b[^>]*>([\s\S]*?)<\/article>/gi, m;
        while ((m = re.exec(html))) {
            var a = m[1];
            var link = a.match(/<h2 class="entry-title">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
            if (!link) continue;
            var dt = a.match(/<time datetime="(\d{4}-\d{2}-\d{2})/);
            out.push({ url: siteUrl(link[1]), title: stripTags(link[2]), posted: dt ? dt[1] : '' });
        }
        return out;
    }

    function lastPage(html) {
        var n = 1, re = /\/page\/(\d+)\/?"/g, m;
        while ((m = re.exec(html))) n = Math.max(n, +m[1]);
        return n;
    }

    async function load(url, cb) {
        try {
            url = siteUrl(String(url || '').trim());
            var single = null;
            if (!/\/watch-online\//.test(url)) {
                // an episode link (Latest Episodes row) -> open its show
                var epHtml = await page(url);
                var showUrl = jsonLdShowUrl(epHtml);
                if (!showUrl) {
                    var t = stripTags((epHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || 'Episode');
                    single = mkItem({
                        title: t, url: url, posterUrl: jsonLdThumb(epHtml), type: 'series',
                        episodes: [mkEpisode({ name: t, url: url, season: 1, episode: 1 })]
                    });
                    return cb({ success: true, data: single });
                }
                url = showUrl;
            }
            url = url.replace(/\/page\/\d+\/?$/, '/').replace(/\/?$/, '/');

            var first = await page(url);
            var total = lastPage(first), upto = Math.min(total, MAX_PAGES);
            var more = [];
            for (var p = 2; p <= upto; p++) more.push(url + 'page/' + p + '/');
            var pages = await Promise.all(more.map(function (u) {
                return withTimeout(page(u), 15000).catch(function () { return ''; });
            }));

            var seen = {}, eps = [];
            [first].concat(pages).forEach(function (h) {
                parseEpisodeList(h).forEach(function (e) { if (!seen[e.url]) { seen[e.url] = 1; eps.push(e); } });
            });
            eps.reverse(); // oldest first
            // promo / preview clips are posted in the same category; hide them when real episodes exist
            var real = eps.filter(function (e) { return !/\b(promo|preview|precap|coming soon|teaser)\b/i.test(e.title); });
            if (real.length) eps = real;

            var title = stripTags((first.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '') ||
                decodeEntities((first.match(/<title>([^<]+)/) || [])[1] || '').replace(/\s+Watch Latest.*$/i, '').replace(/\s+-\s+Desi.*$/i, '');
            var chSlug = (url.match(/\/watch-online\/([a-z0-9-]+)\//) || [])[1];
            var aired = stripTags((first.match(/Show is Aired on:([\s\S]{0,120}?)<\/(?:p|div|span|h\d)>/i) || [])[1] || '');
            var ld = decodeEntities(((first.match(/"@type":"CollectionPage"[\s\S]*?"description":"([^"]*)"/) || [])[1] || '').replace(/\\\//g, '/'));
            var parts = [];
            if (CH_NAME[chSlug]) parts.push(CH_NAME[chSlug]);
            if (aired && !/completed|ended|off air/i.test(aired)) parts.push('Aired ' + aired);
            if (/completed/.test(url)) parts.push('Completed show');
            var desc = parts.join(' • ');
            if (ld) desc += (desc ? '\n\n' : '') + ld;
            if (total > upto) desc += (desc ? '\n\n' : '') + 'Showing the latest ' + eps.length + ' episodes.';

            var episodes = eps.map(function (e, i) {
                var d = titleDate(e.title);
                var name = d ? d.label : e.title.replace(new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—]\\s*', 'i'), '').replace(/\s*Watch Online\s*$/i, '');
                return mkEpisode({
                    name: name || e.title,
                    url: e.url,
                    season: 1,
                    episode: i + 1,
                    airDate: d ? d.iso : e.posted,
                    description: e.title
                });
            });
            if (!episodes.length) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'No episodes listed for this show yet.' });

            var lastAir = episodes[episodes.length - 1].airDate || '';
            cb({
                success: true,
                data: mkItem({
                    title: title || 'Show',
                    url: url,
                    posterUrl: jsonLdThumb(first),
                    type: 'series',
                    description: desc,
                    year: lastAir ? +lastAir.slice(0, 4) : undefined,
                    status: /completed/.test(url) ? 'completed' : 'ongoing',
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: 'LOAD_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────────────────────── extractors ─────────────────────────

    // Dean Edwards P.A.C.K.E.R. unpacker
    function unpackPacked(src) {
        var m = String(src).match(/}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!m) return '';
        var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'), a = parseInt(m[2], 10), c = parseInt(m[3], 10), k = m[4].split('|');
        var ALPHA = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        function dec(w) {
            if (a <= 36) return parseInt(w, a);
            var n = 0;
            for (var i = 0; i < w.length; i++) n = n * a + ALPHA.indexOf(w.charAt(i));
            return n;
        }
        return p.replace(/\b\w+\b/g, function (w) {
            var i = dec(w);
            return (i < c && k[i]) ? k[i] : w;
        });
    }

    // vkspeed.com / vkprime.com (XFileSharing + JW Player)
    async function extractVk(embedUrl, hostName) {
        var r = await get(embedUrl, 'https://tvarticles.org/');
        if (r.status >= 400) throw new Error('vk ' + r.status);
        var js = r.body;
        if (/eval\(function\(p,a,c,k,e,[rd]\)/.test(js)) {
            var un = unpackPacked(js);
            if (!un && typeof getAndUnpack === 'function') { try { un = String(await getAndUnpack(js)); } catch (_) {} }
            js = un || js;
        }
        var srcBlock = (js.match(/sources\s*:\s*\[([\s\S]*?)\]/) || [])[1] || js;
        var out = [], re = /file\s*:\s*"([^"]+)"(?:\s*,\s*label\s*:\s*"([^"]*)")?/g, m;
        while ((m = re.exec(srcBlock))) {
            if (/\.(?:jpg|png|vtt|srt)(?:\?|$)/i.test(m[1])) continue;
            if (/\/ads?\//i.test(m[1])) continue;         // removed file -> the host plays an ad clip instead
            out.push({ url: absUrl(m[1], embedUrl), quality: m[2] || 'Auto' });
        }
        var origin = originOf(r.finalUrl || embedUrl);
        return out.map(function (s) { s.headers = { 'User-Agent': UA, 'Referer': origin + '/' }; s.host = hostName; return s; });
    }

    // flow.tvlogy.to/<plyr|nflix>020A/<id>/ -> tokenised HLS (bound to this User-Agent + IP)
    async function extractTvLogy(playerUrl, hostName) {
        var r = await get(playerUrl, 'https://tvarticles.org/');
        if (r.status >= 400) throw new Error('tvlogy ' + r.status);
        var m = r.body.match(/https?:\/\/[^'"\s<>]+\.m3u8[^'"\s<>]*/i);
        if (!m) return [];
        var hls = decodeEntities(m[0]);
        var headers = { 'User-Agent': UA, 'Referer': TVLOGY + '/' };
        var quality = 'Auto';
        try {
            var mm = await withTimeout(get(hls, TVLOGY + '/'), 8000);
            var res = mm.body.match(/RESOLUTION=\d+x(\d+)/g);
            if (res) {
                var hs = res.map(function (x) { return +x.split('x')[1]; });
                quality = Math.max.apply(null, hs) + 'p';
            }
        } catch (_) {}
        return [{ url: hls, quality: quality, headers: headers, host: hostName }];
    }

    // episode page -> [{ url: tvarticles link, label, hd, part }]
    function serverLinks(html) {
        var body = html;
        var a = html.indexOf('entry-content');
        if (a > 0) body = html.slice(a);
        var out = [], re = /<a[^>]+href="([^"]*(?:tvarticles\.[a-z]+|vidd\.php)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, m;
        while ((m = re.exec(body))) {
            var before = body.slice(Math.max(0, m.index - 1500), m.index);
            var labels = before.match(/>([^<>]{2,80}?(?:Links?|Quality))\s*</gi) || [];
            var label = labels.length ? stripTags(labels[labels.length - 1].replace(/^>|<$/g, '')) : '';
            var text = stripTags(m[2]);
            var part = (text.match(/Part\s*(\d+)/i) || [])[1];
            out.push({
                url: absUrl(m[1], SITE),
                label: label,
                hd: /720p|1080p|HD Quality/i.test(label),
                part: part ? +part : 0
            });
        }
        return out;
    }

    function pickLinks(links) {
        var hdFull = links.filter(function (l) { return l.hd && !l.part; });
        if (hdFull.length) return hdFull;
        var full = links.filter(function (l) { return !l.part; });
        if (full.length) return full;
        var hd = links.filter(function (l) { return l.hd; });
        return hd.length ? hd : links;
    }

    // tvarticles.org/vidd.php?id=N -> the player iframe inside it
    async function resolveWrapper(url, referer) {
        var r = await get(url, referer);
        if (r.status >= 400) return '';
        var re = /<iframe[^>]+src=['"]([^'"]+)['"]/gi, m;
        while ((m = re.exec(r.body))) {
            var src = absUrl(m[1], url);
            if (/business-phone|facebook|google|doubleclick|\/ad\/|\/ads\//i.test(src)) continue;
            return src;
        }
        return '';
    }

    function playerJob(src) {
        var t = src.match(/tvlogy\.[a-z]+\/(embed|plyr|nflix)([a-z0-9]*)\/([^\/?#'"]+)/i);
        if (t && /flow\./i.test(src)) {
            var variant = t[1].toLowerCase() === 'nflix' ? 'nflix' : 'plyr';   // embed (juicycodes JW) == plyr page
            var u = TVLOGY + '/' + variant + t[2] + '/' + t[3] + '/';
            return { key: u, run: function () { return extractTvLogy(u, variant === 'nflix' ? 'TVLogy 2' : 'TVLogy'); }, order: variant === 'nflix' ? 1 : 0 };
        }
        if (/vkspeed\.|vkprime\./i.test(src)) {
            var id = (src.match(/embed-([a-z0-9]+)/i) || [])[1];
            var name = /vkprime/i.test(src) ? 'VkPrime' : 'VKSpeed';
            return { key: name + ':' + (id || src), run: function () { return extractVk(src, name); }, order: name === 'VKSpeed' ? 2 : 3 };
        }
        return null;
    }

    // ───────────────────────── loadStreams ─────────────────────────

    async function loadStreams(data, cb) {
        try {
            var url = siteUrl(String(data || '').trim());
            if (/\/watch-online\//.test(url)) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'Pick an episode of this show.' });
            var r = await get(url);
            if (r.status >= 400) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'HTTP ' + r.status + ' for ' + url });

            var links = pickLinks(serverLinks(r.body)).slice(0, 10);
            if (!links.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No video links on this episode page yet.' });
            var parts = 0;
            links.forEach(function (l) { parts = Math.max(parts, l.part); });

            // 1) wrapper pages -> player iframes (deduplicated: the three TVLogy players share one id)
            var frames = await Promise.all(links.map(function (l) {
                return withTimeout(resolveWrapper(l.url, url), 12000).catch(function () { return ''; });
            }));
            var jobs = [], seenJob = {};
            frames.forEach(function (src, i) {
                if (!src) return;
                var j = playerJob(src);
                if (!j) return;
                var k = j.key + '#' + links[i].part;
                if (seenJob[k]) return;
                seenJob[k] = 1;
                j.part = links[i].part;
                jobs.push(j);
            });
            if (!jobs.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'The video hosts for this episode are not supported.' });

            // 2) players -> streams
            var results = await Promise.all(jobs.map(function (j) {
                return withTimeout(j.run(), 15000).then(function (list) {
                    return list.map(function (s) { s.part = j.part; s.order = j.order; return s; });
                }).catch(function () { return []; });
            }));
            var all = [];
            results.forEach(function (list) { list.forEach(function (s, i) { s.rank = i; all.push(s); }); });
            var hgt = function (s) { return parseInt(s.quality, 10) || 300; };   // 'Auto' ranks just under 360p
            all.sort(function (a, b) { return (a.part - b.part) || (hgt(b) - hgt(a)) || (a.order - b.order); });

            var seen = {}, list = [];
            all.forEach(function (s) {
                if (seen[s.url]) return;
                seen[s.url] = 1;
                var label = (parts > 0 && s.part ? 'Part ' + s.part + '/' + parts + ' • ' : '') + s.host + ' • ' + s.quality;
                list.push(mkStream({ url: s.url, source: label, quality: s.quality, headers: s.headers }));
            });
            if (!list.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'This video has been removed by its hosts (episodes older than about a year are usually deleted).' });

            var verified = await verifyStreams(list, 2);
            if (!verified.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'All players for this episode are down right now.' });
            cb({ success: true, data: verified });
        } catch (e) {
            cb({ success: false, errorCode: 'STREAM_ERROR', message: String((e && e.message) || e) });
        }
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

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
    __ngWrapExports();
})(typeof http_get !== 'undefined' ? http_get : undefined, typeof http_post !== 'undefined' ? http_post : undefined);
