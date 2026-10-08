(function (__ngRawGet, __ngRawPost) {

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

    // =========================================================================
    //  Hindi Dubbed (YouTube official channels) — SkyStream provider  v1
    //
    //  Hollywood Hindi dubbed, South Indian Hindi dubbed, Bollywood and Hindi
    //  cartoon/anime — all from OFFICIAL YouTube channels (Goldmines, Aditya,
    //  Bhavani, Volga, DRJ, Shemaroo, Ultra, Pen, Rajshri, B4U, Pokémon Hindi,
    //  Discovery Kids). Fully on-device: InnerTube JSON API, no server, no
    //  ffmpeg, no yt-dlp.
    //
    //  v1:
    //    * Full movies appear as single movie items (auto-detected).
    //    * Web series are grouped into SERIES (one poster, every episode,
    //      auto-updating via live re-fetch).
    //    * 20 official channels.
    //    * Streams: YouTube's own merged HLS (up to 1080p) when YouTube offers
    //      it for the video, otherwise the progressive MP4 (360p, or 720p when
    //      offered); Invidious only as a last resort.
    // =========================================================================

    const KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
    const INNERTUBE = "https://www.youtube.com/youtubei/v1/";

    const WEB_CTX = { client: { clientName: "WEB", clientVersion: "2.20260811.07.00", hl: "en", gl: "US" } };
    const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

    const AND_UA = "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip";
    const AND_CTX = { client: { clientName: "ANDROID", clientVersion: "21.02.35", androidSdkVersion: 30, userAgent: AND_UA, osName: "Android", osVersion: "11", hl: "en", gl: "US" } };

    const IOS_UA = "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";
    const IOS_CTX = { client: { clientName: "IOS", clientVersion: "21.02.3", deviceMake: "Apple", deviceModel: "iPhone16,2", userAgent: IOS_UA, osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US" } };

    const VR_UA = "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
    const VR_CTX = { client: { clientName: "ANDROID_VR", clientVersion: "1.62.27", deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32, userAgent: VR_UA, osName: "Android", osVersion: "12L", hl: "en", gl: "US" } };

    // Safari UA on the WEB client -> pre-merged video+audio HLS (up to 1080p).
    const SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15";
    const SAFARI_CTX = { client: { clientName: "WEB", clientVersion: "2.20260811.07.00", userAgent: SAFARI_UA + ",gzip(gfe)", hl: "en", gl: "US" } };

    // TV + mobile-web contexts — some return a merged HLS where WEB is gated.
    const TV_SIMPLE_CTX = { client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", hl: "en", gl: "US" } };
    const MWEB_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const MWEB_CTX = { client: { clientName: "MWEB", clientVersion: "2.20240726.01.00", hl: "en", gl: "US" } };

    const CHANNELS = [
        // Hollywood Hindi dubbed + South dubbed (Goldmines network)
        { id: "UCyoXW-Dse7fURq30EWl_CUA", name: "Goldmines" },
        { id: "UCs570zdFq_NNA5OcV8chnHw", name: "Goldmines Movies" },
        { id: "UCOF23vGxkbhN4wl7ROrgXsA", name: "Goldmines Bollywood" },
        { id: "UCu7Hg0f3rxqZ6qs-188ZbjQ", name: "Goldmines Dishoom" },
        { id: "UCY7tB-mpvlQeWgaCCS1Cmwg", name: "Goldmines Action" },
        { id: "UC_cirOvovTcibMbIU5HDkLQ", name: "Goldmines Action Heroes" },
        // South Indian Hindi dubbed (Telugu/Tamil networks)
        { id: "UCX_uPA_dGf7wXjuMEaSKLJA", name: "Aditya Movies" },
        { id: "UCWuPy5C32Az6-cvTBXURYew", name: "Bhavani Movies" },
        { id: "UCIeNlITYK46VkR7yIuTL8GQ", name: "Volga Video" },
        { id: "UCBhStnvUsWCMvAUj7UGj0Wg", name: "DRJ Records Movies" },
        // Bollywood / Hindi movies
        { id: "UCF1JIbMUs6uqoZEY1Haw0GQ", name: "Shemaroo" },
        { id: "UCBOmfqgTZi7yDp4-3Lr_3lA", name: "Shemaroo Movies" },
        { id: "UCmL1WlDI8UkXDXCXcBQN9CA", name: "Ultra Bollywood" },
        { id: "UCYauDsl-rswjQGpA0_-Z9Pw", name: "Ultra Movie Parlour" },
        { id: "UC3ar28GS6o1p0m_wabfk2zw", name: "Pen Movies" },
        { id: "UCTIxI7HjvTzPrVrb7aS0tQQ", name: "PenFlix" },
        { id: "UCEKWXRsfUHkan-D_ljU8Asw", name: "Rajshri" },
        { id: "UCAB29sl-DN4Gq3GL1Cj_OlQ", name: "B4U Movies" },
        // Hindi cartoon / anime (official)
        { id: "UCm1hOHNgH6x8MF22676CmZA", name: "Pokémon Hindi" },
        { id: "UCkg1kqsM6i3QSpUP1JavZew", name: "Discovery Kids India" }
    ];

    const VIDEOS_TAB = "EgZ2aWRlb3M%3D";
    const SPECIALS = "\u0000specials\u0000";

    // ------------------------------------------------------------------
    //  HTTP helpers
    // ------------------------------------------------------------------
    function respBody(res) {
        if (res && typeof res === "object" && res.body != null) return String(res.body);
        if (typeof res === "string") return res;
        return "";
    }

    async function httpPostJson(url, headers, body) {
        if (typeof http_post === "function") {
            const res = await http_post(url, headers, body);
            return respBody(res);
        }
        if (typeof fetch === "function") {
            const r = await fetch(url, { method: "POST", headers: headers, body: body, redirect: "follow" });
            if (r && typeof r.text === "function") return await r.text();
        }
        throw new Error("no HTTP bridge");
    }

    async function innertube(endpoint, body, ua) {
        const text = await httpPostJson(
            INNERTUBE + endpoint + "?key=" + KEY + "&prettyPrint=false",
            { "Content-Type": "application/json", "User-Agent": ua, "Accept": "*/*" },
            JSON.stringify(body)
        );
        if (!text) throw new Error("empty innertube response");
        return JSON.parse(text);
    }

    async function httpGetText(url, headers) {
        headers = headers || {};
        if (typeof http_get === "function") {
            try {
                const res = await http_get(url, headers);
                if (res && typeof res === "object" && res.body != null) return String(res.body);
                if (typeof res === "string") return res;
                return "";
            } catch (e) { /* fall through */ }
        }
        if (typeof fetch === "function") {
            const r = await fetch(url, { headers: headers, redirect: "follow" });
            if (r && typeof r.text === "function") return await r.text();
        }
        return "";
    }

    async function httpJson(url) {
        const text = await httpGetText(url);
        if (!text) throw new Error("empty response");
        return JSON.parse(text);
    }

    // ------------------------------------------------------------------
    //  Parsing
    // ------------------------------------------------------------------
    function rendererTitle(v) {
        try {
            const t = v && v.title;
            if (!t) return "";
            if (typeof t.simpleText === "string") return t.simpleText;
            if (Array.isArray(t.runs)) { let s = ""; for (const r of t.runs) if (r && r.text) s += r.text; return s; }
        } catch (e) { /* ignore */ }
        return "";
    }

    function rendererDur(v) {
        try { const l = v && v.lengthText; if (l && typeof l.simpleText === "string") return l.simpleText; } catch (e) {}
        return "";
    }

    function lockupTitle(lv) {
        try { const m = lv.metadata && lv.metadata.lockupMetadataViewModel; if (m && m.title && typeof m.title.content === "string") return m.title.content; } catch (e) {}
        return "";
    }

    function lockupDur(lv) {
        try {
            const ov = lv.contentImage && lv.contentImage.thumbnailViewModel && lv.contentImage.thumbnailViewModel.overlays;
            if (Array.isArray(ov)) {
                for (const o of ov) {
                    const b = o.thumbnailBottomOverlayViewModel;
                    if (b && Array.isArray(b.badges)) {
                        for (const x of b.badges) {
                            if (x.thumbnailBadgeViewModel && typeof x.thumbnailBadgeViewModel.text === "string") {
                                return x.thumbnailBadgeViewModel.text;
                            }
                        }
                    }
                }
            }
        } catch (e) {}
        return "";
    }

    function normKey(s) {
        return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    // "Zanjeerain Episode 01 [Eng Sub] ..." -> {name:"Zanjeerain", ep:1}
    // Skips teasers/promos/OSTs/recaps/trailers.
    function parseTitle(title) {
        const t = String(title || "");
        if (/\b(teaser|promo|ost|recap|trailer|title\s*song|full\s*ost)\b/i.test(t)) return null;
        // "Zanjeerain Episode 01 [Eng Sub] ..." -> {name:"Zanjeerain", ep:1}
        let m = t.match(/^(.+?)\s*[-–—|]?\s*Episode\s*(\d{1,3})\b/i);
        if (!m) {
            // "Asur S01E04 Hindi ..." / "Asur S1 E4 ..."
            m = t.match(/^(.+?)\s*[-–—|]?\s*S(\d{1,2})\s*E(\d{1,3})\b/i);
            if (m) {
                const ep = parseInt(m[3], 10);
                const name = m[1].replace(/\[.*?\]/g, "").replace(/[-–—|:]\s*$/, "").replace(/\s+/g, " ").trim();
                if (isNaN(ep) || name.length < 2) return null;
                return { name: name, ep: ep, norm: normKey(name) };
            }
            return null;
        }
        const ep = parseInt(m[2], 10);
        if (isNaN(ep)) return null;
        let name = m[1]
            .replace(/\[.*?\]/g, "")
            .replace(/[-–—|:]\s*$/, "")
            .replace(/\s+/g, " ")
            .trim();
        if (name.length < 3) return null;
        return { name: name, ep: ep, norm: normKey(name) };
    }

    // Classify a full-length movie title and return a clean name + year.
    // Skips non-movie uploads (trailers/songs/clips/highlights).
    function parseMovie(title) {
        const t = String(title || "");
        if (/\b(trailer|teaser|promo|ost|lyrical|video\s*song|title\s*song|full\s*ost|scene|clip|sneak\s*peek|review|update|announcement|coming\s*soon|new\s*season|highlights?|best\s*of|recap)\b/i.test(t)) return null;
        const ym = t.match(/\b((?:19|20)\d{2})\b/);
        const year = ym ? parseInt(ym[1], 10) : null;
        let name = t;
        name = name.replace(/\[[^\]]*\]/g, " ");   // [Hindi] [HD] [Full Movie]
        name = name.replace(/\([^)]*\)/g, " ");   // (2022) (Official)
        name = name.split("|")[0];
        name = name
            .replace(/\b(480p|720p|1080p|2160p|4k|uhd|hdr|dolby|web-?dl|webrip|hdtv|hdtc|hdrip|bdrip|blu-?ray|dvdrip|camrip|prehd|hq|full\s*hd|hevc|x264|x265|10bit|dd5\.1|dd\+)\b/gi, " ")
            .replace(/\b(south\s*hindi|hindi\s*-?\s*english|hindi\s*-?\s*tamil|hindi\s*-?\s*telugu|hindi\s*-?\s*malayalam|hindi\s*-?\s*kannada|new\s*released|new\s*release|new\s*movie|dual\s*audio|multi\s*audio|full\s*movie|full\s*hindi|hindi\s*dubbed|hindi\s*movie|hindi\s*audio|movie\s*in\s*hindi|in\s*hindi|hindi|dubbed|english|tamil|telugu|malayalam|kannada|marathi|punjabi|bengali|gujarati|south)\b/gi, " ");
        name = name.replace(/\s*(?:19|20)\d{2}\s*/g, " "); // drop bare years
        name = name.split("–")[0].split(" - ")[0];
        name = name.replace(/\s+/g, " ").replace(/^[-–—:,.]+|[-–—:,.]+$/g, "").trim();
        if (name.length < 2) return null;
        return { name: name, year: year };
    }

    // classify(videoTitle) -> {kind:"episode"|"movie"|"skip", ...}
    function classify(title) {
        const p = parseTitle(title);
        if (p) return { kind: "episode", data: p };
        const m = parseMovie(title);
        if (m) return { kind: "movie", data: m };
        return { kind: "skip" };
    }

    // Walk a response: collect videos + a continuation token (if any).
    function walkResponse(obj, out, seen, next) {
        if (obj == null || typeof obj !== "object") return;
        if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) walkResponse(obj[i], out, seen, next); return; }
        const keys = Object.keys(obj);

        if (keys.indexOf("lockupViewModel") !== -1) {
            const lv = obj.lockupViewModel;
            if (lv && lv.contentId && lv.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && !seen[lv.contentId]) {
                seen[lv.contentId] = 1;
                out.push({ id: lv.contentId, title: lockupTitle(lv), dur: lockupDur(lv) });
            }
        }
        if (keys.indexOf("videoRenderer") !== -1) {
            const v = obj.videoRenderer;
            if (v && v.videoId && !seen[v.videoId]) {
                seen[v.videoId] = 1;
                out.push({ id: v.videoId, title: rendererTitle(v), dur: rendererDur(v) });
            }
        }
        if (keys.indexOf("videoCardRenderer") !== -1) {
            const v = obj.videoCardRenderer;
            if (v && v.videoId && !seen[v.videoId]) {
                seen[v.videoId] = 1;
                out.push({ id: v.videoId, title: rendererTitle(v), dur: rendererDur(v) });
            }
        }
        if (keys.indexOf("continuationCommand") !== -1 && obj.continuationCommand && obj.continuationCommand.token && !next.t) {
            next.t = obj.continuationCommand.token;
        }
        for (let i = 0; i < keys.length; i++) walkResponse(obj[keys[i]], out, seen, next);
    }

    async function fetchChannelVideos(channelId, pages) {
        const out = [];
        const seen = {};
        let token = null;
        for (let p = 0; p < pages; p++) {
            let j;
            if (token) {
                j = await innertube("browse", { context: WEB_CTX, continuation: token }, WEB_UA);
            } else {
                j = await innertube("browse", { context: WEB_CTX, browseId: channelId, params: VIDEOS_TAB }, WEB_UA);
            }
            const next = { t: null };
            walkResponse(j, out, seen, next);
            if (!next.t) break;
            token = next.t;
        }
        return out;
    }

    function thumb(id) { return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"; }

    // ------------------------------------------------------------------
    //  Item building — full movies become single items, "Episode N" /
    //  "SxxExx" uploads are grouped into series.
    // ------------------------------------------------------------------
    function buildItems(channel, videos) {
        const groups = {};   // norm -> {name, eps:[]}
        const order = [];
        const movies = [];
        const seenMovie = {};
        for (let i = 0; i < videos.length; i++) {
            const v = videos[i];
            const c = classify(v.title);
            if (c.kind === "episode") {
                const p = c.data;
                if (!groups[p.norm]) { groups[p.norm] = { name: p.name, norm: p.norm, eps: [] }; order.push(p.norm); }
                groups[p.norm].eps.push({ ep: p.ep, id: v.id, title: v.title, dur: v.dur });
            } else if (c.kind === "movie") {
                const m = c.data;
                // Drop short clips/promos that slipped past the title filter.
                const dm = /^(\d{1,3}):(\d{2})$/.exec(String(v.dur || ""));
                if (dm) {
                    const secs = parseInt(dm[1], 10) * 60 + parseInt(dm[2], 10);
                    if (secs < 180) continue;
                }
                const k = normKey(m.name);
                if (seenMovie[k]) continue;       // de-dup re-uploads
                seenMovie[k] = 1;
                movies.push({ name: m.name, year: m.year, id: v.id, title: v.title, dur: v.dur });
            }
        }
        const items = [];
        // Movies first (most of these channels are movie channels).
        for (let i = 0; i < movies.length; i++) {
            const m = movies[i];
            const desc = (m.year ? (m.year + " · ") : "") + "Hindi dubbed movie";
            items.push(new MultimediaItem({
                url: JSON.stringify({ v: m.id, t: m.name, y: m.year }),
                title: m.name,
                posterUrl: thumb(m.id),
                bannerUrl: "https://i.ytimg.com/vi/" + m.id + "/maxresdefault.jpg",
                type: "movie",
                status: "completed",
                year: m.year || undefined,
                description: desc
            }));
        }
        // Then series.
        for (let i = 0; i < order.length; i++) {
            const g = groups[order[i]];
            g.eps.sort(function (a, b) { return a.ep - b.ep; });
            const seenEp = {};
            const eps = [];
            for (let e = 0; e < g.eps.length; e++) {
                const x = g.eps[e];
                if (seenEp[x.ep]) continue;
                seenEp[x.ep] = 1;
                eps.push(x);
            }
            let posterEp = eps[0];
            for (let e = 0; e < eps.length; e++) { if (eps[e].ep === 1) { posterEp = eps[e]; break; } }
            items.push(new MultimediaItem({
                url: JSON.stringify({ ch: channel.id, d: g.name, n: g.norm }),
                title: g.name,
                posterUrl: thumb(posterEp.id),
                type: "series",
                status: "ongoing",
                description: eps.length + " episodes"
            }));
        }
        return items;
    }

    function seriesEpisodes(videos, norm) {
        const eps = [];
        for (let i = 0; i < videos.length; i++) {
            const v = videos[i];
            const p = parseTitle(v.title);
            if (p && p.norm === norm) eps.push({ ep: p.ep, id: v.id, title: v.title, dur: v.dur });
        }
        eps.sort(function (a, b) { return a.ep - b.ep; });
        const seen = {};
        const out = [];
        for (let i = 0; i < eps.length; i++) {
            if (seen[eps[i].ep]) continue;
            seen[eps[i].ep] = 1;
            out.push(eps[i]);
        }
        return out;
    }

    // ------------------------------------------------------------------
    //  1. getHome — series per channel (episodes grouped, one poster)
    // ------------------------------------------------------------------
    function sleep(ms) {
        return new Promise(function (resolve) {
            if (typeof setTimeout === "function") setTimeout(resolve, ms);
            else resolve();
        });
    }

    // Run items through fn with limited concurrency (avoids YouTube rate-limits
    // that were causing transient "no stream" errors after a full parallel burst).
    async function mapLimit(arr, limit, fn) {
        const results = new Array(arr.length);
        let idx = 0;
        async function worker() {
            while (idx < arr.length) {
                const i = idx++;
                try { results[i] = await fn(arr[i], i); } catch (e) { results[i] = null; }
            }
        }
        const workers = [];
        for (let w = 0; w < Math.min(limit, arr.length); w++) workers.push(worker());
        await Promise.all(workers);
        return results;
    }

    async function getHome(cb) {
        const home = {};
        try {
            const rows = await mapLimit(CHANNELS, 4, function (ch) {
                return fetchChannelVideos(ch.id, 2).then(function (vids) {
                    return { name: ch.name, items: buildItems(ch, vids) };
                }).catch(function () {
                    return { name: ch.name, items: [] };
                });
            });
            for (let i = 0; i < rows.length; i++) {
                if (rows[i] && rows[i].items && rows[i].items.length) home[rows[i].name] = rows[i].items;
            }
        } catch (e) { /* leave home empty */ }
        // An empty map renders as a blank dashboard with no explanation, so
        // report the failure instead of pretending there is content.
        if (!Object.keys(home).length) {
            return cb({
                success: false,
                errorCode: "SITE_OFFLINE",
                message: "YouTube returned no videos for any of the 20 channels - check your connection and try again."
            });
        }
        cb({ success: true, data: home });
    }

    // ------------------------------------------------------------------
    //  2. search — flat videos
    // ------------------------------------------------------------------
    function durSecs(d) {
        const parts = String(d || "").split(":").map(function (x) { return parseInt(x, 10); });
        if (!parts.length || parts.some(isNaN)) return 0;
        return parts.reduce(function (acc, x) { return acc * 60 + x; }, 0);
    }

    async function search(query, cb) {
        if (!query) return cb({ success: true, data: [] });
        try {
            const q = String(query).trim();
            // Bias YouTube towards full Hindi-dubbed uploads unless the user already did.
            const yq = /movie|film|hindi|dubbed/i.test(q) ? q : q + " hindi dubbed full movie";
            const j = await innertube("search", { context: WEB_CTX, query: yq }, WEB_UA);
            const vids = [];
            walkResponse(j, vids, {}, { t: null });
            const full = [], rest = [], seen = {};
            for (let i = 0; i < vids.length; i++) {
                const v = vids[i];
                if (!v || !v.id || seen[v.id]) continue;
                seen[v.id] = 1;
                const title = (v.title || "").trim();
                const secs = durSecs(v.dur);
                if (secs && secs < 180) continue;                 // shorts, clips, songs
                const m = parseMovie(title);
                const item = new MultimediaItem({
                    url: JSON.stringify({ v: v.id, t: m ? m.name : title, y: m && m.year ? m.year : undefined }),
                    title: m ? m.name : title,
                    posterUrl: thumb(v.id),
                    bannerUrl: "https://i.ytimg.com/vi/" + v.id + "/maxresdefault.jpg",
                    type: "movie",
                    status: "completed",
                    year: (m && m.year) || undefined,
                    description: (m && m.year ? m.year + " · " : "") + (v.dur ? "Duration " + v.dur + " · " : "") + title
                });
                if (m && secs >= 40 * 60) full.push(item); else rest.push(item);
            }
            cb({ success: true, data: (full.length ? full : rest).slice(0, 40) });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: "Search failed: " + (e && e.message ? e.message : e) });
        }
    }

    // ------------------------------------------------------------------
    //  3. load — series -> episodes; single video -> one episode
    // ------------------------------------------------------------------
    async function load(url, cb) {
        let m;
        try { m = JSON.parse(String(url || "")); } catch (e) {
            return cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid URL" });
        }

        try {
            if (m.v) {
                // single movie video (from home/search)
                const title = m.t || ("Video " + m.v);
                const item = new MultimediaItem({
                    url: url, title: title, posterUrl: thumb(m.v),
                    bannerUrl: "https://i.ytimg.com/vi/" + m.v + "/maxresdefault.jpg",
                    type: "movie", status: "completed",
                    year: m.y || undefined,
                    description: (m.y ? (m.y + " · ") : "") + "Hindi dubbed movie"
                });
                item.episodes = [new Episode({ name: "Full Movie", url: url, season: 1, episode: 1, posterUrl: thumb(m.v) })];
                return cb({ success: true, data: item });
            }

            if (m.ch) {
                // series (drama) — re-fetch channel live so new episodes appear
                const vids = await fetchChannelVideos(m.ch, 3);
                const episodes = [];
                if (m.d === SPECIALS) {
                    for (let i = 0; i < vids.length; i++) {
                        const v = vids[i];
                        if (parseTitle(v.title)) continue;
                        episodes.push(new Episode({
                            name: (v.title || ("Video " + v.id)).slice(0, 80),
                            url: JSON.stringify({ v: v.id, t: v.title }),
                            season: 1, episode: i + 1, posterUrl: thumb(v.id)
                        }));
                    }
                } else {
                    const eps = seriesEpisodes(vids, m.n);
                    for (let i = 0; i < eps.length; i++) {
                        const e = eps[i];
                        const epTitle = "Episode " + e.ep;
                        episodes.push(new Episode({
                            name: epTitle,
                            url: JSON.stringify({ v: e.id, t: e.title }),
                            season: 1, episode: e.ep, posterUrl: thumb(e.id)
                        }));
                    }
                }
                if (!episodes.length) {
                    return cb({ success: false, errorCode: "NOT_FOUND", message: "No episodes found for this drama." });
                }
                const item = new MultimediaItem({
                    url: url, title: m.d === SPECIALS ? "Promos, OSTs & Specials" : m.d,
                    posterUrl: episodes[0].posterUrl || "",
                    type: "series", status: "ongoing"
                });
                item.episodes = episodes;
                return cb({ success: true, data: item });
            }

            return cb({ success: false, errorCode: "NOT_FOUND", message: "Unsupported item" });
        } catch (e) {
            return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Load failed: " + (e && e.message ? e.message : e) });
        }
    }

    // ------------------------------------------------------------------
    //  4. loadStreams — merged HLS (when offered) -> progressive MP4 -> Invidious
    // ------------------------------------------------------------------
    function playable(ps) {
        if (ps && ps.status === "LOGIN_REQUIRED" && /not a bot/i.test(String(ps.reason || ""))) botGate = Date.now();
        return ps && (ps.status === "OK" || ps.status === "CONTENT_CHECK_REQUIRED");
    }
    // YouTube's anti-bot gate ("Sign in to confirm you're not a bot") hits shared / VPN / data-center
    // addresses, not the video itself; remembered so the error can say so.
    let botGate = 0;

    // Fetch the player response, retrying on transient ERROR/UNPLAYABLE (which
    // YouTube returns when a burst of requests just hit the same IP/key).
    // Returns null on failure, or the response on success.
    async function fetchPlayer(ctx, ua, videoId) {
        for (let attempt = 0; attempt < 3; attempt++) {
            const r = await innertube("player", { context: ctx, videoId: videoId }, ua);
            const ps = r && r.playabilityStatus;
            if (playable(ps)) return r;
            if (ps && ps.status === "LOGIN_REQUIRED") return null;
            if (attempt < 2) await sleep(700 * (attempt + 1));
        }
        return null;
    }

    // Try to get YouTube's own pre-merged HLS manifest (single m3u8 with
    // video+audio muxed, up to 1080p). YouTube only returns it to the WEB
    // client on non-flagged IPs — residential/mobile IPs usually get it,
    // datacenter IPs get PO-token-gated instead. Returns a list of
    // { url, height }.
    async function tryMergedHls(videoId) {
        const tries = [
            { ctx: IOS_CTX, ua: IOS_UA },
            { ctx: SAFARI_CTX, ua: SAFARI_UA },
            { ctx: WEB_CTX, ua: WEB_UA },
            { ctx: TV_SIMPLE_CTX, ua: WEB_UA },
            { ctx: MWEB_CTX, ua: MWEB_UA }
        ];
        // One attempt each, all in parallel — a gated client returns quickly
        // and we don't want retry delays on the HD path.
        const rs = await Promise.all(tries.map(function (t) {
            return innertube("player", { context: t.ctx, videoId: videoId }, t.ua)
                .then(function (r) { return r; })
                .catch(function () { return null; });
        }));
        const out = [];
        const seen = {};
        for (let i = 0; i < rs.length; i++) {
            const r = rs[i];
            if (!r || !r.streamingData) continue;
            const ps = r.playabilityStatus;
            if (!playable(ps)) continue;
            const sd = r.streamingData;
            if (sd.hlsManifestUrl && !seen[sd.hlsManifestUrl]) {
                seen[sd.hlsManifestUrl] = 1;
                out.push({ url: sd.hlsManifestUrl, height: 1080 });
            }
            const fmts = sd.formats || [];
            for (let k = 0; k < fmts.length; k++) {
                const f = fmts[k];
                if (!f || !f.url) continue;
                const mt = String(f.mimeType || "");
                if (mt.indexOf("mpegURL") !== -1 || f.url.indexOf("m3u8") !== -1) {
                    if (seen[f.url]) continue;
                    seen[f.url] = 1;
                    out.push({ url: f.url, height: f.height || 1080 });
                }
            }
        }
        return out;
    }

    // ------------------------------------------------------------------
    //  4c. Invidious fallback — the open Invidious API (same approach the
    //      CloudStream "Invidious" extension uses). Some instances still
    //      serve itag 22 (720p progressive) which YouTube's own clients no
    //      longer return. Pure fallback behind the primary methods.
    // ------------------------------------------------------------------
    const INVIDIOUS_INSTANCES = [
        "https://invidious.f5.si",
        "https://invidious.materialio.us",
        "https://inv.nadeko.net",
        "https://yewtu.be"
    ];

    async function invidiousStreams(videoId) {
        const rs = await Promise.all(INVIDIOUS_INSTANCES.map(function (base) {
            return Promise.race([
                httpGetText(base + "/api/v1/videos/" + videoId + "?fields=formatStreams&local=true", { "Accept": "application/json" }),
                sleep(7000).then(function () { return ""; })
            ]).then(function (t) { return { base: base, text: t }; }, function () { return { base: base, text: "" }; });
        }));
        const out = [];
        for (let i = 0; i < rs.length && out.length < 3; i++) {
            let j = null;
            try { j = JSON.parse(rs[i].text || "null"); } catch (e) { continue; }
            const fs = (j && j.formatStreams) || [];
            for (let k = 0; k < fs.length; k++) {
                const f = fs[k];
                if (!f || !f.url) continue;
                let u = String(f.url);
                if (u.charAt(0) === "/") u = rs[i].base + u;   // relative -> instance-proxied
                if (f.itag === 22 || String(f.itag) === "22") out.push({ url: u, label: "720p (Invidious)", rank: 12 });
                else if (f.itag === 18 || String(f.itag) === "18") out.push({ url: u, label: "360p (Invidious)", rank: 31 });
            }
        }
        return out;
    }

    async function loadStreams(url, cb) {
        const t0 = Date.now();
        let m;
        try { m = JSON.parse(String(url || "")); } catch (e) {
            return cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid URL" });
        }
        const results = [];
        const errors = [];
        const seen = {};

        function add(u, label, rank, headers) {
            if (!u) return;
            if (!/^(https?:|magic_m3u8:|MAGIC_PROXY)/.test(u)) return;
            if (seen[u]) return;
            seen[u] = 1;
            results.push({ url: u, label: label, rank: rank, headers: headers || null });
        }

        // (1) YouTube's own merged HLS (single m3u8, video+audio muxed, small
        //     6s segments, up to 1080p). This is what the official players use
        //     and it sidesteps every range-size/line-length limit. YouTube
        //     returns it to the WEB/TV clients on residential/mobile IPs.
        //     Routed through the app's local proxy so the manifest + segments
        //     are fetched with a matching browser User-Agent / Referer.
        try {
            const mh = await tryMergedHls(m.v);
            for (let i = 0; i < mh.length; i++) {
                const h = mh[i].height ? (mh[i].height + "p") : "HD";
                let u = mh[i].url;
                if (typeof btoa === "function") {
                    u = "MAGIC_PROXY_v1" + btoa(u);
                }
                const hdrs = {
                    "User-Agent": SAFARI_UA,
                    "Referer": "https://www.youtube.com/"
                };
                add(u, h + " (YouTube)", 1 + i, hdrs);
            }
            if (!mh.length) errors.push("merged-hls:none");
        } catch (e) { errors.push("merged-hls:" + (e && e.message ? e.message : e)); }

        // (2) Progressive MP4 (video+audio in one file; itag 18 = 360p, 22 = 720p
        //     when offered). ANDROID first, ANDROID_VR as a second opinion.
        //     NOTE: YouTube's separate HD video/audio tracks only accept byte
        //     ranges of ~10 MB, so they can't be handed to the player as one
        //     range (that was the old "fMP4" option, which always got HTTP 403).
        try {
            let got = false;
            const clients = [{ ctx: AND_CTX, ua: AND_UA }, { ctx: VR_CTX, ua: VR_UA }];
            for (let c = 0; c < clients.length && !got; c++) {
                const r = await fetchPlayer(clients[c].ctx, clients[c].ua, m.v);
                const fmts = (r && r.streamingData && r.streamingData.formats) || [];
                for (let i = 0; i < fmts.length; i++) {
                    const f = fmts[i];
                    if (!f || !f.url) continue;
                    if (f.itag === 22) { add(f.url, "720p (MP4)", 10); got = true; }
                    if (f.itag === 18) { add(f.url, "360p (MP4)", 30); got = true; }
                }
            }
            if (!got) errors.push("mp4:no-stream");
        } catch (e) { errors.push("mp4:" + (e && e.message ? e.message : e)); }

        // (3) Invidious — only when YouTube itself gave us nothing playable
        if (!results.length) {
            try {
                const inv = await invidiousStreams(m.v);
                for (let i = 0; i < inv.length; i++) add(inv[i].url, inv[i].label, inv[i].rank);
                if (!inv.length) errors.push("invidious:no-stream");
            } catch (e) { errors.push("invidious:" + (e && e.message ? e.message : e)); }
        }

        if (!results.length) {
            if (botGate >= t0) {
                return cb({
                    success: false,
                    errorCode: "YOUTUBE_BOT_CHECK",
                    message: "YouTube is asking this connection to confirm it is not a bot, so it won't hand out the video. " +
                        "This happens on VPNs and shared or busy networks. Turn the VPN off (or switch to mobile data / Wi-Fi) and try again in a few minutes."
                });
            }
            return cb({
                success: false,
                errorCode: "NO_STREAM",
                message: "Could not resolve a playable stream" + (errors.length ? " (" + errors.join("; ") + ")" : "") +
                    ". Age-restricted, private or region-locked videos can't be played — try another episode."
            });
        }

        results.sort(function (a, b) { return a.rank - b.rank; });
        const out = [];
        for (let i = 0; i < results.length; i++) {
            out.push(new StreamResult({
                url: results[i].url,
                source: results[i].label,
                headers: results[i].headers || undefined
            }));
        }
        cb({ success: true, data: out });
    }

    // ------------------------------------------------------------------
    //  Export
    // ------------------------------------------------------------------
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
    __ngWrapExports();
})(typeof http_get !== 'undefined' ? http_get : undefined, typeof http_post !== 'undefined' ? http_post : undefined);
