/*
 * DesiDubAnime — SkyStream plugin
 * Site:   https://www.desidubanime.me   (WordPress + "Kiranime Pro" theme)
 * Source: Hindi / Tamil / Telugu / multi-audio dubbed anime series and movies
 *
 * Flow:
 *   catalog : WP REST  /wp-json/wp/v2/anime  (filters: anime_status, anime_type, tags,
 *             anime_attribute, genre; posters through _embed=wp:featuredmedia)
 *   search  : /wp-json/kiranime/v1/anime/search?query=  (matches English + Japanese titles)
 *             merged with WP REST ?search=
 *   load    : REST ?slug= (title, poster, taxonomies) + /anime/<slug>/ (JSON-LD, info block).
 *             The anime page only shows ~10 episodes; any /watch/ page carries the full
 *             episode list (.episode-list-item with number + title), so one watch page is read.
 *   streams : watch page servers  <span data-embed-id="b64(name):b64(url)">
 *             - Streamp2p  (desidubanime.p2pplay.pro/#id): /api/v1/video -> hex, AES-128-CBC
 *               (key "kiemtienmua911ca", iv "1234567890oiuytr") -> JSON with cfNative /
 *               source HLS + English VTT.  hlsVideoTiktok is skipped (PNG-wrapped segments).
 *             - VMoly      (vidmoly.org/.net/.biz embed): plain JW Player setup, master.m3u8
 *               (multi-audio) + English VTT.
 *             - Mirrordub (filesforever, encrypted multi-host) and Abyss are not supported.
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


    var SITE = (typeof manifest !== 'undefined' && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, '')
        : 'https://www.desidubanime.me';
    var HOST = SITE.replace(/^https?:\/\//i, '');
    var API = SITE + '/wp-json';

    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    var P2P_KEY = 'kiemtienmua911ca';
    var P2P_IV = '1234567890oiuytr';

    var LIST_FIELDS = '_embed=wp:featuredmedia&_fields=id,slug,link,title,excerpt,class_list,anime_type,_links,_embedded';

    // Taxonomy ids of desidubanime.me (anime_status 3 = airing, anime_type 77 = movie,
    // anime_attribute 82 = Hindi DUB / 81 = Multi Audio, tags 78 = Tamil / 79 = Telugu).
    var ROWS = [
        { name: 'Trending',          q: 'anime_status=3&orderby=modified' },
        { name: 'Latest Updated',    q: 'orderby=modified' },
        { name: 'Newly Added',       q: 'orderby=date' },
        { name: 'Anime Movies',      q: 'anime_type=77&orderby=modified' },
        { name: 'Hindi Dubbed',      q: 'anime_attribute=82&orderby=modified' },
        { name: 'Multi Audio',       q: 'anime_attribute=81&orderby=modified' },
        { name: 'Tamil',             q: 'tags=78&orderby=modified' },
        { name: 'Telugu',            q: 'tags=79&orderby=modified' },
        { name: 'Action',            q: 'genre=18&orderby=modified' },
        { name: 'Fantasy',           q: 'genre=20&orderby=modified' },
        { name: 'Isekai',            q: 'genre=283&orderby=modified' },
        { name: 'Comedy',            q: 'genre=42&orderby=modified' },
        { name: 'Romance',           q: 'genre=43&orderby=modified' }
    ];

    var LANG_LABEL = {
        hindi: 'Hindi', tamil: 'Tamil', telugu: 'Telugu', english: 'English', japanese: 'Japanese',
        malayalam: 'Malayalam', kannada: 'Kannada', bengali: 'Bengali', chinese: 'Chinese', korean: 'Korean'
    };
    var SUB_LANG = { en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ja: 'Japanese', es: 'Spanish', ar: 'Arabic' };

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
        return decodeEntities(String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    }

    function originOf(u) {
        var m = String(u || '').match(/^(https?:\/\/[^\/?#]+)/i);
        return m ? m[1] : SITE;
    }

    function absUrl(u, base) {
        u = String(u || '');
        if (/^https?:\/\//i.test(u)) return u;
        if (u.indexOf('//') === 0) return 'https:' + u;
        return originOf(base) + (u.charAt(0) === '/' ? '' : '/') + u;
    }

    async function get(url, referer, extra) {
        var h = {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
            'Referer': referer || SITE + '/'
        };
        if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        var res = await http_get(url, h);
        if (!res || typeof res !== 'object') res = { status: 200, body: String(res || '') };
        return { status: Number(res.status || res.statusCode || 0), body: String(res.body || ''), finalUrl: res.finalUrl || url };
    }

    async function getJson(url) {
        var r = await get(url, SITE + '/', { 'Accept': 'application/json' });
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        return JSON.parse(r.body);
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }

    function safeAtob(s) {
        try {
            var bin = atob(String(s || '').replace(/\s+/g, ''));
            try { return decodeURIComponent(escape(bin)); } catch (_) { return bin; }
        } catch (_) { return ''; }
    }

    function hexToB64(hex) {
        var bin = '';
        for (var i = 0; i + 1 < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        return btoa(bin);
    }

    function mkItem(o)    { try { return new MultimediaItem(o); } catch (_) { return o; } }
    function mkEpisode(o) { try { return new Episode(o); }        catch (_) { return o; } }
    function mkStream(o) {
        var s;
        try {
            s = new StreamResult({ url: o.url, source: o.source, headers: o.headers, subtitles: o.subtitles });
            s.quality = o.quality;
        } catch (_) { s = o; }
        if (!o.subtitles || !o.subtitles.length) { try { delete s.subtitles; } catch (_) {} }
        return s;
    }

    function classList(a) {
        var c = a && a.class_list;
        if (Array.isArray(c)) return c.join(' ');
        if (c && typeof c === 'object') return Object.keys(c).map(function (k) { return c[k]; }).join(' ');
        return String(c || '');
    }

    function langsFromClasses(cls) {
        var out = [], re = /\btag-([a-z]+)\b/g, m;
        while ((m = re.exec(cls))) if (LANG_LABEL[m[1]] && out.indexOf(LANG_LABEL[m[1]]) < 0) out.push(LANG_LABEL[m[1]]);
        return out;
    }

    function posterOf(a) {
        try {
            var fm = a._embedded['wp:featuredmedia'][0];
            if (fm && fm.source_url) return fm.source_url;
            var sz = fm.media_details.sizes;
            return (sz.large || sz.medium_large || sz.medium || sz.full).source_url;
        } catch (_) { return ''; }
    }

    function isMovieCls(cls, a) {
        return /\btype-movie\b/.test(cls) || !!(a && a.anime_type && a.anime_type.indexOf && a.anime_type.indexOf(77) >= 0);
    }

    function fromRest(a) {
        var cls = classList(a);
        var title = decodeEntities((a.title && a.title.rendered) || a.slug || 'Untitled');
        var langs = langsFromClasses(cls);
        var desc = stripTags(a.excerpt && a.excerpt.rendered);
        if (langs.length) desc = (desc ? desc + '\n\n' : '') + 'Audio: ' + langs.join(', ');
        return mkItem({
            title: title,
            url: a.link,
            posterUrl: posterOf(a),
            type: isMovieCls(cls, a) ? 'movie' : 'anime',
            description: desc
        });
    }

    async function restList(query, perPage, page) {
        var url = API + '/wp/v2/anime?per_page=' + (perPage || 24) + '&page=' + (page || 1) + '&' + query + '&' + LIST_FIELDS;
        var arr = await getJson(url);
        if (!Array.isArray(arr)) return [];
        return arr.filter(function (a) { return a && a.link; }).map(fromRest);
    }

    // ───────────────────────── catalog ─────────────────────────

    async function getHome(cb) {
        try {
            var lists = await Promise.all(ROWS.map(function (row) {
                return withTimeout(restList(row.q, 24, 1), 14000).catch(function () { return []; });
            }));
            var data = {};
            ROWS.forEach(function (row, i) { if (lists[i] && lists[i].length) data[row.name] = lists[i]; });
            if (!Object.keys(data).length) return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'DesiDubAnime returned no content (' + SITE + ')' });
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String((e && e.message) || e) });
        }
    }

    function parseKiraSearch(html) {
        var out = [], re = /<a\s+href="([^"]*\/anime\/[^"\/]+\/?)"[^>]*>([\s\S]*?)<\/a>/g, m;
        while ((m = re.exec(html))) {
            var body = m[2];
            var img = body.match(/<img[^>]+src=['"]([^'"]+)['"]/);
            var t = body.match(/<span[^>]*line-clamp[^>]*>([\s\S]*?)<\/span>/) || body.match(/alt=['"]([^'"]+)['"]/);
            var type = (body.match(/<span class="uppercase">\s*([^<]+?)\s*<\/span>/) || [])[1] || '';
            var title = t ? stripTags(t[1]).replace(/\s+poster$/i, '') : '';
            if (!title) continue;
            out.push(mkItem({
                title: title,
                url: absUrl(decodeEntities(m[1]), SITE),
                posterUrl: img ? img[1] : '',
                type: /movie/i.test(type) ? 'movie' : 'anime'
            }));
        }
        return out;
    }

    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var enc = encodeURIComponent(q);
            var res = await Promise.all([
                getJson(API + '/kiranime/v1/anime/search?query=' + enc)
                    .then(function (j) { return parseKiraSearch(String((j && j.result) || '')); })
                    .catch(function () { return []; }),
                restList('search=' + enc, 30, 1).catch(function () { return []; })
            ]);
            var byUrl = {}, out = [];
            res[1].forEach(function (it) { byUrl[it.url] = it; });
            res[0].forEach(function (it) {
                var r = byUrl[it.url];
                if (r) { if (!r.posterUrl) r.posterUrl = it.posterUrl; out.push(r); delete byUrl[it.url]; }
                else out.push(it);
            });
            res[1].forEach(function (it) { if (byUrl[it.url]) out.push(it); });
            var seen = {};
            out = out.filter(function (it) { if (seen[it.url]) return false; seen[it.url] = 1; return true; });
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: 'SEARCH_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────────────────────── details ─────────────────────────

    function watchLinks(html) {
        var out = [], seen = {}, re = /href="([^"]*\/watch\/[^"]+)"/g, m;
        while ((m = re.exec(html))) {
            var u = absUrl(decodeEntities(m[1]), SITE);
            if (!seen[u]) { seen[u] = 1; out.push(u); }
        }
        return out;
    }

    function epNumFromUrl(u) {
        var m = String(u).match(/-episode-(\d+)(?:[-\/]|$)/i);
        return m ? parseInt(m[1], 10) : 0;
    }

    function parseEpisodeList(html) {
        var out = [], seen = {}, re = /<a\b([^>]*\bepisode-list-item\b[^>]*)>([\s\S]*?)<\/a>/g, m;
        while ((m = re.exec(html))) {
            var attrs = m[1], body = m[2];
            var href = (attrs.match(/href="([^"]+)"/) || [])[1];
            if (!href || !/\/watch\//.test(href)) continue;
            href = absUrl(decodeEntities(href), SITE);
            if (seen[href]) continue;
            seen[href] = 1;
            var numTxt = (attrs.match(/data-episode-search-query="([^"]*)"/) || [])[1] ||
                stripTags((body.match(/episode-list-item-number[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
            var num = parseFloat(numTxt);
            var title = stripTags((body.match(/episode-list-item-title[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
            out.push({ url: href, num: isFinite(num) ? num : epNumFromUrl(href), title: title });
        }
        return out;
    }

    function parseCards(html, selfUrl) {
        var out = [], seen = {}, re = /<article\b[^>]*anime-card[^>]*>([\s\S]*?)<\/article>/g, m;
        while ((m = re.exec(html))) {
            var body = m[1];
            var a = body.match(/<a\s+href="([^"]*\/anime\/[^"]+)"[^>]*?title="([^"]*)"/) || body.match(/<a\s+href="([^"]*\/(?:anime|watch)\/[^"]+)"[^>]*?title="([^"]*)"/);
            if (!a) continue;
            var u = absUrl(decodeEntities(a[1]), SITE);
            if (u === selfUrl || seen[u]) continue;
            seen[u] = 1;
            var img = body.match(/<img[^>]+src=['"]([^'"]+)['"]/);
            out.push(mkItem({ title: decodeEntities(a[2]), url: u, posterUrl: img ? img[1] : '', type: 'anime' }));
        }
        return out;
    }

    function parseLdJson(html) {
        var re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, m;
        while ((m = re.exec(html))) {
            try {
                var j = JSON.parse(m[1].trim());
                var arr = Array.isArray(j) ? j : (j['@graph'] || [j]);
                for (var i = 0; i < arr.length; i++) {
                    var t = String(arr[i]['@type'] || '');
                    if (/Movie|TVSeries|CreativeWork|Series/i.test(t) && arr[i].name) return arr[i];
                }
            } catch (_) {}
        }
        return null;
    }

    async function load(url, cb) {
        try {
            var u = String(url || '').trim();
            var watchHtml = '';
            if (/\/watch\//.test(u)) {
                var w = await get(u);
                watchHtml = w.body;
                // the watch page links many shows (sidebar); the episode's own one is in .anime-data
                var al = watchHtml.match(/class="anime-data"[^>]*>\s*<h\d[^>]*>\s*<a\s+href="([^"]*\/anime\/[^"\/]+\/?)"/);
                if (!al) {
                    var aid = (watchHtml.match(/\banime_id\s*=\s*(\d+)/) || [])[1];
                    if (aid) {
                        try { var ar = await getJson(API + '/wp/v2/anime/' + aid + '?_fields=link'); if (ar && ar.link) al = [0, ar.link]; } catch (_) {}
                    }
                }
                if (!al) al = watchHtml.match(/href="([^"]*\/anime\/[^"\/]+\/)"/);
                if (al) u = absUrl(decodeEntities(al[1]), SITE);
            }
            var slug = (u.match(/\/anime\/([^\/?#]+)/) || [])[1];
            if (!slug) return cb({ success: false, errorCode: 'BAD_URL', message: 'Not a DesiDubAnime anime URL: ' + u });

            var both = await Promise.all([
                getJson(API + '/wp/v2/anime?slug=' + encodeURIComponent(slug) + '&_embed=wp:featuredmedia,wp:term').catch(function () { return []; }),
                get(u)
            ]);
            var rest = (Array.isArray(both[0]) && both[0][0]) || null;
            var page = both[1];
            if (page.status >= 400 && !rest) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'HTTP ' + page.status + ' for ' + u });
            var html = page.body;
            var text = stripTags(html);
            var ld = parseLdJson(html) || {};
            var cls = rest ? classList(rest) : '';

            // ---- episodes (full list lives on any watch page) ----
            var links = watchLinks(html);
            var eps = [];
            var postId = (rest && rest.id) || (html.match(/postId:\s*'(\d+)'/) || [])[1] || '';
            var recJob = postId
                ? withTimeout(getJson(API + '/kiranime/v1/widget?name=recommended&id=' + postId + '&post_type=anime&display=grid'), 9000)
                    .then(function (j) { return parseCards(String((j && j.result) || ''), u); }).catch(function () { return []; })
                : Promise.resolve([]);
            if (!watchHtml && links.length) {
                var pick = links.filter(function (l) { return epNumFromUrl(l) === 1; })[0] || links[0];
                try { watchHtml = (await get(pick, u)).body; } catch (_) { watchHtml = ''; }
            }
            var recs = await recJob;
            if (watchHtml) eps = parseEpisodeList(watchHtml);
            if (!eps.length) eps = links.map(function (l) { return { url: l, num: epNumFromUrl(l), title: '' }; });
            eps.sort(function (a, b) { return a.num - b.num; });

            // ---- metadata ----
            var title = decodeEntities((rest && rest.title && rest.title.rendered) || ld.name ||
                (html.match(/<h2[^>]*>([^<]+)<\/h2>/) || [])[1] || slug);
            var poster = (rest && posterOf(rest)) || ld.image || (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || '';
            var english = (text.match(/\bEnglish\s+([^,].{1,150}?)\s+Type\s+[A-Z]/) || [])[1] || '';
            var synopsis = stripTags((rest && rest.content && rest.content.rendered) || '') || decodeEntities(ld.description || '');
            var langs = langsFromClasses(cls);
            if (!langs.length) {
                var tg = (text.match(/\bTags\s+((?:[A-Za-z]+\s*,\s*)*[A-Za-z]+)/) || [])[1] || '';
                tg.split(/\s*,\s*/).forEach(function (l) { if (LANG_LABEL[l.toLowerCase()]) langs.push(LANG_LABEL[l.toLowerCase()]); });
            }
            var extraLines = [];
            if (english && english !== 'N/A' && english.toLowerCase() !== title.toLowerCase()) extraLines.push('English title: ' + english);
            if (langs.length) extraLines.push('Audio: ' + langs.join(', '));
            var description = [synopsis, extraLines.join('\n')].filter(Boolean).join('\n\n');

            var genres = [];
            try {
                (rest._embedded['wp:term'] || []).forEach(function (grp) {
                    (grp || []).forEach(function (t) { if (t.taxonomy === 'genre') genres.push(decodeEntities(t.name)); });
                });
            } catch (_) {}
            if (!genres.length && Array.isArray(ld.genre)) genres = ld.genre.map(String);

            var aired = text.match(/\bAired\s+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+)?((?:19|20)\d{2})/);
            var year = aired ? parseInt(aired[2], 10) : 0;
            if (!year && ld.datePublished) year = parseInt(String(ld.datePublished).slice(0, 4), 10) || 0;
            var score = 0;
            try { score = parseFloat(ld.aggregateRating.ratingValue) || 0; } catch (_) {}

            var status = /\bstatus-completed\b/.test(cls) ? 'completed'
                : /\bstatus-(?:upcoming|not-yet-released)\b/.test(cls) ? 'upcoming' : 'ongoing';
            if (!cls) status = /\bStatus\s+Completed\b|Finished Airing/i.test(text) ? 'completed' : 'ongoing';

            var movie = rest ? isMovieCls(cls, rest) : /"@type"\s*:\s*"Movie"|\bType\s+MOVIE\b/.test(html);
            var episodes = eps.map(function (e, i) {
                var n = (e.num && Math.floor(e.num) === e.num) ? e.num : i + 1;
                var nm = e.title && !/^episode\s*\d+$/i.test(e.title) ? e.title
                    : (movie && eps.length === 1 ? title : 'Episode ' + n);
                return mkEpisode({ name: nm, url: e.url, season: 1, episode: n, posterUrl: poster, dubStatus: 'dubbed' });
            });
            if (!episodes.length) {
                // nothing released yet — keep the app happy (movies need one entry); loadStreams explains.
                episodes = [mkEpisode({ name: movie ? title : 'Coming soon', url: u, season: 1, episode: 1, posterUrl: poster })];
            }

            var item = {
                title: title,
                url: u,
                posterUrl: poster,
                type: (movie && episodes.length === 1) ? 'movie' : 'anime',
                description: description,
                status: status,
                tags: genres,
                episodes: episodes,
                recommendations: recs.concat(parseCards(html, u)).slice(0, 24)
            };
            if (year) item.year = year;
            if (score) item.score = score;
            if (ld.image && ld.image !== poster) item.bannerUrl = ld.image;
            cb({ success: true, data: mkItem(item) });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ── pure-JS AES-CBC decrypt (fallback when the crypto bridge can't do AES-128) ──
    var __aesT = null;
    function aesTables() {
        if (__aesT) return __aesT;
        var sbox = [], inv = [], d = [], th = [], x, xi, x2, s, i;
        for (i = 0; i < 256; i++) th[(d[i] = i << 1 ^ (i >> 7) * 283) ^ i] = i;
        for (x = xi = 0; sbox[x] === undefined; x ^= x2 || 1, xi = th[xi] || 1) {
            s = xi ^ xi << 1 ^ xi << 2 ^ xi << 3 ^ xi << 4;
            s = s >> 8 ^ s & 255 ^ 99;
            sbox[x] = s; inv[s] = x;
            x2 = d[x];
        }
        __aesT = { sbox: sbox, inv: inv };
        return __aesT;
    }
    function gmul(a, b) {
        var p = 0;
        while (b) { if (b & 1) p ^= a; a = (a << 1) ^ (a & 128 ? 0x11b : 0); b >>= 1; }
        return p & 255;
    }
    function aesExpand(key) {
        var T = aesTables(), nk = key.length / 4, nr = nk + 6, w = key.slice(), rcon = 1, i, t;
        for (i = nk; i < 4 * (nr + 1); i++) {
            t = w.slice(4 * (i - 1), 4 * i);
            if (i % nk === 0) {
                t = [T.sbox[t[1]] ^ rcon, T.sbox[t[2]], T.sbox[t[3]], T.sbox[t[0]]];
                rcon = gmul(rcon, 2);
            } else if (nk > 6 && i % nk === 4) {
                t = t.map(function (b) { return T.sbox[b]; });
            }
            for (var j = 0; j < 4; j++) w.push(w[4 * (i - nk) + j] ^ t[j]);
        }
        return { w: w, nr: nr };
    }
    function aesDecryptBlock(b, ks) {
        var T = aesTables(), w = ks.w, nr = ks.nr, s = b.slice(), r, c, i, t;
        for (i = 0; i < 16; i++) s[i] ^= w[nr * 16 + i];
        for (r = nr - 1; r >= 0; r--) {
            t = s.slice();                                   // InvShiftRows + InvSubBytes
            for (c = 0; c < 4; c++) for (i = 0; i < 4; i++) s[c * 4 + i] = T.inv[t[((c - i + 4) % 4) * 4 + i]];
            for (i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; // AddRoundKey
            if (r > 0) {                                     // InvMixColumns
                for (c = 0; c < 4; c++) {
                    var a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
                    s[c * 4]     = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
                    s[c * 4 + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
                    s[c * 4 + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
                    s[c * 4 + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
                }
            }
        }
        return s;
    }
    function strBytes(str) { var o = []; for (var i = 0; i < str.length; i++) o.push(str.charCodeAt(i) & 255); return o; }
    function aesCbcDecryptHex(hex, keyStr, ivStr) {
        var data = [], i;
        for (i = 0; i + 1 < hex.length; i += 2) data.push(parseInt(hex.substr(i, 2), 16));
        var ks = aesExpand(strBytes(keyStr)), prev = strBytes(ivStr), out = [];
        for (i = 0; i + 16 <= data.length; i += 16) {
            var blk = data.slice(i, i + 16), dec = aesDecryptBlock(blk, ks);
            for (var j = 0; j < 16; j++) out.push(dec[j] ^ prev[j]);
            prev = blk;
        }
        var pad = out[out.length - 1];
        if (pad > 0 && pad <= 16) out = out.slice(0, out.length - pad);
        var bin = '';
        for (i = 0; i < out.length; i += 4096) bin += String.fromCharCode.apply(null, out.slice(i, i + 4096));
        try { return decodeURIComponent(escape(bin)); } catch (_) { return bin; }
    }

    // ───────────────────────── streams ─────────────────────────

    function parseServers(html) {
        var out = [], seen = {}, re = /data-embed-id="([^"]+)"/g, m;
        while ((m = re.exec(html))) {
            var parts = decodeEntities(m[1]).split(':');
            if (parts.length < 2) continue;
            var name = safeAtob(parts[0]).trim(), url = safeAtob(parts.slice(1).join(':')).trim();
            if (!/^https?:\/\//i.test(url) || seen[url]) continue;
            seen[url] = 1;
            out.push({ name: name || 'Server', url: url });
        }
        var ifr = html.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/i);
        if (ifr && !seen[decodeEntities(ifr[1])]) out.push({ name: 'Default', url: decodeEntities(ifr[1]) });
        return out;
    }

    function prettyName(n) { return String(n || 'Server').replace(/dub$/i, '').trim() || 'Server'; }

    function qualityOf(s) {
        var m = String(s || '').match(/\b(2160|1440|1080|720|576|480|360|240)p\b/i);
        if (m) return m[1] + 'p';
        if (/\b4k\b/i.test(s)) return '2160p';
        return 'Auto';
    }

    function audioOf(title) {
        var m = String(title || '').match(/\b((?:Hindi|Tamil|Telugu|Malayalam|Kannada|Bengali|Eng(?:lish)?|Jap(?:anese)?|Kor(?:ean)?)(?:[-+_ ](?:Hindi|Tamil|Telugu|Malayalam|Kannada|Bengali|Eng(?:lish)?|Jap(?:anese)?|Kor(?:ean)?))*)\b/i);
        return m ? m[1].replace(/[_ +]/g, '-') : '';
    }

    function isP2P(u) { return /^https?:\/\/[^\/]*(p2pplay|strp2p|rpmstream|upns)\.[^\/]+\/.*#./i.test(u); }
    function isVidMoly(u) { return /^https?:\/\/(?:www\.)?vidmoly\.[a-z]+\//i.test(u); }

    async function extractP2P(server) {
        var origin = originOf(server.url);
        var id = server.url.split('#')[1].replace(/^\/+/, '').split(/[?&\/]/)[0];
        var api = origin + '/api/v1/video?id=' + encodeURIComponent(id) + '&w=1920&h=1080&r=' + encodeURIComponent(HOST);
        var r = await get(api, origin + '/', { 'Accept': '*/*' });
        var hex = r.body.trim();
        if (r.status >= 400 || !/^[0-9a-f]+$/i.test(hex)) throw new Error('p2p api ' + r.status);
        var j = null;
        try {
            var plain = await crypto.decryptAES(hexToB64(hex), btoa(P2P_KEY), btoa(P2P_IV), { mode: 'cbc' });
            j = JSON.parse(String(plain).replace(/[\u0000-\u001f]+$/, ''));
        } catch (_) { j = null; }
        if (!j || typeof j !== 'object') j = JSON.parse(aesCbcDecryptHex(hex, P2P_KEY, P2P_IV));
        var headers = { 'User-Agent': UA, 'Referer': origin + '/', 'Origin': origin };
        var subs = [];
        Object.keys(j.subtitle || {}).forEach(function (k) {
            var p = String(j.subtitle[k] || '').split('#')[0];
            if (p) subs.push({ url: absUrl(p, origin), label: SUB_LANG[k] || k, lang: k });
        });
        var q = qualityOf(j.title), aud = audioOf(j.title), base = prettyName(server.name);
        var tag = aud ? ' • ' + aud : '';
        var out = [];
        if (j.cfNative) out.push({ order: 0, url: absUrl(j.cfNative, origin), source: base + ' Cloudflare' + tag, quality: q, headers: headers, subtitles: subs });
        if (j.source) out.push({ order: 2, url: absUrl(j.source, origin), source: base + ' Direct' + tag, quality: q, headers: headers, subtitles: subs });
        return out;
    }

    async function extractVidMoly(server) {
        var r = await get(server.url, SITE + '/');
        if (r.status >= 400) throw new Error('vidmoly ' + r.status);
        var html = r.body;
        if (/eval\(function\(p,a,c,k,e,[rd]\)/.test(html) && typeof getAndUnpack === 'function') {
            try { html += '\n' + (await getAndUnpack(html)); } catch (_) {}
        }
        var m3u8 = (html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+)['"]/) || html.match(/file\s*:\s*['"](https?:[^'"]+\.m3u8[^'"]*)['"]/) || [])[1];
        if (!m3u8) throw new Error('vidmoly: no source');
        var origin = originOf(r.finalUrl || server.url);
        m3u8 = absUrl(m3u8, origin);
        var headers = { 'User-Agent': UA, 'Referer': origin + '/', 'Origin': origin };
        var subs = [], re = /file\s*:\s*['"]([^'"]+\.vtt)['"]\s*,\s*label\s*:\s*['"]([^'"]*)['"]/g, m;
        var seenSub = {};
        while ((m = re.exec(html))) {
            if (seenSub[m[1]]) continue;
            seenSub[m[1]] = 1;
            var lbl = m[2] || 'English';
            var code = Object.keys(SUB_LANG).filter(function (k) { return SUB_LANG[k].toLowerCase() === lbl.toLowerCase(); })[0] || 'en';
            subs.push({ url: absUrl(m[1], origin), label: lbl, lang: code });
        }
        var q = 'Auto', tag = '';
        try {
            var mr = await withTimeout(get(m3u8, origin + '/', { 'Origin': origin, 'Accept': '*/*' }), 7000);
            var hs = [], rr = /RESOLUTION=\d+x(\d+)/g, x;
            while ((x = rr.exec(mr.body))) hs.push(+x[1]);
            if (hs.length) q = Math.max.apply(null, hs) + 'p';
            var codes = [], ra = /TYPE=AUDIO[^\n]*?LANGUAGE="([a-z]{2,3})"/g, y;
            while ((y = ra.exec(mr.body))) if (codes.indexOf(y[1].toUpperCase()) < 0) codes.push(y[1].toUpperCase());
            if (codes.length > 1) tag = ' • ' + codes.join('-');
            else if ((mr.body.match(/TYPE=AUDIO/g) || []).length > 1) tag = ' • Multi Audio';
        } catch (_) {}
        return [{ order: 1, url: m3u8, source: prettyName(server.name) + tag, quality: q, headers: headers, subtitles: subs }];
    }

    async function loadStreams(data, cb) {
        try {
            var url = String(data || '').trim();
            if (/^\{/.test(url)) { try { url = JSON.parse(url).url || url; } catch (_) {} }
            var r = await get(url);
            if (r.status >= 400) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'HTTP ' + r.status + ' for ' + url });
            if (/\/anime\//.test(url) && !/data-embed-id=/.test(r.body)) {
                var wl = watchLinks(r.body);
                if (!wl.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No episodes have been released for this title yet.' });
                r = await get(wl[0], url);
            }
            var servers = parseServers(r.body);
            var jobs = servers.map(function (s) {
                if (isP2P(s.url)) return withTimeout(extractP2P(s), 14000).catch(function () { return []; });
                if (isVidMoly(s.url)) return withTimeout(extractVidMoly(s), 14000).catch(function () { return []; });
                return Promise.resolve([]);
            });
            var found = [].concat.apply([], await Promise.all(jobs));
            found.sort(function (a, b) { return a.order - b.order; });
            var seen = {}, list = [];
            found.forEach(function (s) {
                if (seen[s.url]) return;
                seen[s.url] = 1;
                list.push(mkStream(s));
            });
            if (!list.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No supported server (Streamp2p / VidMoly) for this episode.' });

            var verified = await verifyStreams(list, 2);
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
