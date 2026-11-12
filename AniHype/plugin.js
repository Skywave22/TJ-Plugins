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


    // AniHype (anihype.sbs) - a PHP anime site on top of AniList.
    //   catalog : the site's own pages - index.php (home rows), browse.php (?search= / ?genre= / ?sort= /
    //             ?format= / ?status= / ?page=), detail.php?id=<anilist> (title, synopsis, "total" episodes,
    //             recommendations). Episode titles + thumbnails come from ani.zip (keyed by AniList id).
    //   streams : watch.php lists six embed servers; each one is resolved to a direct link here:
    //     TryEmbed  - /embed/anime/<id>/<ep>/<sub|dub>: BOOTSTRAP_TICKET -> POST /api/bootstrap (needs
    //                 Chrome client-hint headers) -> cookies + "astra" token -> /s/<token>.m3u8 redirects to a
    //                 signed HLS master (1080p, English VTT) that plays without headers.
    //     Katana    - Bingr / Filmu (Vidly) watch page: the first server ("Katana Sub") is inside the page as
    //                 a "v1." payload (same cipher as the Bingr plugin). 1080p H.264 HLS + VTT.
    //     Uqload    - AnimeTV+ embed: #state-data JSON -> uqload embed -> p,a,c,k,e,d packed player -> HLS
    //                 master (Japanese + English audio, up to 720p) + VTT.
    //     Orion     - Vidrift embed: embedMeta.orionStreams = one HLS per language (Original, English,
    //                 Hindi, Tamil, Telugu, Malayalam, Kannada, French). HEVC; playlists need the Vidrift Referer.
    //     Mikaza    - Hindi dub: embed page "resolve" URL -> JSON -> direct MP4.

    const BASE = "https://anihype.sbs";
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    const CH = {
        "sec-ch-ua": "\"Chromium\";v=\"130\", \"Google Chrome\";v=\"130\", \"Not?A_Brand\";v=\"99\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "Accept-Language": "en-US,en;q=0.9"
    };
    const TRYEMBED = "https://tryembed.us.cc";
    const VIDRIFT = "https://embed.vidrift.net";
    const ANIMETV = "https://embed.animetvplus.site";
    const MIKAZA = "https://mikaza.buzz";
    const KATANA_PAGES = ["https://bingr.one/watch/anime/{id}/{ep}", "https://embed.filmu.in/anime/{id}/{ep}/1"];

    // ─────────────────────────── helpers ───────────────────────────

    function mkItem(obj)    { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj)  { try { return new StreamResult(obj); } catch (_) { return obj; } }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            const t = setTimeout(function () { reject(new Error("timed out")); }, ms);
            Promise.resolve(promise).then(
                function (v) { clearTimeout(t); resolve(v); },
                function (e) { clearTimeout(t); reject(e); }
            );
        });
    }
    function st(r) { return Number((r && (r.status || r.statusCode || r.code)) || 0); }
    async function get(url, headers, ms) {
        const r = await withTimeout(http_get(url, Object.assign({ "User-Agent": UA }, headers || {})), ms || 15000);
        return r || { status: 0, body: "" };
    }
    async function page(path) {
        const r = await get(/^https?:/.test(path) ? path : BASE + "/" + path.replace(/^\//, ""), { "Accept": "text/html,*/*", "Referer": BASE + "/" });
        if (st(r) >= 400 || st(r) === 0) throw new Error("AniHype answered " + (st(r) || "nothing") + " for " + path);
        return String(r.body || "");
    }
    function decode(s) {
        return String(s || "")
            .replace(/&#0*39;|&#x27;|&apos;/gi, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
            .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    }
    function strip(s) { return decode(String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")); }
    function abs(u, base) {
        u = String(u || "").trim();
        if (!u) return "";
        if (/^https?:\/\//i.test(u)) return u;
        if (u.indexOf("//") === 0) return "https:" + u;
        const origin = String(base).replace(/^(https?:\/\/[^\/]+).*$/, "$1");
        if (u.charAt(0) === "/") return origin + u;
        return String(base).replace(/[?#].*$/, "").replace(/[^\/]*$/, "") + u;
    }
    function itemUrl(id) { return BASE + "/detail.php?id=" + id; }
    function idOf(url) {
        const s = String(url || "");
        let m = s.match(/[?&]id=(\d+)/);
        if (m) return m[1];
        try { const j = JSON.parse(s); if (j && j.id) return String(j.id); } catch (_) {}
        m = s.match(/^(\d+)$/);
        return m ? m[1] : null;
    }
    function typeOf(format) {
        format = String(format || "").toUpperCase();
        if (format === "MOVIE") return "movie";
        if (format === "OVA" || format === "ONA" || format === "SPECIAL") return "anime";
        return "anime";
    }

    // poster card used everywhere on the site:
    // <a href="detail.php?id=1735"> <img class="poster" src=".." alt="Title"> <div class="score-badge">★ 8.2</div>
    //   <div class="format-badge">TV</div> ... <div class="card-title" title="..">..</div> <div class="card-meta">500 Episodes</div>
    function cards(html) {
        const out = [], seen = {};
        const re = /<a\b[^>]*href="(?:\.?\/)?detail\.php\?id=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(html))) {
            const id = m[1], inner = m[2];
            if (seen[id]) continue;
            const poster = (inner.match(/<img\b[^>]*src="([^"]+)"/i) || [])[1];
            let title = (inner.match(/class="card-title"[^>]*title="([^"]*)"/i) || [])[1]
                || (inner.match(/class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|h\d|p)>/i) || [])[1]
                || (inner.match(/<img\b[^>]*alt="([^"]*)"/i) || [])[1] || "";
            title = strip(title).replace(/\s+poster$/i, "");
            if (!title || !poster) continue;
            seen[id] = 1;
            const fmt = strip((inner.match(/class="format-badge"[^>]*>([\s\S]*?)<\//i) || [])[1] || "");
            const sc = (inner.match(/★\s*([\d.]+)/) || [])[1];
            const meta = strip((inner.match(/class="card-meta"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "");
            const year = (meta.match(/\b(19|20)\d{2}\b/) || [])[0];
            out.push(mkItem({
                title: title,
                url: itemUrl(id),
                posterUrl: poster,
                type: typeOf(fmt),
                score: sc ? parseFloat(sc) : null,
                year: year ? parseInt(year, 10) : null,
                description: meta || ""
            }));
        }
        return out;
    }

    // ─────────────────────────── catalog ───────────────────────────

    const ROWS = [
        { name: "Trending", path: "browse.php?sort=trending" },
        { name: "Airing now", path: "browse.php?status=RELEASING&sort=popular" },
        { name: "Most popular", path: "browse.php?sort=popular" },
        { name: "Highest rated", path: "browse.php?sort=rating" },
        { name: "Movies", path: "browse.php?format=MOVIE&sort=popular" },
        { name: "Action", path: "browse.php?genre=Action&sort=popular" },
        { name: "Fantasy", path: "browse.php?genre=Fantasy&sort=popular" },
        { name: "Romance", path: "browse.php?genre=Romance&sort=popular" },
        { name: "Comedy", path: "browse.php?genre=Comedy&sort=popular" },
        { name: "Sci-Fi", path: "browse.php?genre=Sci-Fi&sort=popular" }
    ];
    // rows of index.php worth keeping (they are not reachable through browse.php filters)
    const HOME_ROWS = ["Latest releases", "Top rated this year", "Coming soon", "All-time favourites"];

    function homeSections(html) {
        const out = {};
        const parts = String(html).split(/<h2\b[^>]*class="(?:section|schedule)-title"[^>]*>/i);
        for (let i = 1; i < parts.length; i++) {
            const title = strip(parts[i].split(/<\/h2>/i)[0]);
            const body = parts[i].split(/<h2\b/i)[0];
            const name = HOME_ROWS.filter(function (n) { return title.toLowerCase().indexOf(n.toLowerCase()) === 0; })[0];
            if (name) out[name] = cards(body);
        }
        return out;
    }

    async function getHome(cb) {
        try {
            const jobs = [page("index.php").then(homeSections).catch(function () { return {}; })]
                .concat(ROWS.map(function (r) { return page(r.path).then(cards).catch(function () { return []; }); }));
            const res = await Promise.all(jobs);
            const home = res[0], data = {};
            ROWS.forEach(function (r, i) {
                if (i === 2 && home["Latest releases"] && home["Latest releases"].length) data["Latest releases"] = home["Latest releases"];
                if (res[i + 1].length) data[r.name] = res[i + 1];
                if (i === 3) ["Top rated this year", "Coming soon"].forEach(function (n) { if (home[n] && home[n].length) data[n] = home[n]; });
            });
            if (home["All-time favourites"] && home["All-time favourites"].length) data["All-time favourites"] = home["All-time favourites"];
            if (!Object.keys(data).length) return cb({ success: false, errorCode: "SITE_OFFLINE", message: "AniHype returned no titles. The site may be down." });
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    async function search(query, cb) {
        try {
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });
            let list = cards(await page("browse.php?search=" + encodeURIComponent(q)));
            // the site matches whole titles / prefixes only ("demon slayer kimetsu" finds nothing, "demon slayer"
            // does): on no hits, retry with shorter prefixes and put the titles that contain every word first
            const words = q.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, " ").trim().split(" ").filter(Boolean);
            for (let n = words.length - 1; !list.length && n >= 2 && n >= words.length - 3; n--) {
                list = cards(await page("browse.php?search=" + encodeURIComponent(words.slice(0, n).join(" "))).catch(function () { return ""; }));
                if (list.length) {
                    const has = function (it) { const t = " " + String(it.title).toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, " ") + " "; return words.every(function (w) { return t.indexOf(" " + w) >= 0; }); };
                    list = list.filter(has).concat(list.filter(function (it) { return !has(it); }));
                }
            }
            cb({ success: true, data: list });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    async function aniZip(id) {
        try {
            const r = await get("https://api.ani.zip/mappings?anilist_id=" + id, { "Accept": "application/json" }, 8000);
            if (st(r) !== 200) return null;
            return JSON.parse(String(r.body || ""));
        } catch (_) { return null; }
    }

    async function load(url, cb) {
        try {
            const id = idOf(url);
            if (!id) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized AniHype url" });
            const res = await Promise.all([page("detail.php?id=" + id), aniZip(id)]);
            const html = res[0], az = res[1];
            const title = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
            if (!title) return cb({ success: false, errorCode: "NOT_FOUND", message: "AniHype has no page for this title." });
            const poster = (html.match(/<img\b[^>]*class="dt-poster"[^>]*src="([^"]+)"/i) || html.match(/<img\b[^>]*src="([^"]+)"[^>]*class="dt-poster"/i) || [])[1] || "";
            const banner = (html.match(/<img\b[^>]*class="dt-bg"[^>]*src="([^"]+)"/i) || [])[1] || poster;
            const syn = strip((html.match(/<p\b[^>]*class="dt-syn[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "");
            const chipsHtml = (html.match(/class="dt-chips"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "";
            const chips = [];
            chipsHtml.replace(/<(?:span|a)\b[^>]*class="dt-chip([^"]*)"[^>]*>([\s\S]*?)<\/(?:span|a)>/gi, function (_, cls, t) { chips.push({ cls: cls.trim(), text: strip(t) }); return _; });
            const scoreChip = chips.filter(function (c) { return /score/.test(c.cls); })[0];
            const live = chips.some(function (c) { return /live/.test(c.cls) || /airing/i.test(c.text); });
            const yearChip = chips.filter(function (c) { return /^(19|20)\d{2}$/.test(c.text); })[0];
            const formatChip = chips.filter(function (c) { return /^(TV|TV_SHORT|TV Short|MOVIE|Movie|OVA|ONA|SPECIAL|Special|MUSIC|Music)$/.test(c.text); })[0];
            const genres = [];
            chipsHtml.replace(/href="browse\.php\?genre=[^"]*"[^>]*>([^<]+)</gi, function (_, g) { genres.push(strip(g)); return _; });
            const fmt = formatChip ? formatChip.text.toUpperCase().replace(/\s+/g, "_") : "";
            let total = parseInt((html.match(/\btotal\s*=\s*(\d+)/) || [])[1] || "0", 10);
            if (!total) {
                const eps = (html.match(/data-episodes="(\d+)"/) || [])[1];
                total = parseInt(eps || "0", 10);
            }
            if (!total && /watch\.php\?id=\d+&(?:amp;)?ep=1/.test(html)) total = 1;
            const next = strip((html.match(/class="dt-next"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "");

            const recs = [];
            html.replace(/<a\b[^>]*class="dt-rec"[^>]*>[\s\S]*?<\/a>/gi, function (a) {
                const c = cards(a.replace(/<a\b[^>]*class="dt-rec"[^>]*href="([^"]+)"/i, '<a href="$1"').replace(/<a\b([^>]*)class="dt-rec"/i, "<a$1"));
                if (c.length) recs.push(c[0]);
                return a;
            });

            const azEps = (az && az.episodes) || {};
            const type = fmt === "MOVIE" ? "movie" : "anime";
            const episodes = [];
            const n = Math.max(1, Math.min(total || 1, 3000));
            for (let e = 1; e <= n; e++) {
                const x = azEps[String(e)] || null;
                const t = x && x.title ? (x.title.en || x.title["x-jat"] || "") : "";
                episodes.push(mkEpisode({
                    name: type === "movie" && n === 1 ? "Full Movie" : ("Episode " + e + (t ? ": " + t : "")),
                    url: JSON.stringify({ id: parseInt(id, 10), ep: e, title: title }),
                    season: 1,
                    episode: e,
                    posterUrl: (x && x.image) || "",
                    description: (x && (x.overview || x.summary)) || "",
                    rating: x && x.rating ? Math.round(parseFloat(x.rating) * 10) / 10 : null,
                    runtime: x && (x.runtime || x.length) ? parseInt(x.runtime || x.length, 10) : null,
                    airDate: (x && (x.airDate || x.airdate)) || null
                }));
            }
            cb({ success: true, data: mkItem({
                title: title,
                url: itemUrl(id),
                posterUrl: poster,
                bannerUrl: banner,
                type: type,
                year: yearChip ? parseInt(yearChip.text, 10) : null,
                description: syn + (next ? "\n\n" + next.replace(/^[^A-Za-z0-9]+/, "") : ""),
                score: scoreChip ? parseFloat(scoreChip.text.replace(/[^\d.]/g, "")) || null : null,
                status: live ? "ongoing" : "completed",
                tags: genres.slice(0, 6),
                recommendations: recs.slice(0, 20),
                syncData: { anilist: String(id) },
                episodes: episodes
            }) });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── servers ───────────────────────────

    function cookieList(r) {
        const h = (r && r.headers) || {};
        let raw = [];
        Object.keys(h).forEach(function (k) { if (k.toLowerCase() === "set-cookie") raw = raw.concat(h[k]); });
        const out = [];
        raw.forEach(function (line) {
            // a joined header ("a=1; Path=/, b=2; Path=/") is split on commas that start a new cookie
            String(line || "").split(/,(?=\s*[A-Za-z0-9_\-]+=)/).forEach(function (c) {
                const m = c.trim().match(/^([A-Za-z0-9_\-]+)=([^;]*)/);
                if (m && !/^(path|expires|domain|max-age|samesite)$/i.test(m[1])) out.push(m[1] + "=" + m[2]);
            });
        });
        return out;
    }

    // TryEmbed "Astra": sub or dub, 1080p HLS + English VTT
    async function tryEmbed(id, ep, audio) {
        const embed = TRYEMBED + "/embed/anime/" + id + "/" + ep + "/" + audio;
        const r1 = await get(embed, Object.assign({}, CH, {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": BASE + "/", "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "cross-site", "Upgrade-Insecure-Requests": "1"
        }), 12000);
        const ticket = (String(r1.body || "").match(/BOOTSTRAP_TICKET\s*=\s*"([^"]+)"/) || [])[1];
        if (!ticket) return [];
        const pre = cookieList(r1);
        const r2 = await withTimeout(http_post(TRYEMBED + "/api/bootstrap", Object.assign({ "User-Agent": UA }, CH, {
            "X-TryEmbed-Bootstrap": ticket, "Accept": "*/*", "Origin": TRYEMBED, "Referer": embed,
            "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin"
        }, pre.length ? { "Cookie": pre.join("; ") } : {}), ""), 12000);
        if (!r2 || st(r2) !== 200) return [];
        let j; try { j = JSON.parse(String(r2.body || "")); } catch (_) { return []; }
        // later Set-Cookie wins (the bootstrap renews the session cookie set by the embed page)
        const jar = {};
        pre.concat(cookieList(r2)).forEach(function (c) { const i = c.indexOf("="); if (/^tryembed_/.test(c)) jar[c.slice(0, i)] = c; });
        const cookies = Object.keys(jar).map(function (k) { return jar[k]; });
        // the token of "selectedProvider" is refused by /s/ ("Token Validation Failed"); the providers[] ones work
        const provs = [].concat(j.providers || []);
        if (!provs.length && j.selectedProvider) provs.push(j.selectedProvider);
        const prov = provs.filter(function (p) { return p && p.status !== "error" && p.qualities && p.qualities.length; })[0];
        if (!prov) return [];
        const subs = [].concat(prov.captions || [], j.captions || []).filter(function (c) { return c && c.url; }).map(function (c) {
            return { url: c.url, label: c.label || c.lang || "English", lang: c.lang || "en" };
        });
        const q = prov.qualities[0];
        let url = q.directUrl || q.url || "";
        let headers = {};
        if (!url) {
            const sh = { "Referer": TRYEMBED + "/", "Cookie": cookies.join("; ") };
            const toks = [q.token, q.fallbackToken].filter(function (t) { return !!t; });
            let spare = null;
            for (let i = 0; i < toks.length && !url; i++) {
                const s = TRYEMBED + "/s/" + toks[i] + ".m3u8";
                const r3 = await get(s, sh, 12000).catch(function () { return null; });
                if (!r3) continue;
                let fu = String(r3.finalUrl || r3.url || "");
                if (st(r3) >= 300 && st(r3) < 400 && r3.headers) {
                    const loc = r3.headers.location || r3.headers.Location;
                    fu = loc ? abs([].concat(loc)[0], s) : "";
                } else if (!(st(r3) === 200 && /^#EXTM3U/.test(String(r3.body || "").trim()))) continue;
                if (!fu || fu === s || /tryembed\./.test(fu)) {
                    // the app did not report the redirect target: give the player the /s/ link + session (it follows the 302)
                    if (!spare) spare = { url: s, headers: Object.assign({ "User-Agent": UA }, sh) };
                    continue;
                }
                // the signed master is served by several anixx.cloud proxies (sora, god, ...) with the same
                // signature; check the variants and switch host if needed
                // signature; "god" answers 502 now and then, "sora" is the steady one -> try sora first
                const hosts = [];
                if (/\.anixx\.cloud\//.test(fu) && !/\/\/sora\.anixx\.cloud\//.test(fu)) hosts.push(fu.replace(/^https?:\/\/[^\/]+/, "https://sora.anixx.cloud"));
                hosts.push(fu);
                for (let h = 0; h < hosts.length && !url; h++) if (await hlsPlays(hosts[h])) url = hosts[h];
                if (!url && !spare) spare = { url: fu, headers: {} };
            }
            if (!url && spare) { url = spare.url; headers = spare.headers; }
            if (!url) return [];
        }
        return [{ url: url, server: "TryEmbed", lang: audio === "dub" ? "English Dub" : "Japanese · English Sub", quality: "1080p", rank: 1080,
            order: audio === "dub" ? 2 : 0, headers: headers, subtitles: subs }];
    }

    // master + its first variant answer with playlists
    async function hlsPlays(u, headers) {
        try {
            const r = await get(u, headers || {}, 8000);
            const b = String(r.body || "");
            if (st(r) !== 200 || !/^\s*#EXTM3U/.test(b)) return false;
            if (!/#EXT-X-STREAM-INF/i.test(b)) return true;
            const lines = b.split(/\r?\n/);
            let child = "";
            for (let i = 0; i < lines.length && !child; i++) if (/^#EXT-X-STREAM-INF/i.test(lines[i])) {
                for (let k = i + 1; k < lines.length; k++) { const l = lines[k].trim(); if (l && l.charAt(0) !== "#") { child = l; break; } }
            }
            if (!child) return true;
            const c = await get(abs(child, u), headers || {}, 8000);
            return st(c) === 200 && /^\s*#EXTM3U/.test(String(c.body || ""));
        } catch (_) { return false; }
    }

    // Katana Sub, from the Bingr page (Filmu/Vidly carries the same payload)
    async function katana(id, ep) {
        for (let i = 0; i < KATANA_PAGES.length; i++) {
            const u = KATANA_PAGES[i].replace("{id}", id).replace("{ep}", ep);
            try {
                const r = await get(u, { "Accept": "text/html,*/*", "Referer": BASE + "/" }, i ? 14000 : 10000);
                if (st(r) !== 200) continue;
                const rsc = rscText(String(r.body || ""));
                const blob = (rsc.match(/v1\.[A-Za-z0-9_-]{60,}/) || [])[0];
                if (!blob) continue;
                const j = bingrDecode(blob);
                const label = (j.provider && j.provider.label) || "Katana Sub";
                const tag = String((j.provider && j.provider.tag) || "SUB").toUpperCase();
                const out = ((j && j.streams) || []).filter(function (s) { return s && /^https?:\/\//i.test(s.url || ""); }).map(function (s) {
                    const subs = (s.subtitles || []).filter(function (x) { return x && x.url; }).slice(0, 12).map(function (x) {
                        return { url: x.url, label: x.label || x.lang || "Subtitle", lang: x.lang || x.label || "" };
                    });
                    const h = (s.headers && typeof s.headers === "object") ? s.headers : {};
                    return { url: s.url, server: label.replace(/\s*(sub|dub|multi)$/i, "") || "Katana", lang: tag === "DUB" ? "English Dub" : tag === "MULTI" ? "Multi-audio" : "Japanese · English Sub",
                        quality: "1080p", rank: 1080, order: tag === "DUB" ? 2 : 1, headers: h, subtitles: subs };
                });
                if (out.length) return out;
            } catch (_) {}
        }
        return [];
    }

    // p,a,c,k,e,d unpacker (Dean Edwards)
    function unpack(src) {
        const m = String(src).match(/\}\('([\s\S]*)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!m) return "";
        let p = m[1];
        const a = parseInt(m[2], 10), k = m[4].split("|");
        let c = parseInt(m[3], 10);
        const enc = function (n) { return (n < a ? "" : enc(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36)); };
        while (c--) if (k[c]) p = p.replace(new RegExp("\\b" + enc(c) + "\\b", "g"), k[c]);
        return p.replace(/\\'/g, "'");
    }

    // AnimeTV+ -> Uqload (Japanese + English audio tracks in one HLS)
    async function uqload(id, ep) {
        const embed = ANIMETV + "/home/embed/anilist/" + id + "/" + ep;
        const r = await get(embed, { "Accept": "text/html,*/*", "Referer": BASE + "/" }, 12000);
        const sj = (String(r.body || "").match(/<script[^>]*id="state-data"[^>]*>([\s\S]*?)<\/script>/i) || [])[1];
        if (!sj) return [];
        let state; try { state = JSON.parse(sj); } catch (_) { return []; }
        if (!state || !state.src || (state.status && state.status !== "ready")) return [];
        const host = String(state.src);
        const r2 = await get(host, { "Accept": "text/html,*/*", "Referer": ANIMETV + "/" }, 12000);
        const body = String(r2.body || "");
        const js = unpack(body) || body;
        const file = (js.match(/file\s*:\s*"([^"]+\.m3u8[^"]*)"/) || js.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/) || [])[1];
        if (!file) return [];
        const subs = [];
        js.replace(/\{\s*file\s*:\s*"([^"]+\.vtt[^"]*)"\s*,\s*label\s*:\s*"([^"]*)"[^}]*\}/g, function (_, u, l) {
            if (!/thumbnail|sprite/i.test(u + l)) subs.push({ url: abs(u, host), label: l || "Subtitle", lang: /eng/i.test(l + u) ? "en" : (l || "") });
            return _;
        });
        if (!subs.length) js.replace(/"(https?:\/\/[^"]+_(eng|sli)\.vtt[^"]*)"/g, function (_, u, l) { subs.push({ url: u, label: l === "eng" ? "English" : "Signs", lang: l === "eng" ? "en" : "" }); return _; });
        return [{ url: abs(file, host), server: "Uqload", lang: "Japanese + English audio", quality: "720p", rank: 720, order: 3,
            headers: { "Referer": host.replace(/^(https?:\/\/[^\/]+).*$/, "$1") + "/" }, subtitles: subs }];
    }

    // Vidrift "Orion": one HEVC HLS per language
    const ORION_ORDER = ["Original", "English", "Hindi", "Tamil", "Telugu", "Malayalam", "Kannada", "French"];
    async function orion(id, ep) {
        const embed = VIDRIFT + "/embed/anilist/" + id + "/" + ep;
        const r = await get(embed, { "Accept": "text/html,*/*", "Referer": BASE + "/" }, 15000);
        const body = String(r.body || "");
        const mm = body.match(/var\s+embedMeta\s*=\s*(\{[\s\S]*?\});\s*(?:\n|<\/script>|var\s|const\s|let\s|window\.)/);
        if (!mm) return [];
        let meta; try { meta = JSON.parse(mm[1]); } catch (_) { return []; }
        const headers = { "Referer": VIDRIFT + "/", "Origin": VIDRIFT, "User-Agent": UA };
        let list = meta.orionStreams || [];
        if (!list.length && meta.playbackToken && meta.tmdbId) {
            // the list is only baked into the page on a cache hit; otherwise the player asks /api/source
            // (same stream objects). Cloudflare refuses that call from data-centre networks, so it is best-effort.
            const path = meta.type === "tv" ? "tv/" + meta.tmdbId + "/" + (meta.season || 1) + "/" + (meta.episode || 1) : "movie/" + meta.tmdbId;
            const ref = String(r.finalUrl || "") || (VIDRIFT + "/embed/" + path);
            try {
                // raw request (not through the network guard): a refusal here is expected and must not be
                // reported to the user as "site blocked"
                const raw = (typeof __ngRawGet === "function") ? __ngRawGet : http_get;
                const r2 = await withTimeout(raw(VIDRIFT + "/api/source/" + path + "?token=" + encodeURIComponent(meta.playbackToken) + "&provider=orion&parent=" + encodeURIComponent(meta.parent || "anihype.sbs"),
                    { "User-Agent": UA, "Accept": "*/*", "Referer": ref, "x-embed-parent": "https://" + (meta.parent || "anihype.sbs") }), 10000);
                if (st(r2) === 200) { const j = JSON.parse(String(r2.body || "")); list = (j && (j.streams || j.sources)) || []; }
            } catch (_) {}
        }
        return list.filter(function (s) { return s && s.url && (!s.provider || /orion/i.test(s.provider)); }).map(function (s) {
            const lang = String(s.name || "").replace(/^Orion\s*[·\-:]\s*/i, "").trim() || "Original";
            const rungs = [].concat(s.rungs || []).map(function (x) { return parseInt((x && (x.height || x.resolution || x)) || 0, 10) || 0; });
            const top = rungs.length ? Math.max.apply(null, rungs) : 0;
            const q = top >= 1080 ? "1080p" : top >= 720 ? "720p" : top >= 480 ? "480p" : top ? top + "p" : "Auto";
            const li = ORION_ORDER.indexOf(lang);
            return { url: abs(s.url, VIDRIFT), server: "Orion", lang: lang === "Original" ? "Japanese" : lang, quality: q, rank: top || 600,
                order: lang === "Original" ? 4 : lang === "English" ? 5 : lang === "Hindi" ? 6 : 7 + (li < 0 ? 9 : li), hevc: true,
                headers: headers, subtitles: [], subList: s.subtitleListUrl ? abs(s.subtitleListUrl, VIDRIFT) : "" };
        });
    }
    async function orionSubs(list) {
        const one = list.filter(function (s) { return s.subList; })[0];
        if (!one) return;
        try {
            const r = await get(one.subList, { "Referer": VIDRIFT + "/", "Accept": "application/json" }, 6000);
            const j = JSON.parse(String(r.body || ""));
            const subs = ((j && j.tracks) || []).filter(function (t) { return t && t.url; }).slice(0, 16).map(function (t) {
                return { url: abs(t.url, VIDRIFT), label: t.label || t.lang || "Subtitle", lang: t.lang || "" };
            });
            if (subs.length) list.forEach(function (s) { if (s.subList === one.subList || !s.subtitles.length) s.subtitles = subs; });
        } catch (_) {}
    }

    // Mikaza: Hindi dub as a direct MP4
    async function mikaza(id, ep) {
        const embed = MIKAZA + "/embed/haiku/ani/" + id + "/" + ep + "/hin";
        const r = await get(embed, { "Accept": "text/html,*/*", "Referer": BASE + "/" }, 12000);
        const res = (String(r.body || "").match(/resolve\s*:\s*"([^"]+)"/) || [])[1];
        if (!res) return [];
        const r2 = await get(abs(res.replace(/\\\//g, "/").replace(/\\u0026/g, "&"), MIKAZA), { "Accept": "application/json", "Referer": embed }, 14000);
        let j; try { j = JSON.parse(String(r2.body || "")); } catch (_) { return []; }
        if (!j || !j.src) return [];
        const got = j.source && j.source.resolvedLanguage ? String(j.source.resolvedLanguage) : "hin";
        if (/^(ja|jp|jpn|en|eng)/i.test(got)) return [];
        const subs = (j.tracks || []).filter(function (t) { return t && (t.src || t.url || t.file); }).map(function (t) {
            return { url: abs(t.src || t.url || t.file, MIKAZA), label: t.label || t.lang || "Subtitle", lang: t.srclang || t.lang || "" };
        });
        return [{ url: abs(j.src, MIKAZA), server: "Mikaza", lang: "Hindi Dub", quality: "Auto", rank: 720, order: 3.5, headers: {}, subtitles: subs }];
    }

    function epOf(url) {
        try {
            const j = JSON.parse(String(url));
            if (j && j.id) return { id: parseInt(j.id, 10), ep: parseInt(j.ep || j.e || 1, 10) || 1 };
        } catch (_) {}
        const s = String(url || "");
        const id = (s.match(/[?&]id=(\d+)/) || [])[1];
        const ep = (s.match(/[?&]ep=(\d+)/) || [])[1];
        return id ? { id: parseInt(id, 10), ep: parseInt(ep || "1", 10) } : null;
    }

    async function loadStreams(url, cb) {
        try {
            const p = epOf(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized AniHype episode" });
            const safe = function (f) { return withTimeout(f, 30000).catch(function () { return []; }); };
            const parts = await Promise.all([
                safe(tryEmbed(p.id, p.ep, "sub")),
                safe(tryEmbed(p.id, p.ep, "dub")),
                safe(katana(p.id, p.ep)),
                safe(uqload(p.id, p.ep)),
                safe(orion(p.id, p.ep)),
                safe(mikaza(p.id, p.ep))
            ]);
            await orionSubs(parts[4]);
            let cands = [];
            parts.forEach(function (l) { cands = cands.concat(l || []); });
            const seen = {};
            cands = cands.filter(function (c) { if (!c || !c.url || seen[c.url]) return false; seen[c.url] = 1; return true; });
            if (!cands.length) return cb({ success: false, errorCode: "NO_STREAMS", message: "None of AniHype's six servers has " + (p.ep === 1 ? "this title" : "episode " + p.ep) + " yet. New movies and episodes usually appear a few hours to a few weeks after release." });
            cands.sort(function (a, b) { return (a.order - b.order) || (b.rank - a.rank); });
            const list = cands.map(function (c) {
                const label = c.server + " · " + c.lang + (c.quality && c.quality !== "Auto" ? " · " + c.quality : "") + (c.hevc ? " · HEVC" : "");
                return mkStream({ url: c.url, source: label, quality: c.quality || "Auto", headers: Object.keys(c.headers || {}).length ? c.headers : undefined, subtitles: c.subtitles && c.subtitles.length ? c.subtitles : undefined });
            });
            const final = await verifyStreams(list, 4);
            if (!final.length) return cb({ success: false, errorCode: "NO_STREAMS", message: "AniHype returned links, but none is playing right now. Try again in a little while." });
            cb({ success: true, data: final });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String((e && e.message) || e) });
        }
    }

    function rscText(html) {
        let out = "";
        const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\[\s\S])*)"\]\)/g;
        let m;
        while ((m = re.exec(html))) { try { out += JSON.parse('"' + m[1] + '"'); } catch (_) {} }
        return out;
    }

    // ─────────────────────────── stream checks ───────────────────────────
    function __tjDeadline(promise, ms) {
        return new Promise(function (resolve) {
            const t = setTimeout(function () { resolve(null); }, ms);
            Promise.resolve(promise).then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(null); });
        });
    }
    async function __tjProbe(s) {
        const u = String((s && s.url) || "");
        if (!/^https?:\/\//i.test(u)) return "ok";
        const h = Object.assign({}, s.headers || {}, { "Range": "bytes=0-2047" });
        const r = await __tjDeadline(http_get(u, h), 9000);
        if (!r) return "unknown";
        const st = Number(r.status || r.statusCode || 0);
        const body = String(r.body || "").replace(/^\uFEFF/, "").replace(/^\s+/, "").slice(0, 600);
        if (st === 200 || st === 206) {
            if (/^#EXTM3U/.test(body)) {
                // a master playlist can be fine while its variants are gone (Citadel's proxy): check the first one
                if (/#EXT-X-STREAM-INF/i.test(body)) {
                    const lines = String(r.body || "").split(/\r?\n/);
                    let child = "";
                    for (let i = 0; i < lines.length; i++) { if (/^#EXT-X-STREAM-INF/i.test(lines[i])) { for (let j = i + 1; j < lines.length; j++) { const l = lines[j].trim(); if (l && l.charAt(0) !== "#") { child = l; break; } } break; } }
                    if (child) {
                        if (!/^https?:\/\//i.test(child)) child = child.charAt(0) === "/" ? u.replace(/^(https?:\/\/[^\/]+).*$/, "$1") + child : u.replace(/[?#].*$/, "").replace(/[^\/]*$/, "") + child;
                        const cr = await __tjDeadline(http_get(child, s.headers || {}), 9000);
                        if (cr) {
                            const cs = Number(cr.status || cr.statusCode || 0);
                            if (cs === 404 || cs === 410 || cs >= 500) return "dead";
                            if ((cs === 200 || cs === 206) && !/^\s*#EXTM3U/.test(String(cr.body || ""))) return "dead";
                        }
                    }
                }
                return "ok";
            }
            if (/<MPD[\s>]/i.test(body)) return "ok";
            if (/^<(!doctype|html|head|body)/i.test(body)) return "dead";
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
        return ok.concat(keep);
    }

    // keystream: 4 x FNV-1a(seed_n, key + iv) as state, then an sfc32-style generator, one 32-bit word
    // per 4 bytes (little-endian). Ported from the site's player (module "D").
    const BK = "vY7#qL2!mZ9@wK4$";
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function b64Bytes(s) {
        s = String(s).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+\/]/g, "");
        const out = new Uint8Array(Math.floor(s.length * 3 / 4));
        let bits = 0, acc = 0, o = 0;
        for (let i = 0; i < s.length; i++) {
            acc = (acc << 6) | B64.indexOf(s.charAt(i)); bits += 6;
            if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
        }
        return out.subarray(0, o);
    }
    function utf8Text(b) {
        let s = "", i = 0;
        while (i < b.length) {
            let c = b[i++];
            if (c >= 0xf0 && i + 2 < b.length + 1) { c = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); continue; }
            if (c >= 0xe0) c = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
            else if (c >= 0xc0) c = ((c & 31) << 6) | (b[i++] & 63);
            s += String.fromCharCode(c);
        }
        return s;
    }
    function bingrDecode(payload) {
        const p = String(payload || "").trim();
        if (p.indexOf("v1.") !== 0) throw new Error("bad payload");
        const all = b64Bytes(p.slice(3)), iv = all.subarray(0, 12), d = new Uint8Array(all.subarray(12));
        const st = [];
        for (let n = 0; n < 4; n++) {
            let l = (0x811c9dc5 ^ Math.imul(0x9e3779b9, n)) >>> 0;
            for (let x = 0; x < BK.length; x++) l = Math.imul(l ^ BK.charCodeAt(x), 0x1000193) >>> 0;
            for (let x = 0; x < iv.length; x++) l = Math.imul(l ^ iv[x], 0x1000193) >>> 0;
            st.push(l);
        }
        let a = st[0], b = st[1], c = st[2], dd = st[3], k = 0;
        for (let t = 0; t < d.length; t++) {
            if ((t & 3) === 0) {
                c >>>= 0; dd >>>= 0;
                let e = ((a >>>= 0) + (b >>>= 0)) | 0;
                a = b ^ (b >>> 9);
                b = (c + (c << 3)) | 0;
                c = (c << 21) | (c >>> 11);
                dd = (dd + 1) | 0;
                e = (e + dd) | 0;
                c = (c + e) | 0;
                k = e >>> 0;
            }
            d[t] ^= (k >>> ((t & 3) * 8)) & 255;
        }
        const txt = utf8Text(d);
        return JSON.parse(txt.slice(0, txt.lastIndexOf("}") + 1));
    }

    // Next.js streams its page data as self.__next_f.push([1,"..."]) string chunks

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
    __ngWrapExports();
})(typeof http_get !== 'undefined' ? http_get : undefined, typeof http_post !== 'undefined' ? http_post : undefined);
