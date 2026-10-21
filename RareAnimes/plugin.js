/*
 * RareAnimes (Rare Toons India) — SkyStream plugin
 * Site:   https://www.rareanimes.mov   (WordPress, "herald" theme, REST API disabled)
 * Source: Hindi / Tamil / Telugu / Malayalam dubbed anime, cartoons and animated movies
 *
 * Flow:
 *   catalog : HTML — /home/page/N/ (latest), /category/<slug>/page/N/ (moved from /hindi/category/ in Oct 2026), /?s=<q>
 *   post    : "Episode NN – name" headings, each followed by one line per audio variant
 *             ("Hindi – [WatchMultiQuality] [HubCloud] [WatchNow] [DLBeta]",
 *              "Episode 01 – Untouched NF (Hindi) – [HubCloud] [WatchNow]", …).
 *             Every link is wrapped in codedew.com/zipper/?url=<enc>.
 *   streams : WatchNow -> zipper 302 -> codedew.com/streambeta/?url=<hubcloudId>
 *             The StreamBeta page embeds `playerSources` (V1 "fsl", V2 "10gbps"):
 *             Cloudflare-worker URLs serving the MKV directly with Range support.
 *             It also lists every audio version of the episode (data-fid) and the
 *             whole series map (window.relatedData), each playable at ?v=<fid>.
 *             HubCloud -> zipper &ad_done=1 -> hubcloud.ist/drive/<id>; the same <id>
 *             opens on StreamBeta, so HubCloud-only episodes play the same way.
 *   WMQ     : WatchMultiQuality (most posts before 2025, ~2/3 of the site): zipper 302 ->
 *             codedew.com/multiquality/?url=<id> -> argon.razorshell.space/embed/<id>, a JW Player
 *             whose config is hidden by JuicyCodes (decoded below) -> HLS master (1080/720/360).
 *             Old posts link a list page instead (store.animetoonhindi.com/archives/N) with one
 *             zipper per episode. The CDN refuses data-centre IPs (403), phones are fine.
 *   dead    : DLBeta (pixeldrain, files deleted), Mega / GoFile / Mediafire / ZIP packs.
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
        : 'https://www.rareanimes.mov';

    var SB = 'https://codedew.com/streambeta/';
    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    var ROWS = [
        { name: 'Trending',         path: '/home/' },
        { name: 'Hindi Anime',      path: '/category/crunchyroll/' },
        { name: 'Hindi Dubbed',     path: '/category/hindi-dub/' },
        { name: 'Animated Movies',  path: '/category/movies/' },
        { name: 'Netflix',          path: '/category/netflix/' },
        { name: 'Cartoon Network',  path: '/category/cartoon-network/' },
        { name: 'Disney / XD',      path: '/category/disney-xd/' },
        { name: 'Tamil',            path: '/category/tamil/' },
        { name: 'Telugu',           path: '/category/telugu/' },
        { name: 'Hindi Subbed',     path: '/category/hindi-sub/' },
        { name: 'Completed Series', path: '/category/completed/' }
    ];

    var LANG_NAMES = {
        'हिंदी': 'Hindi', 'हिन्दी': 'Hindi', 'தமிழ்': 'Tamil', 'తెలుగు': 'Telugu', 'മലയാളം': 'Malayalam',
        'বাংলা': 'Bengali', 'ಕನ್ನಡ': 'Kannada', 'मराठी': 'Marathi', '日本語': 'Japanese', 'English': 'English'
    };

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

    function absUrl(u, base) {
        u = String(u || '');
        if (/^https?:\/\//i.test(u)) return u;
        if (u.indexOf('//') === 0) return 'https:' + u;
        var m = String(base).match(/^(https?:\/\/[^\/]+)/);
        return (m ? m[1] : SITE) + (u.charAt(0) === '/' ? '' : '/') + u;
    }

    async function get(url, referer) {
        var res = await http_get(url, {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
            'Referer': referer || SITE + '/'
        });
        if (!res || typeof res !== 'object') res = { status: 200, body: String(res || '') };
        return { status: Number(res.status || res.statusCode || 0), body: String(res.body || ''), finalUrl: res.finalUrl || url };
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }

    function mkItem(o)    { try { return new MultimediaItem(o); } catch (_) { return o; } }
    function mkEpisode(o) { try { return new Episode(o); }        catch (_) { return o; } }
    function mkStream(o) {
        var s;
        try { s = new StreamResult({ url: o.url, source: o.source, headers: o.headers }); s.quality = o.quality; }
        catch (_) { s = o; }
        return s;
    }

    function cleanTitle(t) {
        t = decodeEntities(t).replace(/\s+/g, ' ').trim();
        var cut = t.search(/\s*[-–|]?\s*\b(?:Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|Dual Audio|Multi Audio|All Episodes|Episodes?|Download|Complete|Watch Online)\b/i);
        if (cut > 2) t = t.slice(0, cut);
        t = t.replace(/[\s\-–|:,(]+$/, '').replace(/\s+(?:Full\s+)?Movie$/i, '').trim();
        return t || 'Untitled';
    }

    function guessType(title, classes) {
        var t = String(title || '');
        if (/\bseason\b|\bepisodes?\b|\bseries\b/i.test(t)) return 'series';
        if (/\bmovie|film\b/i.test(t) || /category-movies/.test(classes || '')) return 'movie';
        return 'series';
    }

    // ───────────────────────── catalog ─────────────────────────

    function parseListing(html) {
        var out = [], seen = {};
        var re = /<article\b([^>]*)>([\s\S]*?)<\/article>/g, m;
        while ((m = re.exec(html))) {
            var cls = (m[1].match(/class="([^"]*)"/) || [])[1] || '';
            if (!/\bpost-\d+/.test(cls)) continue;
            var body = m[2];
            var a = body.match(/<a\s+href="(https?:\/\/[^"]+)"[^>]*?title="([^"]*)"/) || body.match(/<a\s+href="(https?:\/\/[^"]+)"[^>]*>/);
            if (!a || seen[a[1]]) continue;
            var rawTitle = a[2] || stripTags((body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || '');
            if (!rawTitle) continue;
            // index posts ("All Anime & Cartoon Movies List") are link directories, not playable titles
            if (/^\s*all\b[\s\S]*\blist\s*$/i.test(decodeEntities(stripTags(rawTitle)))) continue;
            var img = body.match(/<img[^>]+src="([^"]+)"/);
            seen[a[1]] = 1;
            out.push(mkItem({
                title: cleanTitle(rawTitle),
                url: a[1],
                posterUrl: img ? img[1] : '',
                type: guessType(rawTitle, cls),
                description: decodeEntities(rawTitle)
            }));
        }
        return out;
    }

    async function fetchListing(path, page) {
        var url = SITE + path + (page > 1 ? 'page/' + page + '/' : '');
        var r = await get(url);
        if (r.status >= 400) throw new Error('HTTP ' + r.status + ' for ' + path);
        return parseListing(r.body);
    }

    async function getHome(cb) {
        try {
            var settled = await Promise.all(ROWS.map(function (row) {
                var pages = row.path === '/home/' ? [1, 2] : [1, 2];
                return Promise.all(pages.map(function (p) {
                    return withTimeout(fetchListing(row.path, p), 14000).catch(function () { return []; });
                })).then(function (lists) {
                    var seen = {}, items = [];
                    lists.forEach(function (l) { l.forEach(function (it) { if (!seen[it.url]) { seen[it.url] = 1; items.push(it); } }); });
                    return items;
                });
            }));
            var data = {};
            ROWS.forEach(function (row, i) { if (settled[i] && settled[i].length) data[row.name] = settled[i]; });
            if (!Object.keys(data).length) {
                var hp = await get(SITE + '/').catch(function () { return { status: 0, body: '' }; });
                if (/website has been stopped|aaPanel/i.test(String(hp.body || '').slice(0, 4000)) || hp.status === 404 || hp.status >= 500)
                    return cb({ success: false, errorCode: 'SITE_DOWN', message: 'RareAnimes is down right now - the problem is on the site\'s own server (it fails with a VPN too), not on your network. Try again later.' });
                return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'RareAnimes returned no content (' + SITE + ')' });
            }
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String((e && e.message) || e) });
        }
    }

    // The site's WordPress API searches every post (the HTML search only shows 9 per page,
    // newest first, so e.g. "Doraemon Season 1" was on page 7). Posters: one /media?include= call.
    async function searchApi(q) {
        var base = SITE + '/wp-json/wp/v2/';
        var r = await withTimeout(get(base + 'posts?search=' + encodeURIComponent(q) + '&per_page=100&_fields=link,title,featured_media,categories'), 15000);
        if (r.status !== 200) throw new Error('API ' + r.status);
        var posts = JSON.parse(r.body);
        if (!Array.isArray(posts)) throw new Error('API shape');
        var ids = posts.map(function (p) { return p.featured_media; }).filter(function (x) { return x; });
        var img = {};
        if (ids.length) {
            try {
                var mr = await withTimeout(get(base + 'media?include=' + ids.slice(0, 100).join(',') + '&per_page=100&_fields=id,source_url,media_details.sizes.medium.source_url'), 12000);
                (JSON.parse(mr.body) || []).forEach(function (m) {
                    var md = m.media_details && m.media_details.sizes && m.media_details.sizes.medium;
                    img[m.id] = (md && md.source_url) || m.source_url || '';
                });
            } catch (_) {}
        }
        var words = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
        var out = [];
        posts.forEach(function (p, i) {
            var raw = decodeEntities(stripTags((p.title && p.title.rendered) || ''));
            if (!raw || /^\s*all\b[\s\S]*\blist\s*$/i.test(raw)) return;
            var t = raw.toLowerCase(), hit = words.filter(function (w) { return t.indexOf(w) >= 0; }).length;
            var sn = +((raw.match(/\bseason\s*0*(\d+)/i) || [])[1] || 0);
            out.push({ it: mkItem({ title: cleanTitle(raw), url: p.link, posterUrl: img[p.featured_media] || '', type: guessType(raw, ''), description: raw }),
                hit: hit, i: i, base: cleanTitle(raw).replace(/\s*season\s*\d+.*$/i, '').toLowerCase(), sn: sn });
        });
        // titles containing every word first; seasons of one show in order (1, 2, 3 …), else newest first
        var first = {};
        out.forEach(function (x) { if (x.sn && (first[x.base] === undefined || x.i < first[x.base])) first[x.base] = x.i; });
        out.forEach(function (x) { x.k = x.sn ? first[x.base] : x.i; });
        out.sort(function (a, b) { return (b.hit - a.hit) || (a.k - b.k) || (a.sn - b.sn) || (a.i - b.i); });
        return out.map(function (x) { return x.it; });
    }

    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var api = await searchApi(q).catch(function () { return null; });
            if (api && api.length) return cb({ success: true, data: api });
            var enc = encodeURIComponent(q).replace(/%20/g, '+');
            var searchDown = false;
            var pages = await Promise.all([1, 2].map(function (p) {
                var u = SITE + (p > 1 ? '/page/' + p + '/' : '/') + '?s=' + enc;
                return get(u).then(function (r) {
                    var body = String(r.body || '');
                    // The site's search goes straight to its own server (never cached). When that server
                    // is down, the hosting panel answers with a "website has been stopped" page.
                    if (p === 1 && (r.status >= 500 || r.status === 0 || /website has been stopped|aaPanel/i.test(body.slice(0, 4000)))) searchDown = true;
                    return r.status < 400 ? parseListing(body) : [];
                }).catch(function () { return []; });
            }));
            var seen = {}, out = [];
            pages.forEach(function (l) { l.forEach(function (it) { if (!seen[it.url]) { seen[it.url] = 1; out.push(it); } }); });
            if (!out.length && searchDown) {
                // Fallback: match the title against the catalog pages (still served from the site's cache).
                var words = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
                var lists = await Promise.all(ROWS.map(function (row) {
                    return withTimeout(fetchListing(row.path, 1), 14000).catch(function () { return []; });
                }));
                lists.forEach(function (l) { l.forEach(function (it) {
                    var t = String(it.title || '').toLowerCase();
                    if (!seen[it.url] && words.every(function (w) { return t.indexOf(w) >= 0; })) { seen[it.url] = 1; out.push(it); }
                }); });
                if (!out.length) return cb({ success: false, errorCode: 'SITE_DOWN', message: 'RareAnimes search is down right now (a problem on the site\'s server, not your network). Browse the home rows, or try searching again later.' });
            }
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: 'SEARCH_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────────────────────── post parsing ─────────────────────────

    // Turns the post body into lines; zipper anchors become {label,url} tokens.
    function postLines(content) {
        var c = content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
        var links = [];
        c = c.replace(/<a\s[^>]*href="(https?:\/\/codedew\.com\/zipper\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, function (_, u, t) {
            links.push({ url: decodeEntities(u), label: stripTags(t) });
            return ' \u0001' + (links.length - 1) + '\u0002 ';
        });
        c = c.replace(/<(?:p|h\d|hr|br|div|li|tr)\b[^>]*>/gi, '\n');
        var lines = [];
        stripTagsKeepNewlines(c).split('\n').forEach(function (ln) {
            ln = ln.replace(/[ \t\u00a0]+/g, ' ').trim();
            if (!ln) return;
            var toks = [];
            var text = ln.replace(/\u0001(\d+)\u0002/g, function (_, i) { toks.push(links[+i]); return ''; });
            lines.push({ text: text.replace(/\[\s*\]/g, ' ').replace(/\s+/g, ' ').trim(), links: toks });
        });
        return lines;
    }

    function stripTagsKeepNewlines(html) {
        return decodeEntities(String(html).replace(/<[^>]*>/g, ' '));
    }

    function linkKind(label) {
        var l = String(label || '').toLowerCase().replace(/[^a-z]/g, '');
        if (l === 'watchnow' || l === 'watch') return 'w';
        if (l === 'hubcloud') return 'h';
        if (/^watchmulti?quality$|^multiquality$/.test(l)) return 'm';
        if (l === 'mediafire') return 'f';
        return '';
    }

    function variantLabel(text) {
        var t = String(text || '').replace(/^\s*episode\s*\d+\s*[-–:]\s*/i, '');
        t = t.split(/\s[-–]\s|[-–]\s*$/)[0] || t;
        t = t.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
        if (!t || /download|watch/i.test(t)) return '';
        if (/^untouched\b/i.test(t)) return t.slice(0, 40);
        // "The Seven Knights … Hindi" / "Hindi Uncut" -> start at the language name
        var lm = t.match(/\b(Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|English|Japanese)\b[\s\S]*$/i);
        if (lm) return lm[0].slice(0, 40);
        return t.length > 40 ? '' : t;
    }

    // Episodes keyed by number: [{ n, name, v:[{l,w,h}] }] + loose variants (movies / season links)
    function parseEpisodes(lines) {
        var eps = {}, order = [], cur = null, loose = [];
        function ep(n, name) {
            if (!eps[n]) { eps[n] = { n: n, name: name || '', v: [] }; order.push(n); }
            else if (name && !eps[n].name) eps[n].name = name;
            return eps[n];
        }
        lines.forEach(function (ln) {
            var head = ln.text.match(/^(?:episode|ep\.?)\s*0*(\d{1,4})\b\s*(?:[-–:]\s*(.*))?$/i);
            if (!ln.links.length) {
                if (head) cur = ep(+head[1], (head[2] || '').trim());
                else if (/^(?:season|watch\/download|winding up|thanks for)/i.test(ln.text)) cur = null;
                return;
            }
            var v = { l: '', w: '', h: '', m: '' };
            ln.links.forEach(function (k) { var kind = linkKind(k.label); if (kind && !v[kind]) v[kind] = k.url; });
            if (!v.w && !v.h && !v.m && !v.f) return;
            var target = cur;
            if (head) target = ep(+head[1], '');
            v.l = variantLabel(ln.text) || 'Hindi';
            if (target) target.v.push(v); else loose.push(v);
        });
        var list = order.map(function (n) { return eps[n]; }).filter(function (e) { return e.v.length; });
        list.sort(function (a, b) { return a.n - b.n; });
        return { episodes: list, loose: loose };
    }

    function infoField(text, names) {
        for (var i = 0; i < names.length; i++) {
            var re = new RegExp(names[i] + '\\s*:?\\s*([^\\n]{1,300})', 'i');
            var m = text.match(re);
            if (m) return m[1].trim();
        }
        return '';
    }

    // ───────────────────────── StreamBeta ─────────────────────────

    function langName(native) {
        native = String(native || '').trim();
        return LANG_NAMES[native] || native;
    }

    function parseStreamBeta(html) {
        var out = { sources: [], fid: '', lang: '', langs: [], size: '', title: '', related: null, season: 0 };
        var m = html.match(/playerSources\s*=\s*(\[[\s\S]*?\]);/);
        if (m) { try { out.sources = JSON.parse(m[1]) || []; } catch (_) { out.sources = []; } }
        out.fid = (html.match(/maskedFileId\s*=\s*"([^"]+)"/) || [])[1] || '';
        out.lang = langName((html.match(/currentLangNative\s*=\s*"([^"]+)"/) || [])[1] || '');
        out.size = stripTags((html.match(/id="file-size-text"[^>]*>([^<]*)</) || [])[1] || '');
        out.title = stripTags((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
        out.season = +((html.match(/\blet\s+season\s*=\s*"?(\d+)/) || [])[1] || 0);
        var re = /class="lang-btn[^"]*"[^>]*data-fid="(sb_[^"]+)"\s+data-lang="([^"]+)"/g, x;
        while ((x = re.exec(html))) out.langs.push({ fid: x[1], lang: langName(x[2]) });
        var rm = html.match(/window\.relatedData\s*=\s*(\{[\s\S]*?\});\s*(?:\n|<\/script>)/);
        if (rm) { try { out.related = JSON.parse(rm[1]); } catch (_) { out.related = null; } }
        return out;
    }

    async function fetchStreamBeta(url) {
        var r = await withTimeout(get(url, SITE + '/'), 15000);
        if (r.status >= 400 || r.body.indexOf('playerSources') < 0) throw new Error('StreamBeta HTTP ' + r.status);
        return parseStreamBeta(r.body);
    }

    // HubCloud zipper link -> hubcloud drive id -> StreamBeta page URL
    async function hubToStreamBeta(zipperUrl) {
        var u = zipperUrl + (zipperUrl.indexOf('ad_done=') < 0 ? '&ad_done=1' : '');
        var r = await withTimeout(get(u, SITE + '/'), 12000);
        var href = (r.body.match(/data-href="([^"]+)"/) || [])[1] || '';
        href = decodeEntities(href);
        var id = (href.match(/hubcloud\.[a-z]+\/drive\/([A-Za-z0-9]+)/i) || [])[1];
        if (!id && /\/zipper\//.test(href)) {
            var r2 = await withTimeout(get(absUrl(href, 'https://codedew.com/'), u), 12000);
            id = ((decodeEntities((r2.body.match(/data-href="([^"]+)"/) || [])[1] || '')).match(/hubcloud\.[a-z]+\/drive\/([A-Za-z0-9]+)/i) || [])[1];
        }
        if (!id) throw new Error('HubCloud id not found');
        return SB + '?url=' + id;
    }

    // ───────────────────── WatchMultiQuality ─────────────────────

    var WMQ_LANG = /\b(Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|English|Japanese|Urdu)\b/i;

    function b64bytes(str) {
        var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', map = {}, out = '', buf = 0, bits = 0;
        for (var i = 0; i < 64; i++) map[A.charAt(i)] = i;
        for (var j = 0; j < str.length; j++) {
            var v = map[str.charAt(j)];
            if (v === undefined) continue;
            buf = ((buf << 6) | v) & 0xFFFFFF; bits += 6;
            if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); }
        }
        return out;
    }

    // JuicyCodes: _juicycodes("…"+"…") -> base64 ('_'='+', '-'='/') of symbol chars; each symbol is a digit
    // (index in SYM), every 4 digits are one char code: (n % 1000) - salt, salt = last 3 chars - 100 each.
    function juicyConfig(html) {
        var m = String(html).match(/_juicycodes\(((?:\s*"[^"]*"\s*\+?)+)\)/);
        if (!m) return null;
        var e = (m[1].match(/"([^"]*)"/g) || []).map(function (x) { return x.slice(1, -1); }).join('');
        var salt = +e.slice(-3).split('').map(function (c) { return c.charCodeAt(0) - 100; }).join('');
        var raw = b64bytes(e.slice(0, -3).replace(/_/g, '+').replace(/-/g, '/'));
        var SYM = '`%-+*$!_^=', d = '';
        for (var i = 0; i < raw.length; i++) { var k = SYM.indexOf(raw.charAt(i)); if (k >= 0) d += k; }
        var js = '';
        for (var j = 0; j + 4 <= d.length; j += 4) js += String.fromCharCode(parseInt(d.substr(j, 4), 10) % 1000 - salt);
        var cm = js.match(/var\s+config\s*=\s*(\{[\s\S]*?\});/);
        if (!cm) return null;
        try { return JSON.parse(cm[1]); } catch (_) { return null; }
    }

    function randHex(n) { var s = ''; for (var i = 0; i < n; i++) s += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16)); return s; }

    // zipper -> multiquality page -> embed -> HLS master
    async function wmqStream(zipperUrl) {
        var r = await withTimeout(get(zipperUrl, SITE + '/'), 12000);
        var body = r.body;
        var emb = (body.match(/https:\/\/[a-z0-9.-]+\/embed\/[A-Za-z0-9]+/i) || [])[0];
        if (!emb) {
            var id = (String(r.finalUrl).match(/multiquality\/\?url=([A-Za-z0-9]+)/) || [])[1];
            if (!id) {
                // ad interstitial: data-href leads on (same as the HubCloud zipper)
                var href = decodeEntities((body.match(/data-href="([^"]+)"/) || [])[1] || '');
                if (!href) { var r0 = await withTimeout(get(zipperUrl + (zipperUrl.indexOf('ad_done=') < 0 ? '&ad_done=1' : ''), SITE + '/'), 12000); href = decodeEntities((r0.body.match(/data-href="([^"]+)"/) || [])[1] || ''); }
                if (href) {
                    var r2 = await withTimeout(get(absUrl(href, 'https://codedew.com/'), zipperUrl), 12000);
                    emb = (r2.body.match(/https:\/\/[a-z0-9.-]+\/embed\/[A-Za-z0-9]+/i) || [])[0];
                    id = (String(r2.finalUrl).match(/multiquality\/\?url=([A-Za-z0-9]+)/) || [])[1];
                }
            }
            if (!emb && id) emb = 'https://argon.razorshell.space/embed/' + id;
        }
        if (!emb) throw new Error('WatchMultiQuality player not found');
        var origin = emb.match(/^https:\/\/[^\/]+/)[0];
        var eRaw = await withTimeout(http_get(emb, { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Referer': 'https://codedew.com/' }), 12000);
        var e = { status: Number((eRaw && (eRaw.status || eRaw.statusCode)) || 0), body: String((eRaw && eRaw.body) || '') };
        var jar = setCookies(eRaw);
        var xsrf = decodeURIComponent((jar.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
        var cfg = juicyConfig(e.body);
        var file = cfg && cfg.sources && (cfg.sources.file || (cfg.sources[0] && cfg.sources[0].file));
        if (!file) throw new Error('WatchMultiQuality source not found');
        // the player's own "dawn" ping (counts the view; harmless if refused)
        try {
            var jd = JSON.parse((e.body.match(/window\.juicyData\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/) || [])[1] || '{}').data;
            if (jd && jd.token && jd.routes && jd.routes.ping && typeof http_post === 'function') {
                var ph = { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*', 'Referer': emb, 'Origin': origin, 'X-Requested-With': 'XMLHttpRequest' };
                if (jar) ph['Cookie'] = jar;
                if (xsrf) ph['X-XSRF-TOKEN'] = xsrf;
                await withTimeout(http_post(origin + jd.routes.ping, ph,
                    JSON.stringify({ _token: jd.token, __type: 'dawn', pingID: randHex(32) })), 6000);
            }
        } catch (_) {}
        var labels = cfg.sources.labels ? Object.keys(cfg.sources.labels).filter(function (k) { return /^\d+$/.test(k); }).sort(function (a, b) { return b - a; }).map(function (k) { return k + 'p'; }) : [];
        return { url: file, origin: origin, title: String(cfg.title || ''), qualities: labels };
    }

    // ─────────────── MediaFire (single files, mostly movies) ───────────────
    // zipper -> (blazer.raretoonsindia.com short link: AdLinkFly, 3 s timer, needs its cookies) -> MediaFire page
    // -> download*.mediafire.com direct file (supports Range, so it seeks like a normal video).
    function setCookies(res) {
        var h = (res && res.headers) || {}, sc = [];
        Object.keys(h).forEach(function (k) { if (k.toLowerCase() === 'set-cookie') sc = sc.concat(h[k]); });
        return sc.map(function (c) { return String(c).split(';')[0]; }).filter(Boolean).join('; ');
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    async function mediafireStream(zipperUrl) {
        var r = await withTimeout(get(zipperUrl + (zipperUrl.indexOf('ad_done=') < 0 ? '&ad_done=1' : ''), SITE + '/'), 12000);
        var href = decodeEntities((r.body.match(/data-href="([^"]+)"/) || [])[1] || '');
        if (!href) throw new Error('MediaFire link not found');
        href = absUrl(href, 'https://codedew.com/');
        var mf = /mediafire\.com\//.test(href) ? href : '';
        if (!mf) {
            var page = await withTimeout(http_get(href, { 'User-Agent': UA, 'Referer': 'https://codedew.com/' }), 12000);
            var body = String((page && page.body) || '');
            var form = body.slice(body.indexOf('id="go-link"'));
            form = form.slice(0, form.indexOf('</form>'));
            var fields = [], fr = /name="([^"]+)"[^>]*value="([^"]*)"/g, x;
            while ((x = fr.exec(form))) fields.push(encodeURIComponent(decodeEntities(x[1])) + '=' + encodeURIComponent(decodeEntities(x[2])));
            if (!fields.length) throw new Error('short link form not found');
            var wait = +((body.match(/"counter_value"\s*:\s*"?(\d+)/) || [])[1] || 3);
            await sleep(Math.min(wait, 8) * 1000 + 700);
            var origin = href.match(/^https?:\/\/[^\/]+/)[0];
            var go = await withTimeout(http_post(origin + '/links/go', {
                'User-Agent': UA, 'Cookie': setCookies(page), 'Referer': href, 'Origin': origin,
                'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            }, fields.join('&')), 12000);
            var j = {};
            try { j = JSON.parse(String((go && go.body) || '{}')); } catch (_) {}
            mf = String(j.url || '');
            if (!/mediafire\.com\//.test(mf)) throw new Error('short link refused');
        }
        var p = await withTimeout(get(mf, href), 12000);
        var direct = decodeEntities((p.body.match(/href="(https:\/\/download[0-9]*\.mediafire\.com\/[^"]+)"/) || [])[1] || '');
        if (!direct) {
            var sc = (p.body.match(/data-scrambled-url="([^"]+)"/) || [])[1];
            if (sc) direct = b64bytes(sc);
        }
        if (!/^https:\/\/download/.test(direct)) throw new Error('MediaFire file not available');
        var name = decodeURIComponent(direct.split('/').pop().replace(/\+/g, ' '));
        var size = stripTags((p.body.match(/Download\s*\(([\d.]+\s*[KMG]B)\)/i) || [])[1] || '');
        return { url: direct, name: name, size: size };
    }

    // ─────────────── Pixeldrain ZIP packs ("ZIP – Pixel") ───────────────
    // Most series posts also have a season ZIP on pixeldrain. Pixeldrain can serve every file inside
    // a ZIP on its own (/api/file/<id>/info/zip/<path>), so each episode plays as a normal MKV/MP4.
    var PD = 'https://pixeldrain.com';

    function pixelZipLinks(content) {
        var re = /<a\s[^>]*href="(https?:\/\/codedew\.com\/zipper\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m, out = [], seen = {};
        while ((m = re.exec(content))) {
            var label = stripTags(m[2]), u = decodeEntities(m[1]);
            if (!/zip/i.test(label) || !/pixel/i.test(label) || seen[u]) continue;
            seen[u] = 1;
            var before = stripTags(content.slice(Math.max(0, m.index - 300), m.index)).split(/\n/).pop() || '';
            var lm = (label + ' ' + before).match(WMQ_LANG);
            out.push({ url: u, lang: lm ? lm[1].charAt(0).toUpperCase() + lm[1].slice(1).toLowerCase() : '' });
        }
        return out.slice(0, 3);
    }

    function pdFileUrl(id, path) {
        return PD + '/api/file/' + id + '/info/zip/' + path.split('/').map(encodeURIComponent).join('/');
    }

    async function pixelZip(z) {
        var id = '';
        var r = await withTimeout(get(z.url + (z.url.indexOf('ad_done=') < 0 ? '&ad_done=1' : ''), SITE + '/'), 12000);
        var pick = function (b) {
            return (String(b || '').match(/watchbeta\/\?url=([A-Za-z0-9]+)/) || String(b || '').match(/pixeldrain\.[a-z]+\/(?:u|api\/file)\/([A-Za-z0-9]+)/) || [])[1] || '';
        };
        id = pick(r.body) || pick(r.finalUrl);
        if (!id) throw new Error('pixeldrain id not found');
        var ir = await withTimeout(get(PD + '/api/file/' + id + '/info/zip'), 12000);
        if (ir.status !== 200) throw new Error('pixeldrain ' + ir.status);
        var info = JSON.parse(ir.body);
        if (!info || !info.children || (info.properties || []).indexOf('read_individual_files') < 0) throw new Error('zip not readable');
        var files = [];
        (function walk(node, prefix) {
            Object.keys(node.children || {}).forEach(function (k) {
                var c = node.children[k];
                if (c && c.children) walk(c, prefix + k + '/');
                else if (/\.(mkv|mp4|m4v|webm|avi|mov|ts)$/i.test(k)) files.push({ path: prefix + k, name: k, size: (c && c.size) || 0 });
            });
        })(info, '');
        files.sort(function (a, b) { return a.path.localeCompare(b.path, undefined, { numeric: true }); });
        var lang = z.lang || ((files[0] && files[0].name.match(WMQ_LANG)) || [])[1] || 'Hindi';
        return { id: id, lang: lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase(), files: files };
    }

    function fileEpNo(name) {
        var n = String(name).replace(/\.[a-z0-9]+$/i, '');
        var m = n.match(/S\d{1,2}\s*E(\d{1,4})\b/i) || n.match(/\b(?:Episode|Ep)\.?\s*0*(\d{1,4})\b/i) || n.match(/\s-\s0*(\d{1,4})\b/);
        return m ? +m[1] : 0;
    }

    function sizeLabel(b) {
        if (!b) return '';
        return b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : Math.round(b / 1048576) + ' MB';
    }

    // Adds a {l, z, zs, zn} variant to each episode (or builds the episode list from the ZIP).
    function mergePixel(parsed, zips) {
        zips.forEach(function (zp) {
            if (!zp || !zp.files.length) return;
            var vars = zp.files.map(function (f, i) {
                return { n: fileEpNo(f.name), i: i, f: f, v: { l: zp.lang, w: '', h: '', m: '', z: pdFileUrl(zp.id, f.path), zs: sizeLabel(f.size), zn: f.name } };
            });
            if (parsed.episodes.length) {
                var byN = {};
                parsed.episodes.forEach(function (e) { byN[e.n] = e; });
                var hits = vars.filter(function (x) { return x.n && byN[x.n]; }).length;
                var useNo = hits >= Math.ceil(vars.length / 2);
                vars.forEach(function (x) {
                    var e = useNo ? byN[x.n] : parsed.episodes[x.i];
                    if (!e && x.n && useNo) { e = { n: x.n, name: '', v: [] }; parsed.episodes.push(e); byN[x.n] = e; }
                    if (e) e.v.push(x.v);
                });
                parsed.episodes.sort(function (a, b) { return a.n - b.n; });
            } else if (vars.length === 1) {
                parsed.loose.push(vars[0].v);
            } else if (!parsed.loose.length || parsed.loose.every(function (v) { return !v.w && !v.h; })) {
                var nums = vars.map(function (x) { return x.n; });
                var unique = nums.every(function (n, i) { return n && nums.indexOf(n) === i; });
                var named = {};
                vars.forEach(function (x) {
                    var n = unique ? x.n : x.i + 1;
                    if (!named[n]) { named[n] = { n: n, name: x.n ? '' : x.f.name.replace(/\.[a-z0-9]+$/i, '').replace(/\[[^\]]*\]/g, '').trim(), v: [] }; parsed.episodes.push(named[n]); }
                    named[n].v.push(x.v);
                });
                parsed.episodes.sort(function (a, b) { return a.n - b.n; });
                parsed.loose = [];
            }
        });
        return parsed;
    }

    // Old posts link list pages (store.animetoonhindi.com/archives/N, one per language) instead of
    // the files: either one zipper per episode ("Doraemon S01E01" on a "… MultiQuality" page) or the
    // host buttons of a single title ([WatchMultiQuality] [HubCloud] [WatchBeta] [Mega]).
    // which host a list page's episode links go to (from its button label or page title)
    function listKind(t) {
        t = String(t || '');
        if (/hub\s*cloud/i.test(t)) return 'h';
        if (/watch\s*now|stream\s*beta/i.test(t)) return 'w';
        if (/multi\s*quality|watch\s*mult/i.test(t)) return 'm';
        return '';
    }

    async function fromArchives(content) {
        var re = /<a\s[^>]*href="(https?:\/\/store\.animetoonhindi\.com\/archives\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi, m, lists = [], seen = {};
        while ((m = re.exec(content))) {
            var label = stripTags(m[2]);
            if (seen[m[1]] || /mega|zip|gofile|mediafire|drive|torrent/i.test(label)) continue;
            seen[m[1]] = 1;
            var before = stripTags(content.slice(Math.max(0, m.index - 300), m.index)).split(/\n/).pop() || '';
            var lm = (label + ' ' + before).match(WMQ_LANG);
            lists.push({ url: m[1], lang: lm ? lm[1].charAt(0).toUpperCase() + lm[1].slice(1).toLowerCase() : 'Hindi', kind: listKind(label) });
        }
        lists = lists.slice(0, 8);
        var eps = {}, order = [], loose = [];
        var pages = await Promise.all(lists.map(function (l) {
            return withTimeout(get(l.url, SITE + '/'), 12000).then(function (r) { return { l: l, body: r.body }; }).catch(function () { return null; });
        }));
        pages.forEach(function (pg) {
            if (!pg) return;
            var title = stripTags((pg.body.match(/<title>([^<]*)/) || [])[1] || '');
            if (/\b(mega|zip|gofile|mediafire)\b/i.test(title)) return;
            var ar = /<a\s[^>]*href="(https?:\/\/codedew\.com\/zipper\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, x, links = [];
            while ((x = ar.exec(pg.body))) links.push({ url: decodeEntities(x[1]), text: stripTags(x[2]) });
            var single = { l: pg.l.lang, w: '', h: '', m: '' };
            var epKind = pg.l.kind || listKind(title);
            links.forEach(function (k) {
                var kind = linkKind(k.text);
                if (kind) { if (!single[kind]) single[kind] = k.url; return; }
                if (!epKind) return;
                var n = +((k.text.match(/S\d{1,2}\s*E(\d{1,4})\b/i) || k.text.match(/\b(?:Episode|Ep)\.?\s*0*(\d{1,4})\b/i) || [])[1] || 0);
                if (!n) return;
                if (!eps[n]) { eps[n] = { n: n, name: '', v: [] }; order.push(n); }
                var have = eps[n].v.filter(function (o) { return o.l === pg.l.lang; })[0];
                if (!have) { have = { l: pg.l.lang, w: '', h: '', m: '' }; eps[n].v.push(have); }
                if (!have[epKind]) have[epKind] = k.url;
            });
            if (single.w || single.h || single.m || single.f) loose.push(single);
        });
        var list = order.map(function (n) { return eps[n]; }).sort(function (a, b) { return a.n - b.n; });
        return { episodes: list, loose: list.length ? [] : loose };
    }

    // "Complete series" / "All seasons" posts only link the season posts: open them and merge.
    function indexLinks(content, selfUrl) {
        var re = /<a\s[^>]*href="(https?:\/\/(?:www\.)?rareanimes\.[a-z]+\/[^"#?]+\/)"[^>]*>([\s\S]*?)<\/a>/gi, m, out = [], seen = {};
        var body = content.split(/Watch\s*Also|Related\s*Posts/i)[0];
        while ((m = re.exec(body))) {
            var u = m[1], t = stripTags(m[2]);
            if (seen[u] || u === selfUrl || /\/(home|category|tag|page|dmca|contact-us|disclaimer)\//.test(u) || /^\s*all\b/i.test(t) || /all-(?:series|season|movies)/i.test(u)) continue;
            seen[u] = 1;
            var sn = +((t.match(/\bseason\s*0*(\d+)/i) || u.match(/season-0*(\d+)/i) || [])[1] || 0);
            out.push({ url: u, sn: sn, title: t });
        }
        return out;
    }

    // ───────────────────────── load ─────────────────────────

    // A post that 404s was usually renamed (e.g. "...-hindi-dubbed-..." -> "...-hindi-subbed-...")
    // or deleted while the site's widgets still link to it. Look it up by its slug words.
    var SLUG_NOISE = /^(hindi|tamil|telugu|malayalam|bengali|english|dubbed|subbed|dual|audio|multi|episodes?|download|hd|watch|online|free|full|movie|series|all|seasons?|\d{3,4}p|x264|x265|hevc|esubs?|\d{4})$/;
    function slugWords(u) {
        var slug = String(u || '').replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '';
        return slug.toLowerCase().split('-').filter(function (w) { return w && !/^\d{1,2}$/.test(w) && !SLUG_NOISE.test(w); });
    }
    async function findMovedPost(url) {
        var want = slugWords(url);
        if (want.length < 1) return '';
        var season = (String(url).match(/season-(\d+)/i) || [])[1] || '';
        var found = [];
        await new Promise(function (res) { search(want.slice(0, 4).join(' '), function (r) { found = (r && r.success && r.data) || []; res(); }); });
        var best = '', bestScore = 0;
        found.forEach(function (it) {
            if (!it || !it.url || it.url === url) return;
            var got = slugWords(it.url), hit = 0;
            want.forEach(function (w) { if (got.indexOf(w) >= 0) hit++; });
            var s2 = (String(it.url).match(/season-(\d+)/i) || [])[1] || '';
            if (season !== s2) return;
            var score = hit / want.length;
            if (score > bestScore) { bestScore = score; best = it.url; }
        });
        return bestScore >= 0.8 ? best : '';
    }

    async function load(url, cb, _moved) {
        try {
            var r = await get(url);
            if (r.status === 404 && !_moved) {
                var moved = await findMovedPost(url).catch(function () { return ''; });
                if (moved) return load(moved, cb, true);
                return cb({ success: false, errorCode: 'NOT_FOUND', message: 'This title was removed from RareAnimes - the site still lists it, but its page is gone. Try searching for it, it may be re-uploaded under another name.' });
            }
            if (r.status >= 400) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'RareAnimes returned HTTP ' + r.status });
            var html = r.body;
            var rawTitle = stripTags((html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '')
                || stripTags((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '').replace(/\s*-\s*Rare Toons India\s*$/i, '');
            var a = html.indexOf('<div class="entry-content'), b = html.indexOf('</article>', a);
            var content = a >= 0 ? html.slice(a, b > a ? b : undefined) : html;
            var text = stripTagsKeepNewlines(content.replace(/<(?:p|h\d|br|div|li)\b[^>]*>/gi, '\n'));

            var poster = '';
            var imgRe = /<img[^>]+src="([^"]+)"[^>]*>/g, im;
            while ((im = imgRe.exec(content))) {
                var tag = im[0], w = +((tag.match(/width="(\d+)"/) || [])[1] || 0), h = +((tag.match(/height="(\d+)"/) || [])[1] || 0);
                if (/wp-content\/uploads/.test(im[1]) && h > w) { poster = im[1].replace(/-\d+x\d+(\.\w+)$/, '$1'); break; }
            }
            var og = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || '';
            if (!poster) poster = og;

            var synopsis = infoField(text, ['Synopsis', 'Storyline', 'Plot']);
            var yearM = (infoField(text, ['Release Year', 'Year']) + ' ' + rawTitle).match(/\b(19[5-9]\d|20[0-4]\d)\b/);
            var genres = infoField(text, ['Genre']).split(/,|&|\band\b/).map(function (g) { return g.trim(); }).filter(function (g) { return g && g.length < 30; });
            var seasonNo = +((rawTitle.match(/\bseason\s*0*(\d+)/i) || [])[1] || (infoField(text, ['Season']).match(/^\s*0*(\d+)/) || [])[1] || 1);
            var type = guessType(rawTitle, '');

            var idx;
            var zipJobs = Promise.all(pixelZipLinks(content).map(function (z) { return pixelZip(z).catch(function () { return null; }); }));
            var parsed = parseEpisodes(postLines(content));
            if (!parsed.episodes.length && !parsed.loose.length) {
                var arc = await fromArchives(content).catch(function () { return null; });
                if (arc && (arc.episodes.length || arc.loose.length)) parsed = arc;
            }
            parsed = mergePixel(parsed, await zipJobs);
            var episodes = [];

            if (parsed.episodes.length) {
                type = 'series';
                parsed.episodes.forEach(function (e) {
                    episodes.push(mkEpisode({
                        name: e.name ? ('Episode ' + e.n + ' – ' + e.name) : ('Episode ' + e.n),
                        url: JSON.stringify({ v: e.v, t: rawTitle }),
                        season: seasonNo, episode: e.n, posterUrl: poster,
                        description: e.v.map(function (v) { return v.l + (v.z ? ' (Pixeldrain)' : ''); }).join(' • ')
                    }));
                });
            } else if (parsed.loose.length && type === 'series' && parsed.loose.some(function (v) { return v.w; })) {
                // Season-level WatchNow link: StreamBeta knows every episode of the season.
                var first = parsed.loose.filter(function (v) { return v.w; })[0];
                var sb = null;
                try { sb = await fetchStreamBeta(first.w); } catch (_) { sb = null; }
                var group = null;
                if (sb && sb.related) {
                    var keys = Object.keys(sb.related);
                    keys.forEach(function (k) {
                        var g = sb.related[k];
                        if (!group && g && g.episodes && g.episodes.some(function (x) { return x.id === sb.fid; })) group = g;
                    });
                    if (!group) keys.forEach(function (k) { var g = sb.related[k]; if (!group && g && +g.season_no === seasonNo) group = g; });
                }
                if (group && group.episodes && group.episodes.length > 1) {
                    group.episodes.slice().sort(function (x, y) { return (x.e || 0) - (y.e || 0); }).forEach(function (x) {
                        episodes.push(mkEpisode({
                            name: x.ep_name && !/^episode \d+$/i.test(x.ep_name) ? ('Episode ' + x.e + ' – ' + x.ep_name) : ('Episode ' + x.e),
                            url: JSON.stringify({ f: x.id, t: rawTitle }),
                            season: +(x.s || group.season_no || seasonNo), episode: +(x.e || 0),
                            posterUrl: x.img || poster, description: x.overview || ''
                        }));
                    });
                } else {
                    episodes.push(mkEpisode({ name: 'Episode 1', url: JSON.stringify({ v: parsed.loose, t: rawTitle }), season: seasonNo, episode: 1, posterUrl: poster }));
                }
            } else if (parsed.loose.length) {
                episodes.push(mkEpisode({ name: cleanTitle(rawTitle), url: JSON.stringify({ v: parsed.loose, t: rawTitle }), season: 1, episode: 1, posterUrl: poster }));
            } else if (!_moved && (idx = indexLinks(content, url)).length >= 1) {
                // index post: every linked season (or movie) becomes part of this title
                // keep only posts of this show (pages also link unrelated "you may like" posts)
                var key = cleanTitle(rawTitle).toLowerCase().replace(/\b(all|complete|series|seasons?|movies?|episodes?|hindi|tamil|telugu|english|dubbed|download|hd|the|and|in|of)\b/g, ' ')
                    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; });
                idx = idx.filter(function (x) {
                    var t = (x.title + ' ' + x.url.replace(/[-\/]/g, ' ')).toLowerCase();
                    return key.length && key.every(function (w) { return t.indexOf(w) >= 0; });
                }).slice(0, 24);
                var sns = idx.map(function (x) { return x.sn; });
                if (sns.some(function (n, i) { return n && sns.indexOf(n) !== i; })) idx.forEach(function (x, i) { x.sn = i + 1; });
                var subs = await Promise.all(idx.map(function (x) {
                    return new Promise(function (res) {
                        withTimeout(new Promise(function (r2) { load(x.url, function (o) { r2(o); }, true); }), 20000)
                            .then(res, function () { res(null); });
                    });
                }));
                var seasonsMode = idx.filter(function (x) { return x.sn; }).length >= 2;
                subs.forEach(function (o, i) {
                    if (!o || !o.success || !o.data) return;
                    (o.data.episodes || []).forEach(function (e) {
                        var eu = String(e.url || '');
                        if (/"none":1/.test(eu)) return;
                        if (seasonsMode) {
                            episodes.push(mkEpisode({ name: e.name, url: eu, season: idx[i].sn || e.season || 1, episode: e.episode, posterUrl: e.posterUrl, description: e.description }));
                        } else {
                            episodes.push(mkEpisode({ name: o.data.title + ((o.data.episodes || []).length > 1 ? ' – ' + e.name : ''), url: eu, season: 1, episode: episodes.length + 1, posterUrl: o.data.posterUrl || e.posterUrl, description: e.description }));
                        }
                    });
                });
                if (episodes.length && seasonsMode) type = 'series';
                else if (episodes.length) type = episodes.length > 1 ? 'series' : type;
                else episodes.push(mkEpisode({ name: cleanTitle(rawTitle), url: JSON.stringify({ none: 1, t: rawTitle }), season: 1, episode: 1, posterUrl: poster }));
            } else {
                // Only Mega / ZIP / dead DLBeta links: nothing the app can play.
                episodes.push(mkEpisode({ name: cleanTitle(rawTitle), url: JSON.stringify({ none: 1, t: rawTitle }), season: 1, episode: 1, posterUrl: poster }));
            }

            cb({
                success: true,
                data: mkItem({
                    title: cleanTitle(rawTitle),
                    url: url,
                    posterUrl: poster,
                    bannerUrl: og || poster,
                    type: type,
                    year: yearM ? +yearM[1] : undefined,
                    description: synopsis || decodeEntities(rawTitle),
                    tags: genres,
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: 'LOAD_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────────────────────── streams ─────────────────────────

    function qualityOf(title, size) {
        var m = String(title || '').match(/\b(2160|1440|1080|720|480|360)p\b/i);
        if (m) return m[1] + 'p';
        var mb = parseFloat(size) * (/GB/i.test(size) ? 1024 : 1);
        return mb >= 900 ? '1080p' : (mb > 0 ? 'HD' : 'Auto');
    }

    // file name if it says (1080p…), else a guess from the size of a ~24 min episode
    function pdQuality(name, size) {
        var m = String(name || '').match(/\b(2160|1440|1080|720|576|480|360)p\b/i);
        if (m) return m[1] + 'p';
        var mb = parseFloat(size) * (/GB/i.test(size) ? 1024 : 1);
        return mb >= 600 ? '1080p' : mb >= 250 ? '720p' : 'SD';
    }

    async function loadStreams(data, cb) {
        try {
            var d;
            try { d = JSON.parse(data); } catch (_) { d = { v: [{ l: 'Hindi', w: String(data), h: '' }] }; }
            if (d.none) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'This post only has Mega / ZIP download links, which cannot be played in the app.' });

            // 1) one StreamBeta page per audio variant (WatchNow, or HubCloud as a fallback)
            var jobs = [];
            if (d.f) jobs.push({ label: '', task: function () { return fetchStreamBeta(SB + '?v=' + encodeURIComponent(d.f)); } });
            (d.v || []).forEach(function (v) {
                if (v.w) jobs.push({ label: v.l, task: function () { return fetchStreamBeta(v.w).catch(function (e) { if (v.h) return hubToStreamBeta(v.h).then(fetchStreamBeta); throw e; }); } });
                else if (v.h) jobs.push({ label: v.l, task: function () { return hubToStreamBeta(v.h).then(fetchStreamBeta); } });
            });
            var pdLang = {};
            (d.v || []).forEach(function (v) { if (v.z) pdLang[v.l] = 1; });
            var wmqJobs = (d.v || []).filter(function (v) { return v.m && !v.w && !v.h; }).slice(0, 3).map(function (v) {
                return wmqStream(v.m).then(function (x) { x.label = v.l; return x; }).catch(function () { return null; });
            });
            var wmqAll = Promise.all(wmqJobs);
            var mfAll = Promise.all((d.v || []).filter(function (v) { return v.f; }).slice(0, 3).map(function (v) {
                return mediafireStream(v.f).then(function (x) { x.label = v.l; return x; }).catch(function () { return null; });
            }));
            var pages = await Promise.all(jobs.map(function (j) {
                return j.task().then(function (p) { p.label = j.label; return p; }).catch(function () { return null; });
            }));
            var wmq = (await wmqAll).filter(Boolean);
            var mfs = (await mfAll).filter(Boolean);
            var mfLang = {};
            mfs.forEach(function (x) { mfLang[x.label] = 1; });
            pages = pages.filter(Boolean);

            // 2) audio versions the post didn't link (e.g. Tamil/Telugu of a fid-only episode)
            var have = {};
            pages.forEach(function (p) { if (p.fid) have[p.fid] = 1; });
            var extra = [];
            pages.forEach(function (p) { p.langs.forEach(function (l) { if (!have[l.fid] && extra.length < 4) { have[l.fid] = 1; extra.push(l); } }); });
            if (extra.length) {
                var more = await Promise.all(extra.map(function (l) {
                    return fetchStreamBeta(SB + '?v=' + encodeURIComponent(l.fid)).then(function (p) { p.label = l.lang; return p; }).catch(function () { return null; });
                }));
                pages = pages.concat(more.filter(Boolean));
            }

            // 3) streams
            var list = [], seen = {}, seenFid = {};
            pages.forEach(function (p) {
                if (p.fid && seenFid[p.fid]) return;
                if (p.fid) seenFid[p.fid] = 1;
                var lang = p.lang || p.label || 'Hindi';
                var label = (p.label && /untouched|uncut/i.test(p.label)) ? p.label : lang;
                p.sources.forEach(function (s) {
                    var u = s.stream_url || s.url;
                    if (!u || seen[u] || /pixeldrain/i.test(s.type || '') || !/^https?:\/\//.test(u)) return;
                    seen[u] = 1;
                    var server = s.name || s.type || 'Server';
                    list.push(mkStream({
                        url: u,
                        source: label + ' • ' + server + (p.size ? ' • ' + p.size : ''),
                        quality: qualityOf(p.title, p.size),
                        headers: { 'User-Agent': UA }
                    }));
                });
            });
            mfs.forEach(function (x) {
                if (seen[x.url]) return;
                seen[x.url] = 1;
                list.push(mkStream({
                    url: x.url,
                    source: (/multi[\s._-]*audio/i.test(x.name) ? 'Multi Audio' : (x.label || 'Hindi')) + ' • MediaFire' + (x.size ? ' • ' + x.size : ''),
                    quality: qualityOf(x.name, x.size),
                    headers: { 'User-Agent': UA }
                }));
            });
            wmq.forEach(function (x) {
                if (seen[x.url]) return;
                seen[x.url] = 1;
                list.push(mkStream({
                    url: x.url,
                    source: (x.label || 'Hindi') + ' • MultiQuality' + (x.qualities.length ? ' (' + x.qualities.join('/') + ')' : ''),
                    quality: x.qualities.length ? x.qualities[0] : 'Auto',
                    headers: { 'User-Agent': UA, 'Referer': x.origin + '/', 'Origin': x.origin }
                }));
            });
            // Pixeldrain files are not probed: the host ignores Range, so a probe would download the whole
            // episode. The ZIP was checked when the episode list was built.
            var pd = [];
            (d.v || []).forEach(function (v) {
                if (!v.z || seen[v.z]) return;
                seen[v.z] = 1;
                pd.push(mkStream({
                    url: v.z,
                    source: (/multi[\s._-]*audio/i.test(v.zn || '') ? 'Multi Audio' : v.l) + ' • Pixeldrain' + (v.zs ? ' • ' + v.zs : ''),
                    quality: pdQuality(v.zn, v.zs),
                    headers: { 'User-Agent': UA }
                }));
            });
            if (!list.length && !pd.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No playable source for this episode right now.' });

            var verified = list.length ? await verifyStreams(list, 2) : [];
            verified = pd.concat(verified);
            if (!verified.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'All servers for this episode are down right now.' });
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
        if (!/^https?:\/\//i.test(u)) return "ok";
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
            if (/^\{\s*"success"\s*:\s*false/.test(body)) return "dead";
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
