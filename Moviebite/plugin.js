(function() {
    "use strict";

    // Configuration
    const BASE_URL = "https://moviebite.cc";
    const API_BASE = `${BASE_URL}/api`;

    // Required headers for API access
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/`,
        "X-MovieBite-Client": "1",
        "Accept": "application/json"
    };

    // Helper: Decode JWT payload to extract stream URLs
    function decodeJwtPayload(token) {
        try {
            if (!token) return null;
            
            // This is a 2-part token: payload.signature
            // Extract the payload part (before the first dot)
            let payload = token;
            if (token.includes('.')) {
                const parts = token.split('.');
                payload = parts[0]; // First part is the payload
            }
            
            // Add base64 padding if needed
            const padding = payload.length % 4;
            if (padding > 0) {
                payload += '='.repeat(4 - padding);
            }
            
            // Decode base64
            const decoded = atob(payload);
            return JSON.parse(decoded);
        } catch (e) {
            console.error("JWT decode error:", e);
            return null;
        }
    }

    // Helper: Make API request
    async function apiRequest(endpoint) {
        try {
            const res = await http_get(`${API_BASE}${endpoint}`, headers);
            if (!res || !res.body) return null;
            
            const data = JSON.parse(res.body);
            return data.success ? data.results : null;
        } catch (e) {
            console.error(`API request failed: ${endpoint}`, e);
            return null;
        }
    }

    // Helper: Convert API item to MultimediaItem
    function toMediaItem(item) {
        if (!item) return null;

        const isTV = item.mediaType === "tv" || item.firstAirDate;
        const type = isTV ? "series" : "movie";
        const year = item.year || (item.releaseDate ? parseInt(item.releaseDate.substring(0, 4)) : null);

        return new MultimediaItem({
            title: item.title || item.name || "Unknown",
            url: JSON.stringify({
                tmdbId: item.tmdbId,
                type: item.mediaType || (isTV ? "tv" : "movie"),
                title: item.title || item.name
            }),
            posterUrl: item.poster || (item.posterPath ? `https://image.tmdb.org/t/p/w500${item.posterPath}` : ""),
            bannerUrl: item.backdrop || (item.backdropPath ? `https://image.tmdb.org/t/p/w1280${item.backdropPath}` : ""),
            type: type,
            year: year,
            score: item.voteAverage ? Math.round(item.voteAverage * 10) / 10 : null,
            description: item.overview || ""
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  1. getHome - Fetch trending and popular content
    // ═══════════════════════════════════════════════════════════
    async function getHome(cb) {
        try {
            // Fetch config which contains trending content
            const config = await apiRequest("/config");
            if (!config) {
                return cb({ success: false, errorCode: "API_ERROR", message: "Failed to fetch config" });
            }

            const homeData = {};

            // The config endpoint returns trending movies
            if (Array.isArray(config)) {
                const movies = config
                    .filter(item => item.mediaType === "movie")
                    .map(toMediaItem)
                    .filter(Boolean)
                    .slice(0, 20);

                const shows = config
                    .filter(item => item.mediaType === "tv")
                    .map(toMediaItem)
                    .filter(Boolean)
                    .slice(0, 20);

                if (movies.length > 0) {
                    homeData["Trending Movies"] = movies;
                }
                if (shows.length > 0) {
                    homeData["Trending TV Shows"] = shows;
                }
            }

            // Fetch additional categories
            const categories = [
                { endpoint: "/trending?type=movie", name: "Popular Movies" },
                { endpoint: "/trending?type=tv", name: "Popular TV Shows" }
            ];

            for (const cat of categories) {
                try {
                    const data = await apiRequest(cat.endpoint);
                    if (data && Array.isArray(data)) {
                        const items = data.map(toMediaItem).filter(Boolean).slice(0, 20);
                        if (items.length > 0) {
                            homeData[cat.name] = items;
                        }
                    }
                } catch (e) {
                    console.error(`Failed to fetch ${cat.name}:`, e);
                }
            }

            if (Object.keys(homeData).length === 0) {
                return cb({ success: false, errorCode: "NO_CONTENT", message: "No content available" });
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            console.error("getHome error:", e);
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  2. search - Search for movies and TV shows
    // ═══════════════════════════════════════════════════════════
    async function search(query, cb) {
        try {
            if (!query || query.trim().length === 0) {
                return cb({ success: true, data: [] });
            }

            const data = await apiRequest(`/search?q=${encodeURIComponent(query)}`);
            if (!data || !Array.isArray(data)) {
                return cb({ success: true, data: [] });
            }

            const items = data.map(toMediaItem).filter(Boolean);
            cb({ success: true, data: items });
        } catch (e) {
            console.error("search error:", e);
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  3. load - Load detailed information about a movie or TV show
    // ═══════════════════════════════════════════════════════════
    async function load(url, cb) {
        try {
            const params = typeof url === "string" ? JSON.parse(url) : url;
            if (!params || !params.tmdbId) {
                return cb({ success: false, errorCode: "INVALID_URL", message: "Invalid media URL" });
            }

            const { tmdbId, type } = params;
            const isTV = type === "tv";
            const endpoint = isTV ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;

            const data = await apiRequest(endpoint);
            if (!data) {
                return cb({ success: false, errorCode: "NOT_FOUND", message: "Media not found" });
            }

            // Handle different response structures
            const media = data.data || data.results || data;
            if (!media) {
                return cb({ success: false, errorCode: "NO_DATA", message: "No data available" });
            }

            const year = media.year || (media.releaseDate ? parseInt(media.releaseDate.substring(0, 4)) : null);
            const genres = Array.isArray(media.genres) ? media.genres.map(g => g.name || g).join(", ") : "";

            const item = new MultimediaItem({
                title: media.title || media.name || params.title || "Unknown",
                url: JSON.stringify({
                    tmdbId: tmdbId,
                    type: type,
                    title: media.title || media.name
                }),
                posterUrl: media.poster || (media.posterPath ? `https://image.tmdb.org/t/p/w500${media.posterPath}` : ""),
                bannerUrl: media.backdrop || (media.backdropPath ? `https://image.tmdb.org/t/p/w1280${media.backdropPath}` : ""),
                type: isTV ? "series" : "movie",
                year: year,
                score: media.voteAverage ? Math.round(media.voteAverage * 10) / 10 : null,
                description: media.overview || "",
                genres: genres,
                duration: media.runtime || null,
                status: media.status || null
            });

            // For TV shows, fetch episodes if available
            if (isTV && media.seasons && Array.isArray(media.seasons)) {
                const episodes = [];
                
                // Fetch episodes for each season
                for (const season of media.seasons.slice(0, 5)) {
                    const seasonNum = season.season_number || season.seasonNumber;
                    if (!seasonNum || seasonNum === 0) continue;

                    try {
                        const epData = await apiRequest(`/tv/${tmdbId}/season/${seasonNum}`);
                        if (epData && epData.episodes) {
                            for (const ep of epData.episodes) {
                                episodes.push(new Episode({
                                    name: ep.name || `Episode ${ep.episode_number}`,
                                    url: JSON.stringify({
                                        tmdbId: tmdbId,
                                        type: "tv",
                                        season: seasonNum,
                                        episode: ep.episode_number,
                                        title: ep.name
                                    }),
                                    posterUrl: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : item.posterUrl,
                                    season: seasonNum,
                                    episode: ep.episode_number,
                                    description: ep.overview || ""
                                }));
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to fetch season ${seasonNum}:`, e);
                    }
                }

                if (episodes.length > 0) {
                    item.episodes = episodes;
                }
            }

            cb({ success: true, data: item });
        } catch (e) {
            console.error("load error:", e);
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  4. loadStreams - Extract playable video streams
    // ═══════════════════════════════════════════════════════════
    async function loadStreams(url, cb) {
        try {
            const params = typeof url === "string" ? JSON.parse(url) : url;
            if (!params || !params.tmdbId) {
                return cb({ success: false, errorCode: "INVALID_URL", message: "Invalid media URL" });
            }

            const { tmdbId, type, season, episode } = params;
            const isTV = type === "tv";

            // Build the watch API endpoint
            let endpoint = `/watch?type=${type}&tmdbId=${tmdbId}`;
            if (isTV && season && episode) {
                endpoint += `&season=${season}&episode=${episode}`;
            }

            const data = await apiRequest(endpoint);
            if (!data) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "No streams available" });
            }

            const streams = [];
            const streamList = data.streams || [];

            // Process each stream source
            for (const stream of streamList) {
                if (!stream.token && !stream.url && !stream.playlistUrl) continue;

                // Use the token field directly (pure JWT), or extract from URL
                let token = stream.token;
                if (!token) {
                    // Extract JWT from URL path like /stream-embed/playlist/eyJ...
                    const urlStr = stream.url || stream.playlistUrl || "";
                    const parts = urlStr.split("/");
                    token = parts[parts.length - 1]; // Last segment is the JWT
                }

                const decoded = decodeJwtPayload(token);

                if (!decoded || (!decoded.m3u8 && !decoded.cloudUrl)) {
                    console.warn("Failed to decode stream token for:", stream.name || stream.id);
                    continue;
                }

                const hlsUrl = decoded.m3u8 || decoded.cloudUrl;
                const quality = stream.quality || decoded.quality || "Auto";
                const serverName = stream.name || stream.brand || "Server";
                const provider = stream.provider || "unknown";

                streams.push(new StreamResult({
                    url: hlsUrl,
                    quality: quality,
                    source: `${serverName} (${provider})`,
                    headers: {
                        "User-Agent": headers["User-Agent"],
                        "Referer": `${BASE_URL}/`
                    }
                }));
            }

            if (streams.length === 0) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "No playable streams found" });
            }

            cb({ success: true, data: streams });
        } catch (e) {
            console.error("loadStreams error:", e);
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    // Export functions
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
