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

    // -------------------- Config & Failover --------------------
    const FALLBACK_API_BASES = [
        "https://skyflixer.skyflixer1.workers.dev/api",
        "https://skyflixer.batman18677.workers.dev/api",
        "https://skyflixer.superman88911u.workers.dev/api",
        "https://skyflixer.univers-9009.workers.dev/api"
    ];

    function getApiBase() {
        let base = (typeof manifest !== 'undefined' && manifest.baseUrl) ? manifest.baseUrl : FALLBACK_API_BASES[0];
        base = base.replace(/\/+$/, "");
        if (!base.endsWith("/api")) base = base + "/api";
        return base;
    }

    function getAllApiBases() {
        const primary = getApiBase();
        const list = [primary];
        for (const b of FALLBACK_API_BASES) {
            if (!list.includes(b)) list.push(b);
        }
        return list;
    }

    async function apiFetch(path, options = {}) {
        const bases = getAllApiBases();
        let lastErr = null;
        for (const apiBase of bases) {
            const url = path.startsWith("http") ? path : apiBase + (path.startsWith("/") ? path : "/" + path);
            const headers = {
                "Origin": "https://skyflixer.fun",
                "Referer": "https://skyflixer.fun/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
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
                try {
                    return JSON.parse(text);
                } catch {
                    return text;
                }
            } catch (e) {
                lastErr = e;
                // try next base
                continue;
            }
        }
        throw lastErr || new Error("All API bases failed for " + path);
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

    // -------------------- Hanerix Unpacker & Stream Extractor --------------------
    function unpackPacker(p, a, c, k) {
        // p = packed code string, a = base, c = count, k = dict array
        try {
            for (let i = c - 1; i >= 0; i--) {
                if (k[i]) {
                    let key;
                    if (a === 36 || a === 62 || a <= 36) {
                        // convert i to base a
                        key = i.toString(a);
                    } else {
                        key = i.toString(a);
                    }
                    const re = new RegExp("\\b" + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\b", "g");
                    p = p.replace(re, k[i]);
                }
            }
            return p;
        } catch {
            return p;
        }
    }

    function extractHanerixLinks(html) {
        const streams = [];
        if (!html) return streams;
        try {
            // Look for eval(function(p,a,c,k,e,d){...}) pattern
            const evalMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{[^}]+\}\('([^']*)',\s*(\d+),\s*(\d+),\s*'([^']*)'\.split\('\|'\)/);
            // Alternative regex with double quotes and more generic
            let packed = null, base = 0, count = 0, dict = [];
            if (evalMatch) {
                packed = evalMatch[1];
                base = parseInt(evalMatch[2], 10);
                count = parseInt(evalMatch[3], 10);
                dict = evalMatch[4].split('|');
            } else {
                // try second pattern: search for .split('|')))
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
                unpacked = html; // fallback use html itself
            }

            // Now search for links object: "hls4":"...master.m3u8" or links = {...}
            // Try to find all master.m3u8 urls
            const masterRe = /https?:\/\/[^"'\\\s]+\/[^"'\\\s]*master\.m3u8[^"'\\\s]*/g;
            const hlsRe = /"hls\d*"\s*:\s*"([^"]+)"|'hls\d*'\s*:\s*'([^']+)'/g;
            const streamRe = /\/stream\/[^"'\\\s]+\.m3u8/g;

            let m;
            const seen = {};
            // Extract from unpacked
            let candidates = [];
            // direct https m3u8
            const httpsM3u8 = (unpacked.match(masterRe) || []).concat((html.match(masterRe) || []));
            candidates = candidates.concat(httpsM3u8);

            // hls links object
            let match;
            while ((match = hlsRe.exec(unpacked)) !== null) {
                const url = match[1] || match[2];
                if (url) candidates.push(url);
            }
            while ((match = hlsRe.exec(html)) !== null) {
                const url = match[1] || match[2];
                if (url) candidates.push(url);
            }

            // relative /stream/... urls
            const relStreams = (unpacked.match(streamRe) || []).concat((html.match(streamRe) || []));
            for (const rel of relStreams) {
                // make absolute to hanerix.com
                if (rel.startsWith("/")) {
                    candidates.push("https://hanerix.com" + rel);
                } else {
                    candidates.push(rel);
                }
            }

            // Also look for links.hls4, links.hls2 patterns after unpack
            const linksObjMatch = unpacked.match(/links\s*=\s*(\{[^}]+\})/);
            if (linksObjMatch) {
                try {
                    // Extract urls from that object string
                    const inner = linksObjMatch[1];
                    const urlMatches = inner.match(/https?:\/\/[^"']+m3u8[^"']*|\"\/stream\/[^"]+\"/g) || [];
                    for (let u of urlMatches) {
                        u = u.replace(/^"|"$/g, '');
                        if (u.startsWith("/")) u = "https://hanerix.com" + u;
                        candidates.push(u);
                    }
                } catch {}
            }

            // Deduplicate and clean
            for (let u of candidates) {
                if (!u) continue;
                u = u.replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/\\"/g, '"').trim();
                // fix escaped
                if (u.startsWith("/")) u = "https://hanerix.com" + u;
                if (seen[u]) continue;
                if (u.includes("image.tmdb.org")) continue;
                if (u.length > 2000) continue;
                seen[u] = true;
                // Determine quality from url or label
                let quality = "StreamHG";
                if (u.includes("hls2") || u.includes("480") || u.includes("513")) quality = "StreamHG - 480p";
                else if (u.includes("hls4") || u.includes("1080") || u.includes("2255")) quality = "StreamHG - 1080p";
                else if (u.includes("720") || u.includes("1095")) quality = "StreamHG - 720p";
                else if (u.includes("master")) quality = "StreamHG - Auto";

                streams.push(new StreamResult({
                    url: u,
                    quality: quality,
                    headers: {
                        "Referer": "https://hanerix.com/",
                        "Origin": "https://hanerix.com",
                        "User-Agent": "Mozilla/5.0"
                    }
                }));
            }

        } catch (e) {
            // ignore
        }
        return streams;
    }

    function extractStreamsFromHtml(html, label) {
        const found = [];
        const seen = {};
        if (!html || typeof html !== 'string') return found;

        // First try hanerix specific
        if (html.includes("hanerix.com") || html.includes("jwplayer") || html.includes("hls4") || html.includes("eval(function(p,a,c,k,e,d)")) {
            const hanerix = extractHanerixLinks(html);
            if (hanerix.length > 0) return hanerix;
        }

        // Generic m3u8 / mp4
        const m3u8 = html.match(/https?:\/\/[^\\s\"'<>]+?\.m3u8[^\\s\"'<>]*/g) || [];
        const mp4 = html.match(/https?:\/\/[^\\s\"'<>]+?\.mp4[^\\s\"'<>]*/g) || [];
        // Also look for file: "https://..." patterns
        const fileMatches = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/gi) || [];
        const all = m3u8.concat(mp4);
        for (const fm of fileMatches) {
            const uMatch = fm.match(/https?:\/\/[^"']+/);
            if (uMatch) all.push(uMatch[0]);
        }

        for (let i = 0; i < all.length; i++) {
            let u = all[i];
            u = u.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
            if (seen[u]) continue;
            if (u.includes("image.tmdb.org")) continue;
            if (u.length > 2000) continue;
            if (u.includes(".jpg") || u.includes(".png") || u.includes(".webp") || u.includes(".svg")) continue;
            if (u.includes("google") && u.includes("ads")) continue;
            seen[u] = true;
            found.push(new StreamResult({
                url: u,
                quality: label || "auto",
                headers: { "Referer": "https://skyflixer.fun/", "Origin": "https://skyflixer.fun" }
            }));
        }
        return found;
    }

    // -------------------- getHome - CLEANED (only useful sections) --------------------
    async function getHome(cb) {
        try {
            const endpoints = [
                // Trending / Latest / Popular / Top Rated - Core
                { path: "/tmdb/trending/all/week", title: "Trending Now" },
                { path: "/tmdb/discover/movie?sort_by=primary_release_date.desc&page=1&vote_count.gte=10", title: "Latest Movies" },
                { path: "/tmdb/discover/tv?sort_by=first_air_date.desc&page=1&vote_count.gte=10", title: "Latest TV Shows" },
                { path: "/tmdb/movie/popular?page=1", title: "Popular Movies" },
                { path: "/tmdb/tv/popular?page=1", title: "Popular TV Shows" },
                { path: "/tmdb/movie/top_rated?page=1", title: "Top Rated Movies" },
                { path: "/tmdb/tv/top_rated?page=1", title: "Top Rated TV Shows" },

                // Hindi / Bollywood / Dubbed / Dual Audio - Essential for this audience
                { path: "/tmdb/discover/movie?with_original_language=hi&sort_by=popularity.desc&page=1", title: "Bollywood - Hindi Movies" },
                { path: "/tmdb/discover/movie?with_original_language=en&sort_by=popularity.desc&page=1&vote_count.gte=100", title: "Hollywood Hindi Dubbed" },
                { path: "/tmdb/discover/movie?with_original_language=en&sort_by=vote_average.desc&vote_count.gte=500&page=1", title: "Dual Audio Movies - Hindi + English" },
                { path: "/tmdb/discover/tv?with_original_language=en&sort_by=popularity.desc&page=1", title: "Dual Audio Series - Hindi + English" },
                { path: "/tmdb/discover/movie?with_origin_country=IN&with_original_language=hi&sort_by=popularity.desc&page=2", title: "South Indian Hindi Dubbed" },
                { path: "/tmdb/discover/movie?with_original_language=ta&sort_by=popularity.desc&page=1", title: "Tamil Movies" },
                { path: "/tmdb/discover/movie?with_original_language=te&sort_by=popularity.desc&page=1", title: "Telugu Movies" },

                // Anime - Important
                { path: "/tmdb/discover/tv?with_genres=16&with_origin_country=JP&sort_by=popularity.desc&page=1", title: "Anime - Japanese Sub" },
                { path: "/tmdb/discover/tv?with_genres=16&with_original_language=hi&sort_by=popularity.desc&page=1", title: "Anime - Hindi Dubbed" },

                // Genres - Only most useful
                { path: "/tmdb/discover/movie?with_genres=28&page=1", title: "Action Movies" },
                { path: "/tmdb/discover/movie?with_genres=35&page=1", title: "Comedy Movies" },
                { path: "/tmdb/discover/movie?with_genres=27&page=1", title: "Horror Movies" },
                { path: "/tmdb/discover/movie?with_genres=18&page=1", title: "Drama Movies" },
                { path: "/tmdb/discover/tv?with_origin_country=KR&sort_by=popularity.desc&page=1", title: "K-Drama - Korean Series" }
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
            results.forEach(r => {
                if (r.items && r.items.length > 0) {
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

    // -------------------- loadStreams - FIXED with direct extraction --------------------
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

            // Fetch with failover - try all bases until success
            let data = null;
            let lastErr = null;
            for (const base of getAllApiBases()) {
                try {
                    const fetchUrl = base + "/videohosting/fetch";
                    const res = await fetch(fetchUrl, {
                        method: "POST",
                        body: JSON.stringify(body),
                        headers: {
                            "Content-Type": "application/json",
                            "Origin": "https://skyflixer.fun",
                            "Referer": "https://skyflixer.fun/",
                            "User-Agent": "Mozilla/5.0"
                        }
                    });
                    if (!res.ok) {
                        const txt = await res.text().catch(() => "");
                        throw new Error(`HTTP ${res.status} ${txt.slice(0,200)}`);
                    }
                    const txt = await res.text();
                    data = JSON.parse(txt);
                    if (data) break;
                } catch (e) {
                    lastErr = e;
                    continue;
                }
            }
            if (!data) throw lastErr || new Error("videohosting fetch failed");

            const servers = data.servers || {};
            const streams = [];

            for (const [key, srv] of Object.entries(servers)) {
                if (!srv || !srv.available || !srv.embedUrl) continue;
                const hostLabel = (srv.hostName || key || "unknown").toString();
                const embedUrl = srv.embedUrl;

                // 1. Try direct hanerix extraction first (most reliable)
                if (embedUrl.includes("hanerix.com") || key === "streamhg") {
                    try {
                        const res = await fetch(embedUrl, {
                            headers: {
                                "Referer": "https://skyflixer.fun/",
                                "Origin": "https://skyflixer.fun",
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                            }
                        });
                        if (res.ok) {
                            const html = await res.text();
                            const direct = extractHanerixLinks(html);
                            if (direct.length > 0) {
                                streams.push(...direct);
                                continue;
                            }
                            // also try generic
                            const generic = extractStreamsFromHtml(html, hostLabel);
                            if (generic.length > 0) {
                                streams.push(...generic);
                                continue;
                            }
                        }
                    } catch {}
                }

                // 2. Try loadExtractor (built-in)
                try {
                    if (typeof globalThis.loadExtractor === 'function') {
                        const extResult = await globalThis.loadExtractor(embedUrl);
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
                } catch (e) {
                    // console.log("extractor failed for " + embedUrl + " " + e.message);
                }

                // 3. Try fetch + regex for m3u8/mp4
                try {
                    const res = await fetch(embedUrl, {
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
                                    const base = new URL(embedUrl);
                                    iframeUrl = base.origin + iframeUrl;
                                } catch {}
                            }
                            try {
                                const res2 = await fetch(iframeUrl, {
                                    headers: { "Referer": embedUrl, "Origin": "https://skyflixer.fun" }
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

                // 4. Fallback: return embed URL itself - SkyStream may still be able to handle via internal extractor at playback time
                // But mark quality properly so user sees server name
                streams.push(new StreamResult({
                    url: embedUrl,
                    quality: hostLabel + " (embed)",
                    headers: { "Referer": "https://skyflixer.fun/", "Origin": "https://skyflixer.fun" }
                }));
            }

            // Deduplicate
            const seen = new Set();
            const deduped = [];
            for (const s of streams) {
                if (!s || !s.url) continue;
                // Normalize url
                let u = s.url;
                if (seen.has(u)) continue;
                seen.add(u);
                deduped.push(s);
            }

            // If we have at least one direct m3u8/mp4, prioritize them over embed fallback
            const direct = deduped.filter(s => s.url.includes(".m3u8") || s.url.includes(".mp4"));
            const finalList = direct.length > 0 ? direct : deduped;

            if (finalList.length === 0) {
                // Return empty but success true to avoid greyed? Actually should return empty with success true so app shows no streams rather than error
                // But we try to ensure at least embed urls are returned
                cb({ success: true, data: deduped });
            } else {
                cb({ success: true, data: finalList });
            }
        } catch (e) {
            cb({ success: false, errorCode: "STREAMS_ERROR", message: e.toString() + " " + (e.stack || "") });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
