(function() {

    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";

    // Helper to extract the Next.js _next_f hydration chunks
    async function fetchNextHydration(url) {
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        const text = await res.text();
        
        let fullText = "";
        const regex = /self\.__next_f\.push\(\[1,"(.*?)"\]\)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            try { 
                fullText += JSON.parse('"' + match[match.length - 1] + '"'); 
            } catch(e) {}
        }
        return fullText;
    }

    // High performance extraction of JSON objects from the stringified Next.js payload
    function extractJsonFromTag(str, key) {
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
            const items = extractJsonFromTag(fullText, "items");
            
            const data = {};
            if (items && Array.isArray(items)) {
                data["Trending"] = items.map(item => {
                    return new MultimediaItem({
                        title: item.title,
                        url: `/${item.mediaType}/${item.tmdbId}`,
                        posterUrl: `https://image.tmdb.org/t/p/w342${item.posterPath}`,
                        type: item.mediaType === 'movie' ? 'movie' : 'series'
                    });
                });
            }
            
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, data: {} });
        }
    }

    async function search(query, cb) {
        try {
            const baseUrl = manifest.baseUrl;
            const fullText = await fetchNextHydration(`${baseUrl}/search?q=${encodeURIComponent(query)}`);
            const items = extractJsonFromTag(fullText, "items") || [];
            
            const results = items.map(item => {
                return new MultimediaItem({
                    title: item.title || item.name,
                    url: `/${item.mediaType}/${item.tmdbId || item.id}`,
                    posterUrl: `https://image.tmdb.org/t/p/w342${item.posterPath}`,
                    type: item.mediaType === 'movie' ? 'movie' : 'series'
                });
            });
            cb({ success: true, data: results });
        } catch(e) {
            cb({ success: false, data: [] });
        }
    }

    async function load(url, cb) {
        try {
            const baseUrl = manifest.baseUrl;
            const fullUrl = `${baseUrl}/watch${url}`;
            const fullText = await fetchNextHydration(fullUrl);
            
            const media = extractJsonFromTag(fullText, "initialMedia");
            if (!media) throw new Error("Media data not found in hydration payload");

            const isMovie = media.mediaType === 'movie';
            
            const item = new MultimediaItem({
                title: media.title,
                url: url,
                posterUrl: `https://image.tmdb.org/t/p/w342${media.posterPath}`,
                bannerUrl: `https://image.tmdb.org/t/p/w1280${media.backdropPath}`,
                type: isMovie ? 'movie' : 'series',
                year: media.releaseYear,
                score: media.rating,
                description: media.overview
            });
            
            if (!isMovie && media.seasons && Array.isArray(media.seasons)) {
                const episodes = [];
                for (const season of media.seasons) {
                    if (season.seasonNumber === 0) continue; 
                    const count = season.episodeCount || 0;
                    for (let i = 1; i <= count; i++) {
                        episodes.push(new Episode({
                            name: `Season ${season.seasonNumber} Episode ${i}`,
                            url: `${url}?s=${season.seasonNumber}&e=${i}`,
                            season: season.seasonNumber,
                            episode: i
                        }));
                    }
                }
                item.episodes = episodes;
            }

            cb({ success: true, data: item });
        } catch(e) {
            cb({ success: false, message: e.toString() });
        }
    }

    async function loadStreams(url, cb) {
        try {
            // Note: The new site utilizes tRPC which enforces strict Origin headers, locking out standard API requests.
            // By passing the URL with WebView indicator, SkyStream's internal app can intercept or render the player frame securely.
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
