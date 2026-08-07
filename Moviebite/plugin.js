(function() {
    "use strict";

    const BASE_URL = "https://moviebite.cc";
    const API_BASE = `${BASE_URL}/api`;
    const TMDB_IMG = "https://image.tmdb.org/t/p";

    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/`,
        "X-MovieBite-Client": "1",
        "Accept": "application/json"
    };

    // ─── Helpers ───

    function decodeJwtPayload(token) {
        try {
            if (!token) return null;
            let payload = token;
            if (token.includes('.')) {
                payload = token.split('.')[0];
            }
            const padding = payload.length % 4;
            if (padding > 0) payload += '='.repeat(4 - padding);
            return JSON.parse(atob(payload));
        } catch (e) {
            return null;
        }
    }

    async function apiRequest(endpoint) {
        try {
            const res = await http_get(`${API_BASE}${endpoint}`, headers);
            if (!res || !res.body) return null;
            const data = JSON.parse(res.body);
            return data.success ? data.results : null;
        } catch (e) {
            return null;
        }
    }

    function toMediaItem(item) {
        if (!item) return null;
        const isTV = item.media_type === "tv" || item.mediaType === "tv" || !!item.first_air_date || !!item.firstAirDate;
        const tmdbId = item.tmdbId || item.id;
        const title = item.title || item.name || "Unknown";
        const posterPath = item.posterPath || item.poster_path || "";
        const backdropPath = item.backdropPath || item.backdrop_path || "";
        const year = item.year
            || (item.releaseDate ? parseInt(item.releaseDate.substring(0, 4)) : null)
            || (item.release_date ? parseInt(item.release_date.substring(0, 4)) : null)
            || (item.first_air_date ? parseInt(item.first_air_date.substring(0, 4)) : null);

        return new MultimediaItem({
            title: title,
            url: JSON.stringify({
                tmdbId: tmdbId,
                type: isTV ? "tv" : "movie",
                title: title
            }),
            posterUrl: item.poster || (posterPath ? `${TMDB_IMG}/w500${posterPath}` : ""),
            bannerUrl: item.backdrop || (backdropPath ? `${TMDB_IMG}/w1280${backdropPath}` : ""),
            type: isTV ? "series" : "movie",
            year: year,
            score: (item.voteAverage || item.vote_average) ? Math.round((item.voteAverage || item.vote_average) * 10) / 10 : null,
            description: item.overview || ""
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  1. getHome
    // ═══════════════════════════════════════════════════════════
    async function getHome(cb) {
        try {
            const config = await apiRequest("/config");
            if (!config || !Array.isArray(config)) {
                return cb({ success: false, errorCode: "API_ERROR", message: "Failed to fetch config" });
            }

            const data = {};
            const movies = config.filter(i => i.mediaType === "movie").map(toMediaItem).filter(Boolean);
            const shows = config.filter(i => i.mediaType === "tv").map(toMediaItem).filter(Boolean);

            if (movies.length > 0) data["Trending Movies"] = movies;
            if (shows.length > 0) data["Trending TV Shows"] = shows;

            // Fetch additional categories
            const cats = [
                { ep: "/trending?type=movie", name: "Popular Movies" },
                { ep: "/trending?type=tv", name: "Popular TV Shows" }
            ];
            for (const cat of cats) {
                try {
                    const d = await apiRequest(cat.ep);
                    if (d && Array.isArray(d)) {
                        const items = d.map(toMediaItem).filter(Boolean);
                        if (items.length > 0) data[cat.name] = items;
                    }
                } catch (e) {}
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  2. search
    // ═══════════════════════════════════════════════════════════
    async function search(query, cb) {
        try {
            if (!query || !query.trim()) return cb({ success: true, data: [] });
            const d = await apiRequest(`/search?q=${encodeURIComponent(query)}`);
            const items = (d && Array.isArray(d)) ? d.map(toMediaItem).filter(Boolean) : [];
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  3. load — Full details with cast, episodes, trailers
    // ═══════════════════════════════════════════════════════════
    async function load(url, cb) {
        try {
            const params = typeof url === "string" ? JSON.parse(url) : url;
            if (!params || !params.tmdbId) {
                return cb({ success: false, errorCode: "INVALID_URL", message: "Invalid URL" });
            }

            const { tmdbId, type } = params;
            const isTV = type === "tv";
            const endpoint = isTV
                ? `/tv/${tmdbId}?append_to_response=credits,videos,similar,recommendations`
                : `/movie/${tmdbId}?append_to_response=credits,videos,similar,recommendations`;
            const data = await apiRequest(endpoint);
            if (!data) return cb({ success: false, errorCode: "NOT_FOUND", message: "Not found" });

            const media = data.data || data.results || data;
            const raw = media._raw || {};

            const title = media.title || media.name || params.title || "Unknown";
            const year = media.year || null;
            const poster = media.poster || (media.posterPath ? `${TMDB_IMG}/w500${media.posterPath}` : "");
            const banner = media.backdrop || (media.backdropPath ? `${TMDB_IMG}/w1280${media.backdropPath}` : "");
            const description = media.overview || "";
            const score = media.voteAverage ? Math.round(media.voteAverage * 10) / 10 : null;
            const duration = raw.runtime || null;
            const status = raw.status || null;
            const genres = Array.isArray(media.genres)
                ? media.genres.map(g => typeof g === "string" ? g : g.name).filter(Boolean).join(", ")
                : "";

            // Cast from _raw.credits
            const cast = [];
            const rawCast = raw.credits?.cast || [];
            for (const c of rawCast.slice(0, 15)) {
                cast.push(new Actor({
                    name: c.name || "",
                    role: c.character || "",
                    image: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : ""
                }));
            }

            // Trailers from _raw.videos
            const trailers = [];
            const rawVideos = raw.videos?.results || [];
            for (const v of rawVideos.filter(v => v.site === "YouTube" && v.type === "Trailer").slice(0, 3)) {
                trailers.push(new Trailer({ url: `https://www.youtube.com/watch?v=${v.key}` }));
            }

            // Recommendations from _raw.recommendations or _raw.similar
            const recommendations = [];
            const recs = raw.recommendations?.results || raw.similar?.results || [];
            for (const r of recs.slice(0, 10)) {
                const recItem = toMediaItem(r);
                if (recItem) recommendations.push(recItem);
            }

            const urlPayload = JSON.stringify({
                tmdbId: tmdbId,
                type: type,
                title: title
            });

            if (isTV) {
                // ─── TV SERIES: Build episodes ───
                const episodes = [];
                const rawSeasons = raw.seasons || [];

                // Sort seasons by season_number, skip season 0 (specials)
                const sortedSeasons = rawSeasons
                    .filter(s => s.season_number > 0)
                    .sort((a, b) => a.season_number - b.season_number);

                // Fetch episodes for each season (batch of 3 at a time)
                for (let i = 0; i < sortedSeasons.length; i += 3) {
                    const batch = sortedSeasons.slice(i, i + 3);
                    const results = await Promise.all(
                        batch.map(s => apiRequest(`/tv/${tmdbId}/season/${s.season_number}`))
                    );

                    for (let j = 0; j < batch.length; j++) {
                        const seasonData = results[j];
                        if (!seasonData) continue;

                        const seasonResult = seasonData.data || seasonData.results || seasonData;
                        const eps = seasonResult.episodes || [];
                        const seasonNum = seasonResult.season_number || batch[j].season_number;

                        for (const ep of eps) {
                            const epPoster = ep.still_path
                                ? `${TMDB_IMG}/w500${ep.still_path}`
                                : (seasonResult.poster_path ? `${TMDB_IMG}/w500${seasonResult.poster_path}` : poster);

                            episodes.push(new Episode({
                                name: ep.name || `Episode ${ep.episode_number}`,
                                url: JSON.stringify({
                                    tmdbId: tmdbId,
                                    type: "tv",
                                    season: seasonNum,
                                    episode: ep.episode_number,
                                    title: ep.name || title
                                }),
                                posterUrl: epPoster,
                                season: seasonNum,
                                episode: ep.episode_number,
                                description: ep.overview || "",
                                airDate: ep.air_date || "",
                                runtime: ep.runtime || null
                            }));
                        }
                    }
                }

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: title,
                        url: urlPayload,
                        posterUrl: poster,
                        bannerUrl: banner,
                        description: description,
                        type: "series",
                        year: year,
                        score: score,
                        status: status === "Ended" ? "completed" : (status === "Returning Series" ? "ongoing" : null),
                        cast: cast,
                        trailers: trailers,
                        recommendations: recommendations,
                        episodes: episodes
                    })
                });
            } else {
                // ─── MOVIE ───
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: title,
                        url: urlPayload,
                        posterUrl: poster,
                        bannerUrl: banner,
                        description: description,
                        type: "movie",
                        year: year,
                        score: score,
                        duration: duration,
                        status: status === "Released" ? "completed" : null,
                        cast: cast,
                        trailers: trailers,
                        recommendations: recommendations
                    })
                });
            }
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  4. loadStreams — Extract playable HLS/MP4 streams
    // ═══════════════════════════════════════════════════════════
    async function loadStreams(url, cb) {
        try {
            const params = typeof url === "string" ? JSON.parse(url) : url;
            if (!params || !params.tmdbId) {
                return cb({ success: false, errorCode: "INVALID_URL", message: "Invalid URL" });
            }

            const { tmdbId, type, season, episode } = params;
            const isTV = type === "tv";

            let endpoint = `/watch?type=${type}&tmdbId=${tmdbId}`;
            if (isTV && season && episode) {
                endpoint += `&season=${season}&episode=${episode}`;
            }

            const data = await apiRequest(endpoint);
            if (!data) return cb({ success: false, errorCode: "NO_STREAMS", message: "No streams available" });

            const streams = [];
            const streamList = data.streams || [];

            for (const stream of streamList) {
                // Get the JWT token
                let token = stream.token;
                if (!token) {
                    const urlStr = stream.url || stream.playlistUrl || "";
                    const parts = urlStr.split("/");
                    token = parts[parts.length - 1];
                }

                const decoded = decodeJwtPayload(token);
                if (!decoded || (!decoded.m3u8 && !decoded.cloudUrl)) continue;

                const videoUrl = decoded.m3u8 || decoded.cloudUrl;
                const quality = stream.quality || decoded.quality || "Auto";
                const serverName = stream.name || stream.brand || "Server";
                const provider = stream.provider || "";

                // Build source label with quality
                const sourceLabel = `${serverName} [${quality}]`;

                streams.push(new StreamResult({
                    url: videoUrl,
                    source: sourceLabel
                }));
            }

            if (streams.length === 0) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "No playable streams found" });
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    // ─── Export ───
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
