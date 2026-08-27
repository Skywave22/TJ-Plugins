/*
 * SSR Movies — SkyStream plugin
 * Site:   https://ssrmovies.moda  (ssrmovies.com redirects here)
 * Source: Hindi-dubbed / dual-audio movies, Bollywood, Hollywood, web series, WWE
 *
 * Flow:
 *   catalog  : WordPress REST API (/wp-json/wp/v2/posts)
 *   streams  : linkszilla short-links unlock to mirrors:
 *                watch-online.mom  -> JS-packed JWPlayer -> direct HLS (m3u8)
 *                hubcloud.cx       -> HubCloud extractor (skystream-extractors)
 *
 * Exports: getHome / search / load / loadStreams
 */

(function () {

    'use strict';

    var SITE = (manifest && manifest.baseUrl) || 'https://ssrmovies.moda';
    if (SITE.slice(-1) === '/') SITE = SITE.slice(0, -1);
    var API = SITE + '/wp-json/wp/v2';

    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=SSR+Movies';

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

    // linkszilla anchors in DOM order: {url, label}
    function parseLinkAnchors(contentHtml) {
        var out = [];
        var re = /<a[^>]+href=["'](https:\/\/[^"']*linkszilla[^"']*\/view\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        var m;
        while ((m = re.exec(contentHtml)) !== null) {
            var label = stripTags(m[2]);
            if (label) out.push({ url: m[1], label: label });
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
            else { key = 'main'; }
            var g = null;
            for (var i = 0; i < groups.length; i++) if (groups[i].key === key) g = groups[i];
            if (!g) {
                g = { key: key, kind: r ? 'range' : (key === 'main' ? 'main' : 'ep'),
                      a: r ? parseInt(r[1], 10) : undefined, b: r ? parseInt(r[2], 10) : undefined,
                      n: e ? parseInt(e[1], 10) : undefined, items: [] };
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
                        : ('Episode ' + g.n);
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
        var html = await getText(lzUrl); // 302-chain ends on the unlocked page
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
    function unpack(packedScript) {
        if (typeof getAndUnpack === 'function') {
            try { return getAndUnpack(packedScript); } catch (_) {}
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

    // watch-online.mom embed -> packed JWPlayer -> links.hls2 m3u8
    async function resolveWatchOnline(embedUrl, label) {
        var html = await getText(embedUrl, 'https://watch-online.mom/');
        var pm = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?<\/script>/);
        if (!pm) return null;
        var js = unpack(pm[0]);
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
                var idx = p.grp; // groups are sorted: main=0, then episodes from 1
                if (idx >= 1 && idx < groups.length) {
                    targets = groups[idx].items;
                }
            }
            if (!targets.length) targets = anchors; // main / All Links

            if (!targets.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No download links in this post.' });
            }

            // unlock in a small parallel pool
            var streams = [];
            var cursor = 0;
            async function runner() {
                while (cursor < targets.length) {
                    var t = targets[cursor++];
                    try {
                        var mirrors = await unlockLinkszilla(t.url);
                        for (var i = 0; i < mirrors.length; i++) {
                            var mu = mirrors[i];
                            var q = qualityFromText(t.label) || 'Link';
                            var size = sizeFromText(t.label);
                            var ql = q + (size ? ' • ' + size : '');
                            if (/watch-online\.[a-z]+\/e\//i.test(mu)) {
                                var ws = await resolveWatchOnline(mu, t.label);
                                if (ws) streams.push(ws);
                            } else if (/hubcloud\.[a-z]+\/drive\//i.test(mu) && typeof loadExtractor === 'function') {
                                try {
                                    var ex = await loadExtractor(mu);
                                    if (ex && ex.length) {
                                        for (var x = 0; x < ex.length; x++) {
                                            if (ex[x] && ex[x].url) {
                                                ex[x].quality = 'HubCloud • ' + ql;
                                                streams.push(ex[x]);
                                            }
                                        }
                                    }
                                } catch (_) {}
                            }
                        }
                    } catch (_) { /* skip dead link */ }
                }
            }
            var pool = [];
            for (var w = 0; w < Math.min(3, targets.length); w++) pool.push(runner());
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

            if (!unique.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS',
                            message: 'Mirrors for this title are hosted on providers SkyStream cannot resolve (GDrive/Direct-Cloud pages) — try another title.' });
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

})();
