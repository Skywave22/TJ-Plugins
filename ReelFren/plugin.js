/*
 * ReelFren — SkyStream plugin (2026-10-19)
 * Site: https://www.reelfren.com — free short dramas (vertical "reels") collected from ~40 apps:
 * ReelShort, DramaBox, ShortMax, NetShort, DramaWave, StoryReel, VibeShort, Melolo, FlareFlow, ...
 * plus WeTV / iQIYI dramas and anime. (The bare domain reelfren.com sits behind a Cloudflare
 * challenge; www.reelfren.com and api.reelfren.com don't.)
 * Flow:
 *   catalog : api.reelfren.com/api/home?provider=P&category=C&offset=N&lang=en   (one row per app)
 *   search  : api.reelfren.com/api/search?provider=P&q=Q&lang=en&offset=0      (apps in parallel)
 *   load    : www.reelfren.com/drama/P/ID-slug page (Next.js flight data -> detail.videos[]);
 *             if that page is down: api/video?ep=1 -> totalEpisodes
 *   streams : api.reelfren.com/api/video?provider=P&id=ID&ep=N&lang=en&server=1|2&cv=v21
 *             -> videoUrl / qualityList (HLS or MP4) + subtitles (SRT/VTT, many languages)
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
        : 'https://www.reelfren.com';
    var API = 'https://api.reelfren.com';
    var PROXY = 'https://proxy.reelfren.com';
    var LANG = 'en';
    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    // some video CDNs (BlinkDrama, ...) answer 403 to desktop browsers without the site as referer
    var PLAY_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Referer': 'https://www.reelfren.com/'
    };
    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=ReelFren';
    var PROXIED = { anyreel: 1, blinkdrama: 1, dramawave: 1, shortmax: 1, vibeshort: 1 };

    var NAMES = {
        anamana: 'Anamana', aniboy: 'AniBoy', blinkdrama: 'BlinkDrama', bonustv: 'BonusTV', candyjar: 'CandyJar',
        cubetv: 'CubeTV', dramabox: 'DramaBox', dramanova: 'DramaNova', dramawave: 'DramaWave', filmbox: 'FilmBox',
        flareflow: 'FlareFlow', flextv: 'FlexTV', flextv2: 'FlexTV 2', freereels: 'FreeReels', happyshort: 'HappyShort',
        iqiyi: 'iQIYI', joyreels: 'JoyReels', kalostv: 'KalosTV', melolo: 'Melolo', moboreels: 'MoboReels',
        moviebox: 'MovieBox', movieboxshorts: 'MovieBox Shorts', mydrama: 'MyDrama', netshort: 'NetShort',
        pinedrama: 'PineDrama', rapidtv: 'RapidTV', rapidtv2: 'RapidTV 2', raptdrama: 'RaptDrama', reelife: 'Reelife',
        reelshort: 'ReelShort', sereal: 'Sereal+', shorten: 'Shorten', shortmax: 'ShortMax', storyreel: 'StoryReel',
        vibeshort: 'VibeShort', vigloo: 'Vigloo', wetv: 'WeTV', anyreel: 'AnyReel', bstation: 'Bstation'
    };
    function pname(p) { return NAMES[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'ReelFren'); }

    // home rows: one per app (category/feed = the app's default tab on the site)
    var ROWS = [
        { name: 'ReelShort - Popular', p: 'reelshort', category: 'popular' },
        { name: 'DramaBox',            p: 'dramabox' },
        { name: 'ShortMax',            p: 'shortmax' },
        { name: 'NetShort',            p: 'netshort', category: 'home' },
        { name: 'DramaWave',           p: 'dramawave' },
        { name: 'StoryReel',           p: 'storyreel' },
        { name: 'VibeShort',           p: 'vibeshort', category: 'all' },
        { name: 'Melolo',              p: 'melolo' },
        { name: 'MoboReels',           p: 'moboreels' },
        { name: 'FlareFlow',           p: 'flareflow' },
        { name: 'BlinkDrama',          p: 'blinkdrama' },
        { name: 'HappyShort',          p: 'happyshort', category: 'home' },
        { name: 'FreeReels',           p: 'freereels', category: 'all' },
        { name: 'Reelife',             p: 'reelife', category: 'all' },
        { name: 'Sereal+',             p: 'sereal', feed: 'latest' },
        { name: 'Shorten',             p: 'shorten', category: 'releases' },
        { name: 'CandyJar',            p: 'candyjar' },
        { name: 'PineDrama',           p: 'pinedrama', category: '0' },
        { name: 'MyDrama',             p: 'mydrama', category: 'all' },
        { name: 'RapidTV',             p: 'rapidtv' },
        { name: 'RaptDrama',           p: 'raptdrama' },
        { name: 'BonusTV',             p: 'bonustv' },
        { name: 'CubeTV',              p: 'cubetv' },
        { name: 'MovieBox Shorts',     p: 'movieboxshorts', category: 'all' },
        { name: 'iQIYI Dramas',        p: 'iqiyi', category: 'home' },
        { name: 'WeTV Dramas',         p: 'wetv' },
        { name: 'FilmBox',             p: 'filmbox' },
        { name: 'Anime',               p: 'aniboy', category: 'anime' }
    ];
    // providers searched (the ones whose videos play; MovieBox's CDN often refuses connections)
    var SEARCH_PROVIDERS = ['reelshort', 'dramabox', 'shortmax', 'netshort', 'dramawave', 'storyreel', 'vibeshort',
        'melolo', 'moboreels', 'flareflow', 'blinkdrama', 'happyshort', 'freereels', 'reelife', 'sereal', 'shorten',
        'candyjar', 'pinedrama', 'mydrama', 'rapidtv', 'raptdrama', 'bonustv', 'cubetv', 'movieboxshorts', 'iqiyi',
        'wetv', 'filmbox', 'anamana', 'flextv2', 'aniboy', 'moviebox', 'joyreels', 'kalostv', 'vigloo', 'flextv'];

    // ───────────────── helpers ─────────────────
    function withTimeout(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    async function fetchRaw(url, extra, ms) {
        var h = { 'User-Agent': UA, 'Accept': 'application/json, text/html;q=0.9, */*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': SITE + '/' };
        if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        var r = await withTimeout(http_get(url, h), ms || 15000);
        return { status: Number((r && (r.status || r.statusCode)) || 0), body: String((r && r.body) || '') };
    }
    async function getJson(url, ms) {
        var r = await fetchRaw(url, { 'Accept': 'application/json' }, ms);
        if (r.status !== 200) throw new Error('HTTP ' + (r.status || 'no connection'));
        return JSON.parse(r.body);
    }
    function qs(o) {
        return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== null && o[k] !== ''; })
            .map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
    }
    function asset(u) {   // same rule as the site's backendApiAssetUrl()
        u = String(u || '');
        if (u.indexOf('/api/proxy/') === 0) return PROXY + u;
        if (u.indexOf('/api/') === 0) return API + u;
        if (u.indexOf('//') === 0) return 'https:' + u;
        return u;
    }
    function slugify(id, title) {   // same rule as the site's path helper
        id = String(id);
        if (id.indexOf('-') >= 0) return id;
        var s = String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');
        return s ? id + '-' + s : id;
    }
    function cleanTitle(t) {
        var t2 = String(t || '').replace(/\s+/g, ' ').trim();
        var dub = /[（(]\s*DUBBED\s*[)）]/i.test(t2);
        t2 = t2.replace(/\s*[（(]\s*DUBBED\s*[)）]\s*/ig, ' ').trim();
        return dub ? t2 + ' (Dubbed)' : t2;
    }
    function mkItem(o) { try { return new MultimediaItem(o); } catch (_) { return o; } }
    function mkEpisode(o) { try { return new Episode(o); } catch (_) { return o; } }
    function mkStream(o) {
        var s;
        try { s = new StreamResult({ url: o.url, source: o.source, headers: o.headers, subtitles: o.subtitles }); } catch (_) { s = o; }
        if (o.subtitles && o.subtitles.length && !s.subtitles) s.subtitles = o.subtitles;
        return s;
    }
    function normWords(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean); }

    // Item url: SITE/drama/<provider>/<id-slug>?lang=en#{"t":title,"c":cover,"n":episodes}
    function toItem(d) {
        if (!d || !d.id || !d.provider) return null;
        var title = cleanTitle(d.title);
        var meta = { t: title, c: d.cover || '' };
        if (d.episodes) meta.n = d.episodes;
        return mkItem({
            title: title,
            url: SITE + '/drama/' + d.provider + '/' + slugify(d.id, d.title) + '?lang=' + LANG + '#' + encodeURIComponent(JSON.stringify(meta)),
            posterUrl: d.cover || PLACEHOLDER,
            type: d.episodes === 1 ? 'movie' : 'series',
            description: (d.intro ? String(d.intro).slice(0, 300) + '\n' : '') + pname(d.provider) + (d.episodes ? ' • ' + d.episodes + ' episodes' : '')
        });
    }
    function parseItemUrl(url) {
        var u = String(url || '');
        var m = u.match(/\/(?:drama|watch)\/([a-z0-9]+)\/([^?#\/]+)/i);
        if (!m) return null;
        var slug = decodeURIComponent(m[2]);
        // ids are digits, hex, or (FilmBox) "123_dive"/"abc" — the slug starts after the first "-"
        var id = slug.split('-')[0];
        var meta = {};
        var h = u.split('#')[1];
        if (h) { try { meta = JSON.parse(decodeURIComponent(h)); } catch (_) {} }
        var ep = (u.match(/[?&]ep=(\d+)/) || [])[1];
        return { p: m[1].toLowerCase(), id: id, slug: slug, meta: meta, ep: ep ? parseInt(ep, 10) : 0 };
    }

    // ───────── catalog ─────────
    async function homeRow(row, offset) {
        var j = await getJson(API + '/api/home?' + qs({ provider: row.p, category: row.category, feed: row.feed, offset: offset || 0, lang: LANG }), 12000);
        return (j && j.data) || [];
    }
    async function getHome(cb) {
        try {
            var lists = await Promise.all(ROWS.map(function (r) { return homeRow(r).catch(function () { return null; }); }));
            if (lists.every(function (l) { return !l; })) {
                return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'ReelFren is not answering right now (api.reelfren.com). Try again in a minute.' });
            }
            var data = {};
            // Trending (hero carousel): the top picks of the biggest apps, interleaved
            var trend = [], seen = {};
            for (var k = 0; k < 4; k++) {
                [0, 1, 2, 3, 4, 5].forEach(function (ri) {
                    var it = lists[ri] && lists[ri][k];
                    var key = it && it.provider + ':' + it.id;
                    if (it && !seen[key]) { seen[key] = 1; trend.push(it); }
                });
            }
            if (trend.length) data['Trending'] = trend.map(toItem).filter(Boolean);
            ROWS.forEach(function (r, i) {
                var items = (lists[i] || []).slice(0, 30).map(toItem).filter(Boolean);
                if (items.length) data[r.name] = items;
            });
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var words = normWords(q);
            // all apps in parallel; don't wait for an app that hangs (one being down can take 13 s
            // to fail): answer once 85% of them replied and 2.5 s passed, or after 6 s at the latest
            var lists = await new Promise(function (resolve) {
                var res = SEARCH_PROVIDERS.map(function () { return null; }), done = 0, finished = false, t0 = Date.now();
                function finish() { if (!finished) { finished = true; resolve(res.slice()); } }
                function check() { if (done >= SEARCH_PROVIDERS.length || (done >= SEARCH_PROVIDERS.length * 0.85 && Date.now() - t0 >= 2500)) finish(); }
                SEARCH_PROVIDERS.forEach(function (p, i) {
                    getJson(API + '/api/search?' + qs({ provider: p, q: q, lang: LANG, offset: 0 }), 6000)
                        .then(function (j) { res[i] = (j && j.data) || []; }, function () {})
                        .then(function () { done++; check(); });
                });
                setTimeout(check, 2600);
                setTimeout(finish, 6000);
            });
            if (lists.every(function (l) { return l === null; })) throw new Error('ReelFren search is not answering right now.');
            // best matches first: every query word in the title, then the rest; apps interleaved
            var strong = [], weak = [], seen = {};
            for (var k = 0; k < 40; k++) {
                lists.forEach(function (l) {
                    var it = l && l[k];
                    if (!it) return;
                    var key = it.provider + ':' + it.id;
                    if (seen[key]) return;
                    seen[key] = 1;
                    var t = ' ' + normWords(it.title).join(' ') + ' ';
                    (words.every(function (w) { return t.indexOf(' ' + w) >= 0; }) ? strong : weak).push(it);
                });
            }
            cb({ success: true, data: strong.concat(weak).slice(0, 120).map(toItem).filter(Boolean) });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────── load ─────────
    function flightDetail(html) {
        var re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g, m, txt = '';
        while ((m = re.exec(html))) { try { txt += JSON.parse('"' + m[1] + '"'); } catch (_) {} }
        var i = txt.indexOf('{"detail":{');
        if (i < 0) return null;
        // cut the balanced JSON object
        var depth = 0, inStr = false, esc = false;
        for (var j = i; j < txt.length; j++) {
            var c = txt.charAt(j);
            if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(txt.slice(i, j + 1)).detail; } catch (_) { return null; } } }
        }
        return null;
    }
    async function videoInfo(p, id, ep, server, host) {
        var j = await getJson((host || API) + '/api/video?' + qs({ provider: p, id: id, ep: ep, lang: LANG, server: server || '1', cv: 'v21' }), 15000);
        if (!j || typeof j !== 'object' || j.error) throw new Error((j && j.error) || 'bad answer');
        return j;
    }

    async function load(url, cb) {
        try {
            var it = parseItemUrl(url);
            if (!it) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized ReelFren URL: ' + url });
            var pageUrl = SITE + '/drama/' + it.p + '/' + slugify(it.id, it.meta.t || (it.slug.indexOf('-') > 0 ? '' : '')) + '?lang=' + LANG;
            if (it.slug.indexOf('-') > 0) pageUrl = SITE + '/drama/' + it.p + '/' + it.slug + '?lang=' + LANG;
            var detail = null;
            try {
                var r = await fetchRaw(pageUrl, { 'Accept': 'text/html' }, 15000);
                if (r.status === 200) detail = flightDetail(r.body);
            } catch (_) {}
            var title = cleanTitle((detail && detail.title) || it.meta.t || it.slug.replace(/^[^-]+-?/, '').replace(/-/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }));
            var cover = (detail && detail.cover) || it.meta.c || PLACEHOLDER;
            var eps = [];
            if (detail && detail.videos && detail.videos.length) {
                var avail = detail.videos.filter(function (v) { return v.available !== false; });
                (avail.length ? avail : detail.videos).forEach(function (v) { eps.push(Number(v.episode)); });
            }
            var total = (detail && detail.episodes) || 0;
            if (!eps.length) {
                // drama page down for this app: ask the player API how many episodes there are
                var info = null;
                try { info = await videoInfo(it.p, it.id, 1, '1'); } catch (_) {
                    try { info = await videoInfo(it.p, it.id, 1, '1', SITE); } catch (__) {}
                }
                total = Math.max(total, (info && info.totalEpisodes) || 0, it.meta.n || 0);
                if (!total && info) total = 1;
                for (var e = 1; e <= total; e++) eps.push(e);
            }
            if (!eps.length) {
                return cb({ success: false, errorCode: 'UNAVAILABLE', message: pname(it.p) + ' is not answering on ReelFren right now (the website shows "Video cannot be loaded" too). Try again later.' });
            }
            eps = eps.filter(function (x, i) { return x > 0 && eps.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
            var slug = it.slug.indexOf('-') > 0 ? it.slug : slugify(it.id, title);
            var episodes = eps.map(function (n) {
                return mkEpisode({
                    name: eps.length === 1 ? title : 'Episode ' + n,
                    url: SITE + '/watch/' + it.p + '/' + slug + '?ep=' + n + '&lang=' + LANG,
                    season: 1,
                    episode: n,
                    posterUrl: cover
                });
            });
            var intro = (detail && detail.intro) || '';
            cb({
                success: true,
                data: mkItem({
                    title: title,
                    url: SITE + '/drama/' + it.p + '/' + slug + '?lang=' + LANG,
                    posterUrl: cover,
                    bannerUrl: cover,
                    type: eps.length === 1 ? 'movie' : 'series',
                    description: (intro ? intro + '\n\n' : '') + 'App: ' + pname(it.p) + ' • ' + eps.length + (eps.length === 1 ? ' episode' : ' episodes'),
                    tags: ['Short Drama', pname(it.p)],
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────── streams ─────────
    function qnum(label) { var m = String(label || '').match(/(\d{3,4})\s*p/i); return m ? parseInt(m[1], 10) : 0; }
    function subtitleList(subs) {
        var out = (subs || []).filter(function (s) { return s && s.url; }).map(function (s) {
            var lang = String(s.srclang || s.lang || '').toLowerCase();
            return { url: asset(s.url), label: String(s.label || lang || 'Subtitle'), lang: lang || 'und' };
        });
        function rank(s) { return /^en/.test(s.lang) || /english/i.test(s.label) ? 0 : (/^hi/.test(s.lang) || /hindi/i.test(s.label) ? 1 : 2); }
        return out.sort(function (a, b) { return rank(a) - rank(b); });
    }

    async function loadStreams(url, cb) {
        try {
            var it = parseItemUrl(url);
            if (!it) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized ReelFren episode: ' + url });
            var ep = it.ep || 1;
            // api.reelfren.com server 1, the website's copy and server 2 at the same time (a provider
            // that is down takes ~13 s to fail); server 1 answers are preferred when both arrive
            var tries = [[API, '1'], [SITE, '1'], [API, '2']];
            var lastErr = '';
            var info = await new Promise(function (resolve) {
                var left = tries.length, got = [];
                tries.forEach(function (t, i) {
                    videoInfo(it.p, it.id, ep, t[1], t[0]).then(function (j) {
                        if (j.videoUrl || (j.qualityList && j.qualityList.length)) {
                            got[i] = j;
                            if (i < 2 || !got[0]) return resolve(j);
                        } else lastErr = j.locked ? 'locked' : 'no video';
                    }, function (e) { lastErr = String((e && e.message) || e); }).then(function () {
                        if (--left === 0) resolve(got[0] || got[1] || got[2] || null);
                    });
                });
            });
            if (!info) {
                return cb({ success: false, errorCode: 'NO_STREAMS', message: pname(it.p) + ' episode ' + ep + ' cannot be loaded from ReelFren right now (' + lastErr + '). The website shows "Video cannot be loaded" for it too - try again later.' });
            }
            var subs = subtitleList(info.subtitles);
            var cands = [];
            (info.qualityList || []).forEach(function (q) {
                if (!q || !q.url || (q.format === 'dash' && !/\.mpd/i.test(q.url))) return;
                cands.push({ url: asset(q.url), label: q.label || '', hevc: /h265|hevc/i.test(q.url + ' ' + q.label) });
                if (q.fallbackUrl) cands.push({ url: asset(q.fallbackUrl), label: (q.label || '') + ' backup', hevc: false, backup: true });
            });
            if (info.videoUrl) cands.push({ url: asset(info.videoUrl), label: '', hevc: /h265|hevc/i.test(info.videoUrl) });
            if (info.kid) {   // Melolo-style encrypted file (the site decrypts it in the browser) - can't be played
                return cb({ success: false, errorCode: 'ENCRYPTED', message: 'This ' + pname(it.p) + ' episode is encrypted and only plays on the website.' });
            }
            var seen = {};
            cands = cands.filter(function (c) { if (!c.url || seen[c.url]) return false; seen[c.url] = 1; return true; });
            // these apps' CDNs sometimes refuse direct requests; the site plays them through its proxy
            if (PROXIED[it.p]) {
                var best = cands.filter(function (c) { return /^https?:\/\//.test(c.url) && c.url.indexOf(PROXY) !== 0; })
                    .sort(function (a, b) { return qnum(b.label) - qnum(a.label); })[0];
                if (best) cands.push({ url: PROXY + '/api/proxy/' + it.p + '?url=' + encodeURIComponent(best.url), label: (best.label || '') + ' backup', hevc: best.hevc, backup: true });
            }
            // best quality first; at the same quality H.264 before HEVC and the main link before its backup
            cands.sort(function (a, b) { return ((a.backup ? 1 : 0) - (b.backup ? 1 : 0)) || (qnum(b.label) - qnum(a.label)) || ((a.hevc ? 1 : 0) - (b.hevc ? 1 : 0)); });
            var list = cands.map(function (c) {
                var lab = String(c.label).replace(/\s+\d+$/, '').trim();
                return mkStream({
                    url: c.url,
                    source: pname(it.p) + (lab ? ' ' + lab : '') + (c.hevc ? ' HEVC' : ''),
                    headers: PLAY_HEADERS,
                    subtitles: subs
                });
            });
            var verified = await verifyStreams(list, 3);
            if (!verified.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS', message: 'The video server for this ' + pname(it.p) + ' episode is offline right now - try again later.' });
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
            // links come fresh from the site API: a failed DNS lookup is the local resolver (some
            // networks can't resolve a CDN, e.g. HappyShort's), not a dead link -> keep, unverified
            return "unknown";
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
