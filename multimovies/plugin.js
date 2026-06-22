(function() {

    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";

    // Helper to extract the Next.js _next_f hydration chunks
    async function fetchNextHydration(url) {
        let text = "";
        try {
            if (typeof http_get !== 'undefined') {
                const res = await http_get(url, { "User-Agent": USER_AGENT });
                text = res.body || "";
            } else if (typeof fetch !== 'undefined') {
                const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
                text = await res.text();
            }
        } catch (e) {
            throw new Error("Connection Failed. Site blocked by ISP or down.");
        }
        
        let fullText = "";
        if (!text) return fullText;

        const regex = /self\.__next_f\.push\(\[1,"(.*?)"\]\)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            try { 
                fullText += JSON.parse('"' + match[match.length - 1] + '"'); 
            } catch(e) {}
        }
        return fullText;
    }

    function extractJsonFromTag(str, key) {
        if (!str) return null;
        const parts = str.split(`"${key}":`);
        if (parts.length > 1) {
            let jsonStr = parts[1];
            let depth = 0;
            let endIndex = -1;
            for (let i = 0; i < jsonStr.length; i++) {
                if (jsonStr[i] === '{' || jsonStr[i] === '[') depth++;
                if (jsonStr[i] === '}' || jsonStr[i] === ']') depth--;
                if (depth === 0 && i > 0) {
                    endIndex = i;
                    break;
                }
            }
            if (endIndex !== -1) {
                try {
                    return JSON.parse(jsonStr.substring(0, endIndex + 1));
                } catch(e) {}
            }
        }
        return null;
    }

    // --- HTML / DOOPLAY FALLBACK SCRAPING ---
    async function fetchHtml(url) {
        if (typeof http_get !== 'undefined') {
            const res = await http_get(url, { "User-Agent": USER_AGENT });
            return res.body || "";
        } else if (typeof fetch !== 'undefined') {
            const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
            return await res.text();
        }
        return "";
    }

    async function getHome(cb) {
        try {
            const baseUrl = manifest.baseUrl;

            // If the mirror is .cyou or .bond, it uses NextJS. Otherwise it uses Dooplay.
            if (baseUrl.includes(".cyou") || baseUrl.includes(".bond")) {
                const fullText = await fetchNextHydration(baseUrl);
                if (!fullText) return cb({ success: false, message: "Site blocked or Cloudflare challenge active." });

                const items = extractJsonFromTag(fullText, "items");
                const data = {};
                if (items && Array.isArray(items)) {
                    const validItems = items.filter(i => i && i.title && i.tmdbId && i.mediaType);
                    if (validItems.length > 0) {
                        data["Trending"] = validItems.map(item => {
                            return new MultimediaItem({
                                title: String(item.title),
                                url: `/${item.mediaType}/${item.tmdbId}`,
                                posterUrl: item.posterPath ? `https://image.tmdb.org/t/p/w342${item.posterPath}` : "",
                                type: item.mediaType === 'movie' ? 'movie' : 'series'
                            });
                        });
                    }
                }
                if (!data["Trending"] || data["Trending"].length === 0) return cb({ success: false, message: "Failed to parse data." });
                return cb({ success: true, data: data });
            } 
            
            else {
                // DOOPLAY FALLBACK
                const data = {};
                const html = await fetchHtml(baseUrl);
                if (!html) return cb({ success: false, message: "Site blocked or down." });
                
                const items = [];
                const regex = /<article[^>]*>.*?<div class="poster">\s*<img src="([^"]+)"[^>]*>.*?<div class="data">\s*<h3><a href="([^"]+)">([^<]+)<\/a><\/h3>/gs;
                let m;
                while ((m = regex.exec(html)) !== null) {
                    const posterUrl = m[1];
                    const itemUrl = m[2];
                    const title = m[3].trim();
                    const isMovie = itemUrl.includes("movies");
                    items.push(new MultimediaItem({
                        title: title,
                        url: itemUrl,
                        posterUrl: posterUrl,
                        type: isMovie ? 'movie' : 'series'
                    }));
                }
                
                if (items.length > 0) {
                    data["Trending"] = items;
                    return cb({ success: true, data: data });
                } else {
                    return cb({ success: false, message: "No items found. Theme changed or site blocked." });
                }
            }

        } catch (e) {
            cb({ success: false, message: e.message || "Unknown Home Error" });
        }
    }

    async function search(query, cb) {
        try {
            const baseUrl = manifest.baseUrl;
            if (baseUrl.includes(".cyou") || baseUrl.includes(".bond")) {
                const fullText = await fetchNextHydration(`${baseUrl}/search?q=${encodeURIComponent(query)}`);
                const items = extractJsonFromTag(fullText, "items") || [];
                const results = items.map(item => {
                    const title = item.title || item.name;
                    const id = item.tmdbId || item.id;
                    return new MultimediaItem({
                        title: String(title),
                        url: `/${item.mediaType}/${id}`,
                        posterUrl: item.posterPath ? `https://image.tmdb.org/t/p/w342${item.posterPath}` : "",
                        type: item.mediaType === 'movie' ? 'movie' : 'series'
                    });
                });
                return cb({ success: true, data: results });
            } else {
                // DOOPLAY FALLBACK
                const html = await fetchHtml(`${baseUrl}/?s=${encodeURIComponent(query)}`);
                const results = [];
                const regex = /<div class="result-item">.*?<div class="image">\s*<div class="thumbnail">\s*<a href="([^"]+)"><img src="([^"]+)"[^>]*>.*?<div class="title">\s*<a href="[^"]+">([^<]+)<\/a>.*?<span class="year">([^<]*)<\/span>/gs;
                let m;
                while ((m = regex.exec(html)) !== null) {
                    const itemUrl = m[1];
                    const posterUrl = m[2];
                    const title = m[3].trim();
                    const isMovie = itemUrl.includes("movies");
                    results.push(new MultimediaItem({
                        title: title,
                        url: itemUrl,
                        posterUrl: posterUrl,
                        type: isMovie ? 'movie' : 'series'
                    }));
                }
                return cb({ success: true, data: results });
            }
        } catch(e) {
            cb({ success: false, message: e.message || "Search Error" });
        }
    }

    async function load(url, cb) {
        try {
            const baseUrl = manifest.baseUrl;
            
            if (baseUrl.includes(".cyou") || baseUrl.includes(".bond")) {
                const fullUrl = `${baseUrl}/watch${url}`;
                const fullText = await fetchNextHydration(fullUrl);
                if (!fullText) return cb({ success: false, message: "Load failed. Site blocked." });

                const media = extractJsonFromTag(fullText, "initialMedia");
                if (!media) throw new Error("Media data not found in hydration payload");

                const isMovie = media.mediaType === 'movie';
                const item = new MultimediaItem({
                    title: String(media.title || "Unknown"),
                    url: String(url),
                    posterUrl: media.posterPath ? `https://image.tmdb.org/t/p/w342${media.posterPath}` : "",
                    bannerUrl: media.backdropPath ? `https://image.tmdb.org/t/p/w1280${media.backdropPath}` : "",
                    type: isMovie ? 'movie' : 'series',
                    year: parseInt(media.releaseYear) || undefined,
                    score: parseFloat(media.rating) || undefined,
                    description: media.overview || ""
                });
                
                if (!isMovie && media.seasons && Array.isArray(media.seasons)) {
                    const episodes = [];
                    for (const season of media.seasons) {
                        if (season.seasonNumber === 0) continue; 
                        const count = parseInt(season.episodeCount) || 0;
                        for (let i = 1; i <= count; i++) {
                            episodes.push(new Episode({
                                name: `Season ${season.seasonNumber} Episode ${i}`,
                                url: `${url}?s=${season.seasonNumber}&e=${i}`,
                                season: parseInt(season.seasonNumber),
                                episode: i
                            }));
                        }
                    }
                    item.episodes = episodes;
                }
                return cb({ success: true, data: item });
            } else {
                // DOOPLAY FALLBACK
                const html = await fetchHtml(url);
                if (!html) return cb({ success: false, message: "Site blocked." });
                const titleMatch = /<div class="sheader">\s*<div class="data">\s*<h1>([^<]+)<\/h1>/.exec(html);
                const title = titleMatch ? titleMatch[1].trim() : "Unknown";
                
                // Parse episodes if it's a TV show
                const episodes = [];
                if (url.includes("tvshows")) {
                    const seasonBlocks = html.split('class="episodios"');
                    for (let s = 1; s < seasonBlocks.length; s++) {
                        const epRegex = /<div class="episodiotitle">\s*<a href="([^"]+)">([^<]+)<\/a>/g;
                        let epMatch;
                        let eNum = 1;
                        while ((epMatch = epRegex.exec(seasonBlocks[s])) !== null) {
                            episodes.push(new Episode({
                                name: epMatch[2].trim(),
                                url: epMatch[1],
                                season: s,
                                episode: eNum++
                            }));
                        }
                    }
                }

                cb({ success: true, data: new MultimediaItem({
                    title: title,
                    url: url,
                    type: url.includes("tvshows") ? 'series' : 'movie',
                    episodes: episodes.length > 0 ? episodes : undefined
                })});
            }
        } catch(e) {
            cb({ success: false, message: e.message || "Load Error" });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const baseUrl = manifest.baseUrl;
            if (baseUrl.includes(".cyou") || baseUrl.includes(".bond")) {
                cb({ success: true, data: [
                    new StreamResult({
                        url: `${manifest.baseUrl}/watch${url}`,
                        quality: "WebView",
                        headers: { "User-Agent": USER_AGENT }
                    })
                ] });
            } else {
                // Dooplay streams fallback using magic WebView
                cb({ success: true, data: [
                    new StreamResult({
                        url: url,
                        quality: "WebView",
                        headers: { "User-Agent": USER_AGENT }
                    })
                ] });
            }
        } catch(e) {
            cb({ success: false, data: [] });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
