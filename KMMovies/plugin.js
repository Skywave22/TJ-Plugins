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
        if (res.errorCode === 'NEEDS_UPDATE' || res.errorCode === 'CHECK_FAILED') return res;
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
    //  KMMovies (kmmovies.beer, "the new home of Khatrimaza") — SkyStream plugin
    //
    //  WordPress site. Catalog/search from the theme's HTML listings
    //  (article.movie-card: poster, quality badge, rating, audio):
    //    /                     latest      /page/N/
    //    /category/<slug>/page/N/          /?s=<query>
    //  Post page: hero (title, poster, backdrop, plot, IMDb id) and
    //  .downloads-section:
    //    movies : .download-category (Encoded / WebDL) a.dl-btn
    //    series : .season-block "Season N", tabs episodes / combined / zip
    //  Playable links are the KMCLOUD files (one.kmcloud.lol/s/<id>).
    //  Each file has several mirrors; three of them end on a direct file:
    //    /d/<id>/watch_online -> z1.kmphotos.cv/nf/index.php?videoUrl=<R2 file>
    //    /d/<id>/mydirect     -> vidfiles -> Google video download (video/mkv)
    //    /d/<id>/sonicboom    -> kmphotos download99 (signed R2 / worker)
    //  magiclinks.lol (WEB-DL/4K files and single series episodes) is behind
    //  a Cloudflare challenge and cannot be opened by a plugin, so it is
    //  not listed. Zip files are not videos and are skipped too.
    // ═══════════════════════════════════════════════════════════

    var SITE = (typeof manifest !== 'undefined' && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, '')
        : 'https://kmmovies.beer';
    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=KMMovies';

    var ROWS = [
        { name: 'Latest Uploads',  path: '/' },
        { name: 'Trending',        path: '/category/trending/' },
        { name: 'Bollywood',       path: '/category/bollywood/' },
        { name: 'Hollywood',       path: '/category/hollywood/' },
        { name: 'Dual Audio',      path: '/category/dual-audio/' },
        { name: 'Hindi Dubbed',    path: '/category/hindi-dubbed/' },
        { name: 'South',           path: '/category/south/' },
        { name: 'TV Series',       path: '/category/tv-series/' },
        { name: 'K-Drama',         path: '/category/korean/' },
        { name: 'Anime',           path: '/category/anime/' },
        { name: '4K',              path: '/category/4k/' }
    ];

    // ─────────────────────────── helpers ───────────────────────────
    function mkItem(o)    { try { return new MultimediaItem(o); } catch (_) { return o; } }
    function mkEpisode(o) { try { return new Episode(o); } catch (_) { return o; } }
    function mkStream(o) {
        var s;
        try { s = new StreamResult({ url: o.url, source: o.source, headers: o.headers }); s.quality = o.quality; }
        catch (_) { s = o; }
        return s;
    }
    function withTimeout(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    async function getPage(url, extra, ms) {
        var h = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': SITE + '/' };
        if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        var r = await withTimeout(http_get(url, h), ms || 15000);
        return { status: Number((r && (r.status || r.statusCode)) || 0), body: String((r && r.body) || ''), finalUrl: String((r && r.finalUrl) || url) };
    }
    function decode(s) {
        return String(s || '').replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
            .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
            .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
    }
    function strip(s) { return decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
    function abs(u) { u = decode(u); return /^\/\//.test(u) ? 'https:' + u : (/^\//.test(u) ? SITE + u : u); }
    function isSeriesTitle(t) { return /\bS\d{1,2}\b|\bS\d{1,2}\s*-\s*S?\d{1,2}\b|\bSeason\s*\d|\bEP?\s*\d{1,3}\b|\bWeb\s*Series\b/i.test(String(t || '')); }
    function yearOf(t) { var m = String(t || '').match(/\((19\d{2}|20\d{2})\)/); return m ? +m[1] : undefined; }
    function cleanName(t) {
        return decode(t).replace(/\s*\((19|20)\d{2}\)\s*$/, '').replace(/\s+S\d{1,2}(\s*-\s*S?\d{1,2})?\s*$/i, '').trim();
    }

    // listing card -> item
    function parseCards(html) {
        var out = [], seen = {};
        var re = /<article class="movie-card"[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g, m;
        while ((m = re.exec(html))) {
            var body = m[2];
            var href = (body.match(/<a href="([^"]+)"/) || [])[1];
            if (!href || seen[href]) continue;
            seen[href] = 1;
            var title = decode(m[1]);
            var img = (body.match(/<img[^>]+class="poster"[^>]+src="([^"]+)"/) || body.match(/<img[^>]+src="([^"]+)"/) || [])[1];
            var badge = strip((body.match(/class="badge-left">([\s\S]*?)<\/div>/) || [])[1]);
            var audio = strip((body.match(/class="badge-audio"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
            var rating = parseFloat(strip((body.match(/class="badge badge--[a-z]+">([\s\S]*?)<\/div>/) || [])[1]).replace(/[^\d.]/g, ''));
            out.push(mkItem({
                title: cleanName(title) || title,
                url: abs(href),
                posterUrl: img ? abs(img) : PLACEHOLDER,
                type: isSeriesTitle(title) ? 'series' : 'movie',
                year: yearOf(title),
                score: isNaN(rating) ? undefined : rating,
                description: [badge, audio].filter(Boolean).join(' · ')
            }));
        }
        return out;
    }

    async function listing(path, page) {
        var p = path.replace(/\/?$/, '/');
        var url = SITE + (page > 1 ? p + 'page/' + page + '/' : p);
        var r = await getPage(url);
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
        return parseCards(r.body);
    }

    // ─────────────────────────── catalog ───────────────────────────
    async function getHome(cb) {
        try {
            var lists = await Promise.all(ROWS.map(function (row) {
                return listing(row.path, 1).catch(function () { return null; });
            }));
            var data = {};
            ROWS.forEach(function (row, i) { if (lists[i] && lists[i].length) data[row.name] = lists[i]; });
            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: 'SITE_UNREACHABLE', message: 'KMMovies (' + SITE.replace(/^https?:\/\//, '') + ') is not answering right now - try again in a minute.' });
            }
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var pages = await Promise.all([1, 2].map(function (n) {
                return getPage(SITE + (n > 1 ? '/page/' + n + '/' : '/') + '?s=' + encodeURIComponent(q)).then(function (r) {
                    return r.status === 200 ? parseCards(r.body) : [];
                }, function () { return []; });
            }));
            var seen = {}, out = [];
            pages[0].concat(pages[1]).forEach(function (it) { if (!seen[it.url]) { seen[it.url] = 1; out.push(it); } });
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── post page ───────────────────────────
    function kmFile(href) {
        var m = String(href || '').match(/^https?:\/\/([a-z0-9.-]*kmcloud\.[a-z]+)\/s\/([A-Za-z0-9_-]+)/i);
        return m ? { h: m[1], id: m[2] } : null;
    }
    function dlButtons(html) {
        var out = [], re = /<a href="([^"]+)" class="dl-btn[^"]*"[^>]*>([\s\S]*?)<\/a>/g, m;
        while ((m = re.exec(html))) {
            var f = kmFile(m[1]);
            if (!f) continue;   // magiclinks.lol etc.
            var res = strip((m[2].match(/class="dl-res">([\s\S]*?)<\/span>/) || [])[1]);
            var size = strip((m[2].match(/class="dl-size">([\s\S]*?)<\/span>/) || [])[1]);
            out.push({ h: f.h, id: f.id, l: [res, size].filter(Boolean).join(' • ') });
        }
        return out;
    }
    function qNum(l) { var m = String(l || '').match(/(\d{3,4})p/i); return m ? +m[1] : 0; }

    async function load(url, cb) {
        try {
            var r = await getPage(url, null, 20000);
            if (r.status !== 200 || !r.body) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'This post could not be loaded from KMMovies right now (HTTP ' + (r.status || 'no answer') + ').' });
            var h = r.body;
            var rawTitle = strip((h.match(/<h1 class="hero-title">([\s\S]*?)<\/h1>/) || [])[1]) || strip((h.match(/<title>([^<]*)/) || [])[1]);
            var pm = h.match(/<img[^>]*class="hero-poster"[^>]*?\ssrc="([^"]+)"/);
            var poster = pm ? pm[1] : (h.match(/https:\/\/images\.kmphotos\.[a-z]+\/tmdb\/poster\/[^"'\s)]+/) || [])[0];
            var backdrop = (h.match(/class="hero-backdrop" style="background-image: url\('([^']+)'/) || [])[1];
            var plot = strip((h.match(/<div class="hero-description">([\s\S]*?)<\/div>/) || [])[1]);
            var pills = []; h.replace(/<span class="meta-pill[^"]*">([\s\S]*?)<\/span>/g, function (_, x) { pills.push(strip(x)); });
            var rating = parseFloat(((pills.filter(function (p) { return /★|^\u2605/.test(p); })[0]) || '').replace(/[^\d.]/g, ''));
            var genres = []; h.replace(/href="[^"]*\/genre\/[^"]+" class="meta-link"[^>]*>([^<]+)</g, function (_, g) { if (genres.indexOf(strip(g)) < 0) genres.push(strip(g)); });
            var cast = []; h.replace(/<a class="about-cast-chip"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/g, function (_, c) { if (cast.length < 12) cast.push({ name: strip(c) }); });
            var yt = (h.match(/data-yt="([^"]+)"/) || [])[1];
            var imdb = (h.match(/imdb\.com\/title\/(tt\d+)/) || [])[1];
            var dlAt = h.indexOf('id="download-links"');
            var dl = dlAt >= 0 ? h.slice(dlAt) : '';
            var end = dl.search(/<section class="kmip-guide"|<section class="kmip-faq"/);
            if (end > 0) dl = dl.slice(0, end);

            var episodes = [];
            var isSeries = /season-block/.test(dl) || isSeriesTitle(rawTitle);
            if (/season-block/.test(dl)) {
                // series: one entry per season = the "Combined" files (the whole season in one video file)
                var blocks = dl.split(/<div class="season-block(?:\s+open)?\s*">/).slice(1);
                blocks.forEach(function (b) {
                    var sn = +((strip((b.match(/class="season-block-title">([\s\S]*?)<\/span>/) || [])[1]).match(/Season\s*(\d+)/i) || [])[1] || 0) || 1;
                    var nEps = (strip((b.match(/class="season-block-title">([\s\S]*?)<\/span>/) || [])[1]).match(/\((\d+)\s*eps?\)/i) || [])[1];
                    var comb = (b.match(/data-type="combined-\d+">([\s\S]*?)<\/div>\s*<\/div>/) || [])[1] || '';
                    var files = dlButtons(comb);
                    if (!files.length) return;
                    episodes.push(mkEpisode({
                        name: 'Season ' + sn + ' - all ' + (nEps ? nEps + ' episodes' : 'episodes') + ' in one file',
                        season: sn, episode: 1,
                        url: url + '#' + encodeURIComponent(JSON.stringify({ f: files, s: sn })),
                        posterUrl: poster || PLACEHOLDER
                    }));
                });
                episodes.sort(function (a, b) { return a.season - b.season; });
            } else {
                var files = dlButtons(dl);
                if (files.length) episodes.push(mkEpisode({
                    name: rawTitle || 'Movie', season: 1, episode: 1,
                    url: url + '#' + encodeURIComponent(JSON.stringify({ f: files })),
                    posterUrl: poster || PLACEHOLDER
                }));
            }
            if (!episodes.length) {
                return cb({ success: false, errorCode: 'NO_LINKS', message: isSeries
                    ? 'This series only has single-episode / 4K links on magiclinks.lol, which a plugin cannot open (Cloudflare check). No playable files.'
                    : 'This post only has WEB-DL / 4K links on magiclinks.lol, which a plugin cannot open (Cloudflare check). No playable files.' });
            }
            var item = mkItem({
                title: cleanName(rawTitle) || rawTitle,
                url: url,
                posterUrl: poster ? abs(poster) : PLACEHOLDER,
                bannerUrl: backdrop ? abs(backdrop) : undefined,
                type: isSeries ? 'series' : 'movie',
                year: yearOf(rawTitle) || (+(pills.filter(function (p) { return /^(19|20)\d{2}$/.test(p); })[0]) || undefined),
                score: isNaN(rating) ? undefined : rating,
                description: [plot, isSeries ? 'Each season is one video file with all its episodes (single episodes are only on magiclinks.lol, which plugins cannot open).' : ''].filter(Boolean).join('\n\n'),
                genres: genres.length ? genres : undefined,
                cast: cast.length ? cast : undefined,
                trailers: yt ? [{ url: 'https://www.youtube.com/watch?v=' + yt }] : undefined,
                syncData: imdb ? { imdb: imdb } : undefined,
                episodes: episodes
            });
            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────
    // follow a KMCLOUD mirror (/d/<id>/<provider>) and return where it ends
    async function mirrorEnd(f, provider) {
        try {
            var r = await withTimeout(http_get('https://' + f.h + '/d/' + f.id + '/' + provider, {
                'User-Agent': UA, 'Referer': 'https://' + f.h + '/s/' + f.id, 'Range': 'bytes=0-0'
            }), 15000);
            return { status: Number((r && (r.status || r.statusCode)) || 0), url: String((r && r.finalUrl) || ''), body: String((r && r.body) || '') };
        } catch (_) { return null; }
    }
    async function viaWatchOnline(f) {      // -> R2 file
        var e = await mirrorEnd(f, 'watch_online');
        if (!e) return null;
        var m = e.url.match(/[?&]videoUrl=([^&#]+)/) || e.body.match(/videoUrl=([^"'&\s]+)/);
        if (m) { var u = decodeURIComponent(m[1]); if (/^https?:\/\//.test(u)) return u; }
        var src = e.body.match(/https?:\/\/[a-z0-9.-]+\.r2\.dev\/[^"'\s<>]+/i);
        return src ? decode(src[0]) : null;
    }
    // Google Drive copy: /go/<id>/mydirect redirects (via vidfiles) to a freshly
    // signed video-downloads.googleusercontent.com file each time it is opened,
    // so the player gets this URL itself (Google ignores Range - not probed).
    function driveUrl(f) { return 'https://' + f.h + '/go/' + f.id + '/mydirect'; }
    async function viaSonicboom(f) {        // -> kmphotos signed download (worker)
        var e = await mirrorEnd(f, 'sonicboom');
        if (!e) return null;
        var m = e.body.match(/href="(\?file=[^"]*dl=r2[^"]*)"/) || e.body.match(/href="(\?file=[^"]*dl=worker[^"]*)"/);
        if (!m) return null;
        return e.url.replace(/\?.*$/, '') + decode(m[1]);
    }

    async function loadStreams(url, cb) {
        try {
            var ref = null;
            var hash = String(url).split('#')[1];
            try { ref = hash ? JSON.parse(decodeURIComponent(hash)) : null; } catch (_) { ref = null; }
            if (!ref || !ref.f || !ref.f.length) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized KMMovies link: ' + url });
            // best quality first; at most 4 files (each one costs a few requests)
            var files = ref.f.slice().sort(function (a, b) { return qNum(b.l) - qNum(a.l); }).slice(0, 4);
            var H = { 'User-Agent': UA };
            var jobs = files.map(function (f) {
                var label = (f.l || 'Video') + (ref.s ? ' • Season ' + ref.s + ' (one file)' : '');
                var q = qNum(f.l) ? qNum(f.l) + 'p' : 'auto';
                return viaWatchOnline(f).then(function (w) { return w ? [w, null] : viaSonicboom(f).then(function (b) { return [null, b]; }); }).then(function (r) {
                    var u = r[0] || r[1];
                    if (!u) return null;
                    var st = mkStream({ url: u, source: (r[0] ? 'KMCloud' : 'KMCloud Fast') + ' • ' + label, quality: q, headers: H });
                    st.__f = f; st.__label = label; st.__q = q;
                    return st;
                }, function () { return null; });
            });
            var list = (await Promise.all(jobs)).filter(Boolean);
            var ok = list.length ? await verifyStreams(list, 3) : [];
            // the same file is also on Google Drive - offer it as a second server
            // for every file whose primary copy is reachable
            var verified = [];
            ok.forEach(function (s) {
                var f = s.__f, label = s.__label, q = s.__q;
                try { delete s.__f; delete s.__label; delete s.__q; } catch (_) {}
                verified.push(s);
                if (f && !/may not play/.test(String(s.source))) verified.push(mkStream({ url: driveUrl(f), source: 'KMCloud Drive • ' + label, quality: q, headers: H }));
            });
            if (!verified.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS', message: 'KMCLOUD did not return a playable file for this title right now - try again in a minute.' });
            }
            cb({ success: true, data: verified });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
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
