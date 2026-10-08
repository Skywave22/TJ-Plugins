/*
 * SSR Movies — SkyStream plugin
 * Site:   https://ssrmovies.games  (.name and .com 302 here)
 * Source: Hindi-dubbed / dual-audio movies, Bollywood, Hollywood, web series, WWE
 *
 * Flow:
 *   catalog  : WordPress REST API (/wp-json/wp/v2/posts)
 *   streams  : secure.linkszilla.top/view/<ID> -> 302 -> mirror list page, then
 *                hubcloud.ist/drive/ID  -> gamerxyt hubcloud.php -> signed R2 file
 *                new4.gdflix.io/file/ID -> POST {action:direct|instant} -> direct file
 *                watch-online.mom       -> DEAD (ad interstitial, no player)
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


    // Dynamic base URL: the app injects the domain picked in the settings gear.
    var SITE = (typeof manifest !== 'undefined' && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, '')
        : 'https://ssrmovies.games';
    if (SITE.slice(-1) === '/') SITE = SITE.slice(0, -1);
    var API = SITE + '/wp-json/wp/v2';

    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    // Plain headers only: spoofed X-Forwarded-For / CF-Connecting-IP / True-Client-IP
    // don't change the caller's location, and Cloudflare answers them with HTTP 403.

    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=SSR+Movies';

    // ── hoster endpoints ────────────────────────────────────────────
    // These rotate constantly. The old hosts still answer, but only with
    // a 302, and a 302 on a POST returns an HTML redirect page instead of
    // the JSON the resolver needs — so pin the CURRENT hosts.
    //   hubcloud.cx    -> 302 -> hubcloud.ist
    //   gdflix.dev     -> 302 -> new4.gdflix.io
    //   new3.gdflix.io -> 302 -> new4.gdflix.io
    var HUBCLOUD_HOST = 'hubcloud.ist';
    var GDFLIX_HOST = 'new4.gdflix.io';
    var GD_KEY = 'acbe2066696a1d44345698deb3d9ebf9ae9bbdfd';

    // WP category ids (verified against the live API)
    var ROWS = [
        { name: 'Latest Uploads',      cat: null },
        { name: 'Hindi Dubbed Movies', cat: 6 },
        { name: 'Dual Audio Movies',   cat: 7 },
        { name: 'Bollywood Movies',    cat: 3 },
        { name: 'Hollywood Movies',    cat: 8 },
        { name: 'Web Series',          cat: 106 },
        { name: 'TV Shows',            cat: 2 },
        { name: 'WWE Shows',           cat: 114 },
        { name: '4K Movies',           cat: 119 },
        { name: 'Punjabi Movies',      cat: 98 }
    ];
    var SERIES_CATS = [2, 106, 114]; // TV Shows, Web Series, WWE
    var ALL_LINKS_EPISODE = 997;     // virtual episode: every link in one list

    // ─────────────────────────── helpers ───────────────────────────

    function decodeEntities(s) {
        return String(s == null ? '' : s)
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, '-').replace(/&#8212;|&mdash;/g, '-')
            .replace(/&#8217;|&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
    }

    function stripTags(html) {
        return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    }

    async function getText(url, referer) {
        var res = await http_get(url, {
            'User-Agent': UA,
            'Accept': 'text/html,application/json,*/*;q=0.8',
            'Referer': referer || SITE + '/'
        });
        var body = (res && typeof res === 'object') ? res.body : res;
        var status = (res && typeof res === 'object') ? (res.status || res.statusCode || 0) : 0;
        if (status && (status < 200 || status >= 300)) throw new Error('HTTP ' + status + ' ' + url.slice(0, 70));
        return typeof body === 'string' ? body : '';
    }

    async function getJson(url) {
        var body = await getText(url);
        try { return JSON.parse(body); } catch (_) { throw new Error('Bad JSON from ' + url.slice(0, 60)); }
    }

    function mkItem(obj)    { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); }       catch (_) { return obj; } }
    function mkStream(obj) {
        var s;
        try {
            s = new StreamResult({ url: obj.url, source: obj.source || obj.quality, headers: obj.headers });
            s.quality = obj.quality;
        } catch (_) { s = obj; }
        return s;
    }

    function sleep(ms) {
        if (typeof setTimeout === 'function') return new Promise(function (r) { setTimeout(r, ms); });
        return Promise.resolve();
    }

    // Race a promise against a timer so a slow/blocked host can never hang the
    // stream list forever (SkyStream's spinner has no per-request bound).
    function withTimeout(promise, ms) {
        if (typeof setTimeout !== 'function') return promise;
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            promise.then(
                function (v) { clearTimeout(t); resolve(v); },
                function (e) { clearTimeout(t); reject(e); }
            );
        });
    }

    function qualityFromText(t) {
        var m = String(t || '').match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i) || String(t || '').match(/\b4k\b/i);
        if (!m) return '';
        var q = m[1].toLowerCase();
        return q === '4k' ? '2160p' : q;
    }

    function sizeFromText(t) {
        var m = String(t || '').match(/([\d.]+)\s*(GB|MB)/i);
        return m ? (m[1] + m[2].toUpperCase()) : '';
    }

    var QRANK = { '2160p': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 1, '360p': 1 };

    // ─────────────────────── post parsing ───────────────────────

    // "Welcome to the Jungle (2026) Hindi ORG 5.1 1080p 720p 480p WEB-DL x264 [ESubs]"
    //  -> { name: "Welcome to the Jungle", year: 2026 }
    function parseTitle(raw) {
        var t = decodeEntities(raw).replace(/\s+/g, ' ').trim();
        // name is everything before the first standalone year token
        var m = t.match(/^(.*?)\s*[\(\[]?(19\d{2}|20\d{2})[\)\]]?(\s|:|$)/);
        if (m && m[1].trim()) return { name: m[1].trim(), year: parseInt(m[2], 10) };
        // fallback: cut at the first quality/language token
        var cut = t.split(/\s+(?=(?:1080p|720p|480p|2160p|4K|WEB|BluRay|HDRip|Dual|Hindi|S\d{2}|Complete|Season|AMZN))/i)[0];
        var ym = t.match(/\b(19\d{2}|20\d{2})\b/);
        return { name: cut.replace(/[\(\)\[\]]/g, '').trim() || t, year: ym ? parseInt(ym[1], 10) : undefined };
    }

    function firstImage(contentHtml) {
        var m = String(contentHtml || '').match(/<img[^>]+src=["']([^"']+)["']/i);
        return m ? m[1] : '';
    }

    function extractDescription(contentHtml) {
        var text = stripTags(contentHtml);
        text = text.split('.emd_dl_')[0]; // stop at download-button CSS leak
        // SSR separates blocks with || — pick the longest narrative-looking chunk
        var chunks = text.split(/\s*\|\|\s*/);
        var best = '';
        chunks.forEach(function (ln) {
            ln = ln.replace(/\s+/g, ' ').trim();
            if (ln.length > best.length && ln.length > 40
                    && !/^(IMDb|Size|Language|Genres?|Director|Writers|Stars|Cast|Download|Get This|Watch|Note|Tags?)/i.test(ln)
                    && ln.indexOf('http') < 0) {
                best = ln;
            }
        });
        return best.slice(0, 400);
    }

    function extractScore(contentHtml) {
        var m = String(contentHtml || '').match(/IMDb\s*:\s*([\d.]+)\s*\/\s*10/i);
        return m ? parseFloat(m[1]) : undefined;
    }

    function isSeriesPost(post) {
        var cats = post.categories || [];
        for (var i = 0; i < SERIES_CATS.length; i++) if (cats.indexOf(SERIES_CATS[i]) >= 0) return true;
        return false;
    }

    // linkszilla anchors in DOM order: {url, label, ep?, epTitle?}
    // Daily shows (Bigg Boss, Khatron…) put the episode in a heading and the
    // buttons only say "Watch & Download in 1080p", so remember the last
    // "Episode N" heading and tag every following anchor with it.
    function parseLinkAnchors(contentHtml) {
        var out = [];
        var re = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|<a[^>]+href=["'](https:\/\/(?:[^"']*linkszilla[^"']*\/view\/|[a-z0-9.-]*direct-cloud\.[a-z]+\/d\/)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        var m, curEp = null, curTitle = '';
        while ((m = re.exec(contentHtml)) !== null) {
            if (m[1] != null && m[2] == null) {
                var h = stripTags(m[1]).replace(/\|\|/g, ' ').replace(/\s+/g, ' ').trim();
                var em = h.match(/\bEpisode\s*0*(\d+)/i);
                if (em && !/Ep(?:isode)?s?\s*0*\d+\s*[-–]\s*0*\d+(?![a-z\d])/i.test(h)) { curEp = parseInt(em[1], 10); curTitle = h; }
                else if (/\bSeason\b|\bS\d{1,2}\b|Download|Links/i.test(h)) { curEp = null; curTitle = ''; }
                continue;
            }
            var label = stripTags(m[3]);
            if (!label) continue;
            var a = { url: m[2], label: label };
            if (curEp != null) { a.ep = curEp; a.epTitle = curTitle; }
            out.push(a);
        }
        return out;
    }

    // Group anchors:
    //   "Download (Ep 01-08) 1080p - 3.2GB"  -> range group
    //   "Episode 5 ..."                      -> single-ep group
    //   "Watch & Download in 1080p - 2.47GB" -> main (movie-style)
    function groupAnchors(anchors) {
        var groups = [];   // {key, kind:'main'|'range'|'ep', a, b, n, items:[{url,label}]}
        var main = null;
        anchors.forEach(function (a) {
            var r = a.label.match(/Ep\s*0*(\d+)\s*[-–]\s*0*(\d+)/i);
            var e = a.label.match(/Episode\s*0*(\d+)/i);
            var key;
            if (r) key = 'r:' + parseInt(r[1], 10) + '-' + parseInt(r[2], 10);
            else if (e && !/Watch/i.test(a.label)) key = 'e:' + parseInt(e[1], 10);
            else if (a.ep != null) { key = 'e:' + a.ep; e = [null, String(a.ep)]; }
            else { key = 'main'; }
            var g = null;
            for (var i = 0; i < groups.length; i++) if (groups[i].key === key) g = groups[i];
            if (!g) {
                g = { key: key, kind: r ? 'range' : (key === 'main' ? 'main' : 'ep'),
                      a: r ? parseInt(r[1], 10) : undefined, b: r ? parseInt(r[2], 10) : undefined,
                      n: e ? parseInt(e[1], 10) : undefined, title: a.epTitle || '', items: [] };
                groups.push(g);
            }
            g.items.push(a);
        });
        // deterministic order: main first, then episode/range order
        groups.sort(function (x, y) {
            var ax = x.kind === 'main' ? -1 : (x.a != null ? x.a : (x.n != null ? x.n : 999));
            var ay = y.kind === 'main' ? -1 : (y.a != null ? y.a : (y.n != null ? y.n : 999));
            return ax - ay;
        });
        return groups;
    }

    function postToItem(post) {
        var pt = parseTitle(post.title && post.title.rendered || '');
        var content = (post.content && post.content.rendered) || '';
        var poster = firstImage(content) || PLACEHOLDER;
        var url = String(post.link || '').replace(/^https?:\/\/[^/]+/, SITE);
        return mkItem({
            title: pt.name || 'Untitled',
            url: url,
            posterUrl: poster,
            bannerUrl: poster,
            type: isSeriesPost(post) ? 'series' : 'movie',
            year: pt.year,
            score: extractScore(content),
            description: extractDescription(content) || undefined
        });
    }

    // ─────────────────────── getHome / search ───────────────────────

    async function fetchPosts(query) {
        var posts = await getJson(API + '/posts?per_page=20&_fields=id,title,link,categories,content,' +
            'excerpt,slug&' + query);
        return Array.isArray(posts) ? posts : [];
    }

    async function getHome(cb) {
        try {
            var settled = await Promise.all(ROWS.map(function (row) {
                var q = row.cat == null ? 'page=1' : ('categories=' + row.cat + '&page=1');
                return fetchPosts(q).then(
                    function (v) { return v; },
                    function (e) { console.error('Row failed:', row.name, e && e.message); return null; }
                );
            }));
            var data = {};
            for (var i = 0; i < ROWS.length; i++) {
                if (settled[i] && settled[i].length) {
                    data[ROWS[i].name] = settled[i].slice(0, 20).map(postToItem).filter(Boolean);
                }
            }
            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'SSR Movies API returned no content (' + SITE + ')' });
            }
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String((e && e.message) || e) });
        }
    }

    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var posts = await fetchPosts('search=' + encodeURIComponent(q) + '&page=1');
            cb({ success: true, data: posts.map(postToItem).filter(Boolean) });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── load ───────────────────────────

    function parseItemUrl(url) {
        var m = String(url || '').match(/\/([^\/?#]+)\/?(?:\?(.*))?$/);
        if (!m) return null;
        var slug = m[1];
        if (!slug || slug === 'page' || /^\d+$/.test(slug) === false && slug.indexOf('.') >= 0) {
            // reject file-like segments
        }
        var grp = null;
        if (m[2]) {
            var gm = m[2].match(/grp=(\d+)/);
            if (gm) grp = parseInt(gm[1], 10);
        }
        return { slug: slug, grp: grp };
    }

    async function fetchBySlug(slug) {
        var posts = await getJson(API + '/posts?slug=' + encodeURIComponent(slug) + '&_fields=id,title,link,categories,content,slug');
        return posts && posts[0] ? posts[0] : null;
    }

    async function load(url, cb) {
        try {
            var p = parseItemUrl(url);
            if (!p || !p.slug) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized SSR URL: ' + url });

            var post = await fetchBySlug(p.slug);
            if (!post) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'Post not found on SSR Movies' });

            var content = (post.content && post.content.rendered) || '';
            var item = postToItem(post);
            var poster = item.posterUrl;
            var anchors = parseLinkAnchors(content);
            var groups = groupAnchors(anchors);

            if (!anchors.length) {
                item.episodes = [];
                item.description = (item.description ? item.description + '\n\n' : '')
                    + '⚠ No download links in this post yet — check back later.';
                return cb({ success: true, data: mkItem(item) });
            }

            var episodes = [];
            if (item.type === 'movie' || groups.length <= 1) {
                // single pseudo-episode with everything
                episodes.push(mkEpisode({
                    name: item.title,
                    url: clean(item.url),
                    season: 1, episode: 1,
                    posterUrl: poster,
                    dubStatus: 'none', playbackPolicy: 'none'
                }));
            } else {
                // series: one pseudo-episode per link group (Ep ranges / dated episodes)
                var counter = 1;
                for (var i = 0; i < groups.length; i++) {
                    var g = groups[i];
                    if (g.kind === 'main') continue; // goes into All Links below
                    var name = g.kind === 'range'
                        ? ('Ep ' + pad2(g.a) + '–' + pad2(g.b) + ' Pack')
                        : (g.title || ('Episode ' + g.n));
                    var q = qualityFromText(g.items[0].label);
                    if (q && g.items.length === 1) name += ' • ' + q;
                    episodes.push(mkEpisode({
                        name: name,
                        url: item.url + '?grp=' + counter,
                        season: 1, episode: counter,
                        posterUrl: poster,
                        dubStatus: 'none', playbackPolicy: 'none'
                    }));
                    counter++;
                }
                // everything in one place too
                episodes.push(mkEpisode({
                    name: '📦 All Links — Watch & Download',
                    url: item.url + '?grp=' + ALL_LINKS_EPISODE,
                    season: 1, episode: ALL_LINKS_EPISODE,
                    posterUrl: poster,
                    dubStatus: 'none', playbackPolicy: 'none'
                }));
            }

            item.episodes = episodes;
            cb({ success: true, data: mkItem(item) });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    function clean(u) { return String(u).split('?')[0]; }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    // ─────────────────────── linkszilla unlock ───────────────────────

    async function unlockLinkszilla(lzUrl) {
        var html = await withTimeout(getText(lzUrl), 12000); // 302-chain ends on the unlocked page
        var urls = [];
        var re = /href=["'](https?:\/\/[^"']+)["']/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            var u = m[1];
            if (/linkszilla/.test(u)) continue;
            urls.push(u);
        }
        return urls;
    }

    // P.A.C.K.E.R unpacker (watch-online.mom player) — same algorithm as
    // SkyStream's getAndUnpack; native when available.
    async function unpack(packedScript) {
        if (typeof getAndUnpack === 'function') {
            try { return await getAndUnpack(packedScript); } catch (_) {}
        }
        var m = String(packedScript).match(/\}\(['"]([\s\S]+?)['"],(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
        if (!m) return '';
        var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        var a = parseInt(m[2], 10);
        var c = parseInt(m[3], 10);
        var k = m[4].split('|');
        var out = p;
        for (var n = c - 1; n >= 0; n--) {
            if (!k[n]) continue;
            var token = n.toString(a);
            out = out.replace(new RegExp('\\b' + token + '\\b', 'g'), k[n]);
        }
        return out;
    }

    // ── HubCloud ────────────────────────────────────────────────────────
    // hubcloud.ist/drive/<ID> exposes a #download anchor pointing at
    // gamerxyt.com/hubcloud.php?host=hubcloud&id=<ID>&token=<...>, which
    // serves a signed *.r2.cloudflarestorage.com URL plus pixeldrain
    // fallbacks. Pure GET chain, so it resolves fine from the JS runtime.
    // direct-cloud (dl.direct-cloud.top/d/<id> -> storage.direct-cloud.org/d/<uid>)
    // The page carries data-uid + data-token (the token embeds our User-Agent)
    // and its script POSTs {type:"DOWNLOAD_GENERATE", payload:{uid, access_token}}
    // to /action with the page's PHPSESSID, getting a Google video-downloads URL.
    // The app only auto-sends Cloudflare cookies, so forward PHPSESSID by hand.
    async function resolveDirectCloud(pageUrl) {
        var r = await withTimeout(http_get(pageUrl, { 'User-Agent': UA, 'Referer': SITE + '/' }), 12000);
        var html = String((r && r.body) || '');
        var uid = (html.match(/data-uid=["']([^"']+)["']/) || [])[1];
        var tok = (html.match(/data-token=["']([^"']+)["']/) || [])[1];
        if (!uid || !tok) return null;
        var fin = String((r && r.finalUrl) || '');
        var origin = (fin.match(/^https?:\/\/[^\/]+/) || ['https://storage.direct-cloud.org'])[0];
        var sc = r && r.headers ? (r.headers['set-cookie'] || r.headers['Set-Cookie']) : null;
        var list = Array.isArray(sc) ? sc : (sc ? String(sc).split(/,(?=\s*[A-Za-z0-9_]+=)/) : []);
        var cookie = '';
        for (var i = 0; i < list.length; i++) {
            var c = String(list[i]).split(';')[0].trim();
            if (/^PHPSESSID=/i.test(c)) cookie = c; // last one wins (final response)
        }
        var h = {
            'User-Agent': UA,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Requested-With': 'xmlhttprequest',
            'Referer': fin || pageUrl,
            'Origin': origin
        };
        if (cookie) h['Cookie'] = cookie;
        var pr = await withTimeout(http_post(origin + '/action', h,
            JSON.stringify({ type: 'DOWNLOAD_GENERATE', payload: { uid: uid, access_token: tok } })), 12000);
        try {
            var j = JSON.parse(String((pr && pr.body) || ''));
            return j && j.download_url ? String(j.download_url) : null;
        } catch (_) { return null; }
    }

    async function resolveHubcloud(pageUrl) {
        var out = [];
        try {
            var html = await withTimeout(getText(pageUrl, 'https://' + HUBCLOUD_HOST + '/'), 12000);
            var dl = (html.match(/id=["']download["'][^>]*href=["']([^"']+)["']/) ||
                      html.match(/href=["']([^"']*hubcloud\.php[^"']+)["']/) || [])[1];
            if (!dl) return out;
            dl = dl.replace(/&amp;/g, '&');
            if (/hubcloud\.php|gamerxyt/.test(dl)) {
                var d2 = await withTimeout(getText(dl, pageUrl), 12000);
                var r2 = (d2.match(/https:\/\/[^"'\s<>]*r2\.cloudflarestorage\.com[^"'\s<>]+/) || [])[0];
                if (r2) out.push(r2.replace(/&amp;/g, '&'));
                if (!out.length) {
                    var pd = (d2.match(/https:\/\/pixeldrain\.(?:com|dev)\/u\/[A-Za-z0-9]+/) || [])[0];
                    if (pd) out.push(pd + '?download');
                }
            } else if (/r2\.cloudflarestorage\.com|pixeldrain/.test(dl)) {
                out.push(dl);
            }
        } catch (_) {}
        return out;
    }

    // ── GDFlix ──────────────────────────────────────────────────────────
    // POST https://new4.gdflix.io/{file|mfile}/<ID> with x-token -> JSON.
    // `mfile` + action=instant returns a direct googleusercontent URL;
    // `file` + action=direct returns a drive.google.com id that then has to
    // be unwrapped through the usercontent confirm form.
    //
    // NOTE: new4.gdflix.io sits behind a Cloudflare rule that only accepts
    // HTTP/2. curl --http2 gets 200, curl --http1.1 gets 403 "Just a
    // moment...". Node-based HTTP clients (axios/undici) speak HTTP/1.1
    // only, so this resolves in the SkyStream app but not under
    // `skystream test`. Kept because it is the highest-quality mirror.
    async function resolveGdflix(pageUrl) {
        var instant = [], direct = [];
        try {
            var fid = (String(pageUrl).match(/\/file\/([A-Za-z0-9]+)/) || [])[1];
            if (!fid) return { instant: instant, urls: direct };
            var pageUrlRef = 'https://' + GDFLIX_HOST + '/file/' + fid;
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
            var iu = String(res[0].url || '').replace(/&amp;/g, '&');
            if (!res[0].error && iu.indexOf('http') === 0) instant.push(iu);

            var u = String(res[1].url || '').replace(/&amp;/g, '&');
            if (!res[1].error && u.indexOf('http') === 0) {
                var gid = (u.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || [])[1];
                if (/drive\.google\.com/.test(u) && gid) {
                    try {
                        var chtml = await withTimeout(getText('https://drive.usercontent.google.com/download?id=' + gid + '&export=download', 'https://drive.google.com/'), 12000);
                        var action = (chtml.match(/action="([^"]+)"/) || [])[1] || '';
                        if (action) {
                            var fields = [], fr = /name="([^"]+)"\s+value="([^"]*)"/g, fm;
                            while ((fm = fr.exec(chtml))) fields.push(fm[1] + '=' + encodeURIComponent(fm[2]).replace(/%20/g, '+'));
                            if (fields.length) direct.push(action + '?' + fields.join('&'));
                        }
                    } catch (_) {}
                    if (!direct.length) direct.push('https://drive.google.com/uc?export=download&id=' + gid);
                } else {
                    direct.push(u);
                }
            }
        } catch (_) {}
        return { instant: instant, urls: direct };
    }

    // watch-online.mom embed -> packed JWPlayer -> links.hls2 m3u8
    //
    // Works on only SOME embeds. Of the four watch-online links on a typical
    // post, roughly one serves the real packed JWPlayer (~16KB, resolves to a
    // premilkyway.com hls2 master.m3u8) while the rest serve a ~5.7KB ad
    // interstitial (jquery + hg-function.js + a pickDirect click-catcher) with
    // no player at all. Returning null on those is correct, and loadStreams
    // keeps trying the other mirrors, so the good one still gets used.
    async function resolveWatchOnline(embedUrl, label) {
        var html = await withTimeout(getText(embedUrl, 'https://watch-online.mom/'), 12000);
        var pm = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?<\/script>/);
        if (!pm) return null;
        var js = await unpack(pm[0]);
        if (!js) return null;
        var um = js.match(/["']hls2["']\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/)
             || js.match(/["']hls3["']\s*:\s*["'](https?:\/\/[^"']+)["']/)
             || js.match(/["']hls4["']\s*:\s*["'](https?:\/\/[^"']+)["']/)
             || js.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (!um) return null;
        var q = qualityFromText(label) || 'Auto';
        var size = sizeFromText(label);
        var ql = q + (size ? ' • ' + size : '');
        return mkStream({
            url: um[1],
            quality: 'Watch • ' + ql,
            headers: { 'User-Agent': UA }
        });
    }

    // ─────────────────────────── loadStreams ───────────────────────────

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

    async function loadStreams(url, cb) {
        try {
            var p = parseItemUrl(url);
            if (!p || !p.slug) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized SSR URL: ' + url });

            var post = await fetchBySlug(p.slug);
            if (!post) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'Post not found' });

            var anchors = parseLinkAnchors((post.content && post.content.rendered) || '');
            var groups = groupAnchors(anchors);

            var targets = [];
            if (p.grp != null && p.grp !== ALL_LINKS_EPISODE) {
                // load() numbers the non-main groups from 1 (there may be no main group)
                var epGroups = groups.filter(function (g) { return g.kind !== 'main'; });
                var idx = p.grp - 1;
                if (idx >= 0 && idx < epGroups.length) targets = epGroups[idx].items;
            }
            if (!targets.length) targets = anchors; // main / All Links

            if (!targets.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No download links in this post.' });
            }

            // WWE/weekly posts can hold 99+ links — unlocking all of them would
            // spin for minutes. Cap hard, and stop as soon as we have enough
            // playable watch streams (the first unlock usually yields 3).
            var MAX_TARGETS = (p.grp === ALL_LINKS_EPISODE) ? 10 : 8;
            if (targets.length > MAX_TARGETS) targets = targets.slice(0, MAX_TARGETS);
            var ENOUGH_STREAMS = 4;

            var streams = [];
            var stop = false;
            var cursor = 0;
            async function runner() {
                while (cursor < targets.length && !stop) {
                    var t = targets[cursor++];
                    try {
                        if (/direct-cloud\.[a-z]+\/d\//i.test(t.url)) {
                            var dq = qualityFromText(t.label) || 'Link';
                            var dsz = sizeFromText(t.label);
                            var du = await withTimeout(resolveDirectCloud(t.url), 20000);
                            if (du) streams.push(mkStream({
                                url: du,
                                quality: 'Direct • ' + dq + (dsz ? ' • ' + dsz : ''),
                                headers: { 'User-Agent': UA }
                            }));
                            if (streams.length >= ENOUGH_STREAMS) stop = true;
                            continue;
                        }
                        var mirrors = await withTimeout(unlockLinkszilla(t.url), 14000);
                        for (var i = 0; i < mirrors.length && !stop; i++) {
                            var mu = mirrors[i];
                            var q = qualityFromText(t.label) || 'Link';
                            var size = sizeFromText(t.label);
                            var ql = q + (size ? ' • ' + size : '');
                            if (/watch-online\.[a-z]+\/e\//i.test(mu)) {
                                var ws = await resolveWatchOnline(mu, t.label);
                                if (ws) streams.push(ws);
                            } else if (/hubcloud\.[a-z]+\/drive\//i.test(mu)) {
                                // Was `loadExtractor(mu)` — that global does not
                                // exist in the SkyStream runtime (it is not in the
                                // CLI sandbox and not injected by the app), so the
                                // whole branch silently never ran and SSR resolved
                                // nothing. Inline resolver instead.
                                var hc = await withTimeout(resolveHubcloud(mu), 14000);
                                for (var x = 0; x < hc.length; x++) {
                                    streams.push(mkStream({
                                        url: hc[x],
                                        quality: 'HubCloud' + (x > 0 ? ' #' + (x + 1) : '') + ' • ' + ql,
                                        headers: { 'User-Agent': UA }
                                    }));
                                }
                            } else if (/gdflix\.[a-z]+\/file\//i.test(mu)) {
                                var gd = await withTimeout(resolveGdflix(mu), 16000);
                                for (var gi = 0; gi < gd.instant.length; gi++) {
                                    streams.push(mkStream({
                                        url: gd.instant[gi],
                                        quality: 'GDFlix Instant • ' + ql,
                                        headers: { 'User-Agent': UA }
                                    }));
                                }
                                for (var gu = 0; gu < gd.urls.length; gu++) {
                                    streams.push(mkStream({
                                        url: gd.urls[gu],
                                        quality: 'GDFlix' + (gu > 0 ? ' #' + (gu + 1) : '') + ' • ' + ql,
                                        headers: { 'User-Agent': UA }
                                    }));
                                }
                            }
                        }
                        if (streams.length >= ENOUGH_STREAMS) stop = true;
                    } catch (_) { /* dead/slow link — move on */ }
                }
            }
            var pool = [];
            for (var w = 0; w < Math.min(2, targets.length); w++) pool.push(runner());
            await Promise.all(pool);

            // quality-ordered, watch-online first
            streams.sort(function (a, b) {
                var wa = String(a.quality).indexOf('Watch') === 0 ? 0 : 1;
                var wb = String(b.quality).indexOf('Watch') === 0 ? 0 : 1;
                if (wa !== wb) return wa - wb;
                return (QRANK[qualityFromText(String(b.quality))] || 0) - (QRANK[qualityFromText(String(a.quality))] || 0);
            });

            // de-dupe
            var seen = {}, unique = [];
            streams.forEach(function (s) { if (!seen[s.url]) { seen[s.url] = 1; unique.push(s); } });

            // probe before listing: working first, dead dropped
            unique = unique.length ? await verifyStreams(unique, 3) : [];

            if (!unique.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS',
                            message: 'None of the download mirrors for this title returned a working file right now — try another title or episode.' });
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
