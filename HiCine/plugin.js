/*
 * HiCine — SkyStream plugin
 * Site:   https://www.hicine.sbs
 * API:    https://api.hicine.sbs
 * Source: Bollywood & Hollywood movies, WEB series, K-dramas, anime (Hindi dual-audio)
 *
 * Exports: getHome / search / load / loadStreams
 */

(function () {

    'use strict';

    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    var API = (manifest && manifest.baseUrl) || 'https://api.hicine.sbs';
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

    var HOME_ROWS = [
        { name: 'Hollywood Movies', ct: 'movies' },
        { name: 'Hollywood Series', ct: 'series' },
        { name: 'Bollywood Movies', ct: 'bolly_movies' },
        { name: 'Bollywood Series', ct: 'bolly_series' },
        { name: 'Anime',            ct: 'anime' }
    ];

    var MAX_SEASONS = 15;

    // Worker server keys returned by /api/links -> friendly labels
    var SERVER_LABELS = {
        fsl:     'FSL',
        fsl2:    'FSL v2',
        pixel:   'PixelDrain',
        gofile:  'Gofile',
        server1: 'Server 1',
        ten:     '10Gbps'
    };
    // "ten" redirects to an ad-walled hubcloud interstitial that needs a browser,
    // and "gofile" redirects to a gofile.io *page* (not a direct file) — skip both.
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
            s.quality = obj.quality; // older/newer runtimes label differently — set both
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
    //   https://api.hicine.sbs/api/hollywood_series/28295/season/1/episode/3
    function parseItemUrl(url) {
        var m = String(url || '').match(/\/api\/([a-z_]+)\/(\d+)(?:\/season\/(\d+)\/episode\/(\d+))?/i);
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

    function toItem(rec, forceCt) {
        if (!rec) return null;
        var ct = forceCt || rec.contentType;
        var info = COLLECTIONS[ct];
        if (!info) {
            // Unknown content type — try to sniff from categories
            var cats = String(rec.categories || '');
            ct = /anime/i.test(cats) ? 'anime'
               : /bollywood/i.test(cats) ? (/series/i.test(cats) ? 'bolly_series' : 'bolly_movies')
               : /series|korean|k-drama/i.test(cats) ? 'series'
               : 'movies';
            info = COLLECTIONS[ct];
        }
        return mkItem({
            title: cleanTitle(rec.title),
            url: detailUrl(ct, rec.record_id),
            posterUrl: rec.featured_image || rec.poster || PLACEHOLDER,
            type: info.type,
            year: parseYear(rec),
            description: rec.excerpt ? stripTags(rec.excerpt) : undefined
        });
    }

    // Movies: `links` is a block of lines:
    //   https://worker.dev/?vcloud=https://vcloud.fit/xx, Link2, ..., Title 480p ..., 630MB
    function parseMovieLinks(linksField) {
        var out = [];
        String(linksField || '').split(/\r?\n/).forEach(function (line) {
            var m = line.match(/https?:\/\/[^\s,]+/);
            if (!m) return;
            out.push({
                workerUrl: m[0],
                quality: qualityFromText(line) || 'auto',
                size: sizeFromText(line)
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
                var bare = rest.match(/https?:\/\/[^\s,:]+/g) || [];
                bare.forEach(function (u) { variants.push({ url: u, quality: 'auto' }); });
            }
            if (variants.length) out.push({ num: num, variants: variants });
        });
        return out;
    }

    // Worker resolution:
    //   {workerBase}/api/links?vcloud={enc} -> { title, size, tokens: { fsl: {ts, sig}, ... } }
    // Streams are returned as signed /go URLs; the player follows the 302 to the
    // direct file (R2 / PixelDrain). Never http_get the /go URL itself — that
    // would download the whole movie through the plugin sandbox.
    async function resolveWorker(workerUrl, quality, size) {
        var qi = workerUrl.indexOf('?');
        if (qi < 0) return [];
        var base = workerUrl.slice(0, qi);
        if (base.slice(-1) === '/') base = base.slice(0, -1); // "worker.dev/?x=1" -> "worker.dev"
        var vcloud = getQueryParam(workerUrl, 'vcloud');
        if (!vcloud) return [];

        var data = await getJson(base + '/api/links?vcloud=' + encodeURIComponent(vcloud));
        var tokens = (data && data.tokens) || {};
        var fileSize = (data && data.size) || size || '';

        var out = [];
        Object.keys(tokens).forEach(function (t) {
            if (SKIP_SERVERS.indexOf(t) >= 0) return;
            var tk = tokens[t] || {};
            if (!tk.ts || !tk.sig) return;
            var label = (SERVER_LABELS[t] || t.toUpperCase());
            if (quality) label += ' • ' + quality;
            if (fileSize) label += ' • ' + fileSize;

            var goUrl = base + '/go?type=' + encodeURIComponent(t)
                      + '&vcloud=' + encodeURIComponent(vcloud)
                      + '&ts=' + encodeURIComponent(tk.ts)
                      + '&sig=' + encodeURIComponent(tk.sig);

            out.push(mkStream({
                url: goUrl,
                quality: label,
                headers: { 'User-Agent': UA }
            }));
        });
        return out;
    }

    // ─────────────────────────── getHome ───────────────────────────

    async function fetchRow(path, forceCt, limit) {
        var d = await getJson(API + '/api/' + path + '?offset=0&limit=' + (limit || 18));
        var items = (d && Array.isArray(d.data)) ? d.data : (Array.isArray(d) ? d : []);
        return items.map(function (r) { return toItem(r, forceCt); }).filter(Boolean);
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
                tasks.push(fetchRow(COLLECTIONS[row.ct].path, row.ct, 18));
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
            if (!query) return cb({ success: false, errorCode: 'BAD_QUERY', message: 'Empty query' });
            var d = await getJson(API + '/api/search/' + encodeURIComponent(query.trim()));
            var items = (d && Array.isArray(d.data)) ? d.data : (Array.isArray(d) ? d : []);
            var results = items.map(function (r) { return toItem(r); }).filter(Boolean);
            if (!results.length) {
                return cb({ success: false, errorCode: 'NOT_FOUND', message: 'No results for "' + query + '"' });
            }
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
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
            var cats = String(det.categories || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
            if (cats.length && description) description += '\n\n' + cats.join(' • ');

            var item = {
                title: cleanTitle(det.title),
                url: detailUrl(p.ct, p.id),
                posterUrl: det.featured_image || det.poster || PLACEHOLDER,
                type: info.type,
                year: parseYear(det),
                description: description || undefined,
                isAdult: false
            };

            if (info.type === 'movie') {
                item.type = 'movie';
                cb({ success: true, data: mkItem(item) });
                return;
            }

            // Series / anime — build the episode list from season_1..season_N
            var episodes = [];
            var s;
            for (s = 1; s <= MAX_SEASONS; s++) {
                var txt = det['season_' + s];
                if (!txt) continue;
                var eps = parseSeasonEpisodes(txt);
                for (var i = 0; i < eps.length; i++) {
                    episodes.push(mkEpisode({
                        name: 'Episode ' + eps[i].num,
                        url: episodeUrl(p.ct, p.id, s, eps[i].num),
                        season: s,
                        episode: eps[i].num,
                        dubStatus: 'none',
                        playbackPolicy: 'none'
                    }));
                }
            }

            if (!episodes.length) {
                // No parsed episodes — if the record has plain movie-style links, treat as movie
                if (parseMovieLinks(det.links).length) {
                    item.type = 'movie';
                    return cb({ success: true, data: mkItem(item) });
                }
                return cb({ success: false, errorCode: 'NO_EPISODES', message: 'No episodes found for this title' });
            }

            item.type = info.type;
            cb({ success: true, data: mkItem(item), episodes: episodes });
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

            // Collect every (workerUrl, quality) target for this movie / episode
            var targets = [];
            if (p.season != null && p.ep != null) {
                var eps = parseSeasonEpisodes(det['season_' + p.season]);
                var ep = null;
                for (var i = 0; i < eps.length; i++) if (eps[i].num === p.ep) ep = eps[i];
                if (!ep) {
                    return cb({ success: false, errorCode: 'NOT_FOUND',
                                message: 'Episode ' + p.ep + ' not found in season ' + p.season });
                }
                ep.variants.forEach(function (v) {
                    targets.push({ workerUrl: v.url, quality: v.quality, size: '' });
                });
            } else {
                parseMovieLinks(det.links).forEach(function (l) {
                    targets.push({ workerUrl: l.workerUrl, quality: l.quality, size: l.size });
                });
            }

            if (!targets.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No stream links published for this title yet' });
            }

            var streams = [];
            for (var t = 0; t < targets.length; t++) {
                var target = targets[t];
                try {
                    var resolved = await resolveWorker(target.workerUrl, target.quality, target.size);
                    for (var r = 0; r < resolved.length; r++) streams.push(resolved[r]);
                } catch (_) {
                    // Worker failed for this quality — try remaining targets
                }
                // Generic extractor fallback for non-worker hosts (gofile, pixeldrain, ...)
                if (typeof loadExtractor === 'function' && /^https?:\/\//.test(target.workerUrl)
                        && target.workerUrl.indexOf('workers.dev') < 0) {
                    try {
                        var ex = await loadExtractor(target.workerUrl);
                        if (ex && ex.length) {
                            for (var x = 0; x < ex.length; x++) {
                                if (ex[x] && ex[x].url) {
                                    ex[x].quality = (ex[x].quality || target.quality || 'Link');
                                    streams.push(ex[x]);
                                }
                            }
                        }
                    } catch (_) { /* extractor not available for this host */ }
                }
            }

            // De-duplicate identical signed URLs (rare: same file on two keys)
            var seen = {};
            var unique = [];
            streams.forEach(function (s2) {
                if (!seen[s2.url]) { seen[s2.url] = 1; unique.push(s2); }
            });

            if (!unique.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS',
                            message: 'All HiCine servers failed to sign a link (tokens may have expired — retry)' });
            }
            cb({ success: true, data: unique });
        } catch (e) {
       
