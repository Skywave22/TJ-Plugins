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

    async function getHome(cb) {
        try {
            const baseUrl = manifest.baseUrl;
            const fullText = await fetchNextHydration(baseUrl);
            
            if (!fullText) {
                return cb({ success: false, message: "Site blocked or Cloudflare challenge active. Please switch mirror domains." });
            }

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
            
            if (!data["Trending"] || data["Trending"].length === 0) {
                return cb({ success: false, message: "Failed to parse data. Layout might have changed." });
            }

            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, message: e.message || "Unknown Home Error" });
        }
    }

    async function search(query, cb) {
        try {
            const baseUrl = manifest.baseUrl;
            const fullText = await fetchNextHydration(`${baseUrl}/search?q=${encodeURIComponent(query)}`);
            if (!fullText) return cb({ success: false, message: "Search failed. Site blocked." });

            const items = extractJsonFromTag(fullText, "items") || [];
            
            const results = [];
            for (const item of items) {
                const title = item.title || item.name;
                const id = item.tmdbId || item.id;
                if (!title || !id || !item.mediaType) continue;

                results.push(new MultimediaItem({
                    title: String(title),
                    url: `/${item.mediaType}/${id}`,
                    posterUrl: item.posterPath ? `https://image.tmdb.org/t/p/w342${item.posterPath}` : "",
                    type: item.mediaType === 'movie' ? 'movie' : 'series'
                }));
            }
            cb({ success: true, data: results });
        } catch(e) {
            cb({ success: false, message: e.message || "Search Error" });
        }
    }

    async function load(url, cb) {
        try {
            const baseUrl = manifest.baseUrl;
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

            cb({ success: true, data: item });
        } catch(e) {
            cb({ success: false, message: e.message || "Load Error" });
        }
    }

    async function loadStreams(url, cb) {
        try {
            cb({ success: true, data: [
                new StreamResult({
                    url: `${manifest.baseUrl}/watch${url}`,
                    quality: "WebView",
                    headers: { "User-Agent": USER_AGENT }
                })
            ] });
        } catch(e) {
            cb({ success: false, data: [] });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
