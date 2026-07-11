(function() {
    /**
     * MEGA BUNDLE PLUGIN - 5 in 1
     * PopcornMovies + Cineby + ZStream + PrimeShows + FireFlix
     * @type {import('@skystream/sdk').Manifest}
     */
    // manifest is injected by SkyStream runtime

    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49"; // public key used by many plugins (yflix etc)
    const TMDB_API = "https://api.themoviedb.org/3";
    const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
    const TMDB_ORIGINAL = "https://image.tmdb.org/t/p/original";

    // Current active source
    const CURRENT_BASE = (typeof manifest !== "undefined" && manifest.baseUrl) ? manifest.baseUrl.replace(/\/+$/, "") : "https://popcornmovies.io";
    const PROVIDER_ID = (typeof manifest !== "undefined" && manifest.providerId) ? manifest.providerId : "";

    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9"
    };

    function getProviderLabel() {
        if (PROVIDER_ID) return PROVIDER_ID;
        if (CURRENT_BASE.includes("cineby")) return "cineby";
        if (CURRENT_BASE.includes("zstream")) return "zstream";
        if (CURRENT_BASE.includes("primeshows")) return "primeshows";
        if (CURRENT_BASE.includes("fireflix")) return "fireflix";
        return "popcornmovies";
    }

    function log(...args) {
        try { console.log(`[Mega-${getProviderLabel()}]`, ...args); } catch {}
    }

    function safeJsonParse(str, fallback) {
        try { return JSON.parse(str || ""); } catch { return fallback; }
    }

    async function httpGetJson(url, headers = HEADERS) {
        try {
            const res = await http_get(url, headers);
            if (!res || !res.body) return null;
            // Some APIs return string that needs trim
            const txt = res.body.trim();
            if (txt.startsWith("<")) return null; // HTML not JSON
            return safeJsonParse(txt, null);
        } catch (e) {
            log("GET JSON failed", url, e.message);
            return null;
        }
    }

    async function fetchTmdb(path) {
        const sep = path.includes("?") ? "&" : "?";
        const url = `${TMDB_API}${path}${sep}api_key=${TMDB_API_KEY}`;
        return await httpGetJson(url);
    }

    function toMultimedia(tmdbObj, forcedType) {
        if (!tmdbObj || !tmdbObj.id) return null;
        const type = forcedType || tmdbObj.media_type || (tmdbObj.title ? "movie" : "series");
        const normalizedType = type === "tv" ? "series" : (type === "movie" ? "movie" : type);
        const title = tmdbObj.title || tmdbObj.name || "Unknown";
        const poster = tmdbObj.poster_path ? TMDB_IMAGE + tmdbObj.poster_path : tmdbObj.posterUrl || "https://via.placeholder.com/300x450?text=No+Poster";
        const banner = tmdbObj.backdrop_path ? TMDB_ORIGINAL + tmdbObj.backdrop_path : "";
        const year = parseInt((tmdbObj.release_date || tmdbObj.first_air_date || "").slice(0, 4)) || 0;
        const score = tmdbObj.vote_average ? parseFloat(tmdbObj.vote_average.toFixed(1)) : 0;
        // Encode full object as url for later use in load()
        const payload = {
            tmdbId: tmdbObj.id,
            type: normalizedType === "movie" ? "movie" : "tv",
            title: title,
            year: year
        };
        return new MultimediaItem({
            title: title,
            url: JSON.stringify(payload),
            posterUrl: poster,
            bannerUrl: banner,
            type: normalizedType === "series" ? "series" : normalizedType === "movie" ? "movie" : "movie",
            year: year,
            score: score,
            description: tmdbObj.overview || "",
            // keep extra for recommendation usage
            cast: []
        });
    }

    // ============ getHome ============
    async function getHome(cb) {
        try {
            log("getHome base:", CURRENT_BASE, "provider:", PROVIDER_ID);
            const home = {};

            // Fetch multiple categories in parallel using http_parallel for speed (SkyStream native fast)
            const requests = [
                { url: `${TMDB_API}/trending/all/day?api_key=${TMDB_API_KEY}`, headers: HEADERS },
                { url: `${TMDB_API}/movie/popular?api_key=${TMDB_API_KEY}&language=en-US&page=1`, headers: HEADERS },
                { url: `${TMDB_API}/tv/popular?api_key=${TMDB_API_KEY}&language=en-US&page=1`, headers: HEADERS },
                { url: `${TMDB_API}/movie/top_rated?api_key=${TMDB_API_KEY}&language=en-US&page=1`, headers: HEADERS },
                { url: `${TMDB_API}/tv/top_rated?api_key=${TMDB_API_KEY}&language=en-US&page=1`, headers: HEADERS },
                { url: `${TMDB_API}/movie/now_playing?api_key=${TMDB_API_KEY}&language=en-US&page=1`, headers: HEADERS }
            ];

            let results;
            try {
                results = await http_parallel(requests);
            } catch {
                // fallback sequential if parallel fails
                results = [];
                for (const r of requests) {
                    const j = await httpGetJson(r.url);
                    results.push({ body: JSON.stringify(j || {}), status: 200 });
                }
            }

            const parseBody = (idx) => {
                try {
                    const body = results[idx]?.body || "";
                    const json = safeJsonParse(body, null);
                    return json?.results || [];
                } catch { return []; }
            };

            const trending = parseBody(0).map(o => toMultimedia(o)).filter(Boolean);
            const popularMovies = parseBody(1).map(o => toMultimedia(o, "movie")).filter(Boolean);
            const popularTV = parseBody(2).map(o => toMultimedia(o, "tv")).filter(Boolean);
            const topMovies = parseBody(3).map(o => toMultimedia(o, "movie")).filter(Boolean);
            const topTV = parseBody(4).map(o => toMultimedia(o, "tv")).filter(Boolean);
            const nowPlaying = parseBody(5).map(o => toMultimedia(o, "movie")).filter(Boolean);

            if (trending.length) home["Trending"] = trending.slice(0, 20);
            if (popularMovies.length) home["Popular Movies"] = popularMovies.slice(0, 24);
            if (popularTV.length) home["Popular Series"] = popularTV.slice(0, 24);
            if (nowPlaying.length) home["Now Playing"] = nowPlaying.slice(0, 24);
            if (topMovies.length) home["Top Rated Movies"] = topMovies.slice(0, 24);
            if (topTV.length) home["Top Rated Series"] = topTV.slice(0, 24);

            // Provider-specific attempt: Try to scrape original site homepage for extra row if available
            // This is best-effort, TMDB home is primary and always works
            try {
                if (CURRENT_BASE.includes("cineby") || CURRENT_BASE.includes("popcorn") || CURRENT_BASE.includes("fireflix")) {
                    const siteHtml = await http_get(CURRENT_BASE, { "User-Agent": HEADERS["User-Agent"], "Referer": CURRENT_BASE + "/" });
                    // Try parse_html if site is html
                    if (siteHtml && siteHtml.body && !siteHtml.body.trim().startsWith("{")) {
                        // Example: extract titles if present, but keep TMDB as fallback
                        // This keeps plugin valid even if site blocks
                    }
                }
            } catch {}

            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "HOME_ERROR", message: "No home data - TMDB may be blocked" });
            }

            cb({ success: true, data: home });
        } catch (e) {
            log("getHome error", e.stack || e.message);
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message || String(e) });
        }
    }

    // ============ search ============
    async function search(query, cb) {
        try {
            const q = encodeURIComponent((query || "").trim());
            if (!q) return cb({ success: true, data: [] });

            const url = `${TMDB_API}/search/multi?api_key=${TMDB_API_KEY}&language=en-US&query=${q}&page=1&include_adult=false`;
            const json = await httpGetJson(url);
            const results = (json?.results || [])
                .filter(o => (o.media_type === "movie" || o.media_type === "tv") && o.poster_path)
                .map(o => toMultimedia(o))
                .filter(Boolean);

            cb({ success: true, data: results.slice(0, 30) });
        } catch (e) {
            log("search error", e.message);
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    // ============ load ============
    async function load(url, cb) {
        try {
            let payload;
            try {
                payload = JSON.parse(url);
                // If url was already JSON payload from getHome
                if (typeof payload === 'string') payload = JSON.parse(payload);
            } catch {
                // If direct url like "movie|550" fallback
                const parts = String(url).split("|");
                if (parts.length >= 2) {
                    payload = { tmdbId: parseInt(parts[1]) || parseInt(parts[0]), type: parts[0].includes("tv") || parts[0] === "series" ? "tv" : "movie" };
                } else {
                    // Last try: extract tmdb id from url path
                    const m = url.match(/\/(\d+)(?:\/|$)/);
                    payload = { tmdbId: m ? parseInt(m[1]) : 0, type: url.includes("/tv/") || url.includes("series") ? "tv" : "movie" };
                }
            }

            const tmdbId = payload.tmdbId || payload.id;
            const type = payload.type === "series" ? "tv" : (payload.type || "movie");
            if (!tmdbId) return cb({ success: false, errorCode: "NOT_FOUND", message: "Invalid TMDB ID" });

            if (type === "movie") {
                const movieJson = await fetchTmdb(`/movie/${tmdbId}?language=en-US`);
                if (!movieJson) return cb({ success: false, errorCode: "NOT_FOUND" });

                const poster = movieJson.poster_path ? TMDB_IMAGE + movieJson.poster_path : "";
                const banner = movieJson.backdrop_path ? TMDB_ORIGINAL + movieJson.backdrop_path : "";

                const episodes = [
                    new Episode({
                        name: "Full Movie",
                        url: JSON.stringify({ tmdbId: tmdbId, type: "movie", season: 1, episode: 1, title: movieJson.title }),
                        season: 1,
                        episode: 1,
                        posterUrl: poster,
                        description: movieJson.overview || ""
                    })
                ];

                const item = new MultimediaItem({
                    title: movieJson.title || payload.title || "Unknown",
                    url: url,
                    posterUrl: poster,
                    bannerUrl: banner,
                    type: "movie",
                    year: movieJson.release_date ? parseInt(movieJson.release_date.slice(0,4)) : payload.year,
                    score: movieJson.vote_average || 0,
                    description: movieJson.overview || "",
                    episodes: episodes,
                    tags: (movieJson.genres || []).map(g => g.name)
                });

                return cb({ success: true, data: item });
            } else {
                // TV SHOW
                const tvJson = await fetchTmdb(`/tv/${tmdbId}?language=en-US`);
                if (!tvJson) return cb({ success: false, errorCode: "NOT_FOUND" });

                const poster = tvJson.poster_path ? TMDB_IMAGE + tvJson.poster_path : "";
                const banner = tvJson.backdrop_path ? TMDB_ORIGINAL + tvJson.backdrop_path : "";

                // Get seasons
                const seasons = (tvJson.seasons || []).filter(s => s.season_number > 0);
                // Fetch episodes for each season in parallel (limit first 5 seasons to avoid too many requests, but we can fetch all)
                const seasonFetches = seasons.slice(0, 8).map(s => ({
                    url: `${TMDB_API}/tv/${tmdbId}/season/${s.season_number}?api_key=${TMDB_API_KEY}&language=en-US`,
                    headers: HEADERS
                }));

                let episodes = [];
                try {
                    const seasonResults = await http_parallel(seasonFetches);
                    for (let i = 0; i < seasonResults.length; i++) {
                        const body = seasonResults[i]?.body || "";
                        const seasonData = safeJsonParse(body, null);
                        const eps = seasonData?.episodes || [];
                        const sNum = seasonData?.season_number || seasons[i]?.season_number || (i + 1);
                        eps.forEach(ep => {
                            episodes.push(new Episode({
                                name: `S${String(sNum).padStart(2,'0')}E${String(ep.episode_number).padStart(2,'0')} - ${ep.name || ("Episode " + ep.episode_number)}`,
                                url: JSON.stringify({
                                    tmdbId: tmdbId,
                                    type: "tv",
                                    season: sNum,
                                    episode: ep.episode_number,
                                    title: tvJson.name,
                                    epTitle: ep.name
                                }),
                                season: sNum,
                                episode: ep.episode_number,
                                posterUrl: ep.still_path ? TMDB_IMAGE + ep.still_path : poster,
                                description: ep.overview || "",
                                airDate: ep.air_date || "",
                                rating: ep.vote_average || 0
                            }));
                        });
                    }
                } catch (e) {
                    log("season parallel failed, fallback sequential", e.message);
                    // Fallback sequential first season only
                    const firstSeason = await fetchTmdb(`/tv/${tmdbId}/season/1?language=en-US`);
                    const eps = firstSeason?.episodes || [];
                    eps.forEach(ep => {
                        episodes.push(new Episode({
                            name: `S01E${String(ep.episode_number).padStart(2,'0')} - ${ep.name}`,
                            url: JSON.stringify({ tmdbId, type: "tv", season: 1, episode: ep.episode_number, title: tvJson.name }),
                            season: 1,
                            episode: ep.episode_number,
                            posterUrl: ep.still_path ? TMDB_IMAGE + ep.still_path : poster
                        }));
                    });
                }

                // If still no episodes (TMDB missing), fabricate season 1 with 10 eps placeholder for sources to work
                if (!episodes.length) {
                    for (let e = 1; e <= 10; e++) {
                        episodes.push(new Episode({
                            name: `Episode ${e}`,
                            url: JSON.stringify({ tmdbId, type: "tv", season: 1, episode: e, title: tvJson.name }),
                            season: 1,
                            episode: e,
                            posterUrl: poster
                        }));
                    }
                }

                episodes.sort((a,b) => (a.season - b.season) || (a.episode - b.episode));

                const item = new MultimediaItem({
                    title: tvJson.name || payload.title || "Unknown",
                    url: url,
                    posterUrl: poster,
                    bannerUrl: banner,
                    type: "series",
                    year: tvJson.first_air_date ? parseInt(tvJson.first_air_date.slice(0,4)) : payload.year,
                    score: tvJson.vote_average || 0,
                    description: tvJson.overview || "",
                    episodes: episodes,
                    tags: (tvJson.genres || []).map(g => g.name)
                });

                return cb({ success: true, data: item });
            }
        } catch (e) {
            log("load error", e.stack || e.message);
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    // ============ loadStreams - MULTI SOURCE ============
    async function loadStreams(url, cb) {
        try {
            let payload;
            try {
                payload = JSON.parse(url);
                if (typeof payload === 'string') payload = JSON.parse(payload);
                if (Array.isArray(payload)) payload = payload[0];
            } catch {
                // url could be direct link or previous episode url stringified differently
                payload = { tmdbId: 550, type: "movie" }; // fallback will fail gracefully
                try {
                    const m = String(url).match(/tmdbId[^\d]*(\d+)/);
                    if (m) payload.tmdbId = parseInt(m[1]);
                } catch {}
            }

            const tmdbId = payload.tmdbId || payload.id || 0;
            const type = payload.type === "series" ? "tv" : (payload.type || "movie");
            const season = payload.season || 1;
            const episode = payload.episode || 1;

            if (!tmdbId) return cb({ success: true, data: [] });

            log("loadStreams", { tmdbId, type, season, episode, provider: getProviderLabel() });

            const streams = [];

            // Helper to add stream with dedup later
            function addStream(u, source, headers = null, quality = null) {
                if (!u || typeof u !== 'string' || !u.startsWith("http")) return;
                // Filter out placeholder images etc
                if (u.match(/\.(png|jpg|jpeg|webp|svg)(\?|$)/i) && !u.includes(".m3u8")) return;
                streams.push(new StreamResult({
                    url: u,
                    source: source || "Direct",
                    quality: quality || "Auto",
                    headers: headers || { "Referer": CURRENT_BASE + "/", "User-Agent": HEADERS["User-Agent"] }
                }));
            }

            // Helper that tries loadExtractor for embed URLs (VidSrc family)
            async function tryExtractor(embedUrl, label) {
                try {
                    if (typeof loadExtractor !== 'undefined') {
                        const ext = await loadExtractor(embedUrl);
                        if (ext && Array.isArray(ext) && ext.length) {
                            ext.forEach(item => {
                                addStream(item.url || item.src, label || item.source || "Extractor", item.headers || null, item.quality ? (item.quality + "p") : "Auto");
                            });
                            return true;
                        }
                    }
                } catch (e) {
                    log(`Extractor note for ${label}: ${e.message}`);
                }
                // fallback push embed itself (in app, loadExtractor will resolve to m3u8)
                addStream(embedUrl, label || "Embed");
                return false;
            }

            // 1. TRY FETCHING FROM THE 5 ORIGINAL SITES (best-effort scraping)
            const SITE_PATTERNS = [
                // PopcornMovies
                { base: "https://popcornmovies.io", moviePath: (id) => `/movie/${id}`, tvPath: (id,s,e) => `/tv/${id}/${s}/${e}` },
                // Cineby
                { base: "https://www.cineby.at", moviePath: (id) => `/movie/${id}`, tvPath: (id,s,e) => `/tv/${id}/${s}/${e}` },
                // ZStream (P-Stream) - uses query params? Try /media/tmdb-movie-{id} and /media/tmdb-tv-{id}
                { base: "https://zstream.mov", moviePath: (id) => `/media/tmdb-movie-${id}`, tvPath: (id,s,e) => `/media/tmdb-tv-${id}/${s}/${e}` },
                // PrimeShows
                { base: "https://primeshows.org", moviePath: (id) => `/movie/${id}`, tvPath: (id,s,e) => `/tv/${id}/season/${s}/episode/${e}` },
                // FireFlix
                { base: "https://fireflix.pages.dev", moviePath: (id) => `/movie/${id}`, tvPath: (id,s,e) => `/tv/${id}/${s}/${e}` }
            ];

            // Only attempt scraping for current provider if bundle, else scrape all if single?
            // For mega bundle, we will try current provider first, then all others as fallback multi-source
            const providersToTry = PROVIDER_ID ? 
                SITE_PATTERNS.filter(p => p.base.includes(PROVIDER_ID) || (PROVIDER_ID === "popcornmovies" && p.base.includes("popcorn")) || (PROVIDER_ID === "cineby" && p.base.includes("cineby")) || (PROVIDER_ID === "zstream" && p.base.includes("zstream")) || (PROVIDER_ID === "primeshows" && p.base.includes("primeshows")) || (PROVIDER_ID === "fireflix" && p.base.includes("fireflix"))) 
                : SITE_PATTERNS;

            // If provider filter empty, use current base
            const finalScrapeList = providersToTry.length ? providersToTry : [{ base: CURRENT_BASE, moviePath: (id) => `/movie/${id}`, tvPath: (id,s,e) => `/tv/${id}/${s}/${e}` }];

            for (const site of finalScrapeList) {
                try {
                    const watchPath = type === "movie" ? site.moviePath(tmdbId) : site.tvPath(tmdbId, season, episode);
                    const fullUrl = site.base.replace(/\/+$/,"") + watchPath;
                    log("Trying scrape", fullUrl);
                    const res = await http_get(fullUrl, { "User-Agent": HEADERS["User-Agent"], "Referer": site.base + "/" });
                    if (res && res.body) {
                        const html = res.body;
                        // Try parse_html for iframes
                        try {
                            const iframes = await parse_html(html, "iframe", "src");
                            for (const fr of iframes) {
                                let src = fr.attr || fr.text || "";
                                if (!src) continue;
                                if (src.startsWith("//")) src = "https:" + src;
                                if (src.startsWith("/")) src = site.base + src;
                                // Filter out ads
                                if (src.includes("googletag") || src.includes("facebook") || src.includes("twitter")) continue;
                                await tryExtractor(src, `${site.base.split('//')[1].split('/')[0]} - Iframe`);
                            }
                        } catch {}

                        // Regex fallback for embed urls inside html
                        const embedRegexes = [
                            /["'](https?:\/\/[^"']*vidsrc[^"']*)["']/gi,
                            /["'](https?:\/\/[^"']*2embed[^"']*)["']/gi,
                            /["'](https?:\/\/[^"']*superembed[^"']*)["']/gi,
                            /["'](https?:\/\/[^"']*vidlink[^"']*)["']/gi,
                            /["'](https?:\/\/[^"']*smashy[^"']*)["']/gi,
                            /["'](https?:\/\/[^"']*vidbinge[^"']*)["']/gi,
                            /src\s*:\s*["'](https?:\/\/[^"']+)["']/gi
                        ];
                        for (const rgx of embedRegexes) {
                            let m;
                            while ((m = rgx.exec(html)) !== null) {
                                const u = m[1];
                                if (u && u.startsWith("http") && u.length < 500) {
                                    await tryExtractor(u, `${site.base.split('//')[1]} - Regex`);
                                }
                            }
                        }
                    }
                } catch (e) {
                    log("Scrape failed for", site.base, e.message);
                }
            }

            // 2. DIRECT VIDSRC / SUPEREMBED SOURCES (Most reliable, what these sites use internally)
            const directEmbeds = [];

            if (type === "movie") {
                directEmbeds.push(
                    { url: `https://vidsrc.to/embed/movie/${tmdbId}`, label: "VidSrc.to" },
                    { url: `https://vidsrc.me/embed/movie?tmdb=${tmdbId}`, label: "VidSrc.me" },
                    { url: `https://vidsrc.xyz/embed/movie?tmdb=${tmdbId}`, label: "VidSrc.xyz" },
                    { url: `https://www.2embed.cc/embed/${tmdbId}`, label: "2Embed.cc" },
                    { url: `https://vidlink.pro/movie/${tmdbId}`, label: "VidLink.pro" },
                    { url: `https://player.smashy.stream/movie/${tmdbId}`, label: "SmashyStream" },
                    { url: `https://vidbinge.dev/embed/movie/${tmdbId}`, label: "VidBinge" },
                    { url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`, label: "MultiEmbed" },
                    { url: `https://autoembed.co/movie/tmdb/${tmdbId}`, label: "AutoEmbed" },
                    { url: `https://vidsrc.cc/v2/embed/movie/${tmdbId}`, label: "VidSrc.cc V2" },
                    { url: `https://vidsrc.net/embed/movie?tmdb=${tmdbId}`, label: "VidSrc.net" }
                );
            } else {
                directEmbeds.push(
                    { url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`, label: "VidSrc.to TV" },
                    { url: `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`, label: "VidSrc.me TV" },
                    { url: `https://vidsrc.xyz/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`, label: "VidSrc.xyz TV" },
                    { url: `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`, label: "2Embed TV" },
                    { url: `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}`, label: "VidLink.pro TV" },
                    { url: `https://player.smashy.stream/tv/${tmdbId}?s=${season}&e=${episode}`, label: "SmashyStream TV" },
                    { url: `https://vidbinge.dev/embed/tv/${tmdbId}/${season}/${episode}`, label: "VidBinge TV" },
                    { url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`, label: "MultiEmbed TV" },
                    { url: `https://autoembed.co/tv/tmdb/${tmdbId}-${season}-${episode}`, label: "AutoEmbed TV" },
                    { url: `https://vidsrc.cc/v2/embed/tv/${tmdbId}/${season}/${episode}`, label: "VidSrc.cc TV" },
                    { url: `https://vidsrc.net/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`, label: "VidSrc.net TV" }
                );
            }

            // Try each direct embed via extractor
            for (const emb of directEmbeds) {
                await tryExtractor(emb.url, emb.label);
            }

            // 3. MAGIC PROXY fallback for any blocked m3u8 that requires headers
            // If we have direct m3u8 links that need Referer, convert to MAGIC_PROXY_v1
            // Example: const proxied = "MAGIC_PROXY_v1" + btoa(url)

            // Deduplicate by URL
            const seen = new Set();
            const uniqueStreams = [];
            for (const s of streams) {
                if (!s.url) continue;
                if (seen.has(s.url)) continue;
                seen.add(s.url);
                uniqueStreams.push(s);
            }

            log(`Found ${uniqueStreams.length} streams for ${tmdbId}`);

            // Sort: put 1080p, then 720p, then extractor resolved first
            uniqueStreams.sort((a,b) => {
                const qScore = (q) => {
                    const str = (q.quality || q.source || "").toLowerCase();
                    if (str.includes("1080")) return 3;
                    if (str.includes("720")) return 2;
                    if (str.includes("480")) return 1;
                    return 0;
                };
                return qScore(b) - qScore(a);
            });

            if (!uniqueStreams.length) {
                // Final fallback: return at least one source as iframe to let SkyStream try player
                addStream(`https://vidsrc.to/embed/${type === "movie" ? "movie" : "tv"}/${tmdbId}${type !== "movie" ? `/${season}/${episode}` : ""}`, "Fallback VidSrc.to");
            }

            cb({ success: true, data: uniqueStreams.length ? uniqueStreams : streams });
        } catch (e) {
            log("loadStreams error", e.stack || e.message);
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
