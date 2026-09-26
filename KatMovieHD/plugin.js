/*
 * KatMovieHD — SkyStream plugin (FIXED 2026-09-26)
 * Site: https://new.katmoviehd.top (now SvelteKit, not WP) + https://links.kmhd.me
 * Fix: WP REST API /wp-json is dead. Migrated to SvelteKit __data.json (devalue format).
 * Flow:
 *   catalog : /__data.json?x-sveltekit-invalidated=01 + /category/[slug]/__data.json
 *   search  : /__data.json?x-sveltekit-invalidated=01&q=QUERY
 *   load    : /[slug]/__data.json -> post_content HTML -> kmhd play/file + gdflix direct
 *   watch   : links.kmhd.me/play/__data.json?id=PLAY_ID -> info:{FILE_ID:{name, streamtape_res, streamwish_res}}
 *   download: gdflix.dev / gd.kmhd.eu / hubcloud.ist resolvers (updated hosts)
 */

(function () {
    'use strict';

    var SITE = (manifest && manifest.baseUrl) || 'https://new.katmoviehd.top';
    if (SITE.slice(-1) === '/') SITE = SITE.slice(0, -1);
    var KMHD = 'https://links.kmhd.me';

    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=KatMovieHD';

    var HUBCLOUD_HOST = 'hubcloud.ist';
    var GDFLIX_HOST = 'new4.gdflix.io';
    var GD_KEY = 'acbe2066696a1d44345698deb3d9ebf9ae9bbdfd';

    // Working hosts: StreamTape, StreamWish, HubCloud, GDFlix (GDFlix kept as fallback for titles that only have GDFlix)
    var TOUCHME_CODES = ['streamtape_res', 'streamwish_res', 'hubdrive_res', 'gdflix_res'];
    var PRIORITY_CODES = ['streamtape_res', 'streamwish_res', 'hubdrive_res']; // user requested these 3
    // Geo bypass headers
    var GEO_HEADERS = {
        'X-Forwarded-For': '8.8.8.8',
        'X-Real-IP': '8.8.8.8',
        'CF-IPCountry': 'US',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    var ROWS = [
        { name: 'Latest Uploads',   slug: null },
        { name: 'Hindi Dubbed',     slug: 'hindi-dubbed' },
        { name: 'Dual Audio',       slug: 'dual-audio' },
        { name: 'TV Series Dubbed', slug: 'tv-series-dubbed' },
        { name: 'Netflix',          slug: 'netflix' },
        { name: 'Hollywood Eng',    slug: 'hollywood-eng' },
        { name: 'Anime Dubbed',     slug: 'anime-dubbed' },
        { name: 'WWE',              slug: 'wwe' }
    ];

    // ───────────────── helpers ─────────────────

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
            'Referer': SITE + '/',
            'Accept-Language': GEO_HEADERS['Accept-Language'],
            'Cache-Control': GEO_HEADERS['Cache-Control'],
            'X-Forwarded-For': GEO_HEADERS['X-Forwarded-For'],
            'CF-IPCountry': GEO_HEADERS['CF-IPCountry']
        };
        if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { h[k] = extraHeaders[k]; });
        var res = await http_get(url, h);
        var body = (res && typeof res === 'object') ? res.body : res;
        var status = (res && typeof res === 'object') ? (res.status || res.statusCode || 0) : 0;
        if (status && (status < 200 || status >= 300)) throw new Error('HTTP ' + status + ' ' + url.slice(0, 80));
        return typeof body === 'string' ? body : '';
    }
    function withTimeout(p, ms) {
        if (typeof setTimeout !== 'function') return p;
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    function mkItem(obj) { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
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
        var q = m[1] ? m[1].toLowerCase() : m[0].toLowerCase();
        return q === '4k' ? '2160p' : q;
    }
    function sizeFromText(t) {
        var m = String(t || '').match(/([\d.]+)\s*(GB|MB)/i);
        return m ? (m[1] + m[2].toUpperCase()) : '';
    }
    function parseTitle(raw) {
        var t = decodeEntities(raw).replace(/\s+/g, ' ').trim();
        var y2 = t.match(/\b(19\d{2}|20\d{2})\b/);
        var year = y2 ? parseInt(y2[1], 10) : undefined;
        var sm = t.match(/^(.*?\(Season\s*\d+\))/i);
        var base = sm ? sm[1] : t;
        var cut = base.split(/\s+(?=(?:Hindi|English|Dual|Dubbed|ORG|Clean|Full|All\s+Episodes|Complete|TCRip|HDRip|WEB|BluRay|AMZN|Netflix|JioHotstar|Prime|1080p|720p|480p|2160p|4K|10bit|x265|x264|DD\b|5\.1))/i)[0];
        cut = cut.replace(/\s*[-–|:]+\\s*$/, '').replace(/\s*\|.*$/, '').trim();
        if (!cut || cut.length < 2) cut = t.split(/\s+(?:Hindi|English|Dual|Dubbed)/i)[0].trim();
        return { name: cut || t.slice(0, 80), year: year };
    }

    // ───────── SvelteKit devalue parser ─────────
    // __data.json is NDJSON: each line is {"type":"chunk","id":N,"data":[...devalue array...]}
    // devalue array: indices are references. Object values that are numbers are pointers.
    function devalueResolve(arr) {
        var resolved = new Array(arr.length);
        var resolving = new Set();
        function get(idx) {
            if (idx < 0 || idx >= arr.length) return idx;
            if (resolved[idx] !== undefined) return resolved[idx];
            if (resolving.has(idx)) return null;
            resolving.add(idx);
            var val = arr[idx];
            if (typeof val === 'number') {
                resolved[idx] = val;
            } else if (Array.isArray(val)) {
                var outA = val.map(function (item) {
                    if (typeof item === 'number') return get(item);
                    if (item && typeof item === 'object') return resolveValue(item);
                    return item;
                });
                resolved[idx] = outA;
            } else if (val && typeof val === 'object') {
                var outO = {};
                for (var k in val) {
                    var vv = val[k];
                    if (typeof vv === 'number') outO[k] = get(vv);
                    else if (vv && typeof vv === 'object') outO[k] = resolveValue(vv);
                    else outO[k] = vv;
                }
                resolved[idx] = outO;
            } else {
                resolved[idx] = val;
            }
            resolving.delete(idx);
            return resolved[idx];
        }
        function resolveValue(v) {
            if (typeof v === 'number') return get(v);
            if (Array.isArray(v)) {
                return v.map(function (item) {
                    if (typeof item === 'number') return get(item);
                    if (item && typeof item === 'object') return resolveValue(item);
                    return item;
                });
            }
            if (v && typeof v === 'object') {
                var out = {};
                for (var kk in v) {
                    var vvv = v[kk];
                    if (typeof vvv === 'number') out[kk] = get(vvv);
                    else if (vvv && typeof vvv === 'object') out[kk] = resolveValue(vvv);
                    else out[kk] = vvv;
                }
                return out;
            }
            return v;
        }
        for (var i = 0; i < arr.length; i++) if (resolved[i] === undefined) get(i);
        return resolved;
    }

    function extractChunks(text) {
        var chunks = [];
        var lines = String(text || '').split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            try {
                var obj = JSON.parse(line);
                if (obj && obj.type === 'chunk' && obj.data) chunks.push(obj.data);
            } catch (e) {}
        }
        return chunks;
    }

    function resolveAllChunks(text) {
        var rawChunks = extractChunks(text);
        var resolvedList = [];
        for (var i = 0; i < rawChunks.length; i++) {
            try {
                var res = devalueResolve(rawChunks[i]);
                resolvedList.push(res);
            } catch (e) {}
        }
        return resolvedList;
    }

    function findItemsInResolved(resolvedList) {
        for (var ci = 0; ci < resolvedList.length; ci++) {
            var res = resolvedList[ci];
            for (var ri = 0; ri < res.length; ri++) {
                var v = res[ri];
                if (!v) continue;
                if (v.items && Array.isArray(v.items)) return v;
                if (v.success && v.data && v.data.items) return v.data;
                if (v.data && v.data.items) return v.data;
            }
        }
        return null;
    }

    function findPostContentInResolved(resolvedList) {
        for (var ci = 0; ci < resolvedList.length; ci++) {
            var res = resolvedList[ci];
            for (var ri = 0; ri < res.length; ri++) {
                var v = res[ri];
                if (!v) continue;
                if (v.post_content && typeof v.post_content === 'string') return v.post_content;
                if (v.data && v.data.post_content) return v.data.post_content;
            }
        }
        return null;
    }

    function findPlayDataInResolved(resolvedList) {
        for (var ci = 0; ci < resolvedList.length; ci++) {
            var res = resolvedList[ci];
            for (var ri = 0; ri < res.length; ri++) {
                var v = res[ri];
                if (!v) continue;
                if (v._id && v.info) return v;
            }
        }
        return null;
    }

    async function fetchSvelteItems(url) {
        var txt = await withTimeout(getText(url), 12000);
        var resolvedList = resolveAllChunks(txt);
        var data = findItemsInResolved(resolvedList);
        return data || { items: [], page: 1, perPage: 0, totalItems: 0, totalPages: 0 };
    }

    async function fetchPostContent(slug) {
        var url = SITE + '/' + slug + '/__data.json?x-sveltekit-invalidated=01';
        var txt = await withTimeout(getText(url), 12000);
        var resolvedList = resolveAllChunks(txt);
        var content = findPostContentInResolved(resolvedList);
        if (content) return content;
        // fallback HTML parse
        try {
            var html = await withTimeout(getText(SITE + '/' + slug), 12000);
            var m = html.match(/"post_content":"([\s\S]*?)"\},"error"/);
            if (m) {
                var unescaped = m[1].replace(/\\u003C/g, '<').replace(/\\u003E/g, '>').replace(/\\u002F/g, '/').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
                return unescaped;
            }
            return html;
        } catch (e) {
            return '';
        }
    }

    async function fetchPlayData(playId) {
        var url = KMHD + '/play/__data.json?x-sveltekit-invalidated=01&id=' + encodeURIComponent(playId);
        var txt = await withTimeout(getText(url, { 'Referer': KMHD + '/', 'Origin': KMHD }), 12000);
        var resolvedList = resolveAllChunks(txt);
        var playData = findPlayDataInResolved(resolvedList);
        if (playData) return playData;
        // fallback: try HTML page script extraction
        try {
            var html = await withTimeout(getText(KMHD + '/play?id=' + playId, { 'Referer': KMHD + '/' }), 12000);
            var info = {};
            var re = /(\w+):\{name:"([^"]+)"((?:,[a-z_]+:"[^"]*")*)\}/g;
            var mm;
            while ((mm = re.exec(html)) !== null) {
                var fname = mm[2];
                if (!/(?:\.|\s)(mkv|mp4|avi)\b/i.test(fname)) continue;
                var rest = mm[3] || '';
                var st = (rest.match(/streamtape_res:"([^"]*)"/) || [])[1];
                var sw = (rest.match(/streamwish_res:"([^"]*)"/) || [])[1];
                if (st === 'None') st = null;
                if (sw === 'None') sw = null;
                info[mm[1]] = { name: fname, streamtape_res: st, streamwish_res: sw };
            }
            if (Object.keys(info).length) return { _id: playId, name: 'Play ' + playId, info: info };
        } catch (e) {}
        return null;
    }

    // ───────── kmhd link parsing ─────────
    function parseKmhdLinks(contentHtml) {
        var out = [];
        var re = /<a[^>]+href=["'](?:https?:\/\/links\.kmhd\.(?:me|eu))?\/(play|file|pack)\/?(?:\?id=|=)?([A-Za-z0-9_-]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        var m;
        while ((m = re.exec(contentHtml)) !== null) {
            var label = stripTags(m[3]);
            out.push({ kind: m[1], id: m[2], label: label });
        }
        var re2 = /<a[^>]+href=["'](https?:\/\/(?:gdflix\.dev|gd\.kmhd\.eu|new\d*\.gdflix\.io)\/file\/[A-Za-z0-9]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        while ((m = re2.exec(contentHtml)) !== null) {
            var label2 = stripTags(m[2]);
            out.push({ kind: 'gdflix_direct', id: m[1], label: label2, url: m[1] });
        }
        // Extra hosts found in Idiots 2026 and other CAMRip titles: 1xplayer iframe, bbupload, gofile
        var reIframe = /<iframe[^>]+src=["'](https?:\/\/(?:vd\.)?1xplayer\.com\/[^"']+)["']/gi;
        while ((m = reIframe.exec(contentHtml)) !== null) {
            out.push({ kind: '1xplayer', id: m[1], label: '1XPlayer', url: m[1] });
        }
        var reGoFile = /<a[^>]+href=["'](https?:\/\/(?:download\.bbupload\.to\/download\?v=[A-Za-z0-9]+|gofile\.io\/d\/[A-Za-z0-9]+|bbupload\.to\/[^"']+))["'][^>]*>([\s\S]*?)<\/a>/gi;
        while ((m = reGoFile.exec(contentHtml)) !== null) {
            var label3 = stripTags(m[2]) || 'GoFile';
            out.push({ kind: 'gofile', id: m[1], label: label3, url: m[1] });
        }
        return out;
    }

    function parsePlayInfoFromData(playData) {
        var episodes = [];
        var info = playData.info || {};
        var keys = Object.keys(info);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = info[k];
            if (!v || !v.name) continue;
            if (!/(?:\.|\s)(mkv|mp4|avi)\b/i.test(v.name)) continue;
            var sem = v.name.match(/S(\d{1,2})\s?E(\d{1,3})/i);
            episodes.push({
                key: k,
                name: v.name,
                season: sem ? parseInt(sem[1], 10) : 1,
                episode: sem ? parseInt(sem[2], 10) : episodes.length + 1,
                quality: qualityFromText(v.name),
                streamtape: v.streamtape_res && v.streamtape_res !== 'None' ? v.streamtape_res : null,
                streamwish: v.streamwish_res && v.streamwish_res !== 'None' ? v.streamwish_res : null
            });
        }
        return episodes;
    }

    // ───────── direct host resolvers ─────────
    async function resolveHubcloud(pageUrl) {
        var out = [];
        try {
            var html = await withTimeout(getText(pageUrl, { 'Referer': 'https://' + HUBCLOUD_HOST + '/' }), 15000);
            var dl = (html.match(/id=["']download["'][^>]*href=["']([^"']+)["']/) ||
                      html.match(/href=["']([^"']*hubcloud\.php[^"']+)["']/) || [])[1];
            if (!dl) return out;
            dl = dl.replace(/&amp;/g, '&');
            if (/hubcloud\.php|gamerxyt/.test(dl)) {
                var d2 = await withTimeout(getText(dl, { 'Referer': pageUrl }), 15000);
                var r2 = (d2.match(/https:\/\/[^"'\s<>]*r2\.cloudflarestorage\.com[^"'\s<>]+/) || [])[0];
                if (r2) out.push(r2.replace(/&amp;/g, '&'));
                var px = (d2.match(/https:\/\/pixel\.hubcloud\.cx\/\?id=[^"'\s<>]+/) || [])[0];
                if (px) out.push(px);
                if (!out.length) {
                    var pd = (d2.match(/https:\/\/pixeldrain\.(?:com|dev)\/u\/[A-Za-z0-9]+/) || [])[0];
                    if (pd) {
                        var mm = pd.match(/\/u\/([A-Za-z0-9]+)/);
                        if (mm) out.push('https://pixeldrain.com/api/file/' + mm[1] + '?download');
                    }
                }
            } else if (/r2\.cloudflarestorage\.com|pixel\.hubcloud|pixeldrain/.test(dl)) {
                out.push(dl);
            }
        } catch (_) {}
        return out;
    }

    async function resolveGdflix(pageUrl) {
        var instant = [], direct = [];
        try {
            var fid = (String(pageUrl).match(/\/file\/([A-Za-z0-9]+)/) || [])[1];
            if (!fid) return { instant: instant, urls: direct, r2: [] };
            var pageUrlRef = 'https://' + GDFLIX_HOST + '/file/' + fid;
            try {
                var html = await withTimeout(getText(pageUrl, { 'Referer': 'https://' + GDFLIX_HOST + '/' }), 12000);
                var r2m = html.match(/https:\/\/pub-[^\s"']+\.r2\.dev\/[^\s"']+\?token=[^\s"']+/g);
                if (r2m) {
                    for (var i = 0; i < r2m.length; i++) {
                        var u = r2m[i].replace(/&amp;/g, '&');
                        if (direct.indexOf(u) < 0) direct.push(u);
                    }
                }
                var instantM = html.match(/https:\/\/[^"']*busycdn\.xyz\/[^"']+/g);
                if (instantM) {
                    for (var j = 0; j < instantM.length; j++) {
                        var iu = instantM[j].replace(/&amp;/g, '&');
                        if (instant.indexOf(iu) < 0) instant.push(iu);
                    }
                }
                if (direct.length || instant.length) {
                    return { instant: instant, urls: direct, r2: direct };
                }
            } catch (e) {}
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
            var iu2 = String(res[0].url || '').replace(/&amp;/g, '&');
            if (!res[0].error && iu2.indexOf('http') === 0) instant.push(iu2);
            var u2 = String(res[1].url || '').replace(/&amp;/g, '&');
            if (!res[1].error && u2.indexOf('http') === 0) direct.push(u2);
        } catch (_) {}
        return { instant: instant, urls: direct, r2: direct };
    }

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
        var m = html.match(/id="robotlink"[^>]*>([^<]+)</);
        if (m) {
            var u = m[1].trim().replace(/^\/(?=[^\/])/, '//');
            if (u.indexOf('//') === 0) return 'https:' + u;
            if (u.indexOf('http') === 0) return u;
        }
        return null;
    }

    // ───────── KMHD touchme API — key to getting ALL mirrors ─────────
    // POST https://links.kmhd.me/api/touchme/{fileId}?c={code} → {status:"Done", linkId:"https://..."}
    async function touchMe(fileId, code) {
        if (!fileId || !code) return null;
        try {
            var url = KMHD + '/api/touchme/' + encodeURIComponent(fileId) + '?c=' + encodeURIComponent(code);
            var res = await withTimeout(http_post(url, {
                'User-Agent': UA,
                'Referer': KMHD + '/play?id=xxx',
                'Origin': KMHD,
                'Accept': 'application/json',
                'Accept-Language': GEO_HEADERS['Accept-Language'],
                'X-Forwarded-For': GEO_HEADERS['X-Forwarded-For'],
                'CF-IPCountry': GEO_HEADERS['CF-IPCountry'],
                'Cache-Control': 'no-cache'
            }, ''), 10000);
            var body = (res && res.body) || '';
            var j = null;
            try { j = JSON.parse(body); } catch (e) { return null; }
            if (j && j.status === 'Done' && j.linkId) return j.linkId;
            return null;
        } catch (_) { return null; }
    }

    async function fetchAllMirrors(fileId) {
        var out = {};
        try {
            var results = await Promise.all(TOUCHME_CODES.map(function (code) {
                return touchMe(fileId, code).then(function (link) { return { code: code, link: link }; });
            }));
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                if (r.link) out[r.code] = r.link;
            }
        } catch (_) {}
        return out;
    }

    // ───────── catalog ─────────
    function postToItemFromSvelte(item) {
        if (!item || !item.slug) return null;
        var pt = parseTitle(item.post_title || item.slug || '');
        var url = SITE + '/' + item.slug;
        var thumb = item.thumbnail_image || PLACEHOLDER;
        var cats = item.categories || [];
        var isSeries = cats.indexOf('tv-series-dubbed') >= 0 || cats.indexOf('series') >= 0 || /\(Season\s*\d+\)/i.test(item.post_title || '') || /web[- ]series/i.test(item.post_title || '');
        return mkItem({
            title: pt.name,
            url: url,
            posterUrl: thumb,
            bannerUrl: thumb,
            type: isSeries ? 'series' : 'movie',
            year: pt.year
        });
    }

    async function fetchCategory(slug) {
        var url = slug ? SITE + '/category/' + slug + '/__data.json?x-sveltekit-invalidated=01' : SITE + '/__data.json?x-sveltekit-invalidated=01';
        try {
            var data = await fetchSvelteItems(url);
            return data.items || [];
        } catch (e) {
            console.error('Category fetch failed:', slug, e && e.message);
            return [];
        }
    }

    async function getHome(cb) {
        try {
            var settled = await Promise.all(ROWS.map(function (row) {
                return fetchCategory(row.slug).then(function (v) { return v; }, function (e) { console.error('Row failed:', row.name, e && e.message); return []; });
            }));
            var data = {};
            for (var i = 0; i < ROWS.length; i++) {
                if (settled[i] && settled[i].length) {
                    var items = settled[i].slice(0, 20).map(postToItemFromSvelte).filter(Boolean);
                    if (items.length) data[ROWS[i].name] = items;
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
            var url = SITE + '/__data.json?x-sveltekit-invalidated=01&q=' + encodeURIComponent(q) + '&page=1';
            var data = await fetchSvelteItems(url);
            var items = (data.items || []).map(postToItemFromSvelte).filter(Boolean);
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────── load ─────────
    function parseItemUrl(url) {
        var m = String(url || '').match(/\/([^\/\?#]+)\/?(?:\?(.*))?$/);
        if (!m) return null;
        var slug = m[1];
        var query = m[2] || '';
        var mode = null, arg = null;
        var pm = query.match(/play=([A-Za-z0-9_-]+)/); if (pm) { mode = 'play'; arg = pm[1]; }
        var fm = query.match(/dl=([A-Za-z0-9_-]+)/); if (fm) { mode = 'dl'; arg = fm[1]; }
        if (String(url).indexOf('gdflix.dev/file/') >= 0 || String(url).indexOf('gd.kmhd.eu/file/') >= 0 || String(url).indexOf('new4.gdflix.io/file/') >= 0) {
            return { slug: slug, mode: 'gdflix', arg: url };
        }
        return { slug: slug, mode: mode, arg: arg, query: query };
    }

    async function load(url, cb) {
        try {
            var p = parseItemUrl(url);
            if (!p || !p.slug) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized KatMovieHD URL: ' + url });

            var content = await fetchPostContent(p.slug);
            if (!content) content = await withTimeout(getText(SITE + '/' + p.slug), 12000);

            var links = parseKmhdLinks(content);
            var play = null;
            links.forEach(function (l) {
                if (l.kind === 'play' && !play) play = l;
            });

            var pt = parseTitle(content.match(/<title>([^<]+)<\/title>/) ? RegExp.$1 : p.slug);
            var posterMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
            var poster = posterMatch ? posterMatch[1] : PLACEHOLDER;

            var baseItemUrl = SITE + '/' + p.slug;
            var episodes = [];
            var isSeries = false;

            if (play) {
                try {
                    var playData = await fetchPlayData(play.id);
                    if (playData && playData.info) {
                        var eps = parsePlayInfoFromData(playData);
                        // Sort by season/episode
                        eps.sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); });
                        eps.forEach(function (e, idx) {
                            // Use parsed season, but episode number sequential within season
                            episodes.push(mkEpisode({
                                name: e.name,
                                url: baseItemUrl + '?play=' + play.id + '&ep=' + e.key,
                                season: e.season,
                                episode: e.episode,
                                posterUrl: poster,
                                dubStatus: 'none',
                                playbackPolicy: 'none'
                            }));
                        });
                        if (eps.length > 1 || /season/i.test(pt.name)) isSeries = true;
                    }
                } catch (e) {
                    console.error('Play data fetch failed', e && e.message);
                }

                // ── Try to merge other seasons under same base title (fix separate posters for S1/S2) ──
                try {
                    // Derive base name from slug for reliable search: mobland-s2-hindi -> mobland
                    var baseSlug = p.slug.toLowerCase();
                    var mBase = baseSlug.match(/^(.+?)-s\d+/);
                    if (!mBase) mBase = baseSlug.match(/^(.+?)-season-\d+/);
                    var baseSearch = mBase ? mBase[1].replace(/-/g, ' ') : pt.name;
                    var baseName = baseSearch; // e.g., "mobland"
                    // Search for related seasons
                    var searchUrl = SITE + '/__data.json?x-sveltekit-invalidated=01&q=' + encodeURIComponent(baseName) + '&page=1';
                    var searchData = await withTimeout(fetchSvelteItems(searchUrl), 8000);
                    var related = (searchData.items || []).filter(function (it) {
                        if (!it.slug || it.slug === p.slug) return false;
                        var title = (it.post_title || '').toLowerCase();
                        var baseLower = baseName.toLowerCase();
                        // Must contain base name and be a season
                        if (title.indexOf(baseLower) < 0) return false;
                        if (!/season\s*\d+/i.test(it.post_title || '')) return false;
                        // Avoid duplicates
                        return true;
                    }).slice(0, 3); // max 3 other seasons

                    for (var ri = 0; ri < related.length; ri++) {
                        var rel = related[ri];
                        try {
                            var relContent = await withTimeout(fetchPostContent(rel.slug), 8000);
                            var relLinks = parseKmhdLinks(relContent);
                            var relPlay = null;
                            for (var rli = 0; rli < relLinks.length; rli++) if (relLinks[rli].kind === 'play') { relPlay = relLinks[rli]; break; }
                            if (!relPlay) continue;
                            var relPlayData = await withTimeout(fetchPlayData(relPlay.id), 8000);
                            if (!relPlayData || !relPlayData.info) continue;
                            var relEps = parsePlayInfoFromData(relPlayData);
                            relEps.forEach(function (re) {
                                // Avoid duplicate file keys
                                var exists = episodes.some(function (ex) { return ex.url.indexOf(re.key) >= 0; });
                                if (exists) return;
                                episodes.push(mkEpisode({
                                    name: re.name,
                                    url: baseItemUrl + '?play=' + relPlay.id + '&ep=' + re.key,
                                    season: re.season,
                                    episode: re.episode,
                                    posterUrl: poster,
                                    dubStatus: 'none',
                                    playbackPolicy: 'none'
                                }));
                            });
                            isSeries = true;
                        } catch (e) {}
                    }
                    // Re-sort after merging and deduplicate by season+episode
                    episodes.sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); });
                    var seenEp = {};
                    var deduped = [];
                    for (var di = 0; di < episodes.length; di++) {
                        var ep = episodes[di];
                        var key = ep.season + ':' + ep.episode;
                        if (!seenEp[key]) {
                            seenEp[key] = true;
                            deduped.push(ep);
                        }
                    }
                    episodes = deduped;
                } catch (e) {
                    console.error('Season merge failed', e && e.message);
                }
            }

            if (!episodes.length) {
                episodes.push(mkEpisode({
                    name: pt.name || p.slug,
                    url: baseItemUrl,
                    season: 1, episode: 1,
                    posterUrl: poster,
                    dubStatus: 'none', playbackPolicy: 'none'
                }));
            }

            // For movies without play data, ensure we have at least 1 episode that will try GDFlix direct links in loadStreams
            var item = mkItem({
                title: pt.name || p.slug,
                url: baseItemUrl,
                posterUrl: poster,
                bannerUrl: poster,
                type: (isSeries || episodes.length > 1) ? 'series' : 'movie',
                year: pt.year,
                episodes: episodes
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────── loadStreams ─────────
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

            var streams = [];

            // Direct GDFlix URL fallback — try to get HubCloud via fileId if possible, otherwise return GDFlix as last resort
            if (p.mode === 'gdflix' && p.arg) {
                // Try to resolve GDFlix to R2 (may be blocked by CF in Node, but works in app)
                try {
                    var gdRes = await resolveGdflix(p.arg);
                    var all = gdRes.instant.concat(gdRes.urls);
                    for (var i = 0; i < all.length; i++) {
                        streams.push(mkStream({
                            url: all[i],
                            quality: 'HubCloud • GDFlix R2 • ' + (qualityFromText(all[i]) || '1080p'),
                            headers: { 'User-Agent': UA, 'Referer': p.arg, 'Accept-Language': GEO_HEADERS['Accept-Language'] }
                        }));
                    }
                } catch (e) {}
                // If still nothing, return original link as fallback so app's own extractor can try
                if (!streams.length) {
                    streams.push(mkStream({
                        url: p.arg,
                        quality: 'GDFlix • Original • ' + (qualityFromText(p.arg) || '1080p'),
                        headers: { 'User-Agent': UA, 'Referer': 'https://' + GDFLIX_HOST + '/', 'Accept-Language': GEO_HEADERS['Accept-Language'] }
                    }));
                }
                if (streams.length) return cb({ success: true, data: streams });
            }

            var content = await fetchPostContent(p.slug);
            var playIdMatch = String(url).match(/play=([A-Za-z0-9_-]+)/);
            var epKeyMatch = String(url).match(/ep=([A-Za-z0-9_-]+)/);
            var dlMatch = String(url).match(/dl=([A-Za-z0-9_-]+)/);

            var fileId = null;
            if (playIdMatch && epKeyMatch) fileId = epKeyMatch[1];
            else if (dlMatch) fileId = dlMatch[1];

            // ────── FileId via touchme — ONLY 3 hosts per user request ──────
            if (fileId) {
                var epName = '';
                var q = '';
                if (playIdMatch) {
                    try {
                        var playDataTmp = await fetchPlayData(playIdMatch[1]);
                        if (playDataTmp && playDataTmp.info && playDataTmp.info[fileId]) {
                            epName = playDataTmp.info[fileId].name || '';
                            q = qualityFromText(epName) || '';
                        }
                    } catch (e) {}
                }

                // 1) StreamTape + StreamWish from playData (fast)
                if (playIdMatch && epKeyMatch) {
                    try {
                        var playData = await fetchPlayData(playIdMatch[1]);
                        if (playData && playData.info && playData.info[fileId]) {
                            var ep = playData.info[fileId];
                            if (ep.streamtape_res) {
                                var direct = await extractStreamTape('https://streamtape.com/e/' + ep.streamtape_res);
                                if (direct) {
                                    streams.push(mkStream({
                                        url: direct,
                                        quality: 'StreamTape • ' + (q || '1080p'),
                                        headers: { 'User-Agent': UA, 'Referer': 'https://streamtape.com/', 'Accept-Language': GEO_HEADERS['Accept-Language'] }
                                    }));
                                } else {
                                    var s1 = await loadExtractorSafe('https://streamtape.com/e/' + ep.streamtape_res, 'StreamTape • ' + (q || '1080p'));
                                    if (s1) streams.push(s1);
                                }
                            }
                            if (ep.streamwish_res) {
                                var s2 = await loadExtractorSafe('https://hglink.to/e/' + ep.streamwish_res, 'StreamWish • ' + (q || '1080p'));
                                if (s2) streams.push(s2);
                            }
                        }
                    } catch (e) {}
                }

                // 2) HubCloud via touchme — with geo bypass + R2 direct + GDFlix fallback
                try {
                    var mirrors = await fetchAllMirrors(fileId);
                    // Priority: StreamTape, StreamWish, HubCloud
                    if (mirrors.hubdrive_res) {
                        var hubLinks = await resolveHubcloud(mirrors.hubdrive_res);
                        if (hubLinks.length) {
                            for (var hi = 0; hi < hubLinks.length; hi++) {
                                streams.push(mkStream({
                                    url: hubLinks[hi],
                                    quality: 'HubCloud • ' + (q || '1080p') + ' • Direct',
                                    headers: { 'User-Agent': UA, 'Referer': mirrors.hubdrive_res, 'Accept-Language': GEO_HEADERS['Accept-Language'], 'X-Forwarded-For': GEO_HEADERS['X-Forwarded-For'] }
                                }));
                            }
                        } else {
                            streams.push(mkStream({
                                url: mirrors.hubdrive_res,
                                quality: 'HubCloud • ' + (q || '1080p') + ' • Watch Online',
                                headers: { 'User-Agent': UA, 'Referer': 'https://' + HUBCLOUD_HOST + '/', 'Accept-Language': GEO_HEADERS['Accept-Language'], 'X-Forwarded-For': GEO_HEADERS['X-Forwarded-For'], 'CF-IPCountry': 'US' }
                            }));
                        }
                    }
                    // GDFlix fallback — for titles that only have GDFlix on website
                    if (!streams.length && mirrors.gdflix_res) {
                        try {
                            var gd = await resolveGdflix(mirrors.gdflix_res);
                            var allG = gd.instant.concat(gd.urls);
                            if (allG.length) {
                                for (var gi = 0; gi < allG.length; gi++) {
                                    streams.push(mkStream({
                                        url: allG[gi],
                                        quality: 'GDFlix • ' + (q || '1080p') + ' • ' + (gi === 0 ? 'Instant' : 'Direct'),
                                        headers: { 'User-Agent': UA, 'Referer': mirrors.gdflix_res, 'Accept-Language': GEO_HEADERS['Accept-Language'] }
                                    }));
                                }
                            } else {
                                streams.push(mkStream({
                                    url: mirrors.gdflix_res,
                                    quality: 'GDFlix • ' + (q || '1080p'),
                                    headers: { 'User-Agent': UA, 'Referer': 'https://' + GDFLIX_HOST + '/' }
                                }));
                            }
                        } catch (e) {
                            streams.push(mkStream({ url: mirrors.gdflix_res, quality: 'GDFlix • ' + (q || '1080p'), headers: { 'User-Agent': UA } }));
                        }
                    }
                    // If touchme returned StreamTape/StreamWish as direct http links (not codes), also add
                    if (mirrors.streamtape_res && mirrors.streamtape_res.indexOf('http') === 0) {
                        if (mirrors.streamtape_res.indexOf('streamtape.com/e/') >= 0) {
                            var stDirect = await extractStreamTape(mirrors.streamtape_res);
                            if (stDirect) {
                                streams.push(mkStream({ url: stDirect, quality: 'StreamTape • ' + (q || '1080p'), headers: { 'User-Agent': UA, 'Referer': 'https://streamtape.com/' } }));
                            } else {
                                streams.push(mkStream({ url: mirrors.streamtape_res, quality: 'StreamTape • ' + (q || '1080p'), headers: { 'User-Agent': UA } }));
                            }
                        }
                    }
                    if (mirrors.streamwish_res && mirrors.streamwish_res.indexOf('http') === 0) {
                        var sw = await loadExtractorSafe(mirrors.streamwish_res, 'StreamWish • ' + (q || '1080p'));
                        if (sw) streams.push(sw);
                        else streams.push(mkStream({ url: mirrors.streamwish_res, quality: 'StreamWish • ' + (q || '1080p'), headers: { 'User-Agent': UA } }));
                    }
                } catch (e) {
                    console.error('fetchAllMirrors failed', e && e.message);
                }

                // Deduplicate by URL
                var seen = {};
                var uniq = [];
                for (var si = 0; si < streams.length; si++) {
                    var su = streams[si].url;
                    if (!seen[su]) { seen[su] = true; uniq.push(streams[si]); }
                }
                streams = uniq;
                if (!streams.length) {
                    return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No StreamTape/StreamWish/HubCloud mirrors for ' + fileId });
                }
                return cb({ success: true, data: streams });
            }

            // ────── Plain movie URL — use first fileId + GDFlix direct fallback ──────
            var links = parseKmhdLinks(content);
            var play = null;
            for (var li = 0; li < links.length; li++) if (links[li].kind === 'play') { play = links[li]; break; }
            if (play) {
                try {
                    var pd = await fetchPlayData(play.id);
                    if (pd && pd.info) {
                        var keys = Object.keys(pd.info);
                        if (keys.length) {
                            var firstId = keys[0];
                            var first = pd.info[firstId];
                            var qFirst = qualityFromText(first.name) || '';
                            var mirrorsFirst = await fetchAllMirrors(firstId);
                            if (mirrorsFirst.hubdrive_res) {
                                var hubFirst = await resolveHubcloud(mirrorsFirst.hubdrive_res);
                                if (hubFirst.length) {
                                    for (var hf = 0; hf < hubFirst.length; hf++) {
                                        streams.push(mkStream({ url: hubFirst[hf], quality: 'HubCloud • ' + qFirst + ' • Direct', headers: { 'User-Agent': UA, 'Referer': mirrorsFirst.hubdrive_res, 'Accept-Language': GEO_HEADERS['Accept-Language'] } }));
                                    }
                                } else {
                                    streams.push(mkStream({ url: mirrorsFirst.hubdrive_res, quality: 'HubCloud • ' + qFirst + ' • Watch Online', headers: { 'User-Agent': UA, 'Accept-Language': GEO_HEADERS['Accept-Language'] } }));
                                }
                            }
                            if (first.streamtape_res) {
                                var d0 = await extractStreamTape('https://streamtape.com/e/' + first.streamtape_res);
                                if (d0) streams.push(mkStream({ url: d0, quality: 'StreamTape • ' + qFirst, headers: { 'User-Agent': UA } }));
                                else {
                                    var s4 = await loadExtractorSafe('https://streamtape.com/e/' + first.streamtape_res, 'StreamTape • ' + qFirst);
                                    if (s4) streams.push(s4);
                                }
                            }
                            if (first.streamwish_res) {
                                var s5 = await loadExtractorSafe('https://hglink.to/e/' + first.streamwish_res, 'StreamWish • ' + qFirst);
                                if (s5) streams.push(s5);
                            }
                            // GDFlix fallback if priority hosts gave nothing
                            if (!streams.length && mirrorsFirst.gdflix_res) {
                                try {
                                    var gdFirst = await resolveGdflix(mirrorsFirst.gdflix_res);
                                    var allFirst = gdFirst.instant.concat(gdFirst.urls);
                                    if (allFirst.length) {
                                        for (var gf = 0; gf < allFirst.length; gf++) {
                                            streams.push(mkStream({ url: allFirst[gf], quality: 'GDFlix • ' + qFirst, headers: { 'User-Agent': UA } }));
                                        }
                                    } else {
                                        streams.push(mkStream({ url: mirrorsFirst.gdflix_res, quality: 'GDFlix • ' + qFirst, headers: { 'User-Agent': UA } }));
                                    }
                                } catch (e) {
                                    streams.push(mkStream({ url: mirrorsFirst.gdflix_res, quality: 'GDFlix • ' + qFirst, headers: { 'User-Agent': UA } }));
                                }
                            }
                        }
                    }
                } catch (e) {}
            }
            // Fallback: GDFlix direct links found in post_content (for movies that only have GDFlix on website)
            if (!streams.length) {
                var gLinks3 = content.match(/https?:\/\/(?:gdflix\.dev|gd\.kmhd\.eu|new\d*\.gdflix\.io)\/file\/[A-Za-z0-9]+/g) || [];
                for (var gm = 0; gm < Math.min(gLinks3.length, 2); gm++) {
                    try {
                        var gd3 = await resolveGdflix(gLinks3[gm]);
                        var all3 = gd3.instant.concat(gd3.urls);
                        if (all3.length) {
                            for (var gn = 0; gn < all3.length; gn++) {
                                streams.push(mkStream({ url: all3[gn], quality: 'GDFlix • Direct • ' + (qualityFromText(content) || '1080p'), headers: { 'User-Agent': UA, 'Referer': gLinks3[gm] } }));
                            }
                        } else {
                            streams.push(mkStream({ url: gLinks3[gm], quality: 'GDFlix • Direct', headers: { 'User-Agent': UA } }));
                        }
                    } catch (e) {}
                }
            }
            // Fallback: 1xPlayer iframe and GoFile/BBUpload for CAMRip titles like Idiots 2026
            if (!streams.length) {
                var extraLinks = parseKmhdLinks(content);
                for (var eli = 0; eli < extraLinks.length; eli++) {
                    var el = extraLinks[eli];
                    if (el.kind === '1xplayer') {
                        // Try extractor first, then direct iframe as fallback
                        var ex1 = await loadExtractorSafe(el.url, '1XPlayer • ' + (qualityFromText(content) || '1080p'));
                        if (ex1) streams.push(ex1);
                        else streams.push(mkStream({ url: el.url, quality: '1XPlayer • ' + (qualityFromText(content) || '1080p'), headers: { 'User-Agent': UA, 'Referer': SITE + '/' } }));
                    } else if (el.kind === 'gofile') {
                        var exG = await loadExtractorSafe(el.url, 'GoFile • ' + (el.label || '1080p'));
                        if (exG) streams.push(exG);
                        else streams.push(mkStream({ url: el.url, quality: 'GoFile • ' + (el.label || '1080p'), headers: { 'User-Agent': UA } }));
                    }
                }
            }
            // Deduplicate
            var seen2 = {};
            var uniq2 = [];
            for (var si2 = 0; si2 < streams.length; si2++) {
                var su2 = streams[si2].url;
                if (!seen2[su2]) { seen2[su2] = true; uniq2.push(streams[si2]); }
            }
            streams = uniq2;
            if (!streams.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No StreamTape/StreamWish/HubCloud streams found' });
            }
            return cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
