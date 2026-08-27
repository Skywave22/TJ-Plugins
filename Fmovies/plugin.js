/*
 * FMoviess — SkyStream plugin
 * Site:   https://fmoviess.tv
 * Flow:
 *   catalog  : fmoviess.tv SSR pages (trending / movies / tv / search)
 *   metadata : TMDB api (same public key the site's own player uses)
 *   streams  : moviesapi.to vidora API -> direct multi-quality HLS + subtitles
 *
 * Exports: getHome / search / load / loadStreams
 */

(function () {

    'use strict';

    var SITE = (manifest && manifest.baseUrl) || 'https://fmoviess.tv';
    if (SITE.slice(-1) === '/') SITE = SITE.slice(0, -1);

    var TMDB_KEY = 'e716f19ab4d25edc5247239a8f3494f8'; // public key shipped in the player bundle
    var TMDB = 'https://api.themoviedb.org/3';
    var TMDB_IMG = 'https://image.tmdb.org/t/p';

    var VIDORA = 'https://moviesapi.to/api/vidora/v1';
    var PLAYER_KEY = '3a67e8866ae1d2bb9e81fe7f73315a56eb3bdf5e3e755c7554c8be6910aa6b13';
    var PLAYER_REFERER = 'https://moviesapi.to/';

    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    var PLACEHOLDER = 'https://placehold.co/400x600.png?text=FMoviess';

    var MAX_SEASON_FETCH = 10; // fetch per-season details for shows with up to N seasons

    // ─────────────────────────── helpers ───────────────────────────

    function decodeEntities(s) {
        return String(s == null ? '' : s)
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#x27;|&#0?39;/g, "'").replace(/&apos;/g, "'")
            .replace(/&nbsp;/g, ' ');
    }

    async function getText(url, headers) {
        var res = await http_get(url, Object.assign({
            'User-Agent': UA,
            'Accept': 'text/html,application/json,*/*;q=0.8'
        }, headers || {}));
        var body = (res && typeof res === 'object') ? res.body : res;
        var status = (res && typeof res === 'object') ? (res.status || res.statusCode || 0) : 0;
        if (status && (status < 200 || status >= 300)) throw new Error('HTTP ' + status + ' ' + url.slice(0, 80));
        return typeof body === 'string' ? body : '';
    }

    async function getJson(url, headers) {
        var body = await getText(url, Object.assign({ 'Accept': 'application/json' }, headers || {}));
        try { return JSON.parse(body); } catch (e) { throw new Error('Bad JSON from ' + url.slice(0, 70)); }
    }

    function mkItem(obj)      { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj)   { try { return new Episode(obj); }       catch (_) { return obj; } }
    function mkStream(obj) {
        var s;
        try {
            s = new StreamResult({ url: obj.url, source: obj.source || obj.quality, headers: obj.headers, subtitles: obj.subtitles });
            s.quality = obj.quality;
        } catch (_) { s = obj; }
        return s;
    }

    // ─────────────────────── catalog scraping ───────────────────────
    // Cards on every list page:  <a ... href="/(movie|tv)/{id}/{slug}" ...>
    //   <img ... src="https://image.tmdb.org/t/p/...jpg" alt="Title">
    //   <h3 ...>Title</h3>  ...  Movie • 2026 / TV • 2025

    function parseCards(html) {
        var out = [];
        var seen = {};
        var re = /<a\b[^>]*href="\/(movie|tv)\/(\d+)\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            var type = m[1] === 'tv' ? 'series' : 'movie';
            var id = m[2], slug = m[3], inner = m[4];

            if (seen[id + '|' + type]) continue;
            seen[id + '|' + type] = 1;

            var posterM = inner.match(/src="(https:\/\/image\.tmdb\.org\/t\/p\/[^"]+)"/i);
            var titleM = inner.match(/<h3[^>]*>([^<]+)<\/h3>/i)
                       || inner.match(/alt="([^"]{2,120})"/);
            var yearM = inner.match(/(?:Movie|TV)(?:<!-- -->)?\s*(?:•|&bull;)\s*(?:<!-- -->)?(\d{4})/i);

            var title = titleM ? decodeEntities(titleM[1]).trim() : slug.replace(/-/g, ' ');
            if (/^(poster|image|cover)$/i.test(title)) title = slug.replace(/-/g, ' ');

            out.push({
                type: type,
                tmdbId: id,
                slug: slug,
                title: title,
                posterUrl: posterM ? posterM[1] : PLACEHOLDER,
                year: yearM ? parseInt(yearM[1], 10) : undefined
            });
        }
        return out;
    }

    function toUrl(card) {
        return SITE + '/' + (card.type === 'series' ? 'tv' : 'movie') + '/' + card.tmdbId + '/' + card.slug;
    }

    function cardToItem(card) {
        return mkItem({
            title: card.title,
            url: toUrl(card),
            posterUrl: card.posterUrl,
            bannerUrl: card.posterUrl,
            type: card.type,
            year: card.year,
            syncData: { tmdb: String(card.tmdbId) }
        });
    }

    async function fetchPage(path) {
        var html = await getText(SITE + path, { 'Referer': SITE + '/' });
        return parseCards(html);
    }

    // ─────────────────────────── getHome ───────────────────────────

    // "Latest Updated" — shows with an episode airing today (TMDB schedule)
    async function latestUpdated() {
        var tryPaths = ['/tv/airing_today', '/tv/on_the_air'];
        for (var i = 0; i < tryPaths.length; i++) {
            try {
                var d = await tmdb(tryPaths[i] + '?page=1');
                var results = (d && d.results) || [];
                if (!results.length) continue;
                return results.slice(0, 20).map(function (r) {
                    var name = r.name || r.original_name || 'tv';
                    var slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                    return mkItem({
                        title: name,
                        url: SITE + '/tv/' + r.id + '/' + slug,
                        posterUrl: r.poster_path ? (TMDB_IMG + '/w500' + r.poster_path) : PLACEHOLDER,
                        bannerUrl: r.backdrop_path ? (TMDB_IMG + '/w1280' + r.backdrop_path) : undefined,
                        type: 'series',
                        year: r.first_air_date ? parseInt(String(r.first_air_date).slice(0, 4), 10) : undefined,
                        score: r.vote_average || undefined,
                        description: r.overview || undefined,
                        syncData: { tmdb: String(r.id) }
                    });
                });
            } catch (_) { /* try the next schedule endpoint */ }
        }
        return [];
    }

    async function getHome(cb) {
        try {
            var defs = [
                { name: 'Trending',        path: '/trending' },
                { name: 'Latest Movies',   path: '/movies' },
                { name: 'Latest TV Shows', path: '/tv' }
            ];
            var pageRows = await Promise.all(defs.map(function (d) {
                return fetchPage(d.path).then(
                    function (v) { return v; },
                    function (e) { console.error('Row failed:', d.name, e && e.message); return null; }
                );
            }));
            var updated = await latestUpdated().catch(function () { return []; });

            var data = {};
            for (var i = 0; i < defs.length; i++) {
                if (pageRows[i] && pageRows[i].length) {
                    data[defs[i].name] = pageRows[i].slice(0, 20).map(cardToItem);
                }
            }
            if (updated.length) data['Latest Updated'] = updated;

            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'FMoviess returned no content (' + SITE + ')' });
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
            var cards = await fetchPage('/search?q=' + encodeURIComponent(q));
            cb({ success: true, data: cards.slice(0, 30).map(cardToItem) });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── load ───────────────────────────

    // item urls:  https://fmoviess.tv/movie/{id}/{slug}
    //              https://fmoviess.tv/tv/{id}/{slug}
    function parseItemUrl(url) {
        var m = String(url || '').match(/\/(movie|tv)\/(\d+)(?:\/([a-z0-9-]+))?/i);
        if (!m) return null;
        return {
            kind: m[1] === 'tv' ? 'tv' : 'movie',
            tmdbId: m[2],
            slug: m[3] || '',
            season: null,
            episode: null
        };
    }

    async function tmdb(path) {
        return getJson(TMDB + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + TMDB_KEY);
    }

    async function load(url, cb) {
        try {
            var p = parseItemUrl(url);
            if (!p) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized FMoviess URL: ' + url });

            var det;
            try {
                det = await tmdb('/' + (p.kind === 'tv' ? 'tv' : 'movie') + '/' + p.tmdbId);
            } catch (_) { det = null; }

            var title, poster, banner, description, year, score, runtime, status;
            if (det && det.id) {
                title = det.title || det.name || p.slug.replace(/-/g, ' ');
                poster = det.poster_path ? (TMDB_IMG + '/w500' + det.poster_path) : PLACEHOLDER;
                banner = det.backdrop_path ? (TMDB_IMG + '/w1280' + det.backdrop_path) : poster;
                description = det.overview || '';
                var d = det.release_date || det.first_air_date || '';
                year = d ? parseInt(d.slice(0, 4), 10) : undefined;
                score = det.vote_average || undefined;
                runtime = det.runtime || det.episode_run_time && det.episode_run_time[0] || undefined;
                status = det.status === 'Released' || det.status === 'Ended' || det.in_production === false ? 'completed' : 'ongoing';
            } else {
                // fallback: scrape the site detail page og tags
                var html = await getText(url);
                title = (html.match(/<meta property="og:image:alt" content="([^"]*)"/) || [])[1]
                     || (html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1]
                     || p.slug.replace(/-/g, ' ');
                poster = (html.match(/<meta property="og:image" content="([^"]*)"/) || [])[1] || PLACEHOLDER;
                banner = poster;
                description = decodeEntities((html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || '');
                year = parseInt((title.match(/\((19\d{2}|20\d{2})\)/) || [])[1], 10) || undefined;
            }

            var item = {
                title: decodeEntities(title),
                url: SITE + '/' + (p.kind === 'tv' ? 'tv' : 'movie') + '/' + p.tmdbId + (p.slug ? '/' + p.slug : ''),
                posterUrl: poster,
                bannerUrl: banner,
                type: p.kind === 'tv' ? 'series' : 'movie',
                year: year,
                score: score,
                duration: runtime || undefined,
                status: status,
                description: description || undefined,
                syncData: { tmdb: String(p.tmdbId) }
            };

            var episodes = [];

            if (p.kind === 'tv') {
                var seasons = (det && det.seasons) || [];
                if (!seasons.length && det && det.number_of_seasons) {
                    for (var si = 1; si <= det.number_of_seasons; si++) seasons.push({ season_number: si, episode_count: null });
                }
                var real = seasons.filter(function (s) { return s.season_number > 0; });

                if (real.length && real.length <= MAX_SEASON_FETCH) {
                    // fetch season details in parallel -> real episode names, stills, air dates
                    var seasonLists = await Promise.all(real.map(function (s) {
                        return tmdb('/tv/' + p.tmdbId + '/season/' + s.season_number).then(
                            function (v) { return v && v.episodes ? v.episodes : null; },
                            function () { return null; }
                        );
                    }));
                    for (var i = 0; i < real.length; i++) {
                        var sn = real[i].season_number;
                        var eps = seasonLists[i];
                        if (eps && eps.length) {
                            for (var j = 0; j < eps.length; j++) {
                                episodes.push(episodeFromApi(p, sn, eps[j], poster));
                            }
                        } else {
                            var count = real[i].episode_count || 0;
                            for (var k = 0; k < count; k++) {
                                episodes.push(plainEpisode(p, sn, k + 1, poster));
                            }
                        }
                    }
                } else {
                    // too many seasons / no details — build from counts only
                    for (var i2 = 0; i2 < real.length; i2++) {
                        var snum = real[i2].season_number;
                        var cnt = real[i2].episode_count || 0;
                        for (var k2 = 0; k2 < cnt; k2++) {
                            episodes.push(plainEpisode(p, snum, k2 + 1, poster));
                        }
                    }
                }

                if (!episodes.length) {
                    return cb({ success: false, errorCode: 'NO_EPISODES',
                                message: 'No episode list available for this show (TMDB did not respond)' });
                }
            }

            // Movies get a single pseudo-episode (SkyStream's play button needs one)
            if (p.kind === 'movie') {
                episodes = [mkEpisode({
                    name: item.title,
                    url: item.url,
                    season: 1,
                    episode: 1,
                    posterUrl: poster,
                    runtime: runtime || undefined,
                    dubStatus: 'none',
                    playbackPolicy: 'none'
                })];
            }

            item.episodes = episodes;
            cb({ success: true, data: mkItem(item) });
        } catch (e) {
            cb({ success: false, errorCode: 'ERROR', message: String((e && e.message) || e) });
        }
    }

    function episodeUrl(p, season, ep) {
        return SITE + '/tv/' + p.tmdbId + (p.slug ? '/' + p.slug : '') + '?season=' + season + '&episode=' + ep;
    }

    function parseEpisodeQuery(url) {
        var m = String(url || '').match(/[?&]season=(\d+)&episode=(\d+)/);
        return m ? { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) } : null;
    }

    function episodeFromApi(p, season, ep, showPoster) {
        return mkEpisode({
            name: ep.name && ep.name.trim() ? ('E' + ep.episode_number + ' • ' + decodeEntities(ep.name)) : ('Episode ' + ep.episode_number),
            url: episodeUrl(p, season, ep.episode_number),
            season: season,
            episode: ep.episode_number,
            posterUrl: ep.still_path ? (TMDB_IMG + '/w300' + ep.still_path) : showPoster,
            description: ep.overview ? decodeEntities(ep.overview) : undefined,
            airDate: ep.air_date || undefined,
            runtime: ep.runtime || undefined,
            rating: ep.vote_average || undefined,
            dubStatus: 'none',
            playbackPolicy: 'none'
        });
    }

    function plainEpisode(p, season, ep, showPoster) {
        return mkEpisode({
            name: 'Episode ' + ep,
            url: episodeUrl(p, season, ep),
            season: season,
            episode: ep,
            posterUrl: showPoster,
            dubStatus: 'none',
            playbackPolicy: 'none'
        });
    }

    // ─────────────────────────── loadStreams ───────────────────────────

    // quality label from HLS RESOLUTION=WxH — exact height (960p, 640p…)
    // so SkyStream sorts qualities correctly between standards
    function qualityFromResolution(w, h) {
        if (!h) return 'Auto';
        var std = { 2160: '2160p/4K', 1080: '1080p', 720: '720p', 480: '480p' };
        return std[h] ? std[h] : (h + 'p');
    }

    function b64(str) {
        try { return btoa(unescape(encodeURIComponent(str))); } catch (_) { return null; }
    }

    // netrocdn direct URLs geo-block some regions — the sparkvid Cloudflare
    // worker proxies the same path as /cdn/{base64(path)}.js?query
    function toProxyUrl(u) {
        try {
            var qi = u.indexOf('?');
            if (qi < 0) return null;
            var path = u.slice(0, qi), q = u.slice(qi + 1);
            if (path.indexOf('workers.dev') >= 0) return null; // already the proxy
            var noHost = path.replace(/^https?:\/\/[^/]+/, '');
            if (!noHost || noHost.charAt(0) !== '/') noHost = '/' + noHost;
            var enc = b64(noHost);
            if (!enc) return null;
            return 'https://cdn-proxy.sparkvid.workers.dev/cdn/' + enc + '.js?' + q;
        } catch (_) { return null; }
    }

    // ── Server A: moviesapi.to "vidora" (direct HLS + subtitles) ──
    async function vidoraStreams(kind, tmdbId, season, episode) {
        var apiUrl = kind === 'tv'
            ? VIDORA + '/tv/' + tmdbId + '/' + season + '/' + episode
            : VIDORA + '/movie/' + tmdbId;

        var data = null;
        try {
            var res = await http_get(apiUrl, {
                'User-Agent': UA,
                'Accept': 'application/json',
                'x-player-key': PLAYER_KEY,
                'Referer': PLAYER_REFERER,
                'Origin': PLAYER_REFERER.slice(0, -1)
            });
            var body = (res && typeof res === 'object') ? res.body : res;
            try { data = JSON.parse(typeof body === 'string' ? body : JSON.stringify(body)); }
            catch (_) { data = null; }
        } catch (_) { return []; }

        if (!data || !data.result || !data.sources || !data.sources[0] || !data.sources[0].url) {
            return [];
        }

        var master = data.sources[0].url;
        var subs = [];
        (data.sources[0].tracks || []).forEach(function (t) {
            if (t && t.file && t.label) subs.push({ url: t.file, label: t.label, lang: t.label });
        });
        var headers = { 'Referer': PLAYER_REFERER, 'User-Agent': UA };

        var streams = [mkStream({
            url: master,
            quality: 'MoviesAPI • Auto',
            headers: headers,
            subtitles: subs.length ? subs : undefined
        })];

        // split master into per-quality options, each in direct + CF-proxy form
        try {
            var body2 = await getText(master, { 'Referer': PLAYER_REFERER });
            var lines = body2.split('\n');
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].indexOf('#EXT-X-STREAM-INF') === 0) {
                    var resM = lines[i].match(/RESOLUTION=(\d+)x(\d+)/i);
                    var bwM = lines[i].match(/BANDWIDTH=(\d+)/);
                    var next = '';
                    for (var j = i + 1; j < lines.length; j++) {
                        var t = lines[j].trim();
                        if (t && t.charAt(0) !== '#') { next = t; break; }
                    }
                    if (!next) continue;
                    if (next.indexOf('http') !== 0) {
                        next = master.slice(0, master.lastIndexOf('/') + 1) + next;
                    }
                    var q = resM ? qualityFromResolution(parseInt(resM[1], 10), parseInt(resM[2], 10))
                                 : (bwM ? Math.round(parseInt(bwM[1], 10) / 1000) + ' kbps' : 'Auto');
                    streams.push(mkStream({
                        url: next,
                        quality: 'MoviesAPI • ' + q,
                        headers: headers,
                        subtitles: subs.length ? subs : undefined
                    }));
                    var proxied = toProxyUrl(next);
                    if (proxied) {
                        streams.push(mkStream({
                            url: proxied,
                            quality: 'MoviesAPI • ' + q + ' • CF',
                            headers: headers,
                            subtitles: subs.length ? subs : undefined
                        }));
                    }
                }
            }
        } catch (_) { /* master unreadable — Auto option above still stands */ }

        return streams;
    }

    // ── Server B: vixsrc.to (multi-audio HLS masters) ──
    //  /api/{movie|tv}/... -> {"src":"/embed/{id}?token=.."} ->
    //  embed page exposes window.masterPlaylist + window.streams ->
    //  /playlist/{id}?token=..&expires=..&h=1 -> master m3u8
    async function vixsrcStreams(kind, tmdbId, season, episode) {
        var referer = kind === 'tv'
            ? 'https://vixsrc.to/tv/' + tmdbId + '/' + season + '/' + episode
            : 'https://vixsrc.to/movie/' + tmdbId;
        var apiUrl = kind === 'tv'
            ? 'https://vixsrc.to/api/tv/' + tmdbId + '/' + season + '/' + episode
            : 'https://vixsrc.to/api/movie/' + tmdbId;

        var page = '';
        try {
            var api = await getText(apiUrl, { 'Referer': referer, 'Accept': 'application/json' });
            var src = (JSON.parse(api) || {}).src;
            if (!src) return [];
            page = await getText('https://vixsrc.to' + src, { 'Referer': referer });
        } catch (_) { return []; }

        var token = (page.match(/'token'\s*:\s*'([^']+)'/) || [])[1];
        var expires = (page.match(/'expires'\s*:\s*'([^']+)'/) || [])[1];
        if (!token || !expires) return [];
        var canFHD = /window\.canPlayFHD\s*=\s*true/.test(page);

        var streams = [];
        var servers = [];
        try {
            var sj = (page.match(/window\.streams\s*=\s*(\[[^\]]+\])/) || [])[1];
            if (sj) {
                JSON.parse(sj.replace(/\\"/g, '"')).forEach(function (s) {
                    if (s && s.url) servers.push({ name: s.name || 'Server', url: s.url });
                });
            }
        } catch (_) { servers = []; }
        if (!servers.length) {
            servers.push({ name: 'Server 1', url: 'https://vixsrc.to/playlist/' + tmdbId });
        }

        for (var i = 0; i < servers.length && i < 3; i++) {
            try {
                var u = servers[i].url;
                u += (u.indexOf('?') >= 0 ? '&' : '?')
                   + 'token=' + encodeURIComponent(token)
                   + '&expires=' + encodeURIComponent(expires)
                   + '&asn=' + (canFHD ? '&h=1' : '');
                var pl = await getText(u, { 'Referer': referer });
                if (pl.indexOf('#EXTM3U') === 0) {
                    streams.push(mkStream({
                        url: u,
                        quality: 'VixSrc • ' + (servers[i].name || ('Server ' + (i + 1))) + ' • Auto',
                        headers: { 'Referer': referer, 'User-Agent': UA }
                    }));
                }
            } catch (_) { /* this vixsrc server failed — try the next */ }
        }
        return streams;
    }

    async function loadStreams(url, cb) {
        try {
            var p = parseItemUrl(url);
            if (!p) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognized FMoviess URL: ' + url });

            var epq = parseEpisodeQuery(url);
            var kind = p.kind;
            var season = epq ? epq.season : null;
            var episode = epq ? epq.episode : null;
            if (kind === 'tv' && !epq) {
                return cb({ success: false, errorCode: 'BAD_URL', message: 'Episode information missing in URL' });
            }

            // both providers in parallel — different CDNs, so if one is blocked
            // or dead in the user's region the other still plays
            var both = await Promise.all([
                vidoraStreams(kind, p.tmdbId, season, episode).then(
                    function (v) { return v; }, function () { return []; }),
                vixsrcStreams(kind, p.tmdbId, season, episode).then(
                    function (v) { return v; }, function () { return []; })
            ]);

            var streams = both[0].concat(both[1]);

            if (!streams.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS',
                            message: 'No stream available for this title yet (provider has not encoded it — try another title or retry later).' });
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
