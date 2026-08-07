(function () {
    /**
     * ScreenScape Plugin for SkyStream
     * Uses TMDB API for metadata + ScreenScape embed for streaming
     * 
     * @typedef {Object} Response
     * @property {boolean} success
     * @property {any} [data]
     * @property {string} [errorCode]
     * @property {string} [message]
     */

    // ─── Configuration ───
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_API = "https://api.themoviedb.org/3";
    const TMDB_IMG = "https://image.tmdb.org/t/p";

    const getBaseUrl = () => {
        if (typeof manifest !== 'undefined' && manifest.baseUrl) return manifest.baseUrl;
        return "https://screenscape.me";
    };

    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    };

    // ─── TMDB API Helper ───
    async function tmdbGet(path) {
        const separator = path.includes('?') ? '&' : '?';
        const url = `${TMDB_API}${path}${separator}api_key=${TMDB_API_KEY}`;
        const res = await http_get(url, HEADERS);
        if (!res || !res.body) return null;
        try { return JSON.parse(res.body); } catch (e) { return null; }
    }

    // ─── Convert TMDB item to MultimediaItem ───
    function tmdbToMediaItem(item, mediaType) {
        if (!item) return null;

        const isTV = mediaType === "tv" || item.media_type === "tv";
        const title = isTV ? (item.name || item.original_name) : (item.title || item.original_title);
        const posterPath = item.poster_path;
        const posterUrl = posterPath ? `${TMDB_IMG}/w500${posterPath}` : "";
        const year = (isTV ? item.first_air_date : item.release_date || "")?.substring(0, 4);
        const score = item.vote_average ? Math.round(item.vote_average * 10) / 10 : null;
        const tmdbId = String(item.id);

        const urlPayload = JSON.stringify({
            tmdbId: tmdbId,
            type: isTV ? "tv" : "movie",
            poster: posterUrl,
            title: title
        });

        return new MultimediaItem({
            title: title || "Untitled",
            url: urlPayload,
            posterUrl: posterUrl,
            type: isTV ? "series" : "movie",
            year: year ? parseInt(year) : null,
            score: score,
            description: item.overview || ""
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  1. getHome — Dashboard categories from TMDB
    // ═══════════════════════════════════════════════════════════
    async function getHome(cb) {
        try {
            // Fetch all categories in parallel
            const [
                trendingMovies,
                trendingTV,
                popularMovies,
                popularTV,
                topRatedMovies,
                topRatedTV,
                upcomingMovies,
                airingTodayTV
            ] = await Promise.all([
                tmdbGet("/trending/movie/week"),
                tmdbGet("/trending/tv/week"),
                tmdbGet("/movie/popular"),
                tmdbGet("/tv/popular"),
                tmdbGet("/movie/top_rated"),
                tmdbGet("/tv/top_rated"),
                tmdbGet("/movie/upcoming"),
                tmdbGet("/tv/airing_today")
            ]);

            const finalResult = {};

            // Trending Movies → Hero Carousel
            if (trendingMovies?.results?.length > 0) {
                const items = trendingMovies.results
                    .map(m => tmdbToMediaItem(m, "movie"))
                    .filter(Boolean);

                // Add banner images for trending (hero carousel)
                trendingMovies.results.forEach((m, i) => {
                    if (items[i] && m.backdrop_path) {
                        items[i].bannerUrl = `${TMDB_IMG}/original${m.backdrop_path}`;
                        items[i].logoUrl = items[i].posterUrl;
                    }
                });

                finalResult["Trending"] = items;
            }

            // Trending TV
            if (trendingTV?.results?.length > 0) {
                finalResult["Trending TV"] = trendingTV.results
                    .map(m => tmdbToMediaItem(m, "tv"))
                    .filter(Boolean);
            }

            // Popular Movies
            if (popularMovies?.results?.length > 0) {
                finalResult["Popular Movies"] = popularMovies.results
                    .map(m => tmdbToMediaItem(m, "movie"))
                    .filter(Boolean);
            }

            // Popular TV Shows
            if (popularTV?.results?.length > 0) {
                finalResult["Popular TV Shows"] = popularTV.results
                    .map(m => tmdbToMediaItem(m, "tv"))
                    .filter(Boolean);
            }

            // Top Rated Movies
            if (topRatedMovies?.results?.length > 0) {
                finalResult["Top Rated Movies"] = topRatedMovies.results
                    .map(m => tmdbToMediaItem(m, "movie"))
                    .filter(Boolean);
            }

            // Top Rated TV
            if (topRatedTV?.results?.length > 0) {
                finalResult["Top Rated TV"] = topRatedTV.results
                    .map(m => tmdbToMediaItem(m, "tv"))
                    .filter(Boolean);
            }

            // Upcoming Movies
            if (upcomingMovies?.results?.length > 0) {
                finalResult["Upcoming"] = upcomingMovies.results
                    .map(m => tmdbToMediaItem(m, "movie"))
                    .filter(Boolean);
            }

            // Airing Today
            if (airingTodayTV?.results?.length > 0) {
                finalResult["Airing Today"] = airingTodayTV.results
                    .map(m => tmdbToMediaItem(m, "tv"))
                    .filter(Boolean);
            }

            if (Object.keys(finalResult).length === 0) {
                return cb({ success: false, errorCode: "NO_DATA", message: "No content available" });
            }

            cb({ success: true, data: finalResult });
        } catch (e) {
            console.error("getHome Error:", e);
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  2. search — TMDB multi-search
    // ═══════════════════════════════════════════════════════════
    async function search(query, cb) {
        try {
            const data = await tmdbGet(`/search/multi?query=${encodeURIComponent(query)}`);
            if (!data || !data.results) {
                return cb({ success: true, data: [] });
            }

            const items = data.results
                .filter(r => r.media_type === "movie" || r.media_type === "tv")
                .map(r => tmdbToMediaItem(r, r.media_type))
                .filter(Boolean);

            cb({ success: true, data: items });
        } catch (e) {
            console.error("Search Error:", e);
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  3. load — Full details from TMDB
    // ═══════════════════════════════════════════════════════════
    async function load(urlStr, cb) {
        try {
            const media = JSON.parse(urlStr);
            if (!media || !media.tmdbId) throw new Error("Invalid URL data");

            const { tmdbId, type } = media;

            if (type === "movie") {
                // ─── MOVIE DETAILS ───
                const movie = await tmdbGet(`/movie/${tmdbId}?append_to_response=credits,similar,videos`);
                if (!movie) throw new Error("Movie not found");

                const posterUrl = movie.poster_path ? `${TMDB_IMG}/w500${movie.poster_path}` : (media.poster || "");
                const bannerUrl = movie.backdrop_path ? `${TMDB_IMG}/original${movie.backdrop_path}` : "";
                const year = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : null;

                // Extract cast
                const cast = (movie.credits?.cast || []).slice(0, 10).map(c =>
                    new Actor({
                        name: c.name,
                        role: c.character || "",
                        image: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : ""
                    })
                );

                // Extract trailers
                const trailers = (movie.videos?.results || [])
                    .filter(v => v.type === "Trailer" && v.site === "YouTube")
                    .slice(0, 3)
                    .map(v => new Trailer({ url: `https://www.youtube.com/watch?v=${v.key}` }));

                // Recommendations
                const recommendations = (movie.similar?.results || []).slice(0, 10)
                    .map(m => tmdbToMediaItem(m, "movie"))
                    .filter(Boolean);

                const urlPayload = JSON.stringify({
                    tmdbId: tmdbId,
                    type: "movie",
                    poster: posterUrl,
                    title: movie.title
                });

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: movie.title,
                        url: urlPayload,
                        posterUrl: posterUrl,
                        bannerUrl: bannerUrl,
                        description: movie.overview || "",
                        type: "movie",
                        year: year,
                        score: movie.vote_average ? Math.round(movie.vote_average * 10) / 10 : null,
                        duration: movie.runtime || null,
                        status: movie.status === "Released" ? "completed" : "upcoming",
                        contentRating: "",
                        cast: cast,
                        trailers: trailers,
                        recommendations: recommendations,
                        syncData: { tmdb: tmdbId, imdb: movie.imdb_id || "" }
                    })
                });

            } else if (type === "tv") {
                // ─── TV SERIES DETAILS ───
                const show = await tmdbGet(`/tv/${tmdbId}?append_to_response=credits,similar,videos`);
                if (!show) throw new Error("TV show not found");

                const posterUrl = show.poster_path ? `${TMDB_IMG}/w500${show.poster_path}` : (media.poster || "");
                const bannerUrl = show.backdrop_path ? `${TMDB_IMG}/original${show.backdrop_path}` : "";
                const year = show.first_air_date ? parseInt(show.first_air_date.substring(0, 4)) : null;

                // Extract cast
                const cast = (show.credits?.cast || []).slice(0, 10).map(c =>
                    new Actor({
                        name: c.name,
                        role: c.character || "",
                        image: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : ""
                    })
                );

                // Extract trailers
                const trailers = (show.videos?.results || [])
                    .filter(v => v.type === "Trailer" && v.site === "YouTube")
                    .slice(0, 3)
                    .map(v => new Trailer({ url: `https://www.youtube.com/watch?v=${v.key}` }));

                // Build episodes list from all seasons
                const episodes = [];
                const totalSeasons = show.number_of_seasons || 1;

                // Fetch season details in parallel (batch of 5)
                const seasonNumbers = Array.from({ length: totalSeasons }, (_, i) => i + 1);
                
                // Process seasons in batches of 5
                for (let batch = 0; batch < seasonNumbers.length; batch += 5) {
                    const batchNums = seasonNumbers.slice(batch, batch + 5);
                    const seasonDataArr = await Promise.all(
                        batchNums.map(s => tmdbGet(`/tv/${tmdbId}/season/${s}`))
                    );

                    seasonDataArr.forEach((seasonData) => {
                        if (!seasonData || !seasonData.episodes) return;
                        const seasonNum = seasonData.season_number;

                        seasonData.episodes.forEach(ep => {
                            const epPoster = ep.still_path
                                ? `${TMDB_IMG}/w500${ep.still_path}`
                                : (seasonData.poster_path ? `${TMDB_IMG}/w500${seasonData.poster_path}` : posterUrl);

                            episodes.push(new Episode({
                                name: ep.name || `Episode ${ep.episode_number}`,
                                url: JSON.stringify({
                                    tmdbId: tmdbId,
                                    type: "tv",
                                    season: seasonNum,
                                    episode: ep.episode_number,
                                    poster: epPoster,
                                    title: show.name
                                }),
                                posterUrl: epPoster,
                                season: seasonNum,
                                episode: ep.episode_number,
                                rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : null,
                                runtime: ep.runtime || null,
                                airDate: ep.air_date || ""
                            }));
                        });
                    });
                }

                // Recommendations
                const recommendations = (show.similar?.results || []).slice(0, 10)
                    .map(m => tmdbToMediaItem(m, "tv"))
                    .filter(Boolean);

                const urlPayload = JSON.stringify({
                    tmdbId: tmdbId,
                    type: "tv",
                    poster: posterUrl,
                    title: show.name
                });

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: show.name,
                        url: urlPayload,
                        posterUrl: posterUrl,
                        bannerUrl: bannerUrl,
                        description: show.overview || "",
                        type: "series",
                        year: year,
                        score: show.vote_average ? Math.round(show.vote_average * 10) / 10 : null,
                        status: show.status === "Ended" ? "completed" : (show.status === "Returning Series" ? "ongoing" : "upcoming"),
                        cast: cast,
                        trailers: trailers,
                        recommendations: recommendations,
                        episodes: episodes,
                        syncData: { tmdb: tmdbId }
                    })
                });
            }
        } catch (e) {
            console.error("Load Error:", e);
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  4. loadStreams — Build ScreenScape embed URLs
    // ═══════════════════════════════════════════════════════════
    async function loadStreams(urlInfo, cb) {
        try {
            const media = typeof urlInfo === 'string' ? JSON.parse(urlInfo) : urlInfo;
            if (!media || !media.tmdbId) throw new Error("Invalid URL data");

            const baseUrl = getBaseUrl();
            const { tmdbId, type } = media;
            const streams = [];

            // Languages available on ScreenScape
            const languages = [
                { code: "hindi", label: "Hindi" },
                { code: "eng", label: "English" },
                { code: "tam", label: "Tamil" },
                { code: "tel", label: "Telugu" }
            ];

            if (type === "movie") {
                // Build embed URLs for each language
                for (const lang of languages) {
                    const embedUrl = `${baseUrl}/embed?tmdb=${tmdbId}&type=movie&lan=${lang.code}`;
                    streams.push(new StreamResult({
                        url: embedUrl,
                        quality: `ScreenScape [${lang.label}]`,
                        headers: {
                            "Referer": `${baseUrl}/`,
                            "Origin": baseUrl
                        }
                    }));
                }

                // Default embed (auto-selects best language)
                const defaultUrl = `${baseUrl}/embed?tmdb=${tmdbId}&type=movie`;
                streams.unshift(new StreamResult({
                    url: defaultUrl,
                    quality: "ScreenScape [Auto]",
                    headers: {
                        "Referer": `${baseUrl}/`,
                        "Origin": baseUrl
                    }
                }));

            } else if (type === "tv") {
                const { season, episode } = media;

                for (const lang of languages) {
                    const embedUrl = `${baseUrl}/embed?tmdb=${tmdbId}&type=tv&s=${season}&e=${episode}&lan=${lang.code}`;
                    streams.push(new StreamResult({
                        url: embedUrl,
                        quality: `ScreenScape [${lang.label}]`,
                        headers: {
                            "Referer": `${baseUrl}/`,
                            "Origin": baseUrl
                        }
                    }));
                }

                // Default embed
                const defaultUrl = `${baseUrl}/embed?tmdb=${tmdbId}&type=tv&s=${season}&e=${episode}`;
                streams.unshift(new StreamResult({
                    url: defaultUrl,
                    quality: "ScreenScape [Auto]",
                    headers: {
                        "Referer": `${baseUrl}/`,
                        "Origin": baseUrl
                    }
                }));
            }

            cb({ success: true, data: streams });
        } catch (e) {
            console.error("Stream Error:", e);
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    // ─── Export to global scope ───
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
