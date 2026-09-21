(function () {

    // CLI polyfill
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
                        json: async () => { try { return JSON.parse(txt); } catch { return res.data; } }
                    };
                } catch (e) {
                    const status = e.response?.status || 500;
                    const data = e.response?.data ? (typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data)) : e.message;
                    return { ok: false, status: status, text: async () => data, json: async () => { try { return JSON.parse(data); } catch { return { error: data }; } } };
                }
            };
        } else if (typeof http_get !== 'undefined' && typeof http_post !== 'undefined') {
            globalThis.fetch = async (url, opts = {}) => {
                const method = (opts.method || 'GET').toUpperCase();
                const headers = opts.headers || {};
                const body = opts.body;
                let res;
                if (method === 'POST') res = await http_post(url, headers, body);
                else res = await http_get(url, headers);
                const txt = res.body || "";
                return { ok: res.status >= 200 && res.status < 300, status: res.status, text: async () => txt, json: async () => JSON.parse(txt) };
            };
        }
    }

    function getTmdbApiBase() {
        // Use SkyFlixer worker for TMDB metadata (no key required) - reliable
        // Fallback to manifest.baseUrl if it points to worker, else use skyflixer worker
        let base = (typeof manifest !== 'undefined' && manifest.baseUrl) ? manifest.baseUrl : "";
        if (base.includes("workers.dev")) {
            base = base.replace(/\/+$/, "");
            if (!base.endsWith("/api")) base = base + "/api";
            return base;
        }
        return "https://skyflixer.skyflixer1.workers.dev/api";
    }

    async function apiFetch(path, options = {}) {
        const apiBase = getTmdbApiBase();
        const url = path.startsWith("http") ? path : apiBase + (path.startsWith("/") ? path : "/" + path);
        const headers = {
            "Origin": "https://rivestream.ru",
            "Referer": "https://rivestream.ru/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
            ...(options.headers || {})
        };
        const res = await fetch(url, { ...options, headers });
        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status} for ${path} - ${txt.slice(0,300)}`);
        }
        const text = await res.text();
        try { return JSON.parse(text); } catch { return text; }
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
        return new MultimediaItem({ title, url, type, posterUrl: poster, bannerUrl: backdrop, description: item.overview || "", year, score: item.vote_average || 0 });
    }

    function extractStreamsFromHtml(html, label) {
        const found = []; const seen = {};
        if (!html || typeof html !== 'string') return found;
        const m3u8 = html.match(/https?:\/\/[^\s"'\\<>]+?\.m3u8[^\s"'\\<>]*/g) || [];
        const mp4 = html.match(/https?:\/\/[^\s"'\\<>]+?\.mp4[^\s"'\\<>]*/g) || [];
        const all = m3u8.concat(mp4);
        for (let i = 0; i < all.length; i++) {
            let u = all[i].replace(/\\u002F/g, "/").replace(/\\\//g, "/");
            if (seen[u]) continue;
            if (u.includes("image.tmdb.org")) continue;
            if (u.length > 1500) continue;
            if (u.includes(".jpg") || u.includes(".png") || u.includes(".webp")) continue;
            seen[u] = true;
            found.push(new StreamResult({ url: u, quality: label || "auto", headers: { "Referer": "https://rivestream.ru/", "Origin": "https://rivestream.ru" } }));
        }
        return found;
    }

    // RiveStream providers extracted from rivestream.ru/_next/static/chunks/2427-*.js
    const PROVIDERS = [
        { label: "VidsrcMe", value: "VID", star: true, category: "curated", movie: id => `https://vidsrc.sh/embed/movie/${id}`, tv: (id,s,e) => `https://vidsrc.sh/embed/tv/${id}/${s}/${e}` },
        { label: "Best-Server Prime", value: "PRIME", star: true, category: "curated", movie: id => `https://primesrc.me/embed/movie?tmdb=${id}`, tv: (id,s,e) => `https://primesrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}` },
        { label: "Multi Most-Server", value: "SUP", star: true, category: "multi", movie: id => `https://multiembed.mov/?video_id=${id}&tmdb=1`, tv: (id,s,e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}` },
        { label: "Single-Server VA", value: "VAP", star: true, category: "single", movie: id => `https://vaplayer.ru/embed/movie/${id}`, tv: (id,s,e) => `https://vaplayer.ru/embed/tv/${id}/${s}/${e}` },
        { label: "VidUp Multi", value: "VUP", star: true, category: "multi", movie: id => `https://vidup.to/movie/${id}?autoPlay=true`, tv: (id,s,e) => `https://vidup.to/tv/${id}/${s}/${e}?autoPlay=true` },
        { label: "VidLink Fast", value: "ADF", star: true, category: "curated", movie: id => `https://vidlink.pro/movie/${id}?ads=0`, tv: (id,s,e) => `https://vidlink.pro/tv/${id}/${s}/${e}?ads=0` },
        { label: "SmashyStream Multi", value: "SMASH", star: true, category: "multi", movie: id => `https://embed.smashystream.com/playere.php?tmdb=${id}`, tv: (id,s,e) => `https://embed.smashystream.com/playere.php?tmdb=${id}&season=${s}&episode=${e}` },
        { label: "Cinezo HD", value: "CIN", star: true, category: "curated", movie: id => `https://player.cinezo.live/embed/movie/${id}?autoplay=true&poster=true`, tv: (id,s,e) => `https://player.cinezo.live/embed/tv/${id}/${s}/${e}?autoplay=true` },
        { label: "Videasy HD", value: "EASY", star: true, category: "curated", movie: id => `https://player.videasy.net/movie/${id}`, tv: (id,s,e) => `https://player.videasy.net/tv/${id}/${s}/${e}` },
        { label: "Mapple 4K", value: "MAP", star: true, category: "single", movie: id => `https://mapple.uk/watch/movie/${id}?autoPlay=true`, tv: (id,s,e) => `https://mapple.uk/watch/tv/${id}-${s}-${e}?autoPlay=true` },
        { label: "111Movies", value: "111M", star: false, category: "multi", movie: id => `https://111movies.net/movie/${id}?autoplay=1`, tv: (id,s,e) => `https://111movies.net/tv/${id}/${s}/${e}?autoplay=1` },
        { label: "VidZee Multi", value: "VIDZ", star: true, category: "multi", movie: id => `https://player.vidzee.wtf/embed/movie/${id}`, tv: (id,s,e) => `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}` },
        { label: "Vidora HD", value: "VIDORA", star: true, category: "curated", movie: id => `https://vidora.net/movie/${id}?autoplay=true`, tv: (id,s,e) => `https://vidora.net/tv/${id}/${s}/${e}?autoplay=true` },
        { label: "VidFast Multi", value: "VIDF", star: true, category: "multi", movie: id => `https://vidfast.pro/movie/${id}`, tv: (id,s,e) => `https://vidfast.pro/tv/${id}/${s}/${e}` },
        { label: "Peachify", value: "PEACH", star: false, category: "multi", movie: id => `https://peachify.top/embed/movie/${id}?autoPlay=true`, tv: (id,s,e) => `https://peachify.top/embed/tv/${id}/${s}/${e}?autoPlay=true` },
        { label: "FilmKu Aggregator", value: "AGG", star: false, category: "legacy", movie: id => `https://filmku.stream/embed/${id}`, tv: (id,s,e) => `https://filmku.stream/embed/${id}/${s}/${e}` },
        { label: "VidSrc Pro", value: "PRO", star: false, category: "legacy", movie: id => `https://vidsrc.pro/embed/movie/${id}`, tv: (id,s,e) => `https://vidsrc.pro/embed/tv/${id}/${s}/${e}` },
        { label: "VidSrc CC", value: "EMB", star: false, category: "legacy", movie: id => `https://vidsrc.cc/v2/embed/movie/${id}`, tv: (id,s,e) => `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}` },
        { label: "MultiEmbed Direct", value: "MULTI", star: false, category: "multi", movie: id => `https://multiembed.mov/directstream.php?video_id=${id}&tmdb=1`, tv: (id,s,e) => `https://multiembed.mov/directstream.php?video_id=${id}&tmdb=1&s=${s}&e=${e}` },
        { label: "GodDrive", value: "GOD", star: false, category: "multi", movie: id => `https://godriveplayer.com/player.php?tmdb=${id}`, tv: (id,s,e) => `https://godriveplayer.com/player.php?type=series&tmdb=${id}&season=${s}&episode=${e}` },
        { label: "VidJoy Ad-Free", value: "VIDJ", star: false, category: "single", movie: id => `https://vidjoy.pro/embed/movie/${id}?adFree=true`, tv: (id,s,e) => `https://vidjoy.pro/embed/tv/${id}/${s}/${e}?adFree=true` },
        { label: "Vidsrc VIP Single", value: "ONE", star: false, category: "single", movie: id => `https://vidsrc.vip/embed/movie/${id}`, tv: (id,s,e) => `https://vidsrc.vip/embed/tv/${id}/${s}/${e}` },
        { label: "AnyEmbed", value: "ANY", star: false, category: "single", movie: id => `https://anyembed.xyz/movie/${id}`, tv: (id,s,e) => `https://anyembed.xyz/tv/${id}/${s}/${e}` },
        { label: "PStream MovieWeb", value: "WEB", star: false, category: "single", movie: id => `https://iframe.pstream.mov/embed/tmdb-movie-${id}`, tv: (id,s,e) => `https://iframe.pstream.mov/embed/tmdb-tv-${id}/${s}/${e}` },
        { label: "NL Vidsrc", value: "NL", star: false, category: "regional", movie: id => `https://player.vidsrc.nl/embed/movie/${id}`, tv: (id,s,e) => `https://player.vidsrc.nl/embed/tv/${id}/${s}/${e}` },
        { label: "TurboVid", value: "TURBO", star: false, category: "single", movie: id => `https://turbovid.eu/api/req/movie/${id}`, tv: (id,s,e) => `https://turbovid.eu/api/req/tv/${id}/${s}/${e}` },
        { label: "Vidsrc RIP", value: "RIP", star: false, category: "single", movie: id => `https://vidsrc.rip/embed/movie/${id}`, tv: (id,s,e) => `https://vidsrc.rip/embed/tv/${id}/${s}/${e}` },
        { label: "Vidsrc SU", value: "VSU", star: false, category: "single", movie: id => `https://vidsrc.su/embed/movie/${id}`, tv: (id,s,e) => `https://vidsrc.su/embed/tv/${id}/${s}/${e}` },
        { label: "TechNeo Anime", value: "ANIME", star: false, category: "regional", movie: id => `https://vid.techneo.fun/tmdb/movies/${id}`, tv: (id,s,e) => `https://vid.techneo.fun/tmdb/tv/${id}/${s}/${e}` },
        { label: "MoviesAPI Club", value: "CLUB", star: false, category: "legacy", movie: id => `https://moviesapi.club/movie/${id}`, tv: (id,s,e) => `https://moviesapi.club/tv/${id}-${s}-${e}` },
        { label: "WarezCDN", value: "WARE", star: false, category: "legacy", movie: id => `https://embed.warezcdn.com/filme/${id}`, tv: (id,s,e) => `https://embed.warezcdn.com/serie/${id}/${s}/${e}` },
        { label: "VidSrc WTF Prime", value: "RGS2", star: false, category: "regional", movie: id => `https://www.vidsrc.wtf/4/movie/${id}`, tv: (id,s,e) => `https://www.vidsrc.wtf/4/tv/${id}/${s}/${e}` },
        { label: "VidSrc WTF Indian", value: "RGS", star: false, category: "regional", movie: id => `https://www.vidsrc.wtf/2/movie/${id}`, tv: (id,s,e) => `https://www.vidsrc.wtf/2/tv/${id}/${s}/${e}` },
        { label: "Frembed French", value: "FRE", star: false, category: "regional", movie: id => `https://frembed.mom/api/film.php?id=${id}`, tv: (id,s,e) => `https://frembed.mom/api/serie.php?id=${id}&sa=${s}&epi=${e}` },
        { label: "InsertUnit Russian", value: "RUS", star: false, category: "regional", movie: id => `https://api.insertunit.ws/embed/imdb/${id}`, tv: (id,s,e) => `https://api.insertunit.ws/embed/tv/${id}/${s}/${e}` },
        { label: "2Embed", value: "EMBED", star: false, category: "multi", movie: id => `https://www.2embed.cc/embed/${id}`, tv: (id,s,e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}` },
        { label: "AutoEmbed", value: "AUTO", star: false, category: "multi", movie: id => `https://player.autoembed.cc/embed/movie/${id}?server=1`, tv: (id,s,e) => `https://player.autoembed.cc/embed/tv/${id}/${s}/${e}?server=1` }
    ];

    async function getHome(cb) {
        try {
            const endpoints = [
                { path: "/tmdb/trending/all/week", title: "Trending Now" },
                { path: "/tmdb/trending/all/day", title: "Top 10 Today" },
                { path: "/tmdb/discover/movie?sort_by=primary_release_date.desc&page=1&vote_count.gte=10", title: "Latest Movies" },
                { path: "/tmdb/discover/tv?sort_by=first_air_date.desc&page=1&vote_count.gte=10", title: "Latest TV Shows" },
                { path: "/tmdb/movie/upcoming?page=1", title: "Upcoming Movies" },
                { path: "/tmdb/tv/airing_today?page=1", title: "Airing Today" },
                { path: "/tmdb/movie/popular?page=1", title: "Popular Movies" },
                { path: "/tmdb/tv/popular?page=1", title: "Popular TV Shows" },
                { path: "/tmdb/movie/top_rated?page=1", title: "Top Rated Movies" },
                { path: "/tmdb/tv/top_rated?page=1", title: "Top Rated TV Shows" },
                { path: "/tmdb/movie/now_playing?page=1", title: "Now Playing" },
                { path: "/tmdb/tv/on_the_air?page=1", title: "On The Air" },
                { path: "/tmdb/discover/movie?with_original_language=hi&sort_by=popularity.desc&page=1", title: "Bollywood - Hindi Movies" },
                { path: "/tmdb/discover/tv?with_original_language=hi&sort_by=popularity.desc&page=1", title: "Hindi TV Shows & Web Series" },
                { path: "/tmdb/discover/movie?with_original_language=ta&sort_by=popularity.desc&page=1", title: "Tamil Movies" },
                { path: "/tmdb/discover/movie?with_original_language=te&sort_by=popularity.desc&page=1", title: "Telugu Movies" },
                { path: "/tmdb/discover/movie?with_original_language=ml&sort_by=popularity.desc&page=1", title: "Malayalam Movies" },
                { path: "/tmdb/discover/movie?with_original_language=kn&sort_by=popularity.desc&page=1", title: "Kannada Movies" },
                { path: "/tmdb/discover/movie?with_original_language=en&sort_by=popularity.desc&page=1&vote_count.gte=100", title: "Hollywood Hindi Dubbed" },
                { path: "/tmdb/discover/movie?with_original_language=en&sort_by=popularity.desc&page=2&vote_count.gte=100", title: "Hollywood Hindi Dubbed - More" },
                { path: "/tmdb/discover/movie?with_original_language=en&sort_by=vote_average.desc&vote_count.gte=500&page=1", title: "Dual Audio Movies - Hindi + English" },
                { path: "/tmdb/discover/tv?with_original_language=en&sort_by=popularity.desc&page=1", title: "Dual Audio Series - Hindi + English" },
                { path: "/tmdb/discover/movie?with_origin_country=IN&with_original_language=hi&sort_by=popularity.desc&page=2", title: "South Indian Hindi Dubbed" },
                { path: "/tmdb/discover/tv?with_genres=16&with_origin_country=JP&sort_by=popularity.desc&page=1", title: "Anime - Japanese Sub" },
                { path: "/tmdb/discover/tv?with_genres=16&with_original_language=hi&sort_by=popularity.desc&page=1", title: "Anime - Hindi Dubbed" },
                { path: "/tmdb/discover/movie?with_genres=16&sort_by=popularity.desc&page=1", title: "Animation Movies" },
                { path: "/tmdb/discover/tv?with_genres=16&sort_by=vote_average.desc&vote_count.gte=100&page=1", title: "Top Anime Series" },
                { path: "/tmdb/discover/movie?with_genres=28&page=1", title: "Action Movies" },
                { path: "/tmdb/discover/movie?with_genres=12&page=1", title: "Adventure Movies" },
                { path: "/tmdb/discover/movie?with_genres=35&page=1", title: "Comedy Movies" },
                { path: "/tmdb/discover/movie?with_genres=27&page=1", title: "Horror Movies" },
                { path: "/tmdb/discover/movie?with_genres=53&page=1", title: "Thriller Movies" },
                { path: "/tmdb/discover/movie?with_genres=18&page=1", title: "Drama Movies" },
                { path: "/tmdb/discover/movie?with_genres=878&page=1", title: "Sci-Fi Movies" },
                { path: "/tmdb/discover/movie?with_genres=10749&page=1", title: "Romance Movies" },
                { path: "/tmdb/discover/movie?with_genres=10751&page=1", title: "Family Movies" },
                { path: "/tmdb/discover/tv?with_genres=10759&page=1", title: "Action & Adventure Series" },
                { path: "/tmdb/discover/tv?with_genres=18&page=1", title: "Drama Series" },
                { path: "/tmdb/discover/tv?with_genres=35&page=1", title: "Comedy Series" },
                { path: "/tmdb/discover/tv?with_genres=80&page=1", title: "Crime Series" },
                { path: "/tmdb/discover/tv?with_genres=10765&page=1", title: "Sci-Fi & Fantasy Series" },
                { path: "/tmdb/discover/tv?with_genres=9648&page=1", title: "Mystery Series" },
                { path: "/tmdb/discover/tv?with_origin_country=KR&sort_by=popularity.desc&page=1", title: "K-Drama - Korean Series" },
                { path: "/tmdb/discover/tv?with_origin_country=GB&sort_by=popularity.desc&page=1", title: "British Series" }
            ];

            const results = await Promise.all(endpoints.map(async ep => {
                try {
                    const data = await apiFetch(ep.path);
                    const items = (data.results || []).slice(0, 20).map(tmdbToItem).filter(Boolean);
                    return { title: ep.title, items };
                } catch (e) {
                    return { title: ep.title, items: [] };
                }
            }));

            const data = {};
            results.forEach(r => { if (r.items && r.items.length > 0) data[r.title] = r.items; });
            if (Object.keys(data).length === 0) throw new Error("No home data fetched");
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.toString() });
        }
    }

    async function search(query, page, cb) {
        if (typeof page === "function") { cb = page; page = 1; }
        try {
            const p = page || 1;
            const data = await apiFetch(`/tmdb/search/multi?query=${encodeURIComponent(query)}&page=${p}`);
            const items = (data.results || []).filter(i => i.media_type === "movie" || i.media_type === "tv" || i.title || i.name).map(tmdbToItem).filter(Boolean);
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.toString() });
        }
    }

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
                    try { const sd = await apiFetch(`/tmdb/tv/${tmdbId}/season/${s.season_number}`); return sd.episodes || []; } catch { return []; }
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

    async function loadStreams(url, cb) {
        try {
            const parts = url.split(":");
            const type = parts[0];
            let tmdbId, title, year, season, episode;

            async function ensureMovieMeta(id, t, y) {
                if (t && y) return { title: t, year: y };
                try { const d = await apiFetch(`/tmdb/movie/${id}`); return { title: d.title || t || "", year: (d.release_date || "").slice(0, 4) || y || "" }; } catch { return { title: t || "", year: y || "" }; }
            }
            async function ensureTvMeta(id, t, y) {
                if (t && y) return { title: t, year: y };
                try { const d = await apiFetch(`/tmdb/tv/${id}`); return { title: d.name || t || "", year: (d.first_air_date || "").slice(0, 4) || y || "" }; } catch { return { title: t || "", year: y || "" }; }
            }

            if (type === "movie") {
                tmdbId = parts[1];
                title = parts[2] ? decodeURIComponent(parts[2]) : "";
                year = parts[3] || "";
                const meta = await ensureMovieMeta(tmdbId, title, year);
                title = meta.title; year = meta.year;
                season = 0; episode = 0;
            } else if (type === "episode") {
                tmdbId = parts[1];
                title = parts[2] ? decodeURIComponent(parts[2]) : "";
                year = parts[3] || "";
                season = parseInt(parts[4], 10) || 1;
                episode = parseInt(parts[5], 10) || 1;
                const meta = await ensureTvMeta(tmdbId, title, year);
                title = meta.title; year = meta.year;
            } else if (type === "tv") {
                tmdbId = parts[1];
                title = parts[2] ? decodeURIComponent(parts[2]) : "";
                year = parts[3] || "";
                const meta = await ensureTvMeta(tmdbId, title, year);
                title = meta.title; year = meta.year;
                season = 1; episode = 1;
            } else {
                throw new Error("Invalid URL type: " + type);
            }

            const streams = [];
            const isMovie = type === "movie";

            for (const prov of PROVIDERS) {
                try {
                    let embedUrl = "";
                    if (isMovie) embedUrl = prov.movie(tmdbId);
                    else embedUrl = prov.tv(tmdbId, season, episode);

                    if (!embedUrl) continue;

                    // Try extractor first
                    try {
                        if (typeof globalThis.loadExtractor === 'function') {
                            const ext = await globalThis.loadExtractor(embedUrl);
                            if (Array.isArray(ext) && ext.length > 0) {
                                for (const s of ext) {
                                    if (s && s.url) {
                                        const q = s.quality ? `${prov.label} - ${s.quality}` : prov.label;
                                        streams.push(new StreamResult({ url: s.url, quality: q, headers: s.headers || { "Referer": "https://rivestream.ru/" }, subtitles: s.subtitles || [] }));
                                    }
                                }
                                continue;
                            }
                        }
                    } catch {}

                    // Try fetch and extract m3u8/mp4
                    try {
                        const res = await fetch(embedUrl, { headers: { "Referer": "https://rivestream.ru/", "Origin": "https://rivestream.ru", "User-Agent": "Mozilla/5.0" } });
                        if (res.ok) {
                            const html = await res.text();
                            const found = extractStreamsFromHtml(html, prov.label);
                            if (found.length > 0) { streams.push(...found); continue; }
                            const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                            if (iframeMatch && iframeMatch[1]) {
                                let iframeUrl = iframeMatch[1];
                                if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
                                if (iframeUrl.startsWith("/")) { try { const base = new URL(embedUrl); iframeUrl = base.origin + iframeUrl; } catch {} }
                                try {
                                    const res2 = await fetch(iframeUrl, { headers: { "Referer": embedUrl, "Origin": "https://rivestream.ru" } });
                                    if (res2.ok) {
                                        const html2 = await res2.text();
                                        const found2 = extractStreamsFromHtml(html2, prov.label + " iframe");
                                        if (found2.length > 0) { streams.push(...found2); continue; }
                                    }
                                } catch {}
                            }
                        }
                    } catch {}

                    // Fallback embed
                    streams.push(new StreamResult({
                        url: embedUrl,
                        quality: prov.label + (prov.star ? " ⭐ (embed)" : " (embed)"),
                        headers: { "Referer": "https://rivestream.ru/", "Origin": "https://rivestream.ru" }
                    }));
                } catch {}
            }

            // Deduplicate
            const seen = new Set(); const deduped = [];
            for (const s of streams) {
                if (!s || !s.url) continue;
                if (seen.has(s.url)) continue;
                seen.add(s.url);
                deduped.push(s);
            }

            cb({ success: true, data: deduped });
        } catch (e) {
            cb({ success: false, errorCode: "STREAMS_ERROR", message: e.toString() });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
