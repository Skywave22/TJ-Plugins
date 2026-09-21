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

    const FALLBACK_TMDB_BASES = [
        "https://skyflixer.skyflixer1.workers.dev/api",
        "https://skyflixer.batman18677.workers.dev/api",
        "https://skyflixer.superman88911u.workers.dev/api",
        "https://skyflixer.univers-9009.workers.dev/api"
    ];

    function getTmdbApiBase() {
        let base = (typeof manifest !== 'undefined' && manifest.baseUrl) ? manifest.baseUrl : "";
        if (base.includes("workers.dev")) {
            base = base.replace(/\/+$/, "");
            if (!base.endsWith("/api")) base = base + "/api";
            return base;
        }
        return FALLBACK_TMDB_BASES[0];
    }

    function getAllTmdbBases() {
        const primary = getTmdbApiBase();
        const list = [primary];
        for (const b of FALLBACK_TMDB_BASES) if (!list.includes(b)) list.push(b);
        return list;
    }

    async function apiFetch(path, options = {}) {
        const bases = getAllTmdbBases();
        let lastErr = null;
        for (const apiBase of bases) {
            const url = path.startsWith("http") ? path : apiBase + (path.startsWith("/") ? path : "/" + path);
            const headers = {
                "Origin": "https://rivestream.ru",
                "Referer": "https://rivestream.ru/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                ...(options.headers || {})
            };
            try {
                const res = await fetch(url, { ...options, headers });
                if (!res.ok) {
                    const txt = await res.text().catch(() => "");
                    throw new Error(`HTTP ${res.status} for ${path} - ${txt.slice(0,300)}`);
                }
                const text = await res.text();
                try { return JSON.parse(text); } catch { return text; }
            } catch (e) {
                lastErr = e;
                continue;
            }
        }
        throw lastErr || new Error("All TMDB bases failed for " + path);
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

    function unpackPacker(p, a, c, k) {
        try {
            for (let i = c - 1; i >= 0; i--) {
                if (k[i]) {
                    let key = i.toString(a);
                    const re = new RegExp("\\b" + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\b", "g");
                    p = p.replace(re, k[i]);
                }
            }
            return p;
        } catch { return p; }
    }

    function extractHanerixLinks(html) {
        const streams = [];
        if (!html) return streams;
        try {
            let packed = null, base = 0, count = 0, dict = [];
            const evalMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{[^}]+\}\('([^']*)',\s*(\d+),\s*(\d+),\s*'([^']*)'\.split\('\|'\)/);
            if (evalMatch) {
                packed = evalMatch[1];
                base = parseInt(evalMatch[2], 10);
                count = parseInt(evalMatch[3], 10);
                dict = evalMatch[4].split('|');
            } else {
                const m2 = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split/);
                if (m2) {
                    packed = m2[1];
                    base = parseInt(m2[2], 10);
                    count = parseInt(m2[3], 10);
                    dict = m2[4].split('|');
                }
            }
            let unpacked = null;
            if (packed && base && count && dict.length) {
                unpacked = unpackPacker(packed, base, count, dict);
            } else {
                unpacked = html;
            }
            const masterRe = /https?:\/\/[^"'\\\s]+\/[^"'\\\s]*master\.m3u8[^"'\\\s]*/g;
            const hlsRe = /"hls\d*"\s*:\s*"([^"]+)"|'hls\d*'\s*:\s*'([^']+)'/g;
            const streamRe = /\/stream\/[^"'\\\s]+\.m3u8/g;
            let candidates = [];
            const httpsM3u8 = (unpacked.match(masterRe) || []).concat((html.match(masterRe) || []));
            candidates = candidates.concat(httpsM3u8);
            let match;
            while ((match = hlsRe.exec(unpacked)) !== null) {
                const url = match[1] || match[2];
                if (url) candidates.push(url);
            }
            while ((match = hlsRe.exec(html)) !== null) {
                const url = match[1] || match[2];
                if (url) candidates.push(url);
            }
            const relStreams = (unpacked.match(streamRe) || []).concat((html.match(streamRe) || []));
            for (const rel of relStreams) {
                if (rel.startsWith("/")) candidates.push("https://hanerix.com" + rel);
                else candidates.push(rel);
            }
            const seen = {};
            for (let u of candidates) {
                if (!u) continue;
                u = u.replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/\\"/g, '"').trim();
                if (u.startsWith("/")) u = "https://hanerix.com" + u;
                if (seen[u]) continue;
                if (u.includes("image.tmdb.org")) continue;
                if (u.length > 2000) continue;
                seen[u] = true;
                let quality = "StreamHG";
                if (u.includes("hls2") || u.includes("480") || u.includes("513")) quality = "StreamHG - 480p";
                else if (u.includes("hls4") || u.includes("1080") || u.includes("2255")) quality = "StreamHG - 1080p";
                else if (u.includes("720") || u.includes("1095")) quality = "StreamHG - 720p";
                else if (u.includes("master")) quality = "StreamHG - Auto";
                streams.push(new StreamResult({
                    url: u,
                    quality: quality,
                    headers: { "Referer": "https://hanerix.com/", "Origin": "https://hanerix.com", "User-Agent": "Mozilla/5.0" }
                }));
            }
        } catch {}
        return streams;
    }

    function extractStreamsFromHtml(html, label) {
        const found = []; const seen = {};
        if (!html || typeof html !== 'string') return found;
        if (html.includes("hanerix.com") || html.includes("jwplayer") || html.includes("hls4") || html.includes("eval(function(p,a,c,k,e,d)")) {
            const hanerix = extractHanerixLinks(html);
            if (hanerix.length > 0) return hanerix;
        }
        const m3u8 = html.match(/https?:\/\/[^\\s\"'<>]+?\.m3u8[^\\s\"'<>]*/g) || [];
        const mp4 = html.match(/https?:\/\/[^\\s\"'<>]+?\.mp4[^\\s\"'<>]*/g) || [];
        const fileMatches = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/gi) || [];
        const all = m3u8.concat(mp4);
        for (const fm of fileMatches) {
            const uMatch = fm.match(/https?:\/\/[^"']+/);
            if (uMatch) all.push(uMatch[0]);
        }
        for (let i = 0; i < all.length; i++) {
            let u = all[i].replace(/\\u002F/g, "/").replace(/\\\//g, "/");
            if (seen[u]) continue;
            if (u.includes("image.tmdb.org")) continue;
            if (u.length > 2000) continue;
            if (u.includes(".jpg") || u.includes(".png") || u.includes(".webp") || u.includes(".svg")) continue;
            if (u.includes("google") && u.includes("ads")) continue;
            seen[u] = true;
            found.push(new StreamResult({ url: u, quality: label || "auto", headers: { "Referer": "https://rivestream.ru/", "Origin": "https://rivestream.ru" } }));
        }
        return found;
    }

    // RiveStream providers - curated + reliable external
    const PROVIDERS = [
        // Starred curated (most reliable)
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
        { label: "VidFast Multi", value: "VIDF", star: true, category: "multi", movie: id => `https://vidfast.pro/movie/${id}`, tv: (id,s,e) => `https://vidfast.pro/tv/${id}/${s}/${e}` }
    ];

    const EXTRA_RELIABLE = [
        // These use IMDB id and are known to work with SkyStream extractors
        { label: "Vidsrc XYZ", movie: imdb => `https://vidsrc.xyz/embed/movie?imdb=${imdb}`, tv: (imdb,s,e) => `https://vidsrc.xyz/embed/tv?imdb=${imdb}&season=${s}&episode=${e}` },
        { label: "2Embed CC", movie: imdb => `https://www.2embed.cc/embed/${imdb}`, tv: (imdb,s,e) => `https://www.2embed.cc/embedtv/${imdb}&s=${s}&e=${e}` },
        { label: "AutoEmbed", movie: tmdb => `https://autoembed.co/movie/tmdb/${tmdb}`, tv: (tmdb,s,e) => `https://autoembed.co/tv/tmdb/${tmdb}-${s}-${e}` },
        { label: "Vidsrc To", movie: imdb => `https://vidsrc.to/embed/movie/${imdb}`, tv: (imdb,s,e) => `https://vidsrc.to/embed/tv/${imdb}/${s}/${e}` },
        { label: "SuperEmbed", movie: imdb => `https://multiembed.mov/directstream.php?video_id=${imdb}&tmdb=0`, tv: (imdb,s,e) => `https://multiembed.mov/directstream.php?video_id=${imdb}&tmdb=0&s=${s}&e=${e}` }
    ];

    async function getHome(cb) {
        try {
            const endpoints = [
                { path: "/tmdb/trending/all/week", title: "Trending Now" },
                { path: "/tmdb/discover/movie?sort_by=primary_release_date.desc&page=1&vote_count.gte=10", title: "Latest Movies" },
                { path: "/tmdb/discover/tv?sort_by=first_air_date.desc&page=1&vote_count.gte=10", title: "Latest TV Shows" },
                { path: "/tmdb/movie/popular?page=1", title: "Popular Movies" },
                { path: "/tmdb/tv/popular?page=1", title: "Popular TV Shows" },
                { path: "/tmdb/movie/top_rated?page=1", title: "Top Rated Movies" },
                { path: "/tmdb/tv/top_rated?page=1", title: "Top Rated TV Shows" },
                { path: "/tmdb/discover/movie?with_original_language=hi&sort_by=popularity.desc&page=1", title: "Bollywood - Hindi Movies" },
                { path: "/tmdb/discover/movie?with_original_language=en&sort_by=popularity.desc&page=1&vote_count.gte=100", title: "Hollywood Hindi Dubbed" },
                { path: "/tmdb/discover/movie?with_original_language=en&sort_by=vote_average.desc&vote_count.gte=500&page=1", title: "Dual Audio Movies - Hindi + English" },
                { path: "/tmdb/discover/tv?with_original_language=en&sort_by=popularity.desc&page=1", title: "Dual Audio Series - Hindi + English" },
                { path: "/tmdb/discover/movie?with_origin_country=IN&with_original_language=hi&sort_by=popularity.desc&page=2", title: "South Indian Hindi Dubbed" },
                { path: "/tmdb/discover/movie?with_original_language=ta&sort_by=popularity.desc&page=1", title: "Tamil Movies" },
                { path: "/tmdb/discover/movie?with_original_language=te&sort_by=popularity.desc&page=1", title: "Telugu Movies" },
                { path: "/tmdb/discover/tv?with_genres=16&with_origin_country=JP&sort_by=popularity.desc&page=1", title: "Anime - Japanese Sub" },
                { path: "/tmdb/discover/tv?with_genres=16&with_original_language=hi&sort_by=popularity.desc&page=1", title: "Anime - Hindi Dubbed" },
                { path: "/tmdb/discover/movie?with_genres=28&page=1", title: "Action Movies" },
                { path: "/tmdb/discover/movie?with_genres=35&page=1", title: "Comedy Movies" },
                { path: "/tmdb/discover/movie?with_genres=27&page=1", title: "Horror Movies" },
                { path: "/tmdb/discover/tv?with_origin_country=KR&sort_by=popularity.desc&page=1", title: "K-Drama - Korean Series" }
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
                try {
                    const d = await apiFetch(`/tmdb/movie/${id}`);
                    return { title: d.title || t || "", year: (d.release_date || "").slice(0, 4) || y || "", imdb: d.imdb_id || null };
                } catch {
                    return { title: t || "", year: y || "", imdb: null };
                }
            }
            async function ensureTvMeta(id, t, y) {
                try {
                    const d = await apiFetch(`/tmdb/tv/${id}`);
                    let imdb = null;
                    try {
                        const ext = await apiFetch(`/tmdb/tv/${id}/external_ids`);
                        imdb = ext.imdb_id || null;
                    } catch {}
                    // Fallback to direct TMDB API with known key if worker fails
                    if (!imdb) {
                        try {
                            const directRes = await fetch(`https://api.themoviedb.org/3/tv/${id}/external_ids?api_key=d64117f26031a428449f102ced3aba73`, {
                                headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
                            });
                            if (directRes.ok) {
                                const ext = await directRes.json();
                                imdb = ext.imdb_id || null;
                            }
                        } catch {}
                    }
                    return { title: d.name || t || "", year: (d.first_air_date || "").slice(0, 4) || y || "", imdb: imdb };
                } catch {
                    // Even if main fetch fails, try direct TMDB for imdb
                    try {
                        const directRes = await fetch(`https://api.themoviedb.org/3/tv/${id}/external_ids?api_key=d64117f26031a428449f102ced3aba73`, {
                            headers: { "Accept": "application/json" }
                        });
                        if (directRes.ok) {
                            const ext = await directRes.json();
                            if (ext.imdb_id) return { title: t || "", year: y || "", imdb: ext.imdb_id };
                        }
                    } catch {}
                    return { title: t || "", year: y || "", imdb: null };
                }
            }

            let imdbId = null;

            if (type === "movie") {
                tmdbId = parts[1];
                title = parts[2] ? decodeURIComponent(parts[2]) : "";
                year = parts[3] || "";
                const meta = await ensureMovieMeta(tmdbId, title, year);
                title = meta.title; year = meta.year; imdbId = meta.imdb;
                if (!imdbId) {
                    try {
                        const d = await apiFetch(`/tmdb/movie/${tmdbId}`);
                        imdbId = d.imdb_id || null;
                    } catch {}
                }
                season = 0; episode = 0;
            } else if (type === "episode") {
                tmdbId = parts[1];
                title = parts[2] ? decodeURIComponent(parts[2]) : "";
                year = parts[3] || "";
                season = parseInt(parts[4], 10) || 1;
                episode = parseInt(parts[5], 10) || 1;
                const meta = await ensureTvMeta(tmdbId, title, year);
                title = meta.title; year = meta.year; imdbId = meta.imdb;
            } else if (type === "tv") {
                tmdbId = parts[1];
                title = parts[2] ? decodeURIComponent(parts[2]) : "";
                year = parts[3] || "";
                const meta = await ensureTvMeta(tmdbId, title, year);
                title = meta.title; year = meta.year; imdbId = meta.imdb;
                season = 1; episode = 1;
            } else {
                throw new Error("Invalid URL type: " + type);
            }

            const streams = [];
            const isMovie = type === "movie";

            // First try extra reliable providers that use IMDB/TMDB
            if (imdbId || tmdbId) {
                for (const prov of EXTRA_RELIABLE) {
                    try {
                        let embedUrl = "";
                        if (prov.label.includes("AutoEmbed")) {
                            embedUrl = isMovie ? prov.movie(tmdbId) : prov.tv(tmdbId, season, episode);
                        } else {
                            const idToUse = imdbId || tmdbId;
                            embedUrl = isMovie ? prov.movie(idToUse) : prov.tv(idToUse, season, episode);
                        }
                        if (!embedUrl) continue;
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
                        try {
                            const res = await fetch(embedUrl, { headers: { "Referer": "https://rivestream.ru/", "Origin": "https://rivestream.ru", "User-Agent": "Mozilla/5.0" } });
                            if (res.ok) {
                                const html = await res.text();
                                const found = extractStreamsFromHtml(html, prov.label);
                                if (found.length > 0) { streams.push(...found); continue; }
                            }
                        } catch {}
                        streams.push(new StreamResult({ url: embedUrl, quality: prov.label + " (embed)", headers: { "Referer": "https://rivestream.ru/", "Origin": "https://rivestream.ru" } }));
                    } catch {}
                }
            }

            // Then try RiveStream's own curated providers
            for (const prov of PROVIDERS) {
                try {
                    let embedUrl = "";
                    if (isMovie) embedUrl = prov.movie(tmdbId);
                    else embedUrl = prov.tv(tmdbId, season, episode);
                    if (!embedUrl) continue;

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

                    streams.push(new StreamResult({
                        url: embedUrl,
                        quality: prov.label + (prov.star ? " â­ (embed)" : " (embed)"),
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

            // Prioritize direct m3u8/mp4 over embed fallback
            const direct = deduped.filter(s => s.url.includes(".m3u8") || s.url.includes(".mp4"));
            const finalList = direct.length > 0 ? direct : deduped;

            cb({ success: true, data: finalList });
        } catch (e) {
            cb({ success: false, errorCode: "STREAMS_ERROR", message: e.toString() });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
