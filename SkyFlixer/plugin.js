(function () {

    // -------------------- CLI COMPATIBILITY POLYFILL --------------------
    if (typeof fetch === 'undefined') {
        if (typeof axios !== 'undefined') {
            globalThis.fetch = async (url, opts = {}) => {
                const method = (opts.method || 'GET').toUpperCase();
                const headers = opts.headers || {};
                const body = opts.body;
                try {
                    const res = await axios({
                        url: url,
                        method: method,
                        headers: headers,
                        data: body,
                        responseType: 'text',
                        validateStatus: () => true,
                        timeout: 15000
                    });
                    const txt = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
                    return {
                        ok: res.status >= 200 && res.status < 300,
                        status: res.status,
                        headers: res.headers,
                        text: async () => txt,
                        json: async () => {
                            try { return JSON.parse(txt); } catch { return res.data; }
                        }
                    };
                } catch (e) {
                    const status = e.response?.status || 500;
                    const data = e.response?.data ? (typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data)) : e.message;
                    return {
                        ok: false,
                        status: status,
                        text: async () => data,
                        json: async () => { try { return JSON.parse(data); } catch { return { error: data }; } }
                    };
                }
            };
        } else if (typeof http_get !== 'undefined' && typeof http_post !== 'undefined') {
            globalThis.fetch = async (url, opts = {}) => {
                const method = (opts.method || 'GET').toUpperCase();
                const headers = opts.headers || {};
                const body = opts.body;
                let res;
                if (method === 'POST') {
                    res = await http_post(url, headers, body);
                } else {
                    res = await http_get(url, headers);
                }
                const txt = res.body || "";
                return {
                    ok: res.status >= 200 && res.status < 300,
                    status: res.status,
                    text: async () => txt,
                    json: async () => JSON.parse(txt)
                };
            };
        }
    }

    // -------------------- Helpers --------------------
    function getApiBase() {
        let base = (typeof manifest !== 'undefined' && manifest.baseUrl) ? manifest.baseUrl : "https://skyflixer.skyflixer1.workers.dev/api";
        base = base.replace(/\/+$/, "");
        if (!base.endsWith("/api")) base = base + "/api";
        return base;
    }

    async function apiFetch(path, options = {}) {
        const apiBase = getApiBase();
        const url = path.startsWith("http") ? path : apiBase + (path.startsWith("/") ? path : "/" + path);
        const headers = {
            "Origin": "https://skyflixer.fun",
            "Referer": "https://skyflixer.fun/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/json",
            ...(options.headers || {})
        };
        const res = await fetch(url, { ...options, headers });
        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status} for ${path} - ${txt.slice(0,300)}`);
        }
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    function tmdbToItem(item) {
        if (!item) return null;
        const isMovie = item.media_type ? item.media_type === "movie" : !!item.title;
        const title = item.title || item.name || "Unknown";
        const yearStr = (item.release_date || item.first_air_date || "").slice(0, 4);
        const year = yearStr ? parseInt(yearStr, 10) : undefined;
        const poster = item.poster_path ? "https://image.tmdb.org/t/p/w500" + item.poster_path : "";
        const backdrop = item.backdrop_path ? "https://image.tmdb.org/t/p/original" + item.backdrop_path : "";
        const type = isMovie ? "movie" : "series";
        const id = item.id;
        const url = (isMovie ? "movie:" : "tv:") + id;
        return new MultimediaItem({
            title: title,
            url: url,
            type: type,
            posterUrl: poster,
            bannerUrl: backdrop,
            description: item.overview || "",
            year: year,
            score: item.vote_average || 0
        });
    }

    function extractStreamsFromHtml(html, label) {
        const found = [];
        const seen = {};
        if (!html || typeof html !== 'string') return found;
        const m3u8 = html.match(/https?:\/\/[^\s"'\\<>]+?\.m3u8[^\s"'\\<>]*/g) || [];
        const mp4 = html.match(/https?:\/\/[^\s"'\\<>]+?\.mp4[^\s"'\\<>]*/g) || [];
        const all = m3u8.concat(mp4);
        for (let i = 0; i < all.length; i++) {
            let u = all[i];
            u = u.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
            if (seen[u]) continue;
            if (u.includes("image.tmdb.org")) continue;
            if (u.length > 1500) continue;
            if (u.includes(".jpg") || u.includes(".png") || u.includes(".webp")) continue;
            seen[u] = true;
            found.push(new StreamResult({
                url: u,
                quality: label || "auto",
                headers: { "Referer": "https://skyflixer.fun/", "Origin": "https://skyflixer.fun" }
            }));
        }
        return found;
    }

    // -------------------- getHome with Many Sections --------------------
    async function getHome(cb) {
        try {
            // Define all sections - grouped logically
            const endpoints = [
                // --- Trending / Top ---
                { path: "/tmdb/trending/all/week", title: "Trending Now" },
                { path: "/tmdb/trending/all/day", title: "Top 10 Today" },

                // --- Latest ---
                { path: "/tmdb/discover/movie?sort_by=primary_release_date.desc&page=1&vote_count.gte=10", title: "Latest Movies" },
                { path: "/tmdb/discover/tv?sort_by=first_air_date.desc&page=1&vote_count.gte=10", title: "Latest TV Shows" },
                { path: "/tmdb/movie/upcoming?page=1", title: "Upcoming Movies" },
                { path: "/tmdb/tv/airing_today?page=1", title: "Airing Today" },

                // --- Popular / Top Rated / Now Playing ---
                { path: "/tmdb/movie/popular?page=1", title: "Popular Movies" },
                { path: "/tmdb/tv/popular?page=1", title: "Popular TV Shows" },
                { path: "/tmdb/movie/top_rated?page=1", title: "Top Rated Movies" },
                { path: "/tmdb/tv/top_rated?page=1", title: "Top Rated TV Shows" },
                { path: "/tmdb/movie/now_playing?page=1", title: "Now Playing in Theaters" },
                { path: "/tmdb/tv/on_the_air?page=1", title: "On The Air" },

                // --- Hindi / Bollywood / South Indian / Dubbed / Dual Audio ---
                // Bollywood = Hindi original language, India origin, popular
                { path: "/tmdb/discover/movie?with_original_language=hi&sort_by=popularity.desc&page=1", title: "Bollywood - Hindi Movies" },
                { path: "/tmdb/discover/tv?with_original_language=hi&sort_by=popularity.desc&page=1", title: "Hindi TV Shows & Web Series" },
                // South Indian languages
                { path: "/tmdb/discover/movie?with_original_language=ta&sort_by=popularity.desc&page=1", title: "Tamil Movies" },
                { path: "/tmdb/discover/movie?with_original_language=te&sort_by=popularity.desc&page=1", title: "Telugu Movies" },
                { path: "/tmdb/discover/movie?with_original_language=ml&sort_by=popularity.desc&page=1", title: "Malayalam Movies" },
                { path: "/tmdb/discover/movie?with_original_language=kn&sort_by=popularity.desc&page=1", title: "Kannada Movies" },
                // Hollywood Hindi Dubbed - popular English movies (SkyFlixer provides Hindi dub for these)
                { path: "/tmdb/discover/movie?with_original_language=en&sort_by=popularity.desc&page=1&vote_count.gte=100", title: "Hollywood Hindi Dubbed" },
                { path: "/tmdb/discover/movie?with_original_language=en&sort_by=popularity.desc&page=2&vote_count.gte=100", title: "Hollywood Hindi Dubbed - More" },
                // Dual Audio - same concept, SkyFlixer offers dual audio for most Hollywood
                { path: "/tmdb/discover/movie?with_original_language=en&sort_by=vote_average.desc&vote_count.gte=500&page=1", title: "Dual Audio Movies - Hindi + English" },
                { path: "/tmdb/discover/tv?with_original_language=en&sort_by=popularity.desc&page=1", title: "Dual Audio Series - Hindi + English" },
                // South Indian Hindi Dubbed (popular South Indian dubbed in Hindi - we use Hindi language + South Indian origin trick: actually fetch Hindi movies that are South Indian remakes)
                { path: "/tmdb/discover/movie?with_origin_country=IN&with_original_language=hi&sort_by=popularity.desc&page=2", title: "South Indian Hindi Dubbed" },

                // --- Anime ---
                { path: "/tmdb/discover/tv?with_genres=16&with_origin_country=JP&sort_by=popularity.desc&page=1", title: "Anime - Japanese Sub" },
                { path: "/tmdb/discover/tv?with_genres=16&with_original_language=hi&sort_by=popularity.desc&page=1", title: "Anime - Hindi Dubbed" },
                { path: "/tmdb/discover/movie?with_genres=16&sort_by=popularity.desc&page=1", title: "Animation Movies" },
                { path: "/tmdb/discover/tv?with_genres=16&sort_by=vote_average.desc&vote_count.gte=100&page=1", title: "Top Anime Series" },

                // --- Genres Movies ---
                { path: "/tmdb/discover/movie?with_genres=28&page=1", title: "Action Movies" },
                { path: "/tmdb/discover/movie?with_genres=12&page=1", title: "Adventure Movies" },
                { path: "/tmdb/discover/movie?with_genres=35&page=1", title: "Comedy Movies" },
                { path: "/tmdb/discover/movie?with_genres=27&page=1", title: "Horror Movies" },
                { path: "/tmdb/discover/movie?with_genres=53&page=1", title: "Thriller Movies" },
                { path: "/tmdb/discover/movie?with_genres=18&page=1", title: "Drama Movies" },
                { path: "/tmdb/discover/movie?with_genres=878&page=1", title: "Sci-Fi Movies" },
                { path: "/tmdb/discover/movie?with_genres=10749&page=1", title: "Romance Movies" },
                { path: "/tmdb/discover/movie?with_genres=10751&page=1", title: "Family Movies" },

                // --- Genres TV ---
                { path: "/tmdb/discover/tv?with_genres=10759&page=1", title: "Action & Adventure Series" },
                { path: "/tmdb/discover/tv?with_genres=18&page=1", title: "Drama Series" },
                { path: "/tmdb/discover/tv?with_genres=35&page=1", title: "Comedy Series" },
                { path: "/tmdb/discover/tv?with_genres=80&page=1", title: "Crime Series" },
                { path: "/tmdb/discover/tv?with_genres=10765&page=1", title: "Sci-Fi & Fantasy Series" },
                { path: "/tmdb/discover/tv?with_genres=9648&page=1", title: "Mystery Series" },

                // --- Korean, British etc ---
                { path: "/tmdb/discover/tv?with_origin_country=KR&sort_by=popularity.desc&page=1", title: "K-Drama - Korean Series" },
                { path: "/tmdb/discover/tv?with_origin_country=GB&sort_by=popularity.desc&page=1", title: "British Series" }
            ];

            const results = await Promise.all(endpoints.map(async ep => {
                try {
                    const data = await apiFetch(ep.path);
                    const items = (data.results || []).slice(0, 20).map(tmdbToItem).filter(Boolean);
                    return { title: ep.title, items };
                } catch (e) {
                    console.log(`Home fetch failed ${ep.title}: ${e.message}`);
                    return { title: ep.title, items: [] };
                }
            }));

            const data = {};
            // Preserve order but also avoid empty categories
            results.forEach(r => {
                if (r.items && r.items.length > 0) {
                    // Avoid duplicates across categories? Keep as is, SkyStream will dedup UI
                    data[r.title] = r.items;
                }
            });

            if (Object.keys(data).length === 0) {
                throw new Error("No home data fetched - all endpoints failed");
            }

            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.toString() });
        }
    }

    // -------------------- search --------------------
    async function search(query, page, cb) {
        if (typeof page === "function") {
            cb = page;
            page = 1;
        }
        try {
            const p = page || 1;
            const data = await apiFetch(`/tmdb/search/multi?query=${encodeURIComponent(query)}&page=${p}`);
            const items = (data.results || [])
                .filter(i => i.media_type === "movie" || i.media_type === "tv" || i.title || i.name)
                .map(tmdbToItem)
                .filter(Boolean);
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.toString() });
        }
    }

    // -------------------- load --------------------
    async function load(url, cb) {
        try {
            const parts = url.split(":");
            const type = parts[0];
            const tmdbId = parts[1];
            if (!tmdbId) throw new Error("Invalid URL: " + url);

            if (type === "movie") {
                const details = await apiFetch(`/tmdb/movie/${tmdbId}`);
                const year = (details.release_date || "").slice(0, 4);
                const poster = details.poster_path ? "https://image.tmdb.org/t/p/w500" + details.poster_path : "";
                const backdrop = details.backdrop_path ? "https://image.tmdb.org/t/p/original" + details.backdrop_path : "";
                const safeTitle = encodeURIComponent(details.title || details.original_title || "");
                const item = new MultimediaItem({
                    title: details.title || "Unknown",
                    url: `movie:${tmdbId}:${safeTitle}:${year}`,
                    type: "movie",
                    description: details.overview || "",
                    posterUrl: poster,
                    bannerUrl: backdrop,
                    year: year ? parseInt(year, 10) : undefined,
                    score: details.vote_average || 0,
                    duration: details.runtime || 0
                });
                cb({ success: true, data: item });
            } else if (type === "tv") {
                const details = await apiFetch(`/tmdb/tv/${tmdbId}`);
                const year = (details.first_air_date || "").slice(0, 4);
                const poster = details.poster_path ? "https://image.tmdb.org/t/p/w500" + details.poster_path : "";
                const backdrop = details.backdrop_path ? "https://image.tmdb.org/t/p/original" + details.backdrop_path : "";
                const safeTitle = encodeURIComponent(details.name || details.original_name || "");

                const seasons = (details.seasons || []).filter(s => s.season_number > 0);
                const seasonPromises = seasons.map(async s => {
                    try {
                        const sd = await apiFetch(`/tmdb/tv/${tmdbId}/season/${s.season_number}`);
                        return sd.episodes || [];
                    } catch {
                        return [];
                    }
                });
                const seasonResults = await Promise.all(seasonPromises);
                const allEpisodes = seasonResults.flat();

                const episodes = allEpisodes.map(ep => {
                    const epName = ep.name ? `S${ep.season_number}E${ep.episode_number} - ${ep.name}` : `Episode ${ep.episode_number}`;
                    const epUrl = `episode:${tmdbId}:${safeTitle}:${year}:${ep.season_number}:${ep.episode_number}`;
                    return new Episode({
                        name: epName,
                        url: epUrl,
                        season: ep.season_number,
                        episode: ep.episode_number,
                        description: ep.overview || "",
                        posterUrl: ep.still_path ? "https://image.tmdb.org/t/p/w300" + ep.still_path : poster,
                        airDate: ep.air_date || "",
                        rating: ep.vote_average || 0,
                        runtime: ep.runtime || 0
                    });
                });

                const item = new MultimediaItem({
                    title: details.name || "Unknown",
                    url: `tv:${tmdbId}:${safeTitle}:${year}`,
                    type: "series",
                    description: details.overview || "",
                    posterUrl: poster,
                    bannerUrl: backdrop,
                    year: year ? parseInt(year, 10) : undefined,
                    score: details.vote_average || 0,
                    episodes: episodes
                });
                cb({ success: true, data: item });
            } else if (type === "episode") {
                const title = parts[2] ? decodeURIComponent(parts[2]) : "";
                const year = parts[3] || "";
                const season = parseInt(parts[4], 10) || 1;
                const epNum = parseInt(parts[5], 10) || 1;
                try {
                    const sd = await apiFetch(`/tmdb/tv/${tmdbId}/season/${season}`);
                    const ep = (sd.episodes || []).find(e => e.episode_number === epNum);
                    if (ep) {
                        const poster = ep.still_path ? "https://image.tmdb.org/t/p/w300" + ep.still_path : "";
                        const item = new MultimediaItem({
                            title: `${title} S${season}E${epNum} - ${ep.name}`,
                            url: url,
                            type: "series",
                            description: ep.overview || "",
                            posterUrl: poster,
                            year: year ? parseInt(year, 10) : undefined
                        });
                        cb({ success: true, data: item });
                        return;
                    }
                } catch {}
                cb({ success: true, data: { title: title, url: url, type: "series" } });
            } else {
                throw new Error("Unknown type: " + type);
            }
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.toString() });
        }
    }

    // -------------------- loadStreams --------------------
    async function loadStreams(url, cb) {
        try {
            const parts = url.split(":");
            const type = parts[0];

            async function ensureMovieMeta(id, t, y) {
                if (t && y) return { title: t, year: y };
                try {
                    const d = await apiFetch(`/tmdb/movie/${id}`);
                    return { title: d.title || t || "", year: (d.release_date || "").slice(0, 4) || y || "" };
                } catch {
                    return { title: t || "", year: y || "" };
                }
            }

            async function ensureTvMeta(id, t, y) {
                if (t && y) return { title: t, year: y };
                try {
                    const d = await apiFetch(`/tmdb/tv/${id}`);
                    return { title: d.name || t || "", year: (d.first_air_date || "").slice(0, 4) || y || "" };
                } catch {
                    return { title: t || "", year: y || "" };
                }
            }

            let body = null;
            let tmdbId, title, year, season, episode;

            if (type === "movie") {
                tmdbId = parts[1];
                title = parts[2] ? decodeURIComponent(parts[2]) : "";
                year = parts[3] || "";
                const meta = await ensureMovieMeta(tmdbId, title, year);
                title = meta.title;
                year = meta.year;
                body = {
                    type: "movie",
                    tmdbId: parseInt(tmdbId, 10),
                    title: title,
                    year: year ? parseInt(year, 10) : 0
                };
            } else if (type === "episode") {
                tmdbId = parts[1];
                title = parts[2] ? decodeURIComponent(parts[2]) : "";
                year = parts[3] || "";
                season = parseInt(parts[4], 10) || 1;
                episode = parseInt(parts[5], 10) || 1;
                const meta = await ensureTvMeta(tmdbId, title, year);
                title = meta.title;
                year = meta.year;
                body = {
                    type: "tv",
                    tmdbId: parseInt(tmdbId, 10),
                    title: title,
                    year: year ? parseInt(year, 10) : 0,
                    season: season,
                    episode: episode
                };
            } else if (type === "tv") {
                tmdbId = parts[1];
                title = parts[2] ? decodeURIComponent(parts[2]) : "";
                year = parts[3] || "";
                const meta = await ensureTvMeta(tmdbId, title, year);
                title = meta.title;
                year = meta.year;
                body = {
                    type: "tv",
                    tmdbId: parseInt(tmdbId, 10),
                    title: title,
                    year: year ? parseInt(year, 10) : 0,
                    season: 1,
                    episode: 1
                };
            } else {
                throw new Error("Invalid URL type for streams: " + type);
            }

            const data = await apiFetch("/videohosting/fetch", {
                method: "POST",
                body: JSON.stringify(body),
                headers: { "Content-Type": "application/json" }
            });

            const servers = data.servers || {};
            const streams = [];

            for (const [key, srv] of Object.entries(servers)) {
                if (!srv || !srv.available || !srv.embedUrl) continue;
                const hostLabel = (srv.hostName || key || "unknown").toString();

                try {
                    if (typeof globalThis.loadExtractor === 'function') {
                        const extResult = await globalThis.loadExtractor(srv.embedUrl);
                        if (Array.isArray(extResult) && extResult.length > 0) {
                            for (const s of extResult) {
                                if (s && s.url) {
                                    const q = s.quality ? `${hostLabel} - ${s.quality}` : hostLabel;
                                    streams.push(new StreamResult({
                                        url: s.url,
                                        quality: q,
                                        headers: s.headers || { "Referer": "https://skyflixer.fun/" },
                                        subtitles: s.subtitles || []
                                    }));
                                }
                            }
                            continue;
                        }
                    }
                } catch {}

                try {
                    const res = await fetch(srv.embedUrl, {
                        headers: {
                            "Referer": "https://skyflixer.fun/",
                            "Origin": "https://skyflixer.fun",
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                        }
                    });
                    if (res.ok) {
                        const html = await res.text();
                        const found = extractStreamsFromHtml(html, hostLabel);
                        if (found.length > 0) {
                            streams.push(...found);
                            continue;
                        }
                        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                        if (iframeMatch && iframeMatch[1]) {
                            let iframeUrl = iframeMatch[1];
                            if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
                            if (iframeUrl.startsWith("/")) {
                                try {
                                    const base = new URL(srv.embedUrl);
                                    iframeUrl = base.origin + iframeUrl;
                                } catch {}
                            }
                            try {
                                const res2 = await fetch(iframeUrl, {
                                    headers: { "Referer": srv.embedUrl, "Origin": "https://skyflixer.fun" }
                                });
                                if (res2.ok) {
                                    const html2 = await res2.text();
                                    const found2 = extractStreamsFromHtml(html2, hostLabel + " iframe");
                                    if (found2.length > 0) {
                                        streams.push(...found2);
                                        continue;
                                    }
                                }
                            } catch {}
                        }
                    }
                } catch {}

                streams.push(new StreamResult({
                    url: srv.embedUrl,
                    quality: hostLabel + " (embed)",
                    headers: { "Referer": "https://skyflixer.fun/", "Origin": "https://skyflixer.fun" }
                }));
            }

            const seen = new Set();
            const deduped = [];
            for (const s of streams) {
                if (!s || !s.url) continue;
                if (seen.has(s.url)) continue;
                seen.add(s.url);
                deduped.push(s);
            }

            cb({ success: true, data: deduped });
        } catch (e) {
            cb({ success: false, errorCode: "STREAMS_ERROR", message: e.toString() + " " + (e.stack || "") });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
