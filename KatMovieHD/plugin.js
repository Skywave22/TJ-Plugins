/*
 * KatMovieHD — SkyStream plugin
 * Site:   https://new.katmoviehd.top  (WordPress) + https://links.kmhd.me (link system)
 * Source: Hindi-dubbed / dual-audio movies, web series, Netflix/Prime shows, anime dubs
 *
 * Flow:
 *   catalog : WP REST API (/wp-json/wp/v2/posts, categories)
 *   watch   : post -> links.kmhd.me/play?id=X  (SSR SvelteKit data) ->
 *             per-episode streamtape/streamwish codes -> built-in extractors
 *   download: links.kmhd.me/file/ID with Cookie: unlocked=true (static value) ->
 *             upload_links codes -> hubcloud.cx/drive/... -> hub_cloud extractor
 *
 * Exports: getHome / search / load / loadStreams
 */

(function () {

    'use strict';

    var SITE = (manifest && manifest.baseUrl) || 'https://new.katmoviehd.top';
    if (SITE.slice(-1) === '/') SITE = SITE.slice(0, -1);
    var API = SITE + '/wp-json/wp/v2';
    var KMHD = 'https://links.kmhd.me';

    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=KatMovieHD';

    var ROWS = [
        { name: 'Latest Uploads',   cat: null },
        { name: 'Hindi Dubbed',     cat: 533057 },
        { name: 'Dual Audio',       cat: 21 },
        { name: 'TV Series Dubbed', cat: 51 },
        { name: 'Netflix',          cat: 41018 },
        { name: 'Hollywood Eng',    cat: 30 },
        { name: 'Anime Dubbed',     cat: 10 },
        { name: 'WWE',              cat: 58 }
    ];

    // download mirror keys -> {label, url-builder}; only extractor-resolvable hosts
    var MIRROR_HOSTS = {
        hubdrive_res:  { label: 'HubCloud',  base: 'https://hubcloud.cx/drive/' },
        gdflix_res:    { label: 'GDFlix',    base: 'https://gdflix.dev/file/' },
        katdrive_res:  { label: 'KatDrive',  base: 'https://katdrive.click/file/' },
        sendcm_res:    { label: 'SendCM',    base: 'https://send.cm/' },
        clicknupload_res: { label: 'ClickNUpload', base: 'https://clicknupload.cam/' },
        streamtape_res:{ label: 'StreamTape', base: 'https://streamtape.com/e/' },
        streamwish_res:{ label: 'StreamWish', base: 'https://streamwish.to/e/' },
        ffast_res:     { label: 'Fast',      base: 'https://fuckingfast.net/' },
        fichier_res:   { label: '1Fichier',  base: 'https://1fichier.com/?' }
    };

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

    async function getText(url, extraHeaders) {
        var h = {
            'User-Agent': UA,
            'Accept': 'text/html,application/json,*/*;q=0.8',
            'Referer': SITE + '/'
        };
        if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { h[k] = extraHeaders[k]; });
        var res = await http_get(url, h);
        var body = (res && typeof res === 'object') ? res.body : res;
        var status = (res && typeof res === 'object') ? (res.status || res.statusCode || 0) : 0;
        if (status && (status < 200 || status >= 300)) throw new Error('HTTP ' + status + ' ' + url.slice(0, 60));
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

    // "Beauty in Black (Season 3) Hindi Dubbed (DD 5.1) & English [Dual Audio] ..." -> "Beauty in Black (Season 3)"
    function parseTitle(raw) {
        var t = decodeEntities(raw).replace(/\s+/g, ' ').trim();
        var y2 = t.match(/\b(19\d{2}|20\d{2})\b/);
        var year = y2 ? parseInt(y2[1], 10) : undefined;
        // keep through "(Season N)" if present, else plain name
        var sm = t.match(/^(.*?\(Season\s*\d+\))/i);
        var base = sm ? sm[1] : t;
        var cut = base.split(/\s+(?=(?:Hindi|English|Dual|Dubbed|ORG|Clean|Full|All\s+Episodes|Complete|TCRip|HDRip|WEB|BluRay|AMZN|Netflix|JioHotstar|Prime|1080p|720p|480p|2160p|4K|10bit|x265|x264|DD\b|5\.1))/i)[0];
        cut = cut.replace(/\s*[-–|:]\s*$/, '').replace(/\s*\|.*$/, '').trim();
        if (!cut || cut.length < 2) cut = t.split(/\s+(?:Hindi|English|Dual|Dubbed)/i)[0].trim();
        return { name: cut || t.slice(0, 60), year: year };
    }

    // ─────────────────────── kmhd link parsing ───────────────────────

    // extract kmhd anchors from post content: {kind:'play'|'file'|'pack', id, label}
    function parseKmhdLinks(contentHtml) {
        var out = [];
        var re = /<a[^>]+href=["'](?:https?:\/\/links\.kmhd\.me)?\/(play|file|pack)\/?(?:\?id=|=)?([A-Za-z0-9_-]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        var m;
        while ((m = re.exec(contentHtml)) !== null) {
            var label = stripTags(m[3]);
            out.push({ kind: m[1], id: m[2], label: label });
        }
        return out;
    }

    // play page SSR embeds: info:{KEY:{name:"...mkv",streamtape_res:"..",streamwish_res:".."}}
    function parsePlayInfo(playHtml) {
        var episodes = [];
        var re = /(\w+):\{name:"([^"]+)"((?:,[a-z_]+:"[^"]*")*)\}/g;
        var m;
        while ((m = re.exec(playHtml)) !== null) {
            var fname = m[2];
            if (!/\.(mkv|mp4|avi)/i.test(fname)) continue;
            var rest = m[3] || '';
            var st = (rest.match(/streamtape_res:"([^"]*)"/) || [])[1];
            var sw = (rest.match(/streamwish_res:"([^"]*)"/) || [])[1];
            if (st === 'None') st = null;
            if (sw === 'None') sw = null;
            var sem = fname.match(/S(\d{1,2})\s?E(\d{1,3})/i);
            episodes.push({
                key: m[1],
                name: fname,
                season: sem ? parseInt(sem[1], 10) : 1,
                episode: sem ? parseInt(sem[2], 10) : episodes.length + 1,
                quality: qualityFromText(fname),
                streamtape: st || null,
                streamwish: sw || null
            });
        }
        return episodes;
    }

    // file page (with unlock cookie): upload_links:{key:"code"| "None", ...} + name
    function parseFileLinks(fileHtml) {
        var out = { name: '', size: 0, links: {} };
        var nm = fileHtml.match(/name:"([^"]{5,200})"/);
        if (nm) out.name = nm[1];
        var um = fileHtml.match(/upload_links:\{([^}]*)\}/);
        if (um) {
            var re = /(\w+_res):"([^"]*)"/g, m;
            while ((m = re.exec(um[1])) !== null) {
                if (m[2] && m[2] !== 'None') out.links[m[1]] = m[2];
            }
        }
        return out;
    }

    async function fetchKmhdPage(path, unlocked) {
        var headers = { 'Referer': KMHD + '/', 'Origin': KMHD };
        if (unlocked) headers['Cookie'] = 'unlocked=true';
        return getText(KMHD + path, headers);
    }

    // streamtape embed -> direct mp4. The robotlink *div* holds a decoy; the
    // real link is built by JS: innerHTML = '//host/get_video?' + ('xxxx…').substring(2).substring(1)
    async function extractStreamTape(embedUrl) {
        var html;
        try {
            html = await withTimeout(getText(embedUrl, { 'Referer': 'https://streamtape.com/' }), 12000);
        } catch (_) { return null; }
        var s = html.match(/robotlink'\)\.innerHTML\s*=\s*'([^']*)'\s*\+\s*\('([^']+)'\)\.substring\(2\)\.substring\(1\)/);
        if (s) {
            var built = s[1] + s[2].substring(2).substring(1);
            return built.indexOf('//') === 0 ? 'https:' + built : built;
        }
        // older fallback: resolved div (some mirrors render it server-side)
        var m = html.match(/id="robotlink"[^>]*>([^<]+)</);
        if (m) {
            var u = m[1].trim().replace(/^\/(?=[^\/])/, '//');
            if (u.indexOf('//') === 0) return 'https:' + u;
            if (u.indexOf('http') === 0) return u;
        }
        return null;
    }

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

    // ─────────────────────────── catalog ───────────────────────────

    function featuredPoster(post) {
        var fm = post._embedded && post._embedded['wp:featuredmedia'];
        if (fm && fm[0] && fm[0].source_url) return fm[0].source_url;
        return PLACEHOLDER;
    }

    function postToItem(post) {
        var pt = parseTitle(post.title && post.title.rendered || '');
        var content = (post.content && post.content.rendered) || '';
        var kmhdLinks = parseKmhdLinks(content);
        if (!kmhdLinks.length) return null; // skip site announcements / info posts
        var url = String(post.link || '').replace(/^https?:\/\/[^/]+/, SITE);
        var rawTitle = post.title && post.title.rendered || '';
        var isSeries = /\(\s*season\s*\d+\s*\)/i.test(rawTitle)
                    || /web[- ]series/i.test(rawTitle)
                    || (kmhdLinks.some(function (l) { return l.kind === 'play'; }) && /all episodes/i.test(rawTitle));
        return mkItem({
            title: pt.name,
            url: url,
            posterUrl: featuredPoster(post),
            bannerUrl: featuredPoster(post),
            type: isSeries ? 'series' : 'movie',
            year: pt.year
        });
    }

    async function fetchPosts(query) {
        var posts = await getJson(API + '/posts?per_page=20&_embed=wp:featuredmedia&' + query);
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
                return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'KatMovieHD API returned no content (' + SITE + ')' });
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
        var query = m[2] || '';
        var mode = null, arg = null;
        var pm = query.match(/play=([\w-]+)/);  if (pm) { mode = 'play'; arg = pm[1]; }
        var fm = query.match(/dl=([\w-]+)/);     if (fm) { mode = 'dl';   arg = fm[1]; }
        return { slug: slug, mode: mode, arg: arg };
    }

    async function fetchBySlug(slug) {
        var posts = await getJson(API + '/posts?slug=' + encodeURIComponent(slug) + '&_embed=wp:featuredmedia');
        return posts && posts[0] ? posts[0] : null;
    }

    async function load(url, cb) {
        try {
            var p = parseItemUrl(url);
            if (!p || !p.slug) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized KatMovieHD URL: ' + url });

            var post = await fetchBySlug(p.slug);
            if (!post) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'Post not found on KatMovieHD' });

            var item = postToItem(post);
            var poster = item.posterUrl;
            var links = parseKmhdLinks((post.content && post.content.rendered) || '');
            var play = null, downloads = [];
            links.forEach(function (l) {
                if (l.kind === 'play' && !play) play = l;
                else if (l.kind === 'file' || l.kind === 'pack') downloads.push(l);
            });

            var episodes = [];

            if (play) {
                var playHtml = await fetchKmhdPage('/play?id=' + play.id, false);
                var eps = parsePlayInfo(playHtml);
                eps.forEach(function (e) {
                    episodes.push(mkEpisode({
                        name: 'Episode ' + e.episode + (e.quality ? ' • ' + e.quality : ''),
                        url: item.url.split('?')[0] + '?play=' + play.id + '&ep=' + e.key,
                        season: e.season,
                        episode: e.episode,
                        posterUrl: poster,
                        dubStatus: 'none',
                        playbackPolicy: 'none'
                    }));
                });
            }

            if (!episodes.length) {
                // movie-style: single pseudo-episode carrying the downloads
                episodes.push(mkEpisode({
                    name: item.title,
                    url: item.url.split('?')[0],
                    season: 1, episode: 1,
                    posterUrl: poster,
                    dubStatus: 'none', playbackPolicy: 'none'
                }));
            }

            // download packs as extra pseudo-episodes
            downloads.forEach(function (d, i) {
                var q = qualityFromText(d.label) || 'Pack';
                var sz = sizeFromText(d.label);
                episodes.push(mkEpisode({
                    name: '📦 Download • ' + q + (sz ? ' • ' + sz : '') + (d.kind === 'pack' ? ' • per-episode' : ' • zip'),
                    url: item.url.split('?')[0] + '?dl=' + d.id,
                    season: 1,
                    episode: 900 + i,
                    posterUrl: poster,
                    dubStatus: 'none', playbackPolicy: 'none'
                }));
            });

            if (!links.length) {
                item.description = '⚠ No links published in this post yet.';
            }

            item.episodes = episodes;
            cb({ success: true, data: mkItem(item) });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── loadStreams ───────────────────────────

    async function loadExtractorSafe(url, label) {
        if (typeof loadExtractor !== 'function') return null;
        try {
            var ex = await loadExtractor(url);
            if (ex && ex.length) {
                for (var i = 0; i < ex.length; i++) {
                    if (ex[i] && ex[i].url) {
                        ex[i].quality = label;
                        return ex[i];
                    }
                }
            }
        } catch (_) {}
        return null;
    }

    async function loadStreams(url, cb) {
        try {
            var p = parseItemUrl(url);
            if (!p || !p.slug) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized KatMovieHD URL: ' + url });

            var post = await fetchBySlug(p.slug);
            if (!post) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'Post not found' });

            var streams = [];

            if (p.mode === 'play' && p.arg) {
                // episode watch links — StreamTape resolved in-plugin (robotlink),
                // StreamWish/hglink left to the app's extractors
                var playHtml = await fetchKmhdPage('/play?id=' + p.arg, false);
                var eps = parsePlayInfo(playHtml);
                var epKey = (String(url).match(/[?&]ep=([\w-]+)/) || [])[1];
                var ep = null;
                for (var i = 0; i < eps.length; i++) if (eps[i].key === epKey) ep = eps[i];
                if (!ep) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'Episode not found in play list' });

                var tried = [];
                if (ep.streamtape) {
                    tried.push('StreamTape');
                    var direct = await extractStreamTape('https://streamtape.com/e/' + ep.streamtape);
                    if (direct) {
                        streams.push(mkStream({
                            url: direct,
                            quality: 'Watch • StreamTape • ' + (ep.quality || ''),
                            headers: { 'User-Agent': UA, 'Referer': 'https://streamtape.com/' }
                        }));
                    } else {
                        var s1 = await loadExtractorSafe('https://streamtape.com/e/' + ep.streamtape,
                            'Watch • StreamTape • ' + (ep.quality || ''));
                        if (s1) streams.push(s1);
                    }
                }
                if (ep.streamwish) {
                    tried.push('StreamWish');
                    var s2 = await loadExtractorSafe('https://hglink.to/e/' + ep.streamwish,
                        'Watch • StreamWish • ' + (ep.quality || ''));
                    if (s2) streams.push(s2);
                }
                if (!streams.length) {
                    return cb({ success: false, errorCode: 'NO_STREAMS',
                                message: 'Watch servers for this episode (' + (tried.join(', ') || 'none') +
                                         ') did not respond — try the 📦 Download episode or another quality post.' });
                }
            } else if (p.mode === 'dl' && p.arg) {
                // download mirrors: unlock cookie is a static value
                var fileHtml = await fetchKmhdPage('/file/' + p.arg, true);
                var f = parseFileLinks(fileHtml);
                var q = qualityFromText(f.name) || 'Download';
                var order = ['hubdrive_res', 'streamtape_res', 'streamwish_res', 'gdflix_res', 'katdrive_res', 'sendcm_res', 'clicknupload_res', 'ffast_res', 'fichier_res'];
                for (var k = 0; k < order.length; k++) {
                    var key = order[k];
                    if (!f.links[key]) continue;
                    var host = MIRROR_HOSTS[key];
                    var full = host.base + f.links[key];
                    var label = 'Download • ' + host.label + ' • ' + q;
                    if (key === 'hubdrive_res') {
                        var s3 = await loadExtractorSafe(full, label);
                        if (s3) { streams.push(s3); continue; }
                    }
                    // non-extractable hosts still listed for external-browser download
                    streams.push(mkStream({
                        url: full,
                        quality: label,
                        headers: { 'User-Agent': UA, 'Referer': KMHD + '/' }
                    }));
                }
                if (!streams.length) {
                    return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No download mirrors available for this pack.' });
                }
            } else {
                // plain movie url: try the post's own links
                var links = parseKmhdLinks((post.content && post.content.rendered) || '');
                var dl = null, playL = null;
                links.forEach(function (l) {
                    if (l.kind === 'file' && !dl) dl = l;
                    if (l.kind === 'play' && !playL) playL = l;
                });
                if (playL) {
                    var ph = await fetchKmhdPage('/play?id=' + playL.id, false);
                    var eps2 = parsePlayInfo(ph);
                    if (eps2.length) {
                        var e0 = eps2[0];
                        if (e0.streamtape) {
                            var d0 = await extractStreamTape('https://streamtape.com/e/' + e0.streamtape);
                            if (d0) {
                                streams.push(mkStream({
                                    url: d0,
                                    quality: 'Watch • StreamTape • ' + (e0.quality || ''),
                                    headers: { 'User-Agent': UA, 'Referer': 'https://streamtape.com/' }
                                }));
                            } else {
                                var s4 = await loadExtractorSafe('https://streamtape.com/e/' + e0.streamtape,
                                    'Watch • StreamTape • ' + (e0.quality || ''));
                                if (s4) streams.push(s4);
                            }
                        }
                        if (e0.streamwish) {
                            var s5 = await loadExtractorSafe('https://hglink.to/e/' + e0.streamwish,
                                'Watch • StreamWish • ' + (e0.quality || ''));
                            if (s5) streams.push(s5);
                        }
                    }
                }
                if (dl) {
                    var fh = await fetchKmhdPage('/file/' + dl.id, true);
                    var f2 = parseFileLinks(fh);
                    var q2 = qualityFromText(f2.name) || 'Download';
                    if (f2.links.hubdrive_res) {
                        var s6 = await loadExtractorSafe('https://hubcloud.cx/drive/' + f2.links.hubdrive_res,
                            'Download • HubCloud • ' + q2);
                        if (s6) streams.push(s6);
                    }
                }
                if (!streams.length) {
                    return cb({ success: false, errorCode: 'NO_STREAMS',
                                message: 'This release has no watch/download links (early TCRip posts often lack them) — try another quality post of the same title.' });
                }
            }

            cb({ success: true, data: streams });
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
