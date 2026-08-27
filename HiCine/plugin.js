/*
 * HiCine — SkyStream plugin (v3)
 * Site:   https://www.hicine.sbs
 * API:    https://api.hicine.sbs
 * Source: Bollywood & Hollywood movies, series, K-dramas, anime (Hindi dual-audio)
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

    function buildGoStream(ctx, tokenKey, tk, quality, size) {
        var label = (SERVER_LABELS[tokenKey] || tokenKey.toUpperCase());
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
    //   https://worker.dev/?vcloud=..., Link2, ..., Title 480p ..., 630MB
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
                    size: sizeFromText(seg)
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
    async function resolveWorker(workerUrl, quality, size, allowFallbackServers) {
        var ctx = await fetchWorkerTokens(workerUrl);
        if (!ctx) return [];
        var tokens = (ctx.data && ctx.data.tokens) || {};

        var out = [];
        var keys = Object.keys(tokens);
        if (!allowFallbackServers) {
            keys = keys.filter(function (t) { return SKIP_SERVERS.indexOf(t) < 0; });
        }
        keys.forEach(function (t) {
            var tk = tokens[t] || {};
            if (!tk.ts || !tk.sig) return;
            out.push(buildGoStream(ctx, t, tk, quality, size));
        });
        return out;
    }

    // Bulk mode: one link per file — try the most reliable server first, fall
    // back to the next. Keeps "All Episodes" fast (1 request per episode).
    async function resolveWorkerSingle(workerUrl, quality, labelPrefix) {
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
            var s = buildGoStream(ctx, keys[i], tk, quality, '');
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
                var got = await resolveWorker(target.workerUrl, target.quality, target.size, false);
                if (got.length) return got;
            } catch (e) {
                if (e && e.dead) return []; // confirmed dead — stop retrying
            }
            if (tries < 2) await sleep(350);
        }
        // last resort: allow the ad-walled/page hosts so *something* is listed
        try {
            return await resolveWorker(target.workerUrl, target.quality, target.size, true);
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
            var d = await getJson(API + '/api/search/' + encodeURIComponent(q));
            var items = (d && Array.isArray(d.data)) ? d.data : (Array.isArray(d) ? d : []);

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

            // Series / anime — build the episode list from season_1..season_N
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

            // Collect every (workerUrl, quality) target for this movie / episode
            var targets = [];
            var bulkMode = false;
            var bulkLabelPrefix = '';
            if (p.season != null && p.ep != null) {
                var seasonText = det['season_' + p.season] || '';
                var eps = parseSeasonEpisodes(seasonText);

                if (p.ep === ZIP_EPISODE_NUMBER) {
                    // whole-season complete pack (zip download)
                    parseSeasonZips(det['season_zip']).filter(function (z) {
                        return z.season === p.season;
                    }).forEach(function (z) {
                        targets.push({ workerUrl: z.workerUrl, quality: (z.quality !== 'pack' ? z.quality : 'Pack'), size: z.size });
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
                        targets.push({ workerUrl: v.url, quality: v.quality, size: '' });
                    });
                }
            } else {
                parseMovieLinks(det.links).forEach(function (l) {
                    targets.push({ workerUrl: l.workerUrl, quality: l.quality, size: l.size });
                });
            }

            if (!targets.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS',
                            message: 'No download links uploaded for this title yet — check back later.' });
            }

            var streams = [];
            if (bulkMode) {
                // "All Episodes": resolve one server per episode, small concurrency pool
                var cursor = 0;
                async function bulkRunner() {
                    while (cursor < targets.length) {
                        var t = targets[cursor++];
                        try {
                            var st = await resolveWorkerSingle(t.workerUrl, t.quality, t.bulkLabel);
                            if (st) streams.push(st);
                        } catch (_) { /* skip this episode's link */ }
                    }
                }
                var pool = [];
                for (var w = 0; w < Math.min(3, targets.length); w++) pool.push(bulkRunner());
                await Promise.all(pool);
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

})();
