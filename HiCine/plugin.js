/*
 * HiCine — SkyStream plugin (v3)
 * Site:   https://www.hicine.sbs
 * API:    https://api.hicine.sbs
 * Source: Bollywood & Hollywood movies, series, K-dramas, anime (Hindi dual-audio)
 *
 * Exports: getHome / search / load / loadStreams
 */

(function (__ngRawGet, __ngRawPost) {

    'use strict';

    // ── network guard (TJ-Plugins shared helper) ─────────────────────────────────
    // Many internet providers block streaming sites, either with fake DNS answers or by
    // cutting the connection based on the site name. Then the plugin only works over a VPN.
    // This wraps this plugin's own http_get / http_post (never the shared globals):
    //   1. A request to the site that fails at network level (status 0: DNS failure,
    //      connection reset/refused, TLS cut, timeout), returns HTTP 451, or lands on an
    //      ISP block page is retried on the site's mirror domains. The first one that works
    //      is used for the rest of the session and remembered with setPreference.
    //   2. If nothing works, the error the user sees says the site is blocked on their
    //      network and how to get around it, instead of "no results" or a raw error.
    var __NG_MIRRORS = [];
    // group 0 = this site (manifest.baseUrl + manifest.domains + known mirrors); then shared APIs with official aliases
    var __NG = { get: __ngRawGet, post: __ngRawPost, groups: [[], ['https://api.themoviedb.org', 'https://api.tmdb.org']], active: {}, ready: null, fails: [] };
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
    var __NG_BLOCK_TEXT = /(has been|is|was) (blocked|restricted|disabled)|access (to this [a-z ]{0,20})?(is|has been) (denied|restricted|blocked)|blocked (as per|by order|under|by court|by the)|not available in your (country|region)|website (is )?blocked/i;
    var __NG_BLOCK_WHO = /court|order|government|ministry|authority|department|telecom|regulat|commission|law|legal|isp\b|internet service provider|operator/i;
    var __NG_BLOCK_HOST = /internetpositif|trustpositif|blockpage|block\.|blocked\.|warning\.or\.kr|lawfulblock|zapret|rkn\.gov|eais\.|safebrowse|surfsafe|netalerts/i;
    function __ngBad(r, reqUrl) {
        if (!r) return 'no response';
        var st = Number(r.status || r.statusCode || r.code || 0);
        if (st === 0) {
            var e = String(r.error || '');
            if (/cancel/i.test(e)) return '';
            return e || 'connection failed';
        }
        if (st === 451) return 'HTTP 451';
        var fin = String(r.finalUrl || '');
        if (fin && __ngHost(fin) !== __ngHost(reqUrl) && __NG_BLOCK_HOST.test(__ngHost(fin))) return 'ISP block page';
        var body = String(r.body || '');
        if (body.length < 40000 && __NG_BLOCK_TEXT.test(body) && __NG_BLOCK_WHO.test(body) && !/cloudflare/i.test(body)) return 'ISP block page';
        return '';
    }
    function __ngWhy(e) {
        e = String(e || '');
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
                if (o && o.base === __NG.groups[0][0] && o.active) {
                    Object.keys(o.active).forEach(function (g) {
                        var a = o.active[g];
                        if (__ngGroupOf(__ngHost(a)) === +g) __NG.active[g] = a;
                    });
                }
            } catch (_) {}
        })();
        return __NG.ready;
    }
    function __ngRemember(g, origin) {
        __NG.active[g] = origin;
        try { if (typeof setPreference === 'function') setPreference('tj_net_mirror', JSON.stringify({ base: __NG.groups[0][0], active: __NG.active })); } catch (_) {}
    }
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
    async function __ngCall(method, url, headers, body) {
        try {
            var r = method === 'POST' ? await __NG.post(url, headers, body) : await __NG.get(url, headers);
            return { r: r, err: null };
        } catch (e) {
            return { r: { status: 0, statusCode: 0, body: '', error: String((e && e.message) || e) }, err: e };
        }
    }
    async function __ngRequest(method, url, headers, body) {
        await __ngInit();
        var host = __ngHost(url), g = __ngGroupOf(host), mine = g >= 0;
        var target = url, h0 = headers, act = mine ? __NG.active[g] : '';
        if (act && __ngBare(__ngHost(act)) !== __ngBare(host)) {
            target = __ngSwap(url, act);
            h0 = __ngHeaders(headers, act);
        }
        var first = await __ngCall(method, target, h0, body);
        var bad = __ngBad(first.r, target);
        if (!bad) return first.r;
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
                if (hit) { __ngRemember(g, hit.o); return hit.r; }
            }
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
    // strong = the network itself refused the site (typical ISP block); weak = only timeouts (may just be a slow/down site)
    function __ngStrong(why) { return why !== 'timed out' && why !== 'connection failed'; }
    function __ngExplain(name, res, t0) {
        if (!res || res.success !== false) return res;
        var recent = __NG.fails.filter(function (f) { return f.t >= t0; });
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
                    '), usually by your internet provider - that is why it works with a VPN.' + tip };
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


    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    // Plain headers only: spoofed X-Forwarded-For / CF-Connecting-IP / True-Client-IP
    // don't change the caller's location, and Cloudflare answers them with HTTP 403.
    function mergeGeoHeaders(base) { return Object.assign({}, base || {}); }

    // Dynamic base URL: the app injects the domain picked in the settings gear.
    var API = (typeof manifest !== 'undefined' && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, '')
        : 'https://api.hicine.sbs';
    if (API.slice(-1) === '/') API = API.slice(0, -1);

    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=HiCine';

    // contentType -> collection path on the API + plugin item type
    var COLLECTIONS = {
        bolly_movies: { path: 'bollywood_movies',  type: 'movie'  },
        bolly_series: { path: 'bollywood_series',  type: 'series' },
        movies:       { path: 'hollywood_movies',  type: 'movie'  },
        series:       { path: 'hollywood_series',  type: 'series' },
        anime:        { path: 'anime',             type: 'anime'  }
    };
    var PATH_TO_CT = {};
    Object.keys(COLLECTIONS).forEach(function (ct) { PATH_TO_CT[COLLECTIONS[ct].path] = ct; });
    // aliases the site's own frontend uses
    PATH_TO_CT['movies'] = 'movies';
    PATH_TO_CT['series'] = 'series';

    var HOME_ROWS = [
        { name: 'Hollywood Movies', ct: 'movies' },
        { name: 'Hollywood Series', ct: 'series' },
        { name: 'Bollywood Movies', ct: 'bolly_movies' },
        { name: 'Bollywood Series', ct: 'bolly_series' },
        { name: 'Anime',            ct: 'anime' }
    ];

    var MAX_SEASONS = 20;
    var ZIP_EPISODE_NUMBER = 999;      // virtual "Season Complete Pack" (zip download)
    var ALL_EPISODE_NUMBER = 998;      // virtual "All Episodes" (every single-episode link)
    var BULK_EPISODE_CAP = 60;         // safety cap for the All-Episodes resolver

    // Worker server keys returned by /api/links -> friendly labels
    var SERVER_LABELS = {
        fsl:     'FSL',
        fsl2:    'FSL v2',
        pixel:   'PixelDrain',
        gofile:  'Gofile',
        server1: 'Server 1',
        ten:     '10Gbps'
    };
    // "ten" redirects to an ad-walled hubcloud interstitial, "gofile" to a link
    // page (not a direct file) — only used as a last-resort fallback.
    var SKIP_SERVERS = ['ten', 'gofile'];

    // ─────────────────────────── helpers ───────────────────────────

    function decodeEntities(s) {
        return String(s == null ? '' : s)
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
            .replace(/&nbsp;/g, ' ');
    }

    function stripTags(html) {
        return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    }

    function parseYear(rec) {
        var m = String(rec.title || '').match(/\((19\d{2}|20\d{2})\)/);
        if (m) return parseInt(m[1], 10);
        var y = parseInt(String(rec.date || '').slice(0, 4), 10);
        return (y > 1900 && y < 2100) ? y : undefined;
    }

    function cleanTitle(title) {
        return decodeEntities(String(title || '').trim()).replace(/\s*\((19\d{2}|20\d{2})\)\s*$/, '').trim();
    }

    function qualityFromText(text) {
        var m = String(text || '').match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i)
              || String(text || '').match(/\b4k\b/i);
        if (!m) return '';
        var q = m[1].toLowerCase();
        return q === '4k' ? '2160p' : q;
    }

    function sizeFromText(text) {
        var m = String(text || '').match(/([\d.]+)\s*(GB|MB)/i);
        return m ? (m[1] + m[2].toUpperCase()) : '';
    }

    // ── audio-language detection (HiCine files carry language in their titles) ──
    var LANGS = ['hindi', 'punjabi', 'urdu', 'tamil', 'telugu', 'marathi',
                 'kannada', 'malayalam', 'bengali', 'gujarati', 'english',
                 'korean', 'japanese', 'chinese', 'spanish', 'arabic'];

    function langFromText(text) {
        var s = decodeEntities(String(text || '').toLowerCase());
        var found = [];
        for (var i = 0; i < LANGS.length; i++) {
            if (s.indexOf(LANGS[i]) >= 0) found.push(LANGS[i]);
        }
        return found.join('-');
    }

    function langLabel(lang) {
        if (!lang) return '';
        return lang.split('-').map(function (p) {
            return p.charAt(0).toUpperCase() + p.slice(1);
        }).join('-');
    }

    // Hindi (incl. Hindi dual-audio) is the DEFAULT server tier, then other
    // Indian languages, then unknown, then English/foreign.
    function langTier(lang) {
        if (!lang) return 3;
        if (lang.indexOf('hindi') >= 0) return 0;
        if (lang.indexOf('punjabi') >= 0 || lang.indexOf('urdu') >= 0) return 1;
        if (lang.indexOf('english') >= 0) return 4;
        return 2;
    }

    function sortTargetsByPreference(targets) {
        // Hindi first (default), then highest quality within the same language
        return targets.slice().sort(function (a, b) {
            var lt = langTier(a.lang || '') - langTier(b.lang || '');
            if (lt !== 0) return lt;
            var qa = QRANK[a.quality] || 0, qb = QRANK[b.quality] || 0;
            return qb - qa;
        });
    }

    var QRANK = { '2160p': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 1, '360p': 1 };

    // pick the highest-quality variant of an episode
    function pickBestVariant(variants) {
        var best = null, bestScore = -1;
        for (var i = 0; i < variants.length; i++) {
            var score = QRANK[variants[i].quality] || 0;
            if (score > bestScore) { bestScore = score; best = variants[i]; }
        }
        return best || variants[0];
    }

    var SERVER_PREFERENCE = ['fsl', 'server1', 'fsl2', 'pixel'];

    // Fetch worker tokens once, shared by both resolvers.
    // Throws Error('DEAD') when the worker confirms the link is gone (empty tokens).
    async function fetchWorkerTokens(workerUrl) {
        var qi = workerUrl.indexOf('?');
        if (qi < 0) return null;
        var base = workerUrl.slice(0, qi);
        if (base.slice(-1) === '/') base = base.slice(0, -1); // "worker.dev/?x=1" -> "worker.dev"
        var vcloud = getQueryParam(workerUrl, 'vcloud');
        if (!vcloud) return null;
        var data = await getJson(base + '/api/links?vcloud=' + encodeURIComponent(vcloud));
        if (!data || !data.tokens || Object.keys(data.tokens).length === 0) {
            var err = new Error('DEAD');
            err.dead = true;
            throw err;
        }
        return { base: base, vcloud: vcloud, data: data };
    }

    function buildGoStream(ctx, tokenKey, tk, quality, size, lang) {
        var label = (SERVER_LABELS[tokenKey] || tokenKey.toUpperCase());
        if (lang) label += ' • ' + langLabel(lang);
        if (quality) label += ' • ' + quality;
        var fileSize = size || (ctx.data && ctx.data.size) || '';
        if (fileSize) label += ' • ' + fileSize;
        return mkStream({
            url: ctx.base + '/go?type=' + encodeURIComponent(tokenKey)
               + '&vcloud=' + encodeURIComponent(ctx.vcloud)
               + '&ts=' + encodeURIComponent(tk.ts)
               + '&sig=' + encodeURIComponent(tk.sig),
            quality: label,
            headers: { 'User-Agent': UA }
        });
    }

    function sleep(ms) {
        if (typeof setTimeout === 'function') {
            return new Promise(function (r) { setTimeout(r, ms); });
        }
        return Promise.resolve();
    }

    async function getJson(url) {
        var res = await http_get(url, {
            'User-Agent': UA,
            'Accept': 'application/json, text/plain, */*'
        });
        var body = (res && typeof res === 'object') ? res.body : res;
        var status = (res && typeof res === 'object') ? (res.status || res.statusCode || 0) : 0;
        if (status && (status < 200 || status >= 300)) {
            throw new Error('HTTP ' + status + ' for ' + url);
        }
        if (!body) throw new Error('Empty response from ' + url);
        try {
            return JSON.parse(typeof body === 'string' ? body : JSON.stringify(body));
        } catch (e) {
            throw new Error('Invalid JSON from ' + url);
        }
    }

    // Class helpers — use the runtime classes when present, plain objects otherwise
    function mkItem(obj) {
        try { return new MultimediaItem(obj); } catch (_) { return obj; }
    }
    function mkEpisode(obj) {
        try { return new Episode(obj); } catch (_) { return obj; }
    }
    function mkStream(obj) {
        var s;
        try {
            s = new StreamResult({ url: obj.url, source: obj.source || obj.quality, headers: obj.headers });
            s.quality = obj.quality; // runtimes label streams differently — set both
        } catch (_) {
            s = obj;
        }
        return s;
    }

    // Extract a query param without URLSearchParams (safe in every JS engine)
    function getQueryParam(url, key) {
        var qi = url.indexOf('?');
        if (qi < 0) return null;
        var pairs = url.slice(qi + 1).split('&');
        for (var i = 0; i < pairs.length; i++) {
            var kv = pairs[i].split('=');
            if (decodeURIComponent(kv[0]) === key) {
                return decodeURIComponent(kv.slice(1).join('='));
            }
        }
        return null;
    }

    // Item URLs are the real API detail URLs:
    //   https://api.hicine.sbs/api/hollywood_series/28295
    // Episode URLs are virtual paths on the same host:
    //   .../28295/season/2/episode/5          (a normal episode)
    //   .../28295/season/1/episode/999        (whole-season "Complete Pack")
    function parseItemUrl(url) {
        var m = String(url || '').match(/\/api\/([a-z_-]+)\/(\d+)(?:\/season\/(\d+)\/episode\/(\d+))?/i);
        if (!m) return null;
        var ct = PATH_TO_CT[m[1].toLowerCase()];
        if (!ct) return null;
        return {
            ct: ct,
            id: m[2],
            season: m[3] ? parseInt(m[3], 10) : null,
            ep: m[4] ? parseInt(m[4], 10) : null
        };
    }

    function detailUrl(ct, id) {
        return API + '/api/' + COLLECTIONS[ct].path + '/' + id;
    }

    function episodeUrl(ct, id, season, ep) {
        return detailUrl(ct, id) + '/season/' + season + '/episode/' + ep;
    }

    // Normalize image URLs: protocol-relative, root-relative, http -> https
    function fixPoster(u) {
        var s = String(u || '').trim();
        if (!s) return '';
        if (s.startsWith('//')) return 'https:' + s;
        if (s.startsWith('/')) return 'https://storage.hicine.sbs' + s;
        if (s.startsWith('http://')) return 'https://' + s.slice(7);
        return s;
    }

    function toItem(rec, forceCt) {
        if (!rec) return null;
        var ct = forceCt || rec.contentType;
        var info = COLLECTIONS[ct];
        if (!info) {
            // Unknown content type — sniff from categories
            var cats = String(rec.categories || '');
            ct = /anime/i.test(cats) ? 'anime'
               : /bollywood/i.test(cats) ? (/series/i.test(cats) ? 'bolly_series' : 'bolly_movies')
               : /series|korean|k-drama/i.test(cats) ? 'series'
               : 'movies';
            info = COLLECTIONS[ct];
        }
        var poster = fixPoster(rec.featured_image || rec.poster) || PLACEHOLDER;
        return mkItem({
            title: cleanTitle(rec.title),
            url: detailUrl(ct, rec.record_id),
            posterUrl: poster,
            bannerUrl: poster,
            type: info.type,
            year: parseYear(rec),
            description: rec.excerpt ? stripTags(rec.excerpt) : undefined
        });
    }

    // Movies: `links` is a block of lines:
    //   https://worker.dev/?vcloud=..., Link2, ..., Title 480p ..., 630MB
    function parseMovieLinks(linksField) {
        var out = [];
        String(linksField || '').split(/\r?\n/).forEach(function (line) {
            var m = line.match(/https?:\/\/[^\s,]+/);
            if (!m) return;
            out.push({
                workerUrl: m[0],
                quality: qualityFromText(line) || 'auto',
                size: sizeFromText(line),
                lang: langFromText(line)
            });
        });
        return out;
    }

    // Series/Anime: `season_N` fields hold lines like:
    //   Episode 1 : https://worker/?vcloud=...,,480p : https://worker/?vcloud=...,,720p
    function parseSeasonEpisodes(seasonText) {
        var out = [];
        decodeEntities(String(seasonText || '')).split(/\r?\n/).forEach(function (line) {
            var m = line.match(/episode\s*(\d+)\s*[:\-]?\s*(.*)/i);
            if (!m) return;
            var num = parseInt(m[1], 10);
            var rest = m[2] || '';
            var variants = [];

            var re = /(https?:\/\/[^\s,]+?)\s*,\s*,?\s*([^:]*?)(?=\s*:|$)/g;
            var hit;
            while ((hit = re.exec(rest)) !== null) {
                var label = hit[2].trim();
                variants.push({ url: hit[1], quality: qualityFromText(label) || label || 'auto' });
            }
            if (!variants.length) {
                // fallback: bare urls, no quality labels
                var bare = rest.match(/https?:\/\/[^\s,]+/g) || [];
                bare.forEach(function (u) { variants.push({ url: u, quality: 'auto' }); });
            }
            if (variants.length) out.push({ num: num, variants: variants });
        });
        return out;
    }

    // `season_zip` fields hold whole-season batch packs (one line per season):
    //   Season 1 : https://worker/?vcloud=...,Title [770MB],480p : https://worker/...,...,720p
    function parseSeasonZips(zipField) {
        var out = [];
        decodeEntities(String(zipField || '')).split(/\r?\n/).forEach(function (line) {
            var sm = line.match(/season\s*(\d+)/i);
            var season = sm ? parseInt(sm[1], 10) : 1;
            var re = /https?:\/\/[^\s,]+/g;
            var hits = [];
            var m;
            while ((m = re.exec(line)) !== null) hits.push({ url: m[0], start: m.index });
            for (var i = 0; i < hits.length; i++) {
                var seg = line.slice(hits[i].start, i + 1 < hits.length ? hits[i + 1].start : line.length);
                out.push({
                    season: season,
                    workerUrl: hits[i].url,
                    quality: qualityFromText(seg) || 'pack',
                    size: sizeFromText(seg),
                    lang: langFromText(seg)
                });
            }
        });
        return out;
    }

    // Worker resolution:
    //   {workerBase}/api/links?vcloud={enc} -> { title, size, tokens: { fsl: {ts, sig}, ... } }
    // Streams are returned as signed /go URLs; the player follows the 302 to the
    // direct file (R2 / PixelDrain). Never http_get the /go URL itself — that
    // would download the whole movie through the plugin sandbox.
    async function resolveWorker(workerUrl, quality, size, allowFallbackServers, lang) {
        var ctx = await fetchWorkerTokens(workerUrl);
        if (!ctx) return [];
        var tokens = (ctx.data && ctx.data.tokens) || {};

        var out = [];
        var keys = Object.keys(tokens);
        if (!allowFallbackServers) {
            keys = keys.filter(function (t) { return SKIP_SERVERS.indexOf(t) < 0; });
        }
        // deterministic, most-reliable-server-first ordering
        keys.sort(function (a, b) {
            var ia = SERVER_PREFERENCE.indexOf(a); var ib = SERVER_PREFERENCE.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        for (var k = 0; k < keys.length; k++) {
            var tk = tokens[keys[k]] || {};
            if (!tk.ts || !tk.sig) continue;
            var st = buildGoStream(ctx, keys[k], tk, quality, size, lang);
            if (keys[k] === 'pixel') {
                var direct = await pixeldrainDirect(st.url);
                if (!direct) continue;
                st.url = direct;
            }
            out.push(st);
        }
        return out;
    }

    // The worker's "pixel" /go redirects to pixeldrain.*/u/<id> — an HTML page.
    // Follow it (1-byte range, so a direct file is never downloaded) and turn it
    // into the direct file URL /api/file/<id>.
    async function pixeldrainDirect(goUrl) {
        try {
            var r = await Promise.race([
                http_get(goUrl, { 'User-Agent': UA, 'Range': 'bytes=0-0' }),
                sleep(8000).then(function () { return null; })
            ]);
            var fin = String((r && (r.finalUrl || r.url)) || '');
            var m = fin.match(/^https?:\/\/(pixeldrain\.[a-z]+)\/(?:u|api\/file)\/([A-Za-z0-9]+)/);
            return m ? 'https://' + m[1] + '/api/file/' + m[2] : null;
        } catch (_) { return null; }
    }

    // Bulk mode: one link per file — try the most reliable server first, fall
    // back to the next. Keeps "All Episodes" fast (1 request per episode).
    async function resolveWorkerSingle(workerUrl, quality, labelPrefix, lang) {
        var ctx;
        try {
            ctx = await fetchWorkerTokens(workerUrl);
        } catch (_) {
            return null;
        }
        if (!ctx) return null;
        var tokens = (ctx.data && ctx.data.tokens) || {};

        var keys = Object.keys(tokens).filter(function (t) { return SKIP_SERVERS.indexOf(t) < 0; });
        keys.sort(function (a, b) {
            var ia = SERVER_PREFERENCE.indexOf(a); var ib = SERVER_PREFERENCE.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        for (var i = 0; i < keys.length; i++) {
            var tk = tokens[keys[i]] || {};
            if (!tk.ts || !tk.sig) continue;
            var s = buildGoStream(ctx, keys[i], tk, quality, '', lang);
            if (labelPrefix) s.source = labelPrefix + ' • ' + s.source;
            s.quality = s.source;
            return s;
        }
        return null;
    }

    // Resolve one target with one retry; never throws. Dead links (confirmed by
    // the worker) are dropped immediately without pointless retries.
    async function resolveTargetSafe(target) {
        var tries = 0;
        while (tries < 2) {
            tries++;
            try {
                var got = await resolveWorker(target.workerUrl, target.quality, target.size, false, target.lang);
                if (got.length) return got;
            } catch (e) {
                if (e && e.dead) return []; // confirmed dead — stop retrying
            }
            if (tries < 2) await sleep(350);
        }
        // last resort: allow the ad-walled/page hosts so *something* is listed
        try {
            return await resolveWorker(target.workerUrl, target.quality, target.size, true, target.lang);
        } catch (_) { /* fall through */ }
        // generic extractor fallback for non-worker hosts
        if (typeof loadExtractor === 'function' && target.workerUrl.indexOf('workers.dev') < 0) {
            try {
                var ex = await loadExtractor(target.workerUrl);
                if (ex && ex.length) {
                    var got2 = [];
                    for (var x = 0; x < ex.length; x++) {
                        if (ex[x] && ex[x].url) {
                            ex[x].quality = (ex[x].quality || target.quality || 'Link');
                            got2.push(ex[x]);
                        }
                    }
                    return got2;
                }
            } catch (_) { /* extractor not available for this host */ }
        }
        return [];
    }

    // Small concurrency pool so we don't burst the worker with parallel calls
    // (bursting triggers rate limits -> "no streams found").
    async function resolveAllTargets(targets) {
        var results = new Array(targets.length);
        var cursor = 0;
        var POOL = Math.min(2, targets.length);
        async function runner() {
            while (cursor < targets.length) {
                var idx = cursor++;
                results[idx] = await resolveTargetSafe(targets[idx]);
            }
        }
        var workers = [];
        for (var i = 0; i < POOL; i++) workers.push(runner());
        await Promise.all(workers);
        return results;
    }

    // ─────────────────────────── getHome ───────────────────────────

    async function fetchList(path, offset, limit) {
        var d = await getJson(API + '/api/' + path + '?offset=' + offset + '&limit=' + limit);
        return (d && Array.isArray(d.data)) ? d.data : (Array.isArray(d) ? d : []);
    }

    async function getHome(cb) {
        try {
            var tasks = [];
            var names = [];

            names.push('Trending');
            tasks.push((async function () {
                var d = await getJson(API + '/api/trending-paginated?offset=0&limit=20');
                var items = (d && Array.isArray(d.data)) ? d.data : [];
                return items.map(function (r) { return toItem(r); }).filter(Boolean);
            })());

            names.push('Latest Uploads');
            tasks.push((async function () {
                var d = await getJson(API + '/api/recent');
                var items = Array.isArray(d) ? d : (d && d.data) || [];
                return items.slice(0, 18).map(function (r) { return toItem(r); }).filter(Boolean);
            })());

            HOME_ROWS.forEach(function (row) {
                names.push(row.name);
                tasks.push((async function () {
                    if (row.ct === 'series') {
                        // one wide fetch feeds BOTH the Hollywood Series row and the K-Drama row
                        var wide = await fetchList(COLLECTIONS.series.path, 0, 100);
                        var western = [], kdrama = [];
                        for (var i = 0; i < wide.length; i++) {
                            var rec = wide[i];
                            if (/korean|k-drama/i.test(String(rec.categories || ''))) {
                                if (kdrama.length < 18) kdrama.push(toItem(rec, 'series'));
                            } else if (western.length < 18) {
                                western.push(toItem(rec, 'series'));
                            }
                        }
                        row._kdrama = kdrama.filter(Boolean);
                        return western.filter(Boolean);
                    }
                    return (await fetchList(COLLECTIONS[row.ct].path, 0, 18))
                        .map(function (r) { return toItem(r, row.ct); }).filter(Boolean);
                })());
            });

            var settled = await Promise.all(tasks.map(function (p) {
                return p.then(
                    function (v) { return v; },
                    function (e) { console.error('Row failed:', e && e.message); return null; }
                );
            }));

            var data = {};
            for (var i = 0; i < names.length; i++) {
                if (settled[i] && settled[i].length) data[names[i]] = settled[i];
                // insert the K-Drama row right after Hollywood Series
                if (names[i] === 'Hollywood Series') {
                    var kd = HOME_ROWS[1]._kdrama;
                    if (kd && kd.length) data['K-Drama'] = kd;
                }
            }

            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'HiCine API returned no content (' + API + ')' });
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
            // HiCine's search is a plain substring match on the title: "spider man" finds nothing,
            // "spider-man" finds 16. Try the query as typed, then spelling variants and single words,
            // keeping only titles that contain every word of the query.
            var norm = function (t) { return String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ''); };
            var words = q.toLowerCase().split(/[^a-z0-9]+/i).filter(function (w) { return w.length > 1; });
            var fetchQ = function (t) {
                return getJson(API + '/api/search/' + encodeURIComponent(t)).then(function (d) {
                    return (d && Array.isArray(d.data)) ? d.data : (Array.isArray(d) ? d : []);
                }).catch(function () { return []; });
            };
            var items = await fetchQ(q);
            if (items.length < 3 && words.length > 1) {
                var variants = [words.join('-'), words.join(' ')];
                words.slice().sort(function (a, b) { return b.length - a.length; }).slice(0, 2).forEach(function (w) {
                    if (w.length > 2) variants.push(w);
                });
                var extra = await Promise.all(variants.filter(function (v, i, a) { return v !== q && a.indexOf(v) === i; }).map(fetchQ));
                extra.forEach(function (list) {
                    list.forEach(function (rec) {
                        var t = norm(rec && (rec.title || rec.name));
                        if (words.every(function (w) { return t.indexOf(norm(w)) >= 0; })) items.push(rec);
                    });
                });
            }

            var results = [];
            var seen = {};
            for (var i = 0; i < items.length; i++) {
                var rec = items[i];
                if (!rec) continue;
                var it = toItem(rec);
                if (!it) continue;
                // same title is often filed under both Bollywood & Hollywood — dedupe
                var key = String(it.title).toLowerCase() + '|' + (it.year || '');
                if (seen[key]) continue;
                seen[key] = 1;
                results.push(it);
            }

            // Empty result is NOT an error — let the app render "no results" calmly
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // HiCine's API has no plot for most titles. Its poster file names are TMDB
    // poster paths, so look the title up on TMDB and match on that (or year).
    var TMDB_KEY = 'e716f19ab4d25edc5247239a8f3494f8';
    async function tmdbInfo(title, year, type, posterUrl) {
        try {
            var kind = type === 'movie' ? 'movie' : 'tv';
            var q = String(title || '').replace(/\s*\(\d{4}\)\s*$/, '').replace(/:\s*(\d+)$/, ' $1').trim();
            if (!q) return null;
            var res = await http_get('https://api.themoviedb.org/3/search/' + kind + '?api_key=' + TMDB_KEY
                + '&query=' + encodeURIComponent(q), { 'User-Agent': UA, 'Accept': 'application/json' });
            var list = (JSON.parse((res && res.body) || '{}').results) || [];
            if (!list.length) return null;
            var key = (String(posterUrl || '').match(/\/([A-Za-z0-9]{20,})\.(?:webp|jpe?g|png)/) || [])[1];
            var hit = null;
            if (key) hit = list.filter(function (r) { return String(r.poster_path || '').indexOf(key) >= 0; })[0];
            if (!hit && year) hit = list.filter(function (r) {
                return String(r.release_date || r.first_air_date || '').slice(0, 4) === String(year);
            })[0];
            if (!hit) return null;
            return {
                overview: hit.overview || '',
                score: typeof hit.vote_average === 'number' && hit.vote_average > 0 ? Math.round(hit.vote_average * 10) / 10 : undefined,
                backdrop: hit.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + hit.backdrop_path : undefined
            };
        } catch (_) { return null; }
    }

    // ─────────────────────────── load ───────────────────────────

    async function load(url, cb) {
        try {
            var p = parseItemUrl(url);
            if (!p) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized HiCine URL: ' + url });

            var det = await getJson(detailUrl(p.ct, p.id));
            if (!det || det.error) {
                return cb({ success: false, errorCode: 'NOT_FOUND', message: (det && det.error) || 'Item not found' });
            }

            var info = COLLECTIONS[p.ct];
            var description = stripTags(det.content || det.excerpt || '');
            var cats = String(det.categories || '').split(',').map(function (s) { return s.trim(); })
                .filter(function (c) { return c && !/^(\d{3,4}p|\d{4}|featured)$/i.test(c); });
            var tm = null;
            if (!description) {
                tm = await tmdbInfo(cleanTitle(det.title), parseYear(det), info.type, det.featured_image || det.poster);
                if (tm && tm.overview) description = tm.overview;
            }
            if (cats.length) description = (description ? description + '\n\n' : '') + cats.join(' • ');

            var item = {
                title: cleanTitle(det.title),
                url: detailUrl(p.ct, p.id),
                posterUrl: fixPoster(det.featured_image || det.poster) || PLACEHOLDER,
                type: info.type,
                year: parseYear(det),
                description: description || undefined,
                isAdult: false
            };
            item.bannerUrl = (tm && tm.backdrop) || item.posterUrl;
            if (tm && tm.score) item.score = tm.score;

            // Series / anime — build the episode list from season_1..season_N
            var poster = item.posterUrl;
            var episodes = [];
            var s;
            for (s = 1; s <= MAX_SEASONS; s++) {
                var txt = det['season_' + s];
                if (!txt) continue;
                var eps = parseSeasonEpisodes(txt);
                var seasonZips = parseSeasonZips(det['season_zip']).filter(function (z) {
                    return z.season === s;
                });

                for (var i = 0; i < eps.length; i++) {
                    episodes.push(mkEpisode({
                        name: 'Episode ' + eps[i].num,
                        url: episodeUrl(p.ct, p.id, s, eps[i].num),
                        season: s,
                        episode: eps[i].num,
                        posterUrl: poster,
                        dubStatus: 'none',
                        playbackPolicy: 'none'
                    }));
                }

                // Extra pseudo-episodes at the end of the season (bulk downloads)
                if (eps.length) {
                    // every single episode's link in one place — one server per episode
                    episodes.push(mkEpisode({
                        name: '📦 All Episodes — Download Links',
                        url: episodeUrl(p.ct, p.id, s, ALL_EPISODE_NUMBER),
                        season: s,
                        episode: ALL_EPISODE_NUMBER,
                        posterUrl: poster,
                        dubStatus: 'none',
                        playbackPolicy: 'none'
                    }));
                }
                if (seasonZips.length) {
                    // whole-season zip pack(s) — verify the pack is still alive on the
                    // worker before advertising it (dead packs are common)
                    var packAlive = false;
                    try {
                        var packCtx = await fetchWorkerTokens(seasonZips[0].workerUrl);
                        packAlive = !!packCtx;
                    } catch (e) {
                        packAlive = !(e && e.dead); // network hiccup -> keep the pack; confirmed dead -> drop
                    }
                    if (packAlive) {
                        episodes.push(mkEpisode({
                            name: '📦 Season ' + s + ' Complete Pack (ZIP)',
                            url: episodeUrl(p.ct, p.id, s, ZIP_EPISODE_NUMBER),
                            season: s,
                            episode: ZIP_EPISODE_NUMBER,
                            posterUrl: poster,
                            dubStatus: 'none',
                            playbackPolicy: 'none'
                        }));
                    }
                }
            }

            if (!episodes.length) {
                // No season data at all — movie-style `links`? then treat as a movie
                if (parseMovieLinks(det.links).length) {
                    item.type = 'movie';
                } else {
                    // Genuinely nothing uploaded yet — return the info page calmly
                    // instead of throwing an exception in the user's face.
                    item.episodes = [];
                    item.description = (item.description ? item.description + '\n\n' : '')
                        + '⚠ Links for this title have not been uploaded on HiCine yet — check back later.';
                    return cb({ success: true, data: mkItem(item) });
                }
            }

            // Movies (and movie-like items) get a single pseudo-episode —
            // SkyStream's play button is episode-driven and stays disabled without one.
            if (item.type === 'movie') {
                episodes = [mkEpisode({
                    name: cleanTitle(det.title),
                    url: detailUrl(p.ct, p.id),
                    season: 1,
                    episode: 1,
                    posterUrl: poster,
                    dubStatus: 'none',
                    playbackPolicy: 'none'
                })];
            }

            // Episodes MUST live inside the MultimediaItem (data.episodes)
            item.episodes = episodes;
            cb({ success: true, data: mkItem(item) });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── loadStreams ───────────────────────────

    async function loadStreams(url, cb) {
        try {
            var p = parseItemUrl(url);
            if (!p) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized HiCine URL: ' + url });

            var det = await getJson(detailUrl(p.ct, p.id));
            if (!det || det.error) {
                return cb({ success: false, errorCode: 'NOT_FOUND', message: (det && det.error) || 'Item not found' });
            }

            // Collect every (workerUrl, quality, lang) target for this movie / episode
            var targets = [];
            var bulkMode = false;
            if (p.season != null && p.ep != null) {
                var seasonText = det['season_' + p.season] || '';
                var eps = parseSeasonEpisodes(seasonText);
                // season header (first line) carries the audio language, e.g.
                // "Reacher Season 1 Amazon Dual Audio {Hindi-English} Series ..."
                var seasonLang = langFromText(String(seasonText).split(/\r?\n/)[0] || '');

                if (p.ep === ZIP_EPISODE_NUMBER) {
                    // whole-season complete pack (zip download)
                    parseSeasonZips(det['season_zip']).filter(function (z) {
                        return z.season === p.season;
                    }).forEach(function (z) {
                        targets.push({
                            workerUrl: z.workerUrl,
                            quality: (z.quality !== 'pack' ? z.quality : 'Pack'),
                            size: z.size,
                            lang: z.lang
                        });
                    });
                } else if (p.ep === ALL_EPISODE_NUMBER) {
                    // every single episode of the season, best quality, one server each
                    bulkMode = true;
                    var capped = eps.slice(0, BULK_EPISODE_CAP);
                    capped.forEach(function (e) {
                        var best = pickBestVariant(e.variants);
                        targets.push({
                            workerUrl: best.url,
                            quality: best.quality === 'auto' ? '' : best.quality,
                            lang: seasonLang,
                            bulkLabel: 'E' + e.num
                        });
                    });
                } else {
                    var ep = null;
                    for (var i = 0; i < eps.length; i++) if (eps[i].num === p.ep) ep = eps[i];
                    if (!ep) {
                        return cb({ success: false, errorCode: 'NOT_FOUND',
                                    message: 'Episode ' + p.ep + ' not found in season ' + p.season });
                    }
                    ep.variants.forEach(function (v) {
                        targets.push({ workerUrl: v.url, quality: v.quality, size: '', lang: seasonLang });
                    });
                }
            } else {
                parseMovieLinks(det.links).forEach(function (l) {
                    targets.push({ workerUrl: l.workerUrl, quality: l.quality, size: l.size, lang: l.lang });
                });
            }

            if (!targets.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS',
                            message: 'No download links uploaded for this title yet — check back later.' });
            }

            // Hindi (and Hindi dual-audio) first — it becomes the default server
            targets = sortTargetsByPreference(targets);

            var streams = [];
            if (bulkMode) {
                // "All Episodes": one server per episode; keep results INDEXED so the
                // episode order stays E1, E2, E3… regardless of network completion order
                var bulkResults = new Array(targets.length);
                var cursor = 0;
                async function bulkRunner() {
                    while (cursor < targets.length) {
                        var idx = cursor++;
                        var t = targets[idx];
                        try {
                            bulkResults[idx] = await resolveWorkerSingle(t.workerUrl, t.quality, t.bulkLabel, t.lang);
                        } catch (_) {
                            bulkResults[idx] = null;
                        }
                    }
                }
                var pool = [];
                for (var w = 0; w < Math.min(3, targets.length); w++) pool.push(bulkRunner());
                await Promise.all(pool);
                bulkResults.forEach(function (s3) { if (s3) streams.push(s3); });
            } else {
                var batches = await resolveAllTargets(targets);
                batches.forEach(function (batch) {
                    for (var b = 0; b < batch.length; b++) streams.push(batch[b]);
                });
            }

            // De-duplicate identical signed URLs
            var seen = {};
            var unique = [];
            streams.forEach(function (s2) {
                if (!seen[s2.url]) { seen[s2.url] = 1; unique.push(s2); }
            });

            if (!unique.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS',
                            message: 'HiCine servers did not respond (links may be dead or rate-limited) — please retry.' });
            }
            cb({ success: true, data: unique });
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
