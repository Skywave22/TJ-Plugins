(function () {
    /**
     * @typedef {Object} Response
     * @property {boolean} success
     * @property {any} [data]
     * @property {string} [errorCode]
     * @property {string} [message]
     */

    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };

    const TMDB_IMG = "https://image.tmdb.org/t/p";

    const getBaseUrl = () => {
        if (typeof manifest !== 'undefined' && manifest.baseUrl) return manifest.baseUrl;
        return "https://screenscape.me";
    };

    function safeParse(data) {
        if (!data) return null;
        if (typeof data === 'object') return data;
        try { return JSON.parse(data); } catch (e) { return null; }
    }

    // ─── Helper: Extract TMDB ID and type from a site URL ───
    function parseRoute(href) {
        if (!href) return null;
        // /movie/969681  or  /tv/94997  or  /watch/movie/969681  or  /watch/tv/94997/1/1
        const movieMatch = href.match(/\/(?:watch\/)?movie\/(\d+)/);
        if (movieMatch) return { type: "movie", tmdbId: movieMatch[1] };
        const tvMatch = href.match(/\/(?:watch\/)?tv\/(\d+)/);
        if (tvMatch) return { type: "tv", tmdbId: tvMatch[1] };
        return null;
    }

    // ─── Helper: Build a MultimediaItem from scraped card HTML ───
    function cardToMedia(link, type) {
        if (!link) return null;
        const href = link.getAttribute('href') || '';
        const route = parseRoute(href);
        if (!route) return null;

        const title = link.getAttribute('title')
            || link.querySelector('.title, .card-title, h3, h2, strong, span')?.textContent?.trim()
            || "Untitled";

        // Poster: try data-src (lazy), then src, with TMDB fallback
        const img = link.querySelector('img');
        let poster = img?.getAttribute('data-src')
            || img?.getAttribute('data-lazy-src')
            || img?.getAttribute('src')
            || '';

        // If poster is a relative TMDB path, resolve it
        if (poster && poster.startsWith('/')) {
            poster = TMDB_IMG + "/w500" + poster;
        }

        // Extract year and rating from text if present
        const fullText = link.textContent || '';
        const yearMatch = fullText.match(/(\d{4})/);
        const ratingMatch = fullText.match(/(\d\.\d)/);
        const year = yearMatch ? parseInt(yearMatch[1]) : null;
        const score = ratingMatch ? parseFloat(ratingMatch[1]) : null;

        const urlPayload = {
            tmdbId: route.tmdbId,
            type: route.type,
            poster: poster
        };

        return new MultimediaItem({
            title: title,
            url: JSON.stringify(urlPayload),
            posterUrl: poster,
            type: route.type === "tv" ? "series" : "movie",
            year: year,
            score: score
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  1. getHome — Dashboard categories
    // ═══════════════════════════════════════════════════════════
    async function getHome(cb) {
        try {
            const baseUrl = getBaseUrl();
            const res = await http_get(baseUrl, headers);
            if (!res || !res.body) {
                return cb({ success: false, errorCode: "HTTP_ERROR", message: "Empty response from homepage" });
            }

            const doc = await parseHtml(res.body);
            const finalResult = {};

            // Strategy: The homepage has sections with headings
            // We look for section headings and their associated card grids
            const sections = doc.querySelectorAll('section, [class*="section"], [class*="row"], [class*="grid"], [class*="carousel"], [class*="swiper"]');

            // Also try to find all links to /movie/ and /tv/ pages
            const allLinks = Array.from(doc.querySelectorAll('a[href*="/movie/"], a[href*="/tv/"]'));

            // Group items by their parent section heading
            const seen = new Set();

            // Try to identify named sections
            const sectionMap = {};
            const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, [class*="heading"], [class*="title"]');

            headings.forEach(h => {
                const text = h.textContent?.trim() || '';
                if (!text) return;

                // Find the closest container that holds nearby links
                const container = h.closest('section, [class*="section"], [class*="container"], [class*="wrapper"], div') || h.parentElement;
                if (!container) return;

                const links = Array.from(container.querySelectorAll('a[href*="/movie/"], a[href*="/tv/"]'));
                if (links.length < 3) return; // Skip tiny sections

                const items = links
                    .map(l => cardToMedia(l))
                    .filter(item => {
                        if (!item || seen.has(item.url)) return false;
                        seen.add(item.url);
                        return true;
                    });

                if (items.length > 0) {
                    sectionMap[text] = items;
                }
            });

            // If we found named sections, use them
            if (Object.keys(sectionMap).length > 0) {
                // Reorganize: Put trending/popular first
                const priority = ["Trending", "Popular", "TOP 10", "New"];
                for (const key of priority) {
                    for (const sectionName in sectionMap) {
                        if (sectionName.toLowerCase().includes(key.toLowerCase())) {
                            finalResult[sectionName] = sectionMap[sectionName];
                        }
                    }
                }
                // Add remaining sections
                for (const sectionName in sectionMap) {
                    if (!finalResult[sectionName]) {
                        finalResult[sectionName] = sectionMap[sectionName];
                    }
                }
            }

            // Fallback: If no sections found, split all links into Movies and TV
            if (Object.keys(finalResult).length === 0) {
                const movies = [];
                const shows = [];
                allLinks.forEach(link => {
                    const item = cardToMedia(link);
                    if (!item || seen.has(item.url)) return;
                    seen.add(item.url);

                    const route = parseRoute(link.getAttribute('href'));
                    if (route?.type === "movie") movies.push(item);
                    else if (route?.type === "tv") shows.push(item);
                });

                if (movies.length > 0) finalResult["Popular Movies"] = movies;
                if (shows.length > 0) finalResult["Trending TV Series"] = shows;
            }

            if (Object.keys(finalResult).length === 0) {
                return cb({ success: false, errorCode: "PARSE_ERROR", message: "No content found on homepage" });
            }

            cb({ success: true, data: finalResult });
        } catch (e) {
            console.error("Critical getHome Error:", e);
            cb({ success: false, errorCode: "HTTP_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  2. search — Handle user search queries
    // ═══════════════════════════════════════════════════════════
    async function search(query, cb) {
        try {
            const baseUrl = getBaseUrl();
            // Try multiple search URL patterns
            const searchUrls = [
                `${baseUrl}/search?q=${encodeURIComponent(query)}`,
                `${baseUrl}/search?query=${encodeURIComponent(query)}`,
                `${baseUrl}/search/${encodeURIComponent(query)}`,
                `${baseUrl}/?s=${encodeURIComponent(query)}`
            ];

            let allItems = [];
            const seen = new Set();

            for (const searchUrl of searchUrls) {
                try {
                    const res = await http_get(searchUrl, headers);
                    if (!res || !res.body) continue;

                    const doc = await parseHtml(res.body);
                    const links = Array.from(doc.querySelectorAll('a[href*="/movie/"], a[href*="/tv/"]'));

                    const items = links
                        .map(l => cardToMedia(l))
                        .filter(item => {
                            if (!item || seen.has(item.url)) return false;
                            seen.add(item.url);
                            return true;
                        });

                    if (items.length > 0) {
                        allItems = items;
                        break; // Found results, stop trying other patterns
                    }
                } catch (e) {
                    console.error(`Search attempt failed for ${searchUrl}:`, e.message);
                }
            }

            // Fallback: Try scraping the browse pages for the query
            if (allItems.length === 0) {
                try {
                    const browseRes = await http_get(`${baseUrl}/movie`, headers);
                    if (browseRes && browseRes.body) {
                        const doc = await parseHtml(browseRes.body);
                        const links = Array.from(doc.querySelectorAll('a[href*="/movie/"]'));
                        const lowerQuery = query.toLowerCase();

                        allItems = links
                            .map(l => cardToMedia(l))
                            .filter(item => {
                                if (!item || seen.has(item.url)) return false;
                                if (!item.title.toLowerCase().includes(lowerQuery)) return false;
                                seen.add(item.url);
                                return true;
                            });
                    }
                } catch (e) { /* ignore */ }
            }

            cb({ success: true, data: allItems });
        } catch (e) {
            console.error("Search Error:", e);
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  3. load — Full details for a movie or series
    // ═══════════════════════════════════════════════════════════
    async function load(urlStr, cb) {
        try {
            const media = safeParse(urlStr);
            if (!media) throw new Error("Invalid URL data");

            const baseUrl = getBaseUrl();
            const { tmdbId, type } = media;

            // Fetch the detail page
            const detailUrl = `${baseUrl}/${type}/${tmdbId}`;
            const res = await http_get(detailUrl, headers);
            if (!res || !res.body) throw new Error("Empty detail page");

            const doc = await parseHtml(res.body);

            // Extract title
            let title = doc.querySelector('h1')?.textContent?.trim() || '';
            // Remove year from title if appended like "Spider-Man: Brand New Day(2026)"
            title = title.replace(/\(\d{4}\)$/, '').trim();
            if (!title) {
                title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.split('(')[0]?.trim() || "Untitled";
            }

            // Extract poster
            let poster = media.poster || '';
            if (!poster) {
                const posterImg = doc.querySelector('img[src*="tmdb.org"]');
                poster = posterImg?.getAttribute('src') || '';
            }
            // Get backdrop/banner
            const backdropImg = doc.querySelector('img[src*="/original/"]');
            const bannerUrl = backdropImg?.getAttribute('src') || '';

            // Extract description
            const description = doc.querySelector('.overview, [class*="description"], [class*="synopsis"]')?.textContent?.trim()
                || doc.querySelector('meta[property="og:description"]')?.getAttribute('content')
                || '';

            // Extract year
            const yearText = doc.querySelector('[class*="year"], [class*="date"]')?.textContent?.match(/\d{4}/)?.[0]
                || res.body.match(/(\d{4})/)?.[1];
            const year = yearText ? parseInt(yearText) : null;

            // Extract rating
            const ratingMatch = res.body.match(/TMDb\s+(\d+\.?\d*)/i) || res.body.match(/IMDb\s+(\d+\.?\d*)/i);
            const score = ratingMatch ? parseFloat(ratingMatch[1]) : null;

            // Extract duration
            const durationMatch = res.body.match(/(\d+)h\s*(\d+)m/);
            const duration = durationMatch ? (parseInt(durationMatch[1]) * 60 + parseInt(durationMatch[2])) : null;

            // Extract genres
            const genreEls = doc.querySelectorAll('[class*="genre"] a, [class*="genre"] span');
            const genres = Array.from(genreEls).map(g => g.textContent?.trim()).filter(Boolean);

            // ─── MOVIE ───
            if (type === "movie") {
                const urlPayload = JSON.stringify({
                    tmdbId: tmdbId,
                    type: "movie",
                    poster: poster
                });

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: title,
                        url: urlPayload,
                        posterUrl: poster,
                        bannerUrl: bannerUrl,
                        description: description,
                        type: "movie",
                        year: year,
                        score: score,
                        duration: duration
                    })
                });
            }
            // ─── TV SERIES ───
            else if (type === "tv") {
                // Extract episode/season info from the page
                // Look for season tabs or episode listings
                const episodes = [];

                // Strategy 1: Look for season/episode links on the page
                const epLinks = doc.querySelectorAll('a[href*="/watch/tv/"]');
                if (epLinks.length > 0) {
                    epLinks.forEach(link => {
                        const href = link.getAttribute('href') || '';
                        const epMatch = href.match(/\/watch\/tv\/\d+\/(\d+)\/(\d+)/);
                        if (epMatch) {
                            const season = parseInt(epMatch[1]);
                            const episode = parseInt(epMatch[2]);
                            const epName = link.textContent?.trim() || `S${season}E${episode}`;

                            episodes.push(new Episode({
                                name: epName,
                                url: JSON.stringify({
                                    tmdbId: tmdbId,
                                    type: "tv",
                                    season: season,
                                    episode: episode,
                                    poster: poster
                                }),
                                season: season,
                                episode: episode
                            }));
                        }
                    });
                }

                // Strategy 2: Look for season sections/tabs
                if (episodes.length === 0) {
                    const seasonSections = doc.querySelectorAll('[class*="season"], [data-season]');
                    seasonSections.forEach(section => {
                        const seasonNum = section.getAttribute('data-season')
                            || section.textContent?.match(/Season\s*(\d+)/i)?.[1]
                            || '1';
                        const season = parseInt(seasonNum);

                        const epItems = section.querySelectorAll('[class*="episode"], li, a');
                        epItems.forEach((ep, idx) => {
                            const epName = ep.textContent?.trim() || `Episode ${idx + 1}`;
                            const epNumMatch = epName.match(/(?:E|Episode)\s*(\d+)/i);
                            const epNum = epNumMatch ? parseInt(epNumMatch[1]) : idx + 1;

                            episodes.push(new Episode({
                                name: epName,
                                url: JSON.stringify({
                                    tmdbId: tmdbId,
                                    type: "tv",
                                    season: season,
                                    episode: epNum,
                                    poster: poster
                                }),
                                season: season,
                                episode: epNum
                            }));
                        });
                    });
                }

                // Strategy 3: Extract season/episode counts from page text
                if (episodes.length === 0) {
                    const seasonCountMatch = res.body.match(/(\d+)\s*Season/i);
                    const episodeCountMatch = res.body.match(/(\d+)\s*Episode/i);
                    const totalSeasons = seasonCountMatch ? parseInt(seasonCountMatch[1]) : 1;
                    const totalEpisodes = episodeCountMatch ? parseInt(episodeCountMatch[1]) : 1;

                    // Generate episodes for season 1 as fallback
                    // The user can navigate to specific episodes via the watch URL
                    const epsPerSeason = Math.ceil(totalEpisodes / totalSeasons);
                    for (let s = 1; s <= totalSeasons; s++) {
                        for (let e = 1; e <= epsPerSeason; e++) {
                            episodes.push(new Episode({
                                name: `S${s}E${e}`,
                                url: JSON.stringify({
                                    tmdbId: tmdbId,
                                    type: "tv",
                                    season: s,
                                    episode: e,
                                    poster: poster
                                }),
                                season: s,
                                episode: e
                            }));
                        }
                    }
                }

                const urlPayload = JSON.stringify({
                    tmdbId: tmdbId,
                    type: "tv",
                    poster: poster
                });

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: title,
                        url: urlPayload,
                        posterUrl: poster,
                        bannerUrl: bannerUrl,
                        description: description,
                        type: "series",
                        year: year,
                        score: score,
                        episodes: episodes
                    })
                });
            }
        } catch (e) {
            console.error("Load Error:", e);
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  4. loadStreams — Get playable video links
    // ═══════════════════════════════════════════════════════════
    async function loadStreams(urlInfo, cb) {
        try {
            const media = safeParse(urlInfo);
            if (!media) throw new Error("Invalid URL data");

            const baseUrl = getBaseUrl();
            const streams = [];
            const { tmdbId, type } = media;

            // Build the watch URL and embed URL
            let watchUrl, embedUrl;
            if (type === "movie") {
                watchUrl = `${baseUrl}/watch/movie/${tmdbId}`;
                embedUrl = `${baseUrl}/embed?tmdb=${tmdbId}&type=movie`;
            } else {
                const { season, episode } = media;
                watchUrl = `${baseUrl}/watch/tv/${tmdbId}/${season}/${episode}`;
                embedUrl = `${baseUrl}/embed?tmdb=${tmdbId}&type=tv&s=${season}&e=${episode}`;
            }

            // ─── Strategy 1: Extract HLS URL from watch page ───
            const watchTask = (async () => {
                try {
                    const res = await http_get(watchUrl, {
                        ...headers,
                        "Referer": baseUrl
                    });
                    if (!res || !res.body) return;

                    const html = res.body;

                    // Look for HLS .m3u8 URLs in the page source
                    const m3u8Regex = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g;
                    const m3u8Matches = html.match(m3u8Regex) || [];

                    const seenUrls = new Set();
                    m3u8Matches.forEach(url => {
                        // Clean up the URL (remove trailing quotes, etc.)
                        const cleanUrl = url.replace(/["'\\]/g, '').replace(/&amp;/g, '&');
                        if (seenUrls.has(cleanUrl)) return;
                        if (cleanUrl.includes('preview')) return; // Skip preview clips
                        seenUrls.add(cleanUrl);

                        // Try to extract quality from URL
                        const qualMatch = cleanUrl.match(/(\d{3,4})p?[\._/]/i)
                            || cleanUrl.match(/_(\d{3,4})[p_]/i);
                        const quality = qualMatch ? `${qualMatch[1]}p` : "Auto";

                        streams.push(new StreamResult({
                            url: cleanUrl,
                            quality: quality,
                            headers: {
                                "Referer": baseUrl + "/",
                                "Origin": baseUrl
                            }
                        }));
                    });

                    // Also look for MP4 URLs
                    const mp4Regex = /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g;
                    const mp4Matches = html.match(mp4Regex) || [];
                    mp4Matches.forEach(url => {
                        const cleanUrl = url.replace(/["'\\]/g, '').replace(/&amp;/g, '&');
                        if (seenUrls.has(cleanUrl)) return;
                        seenUrls.add(cleanUrl);

                        const qualMatch = cleanUrl.match(/(\d{3,4})p?[\._/]/i);
                        const quality = qualMatch ? `${qualMatch[1]}p` : "Auto";

                        streams.push(new StreamResult({
                            url: cleanUrl,
                            quality: quality,
                            headers: {
                                "Referer": baseUrl + "/",
                                "Origin": baseUrl
                            }
                        }));
                    });

                    // Look for audio track information (multi-language)
                    const audioTrackRegex = /["'](hindi|english|tamil|telugu|eng|hin|tam|tel)["']\s*[,}]/gi;
                    const audioTracks = html.match(audioTrackRegex) || [];
                    // We'll note available languages in stream names if found

                    // Look for JSON data with stream sources
                    const jsonSourcesRegex = /sources\s*[:=]\s*(\[.*?\])/s;
                    const jsonMatch = html.match(jsonSourcesRegex);
                    if (jsonMatch) {
                        const sources = safeParse(jsonMatch[1]);
                        if (Array.isArray(sources)) {
                            sources.forEach(src => {
                                if (src.src || src.url || src.file) {
                                    const srcUrl = src.src || src.url || src.file;
                                    if (seenUrls.has(srcUrl)) return;
                                    seenUrls.add(srcUrl);

                                    streams.push(new StreamResult({
                                        url: srcUrl,
                                        quality: src.label || src.quality || "Auto",
                                        headers: {
                                            "Referer": baseUrl + "/",
                                            "Origin": baseUrl
                                        }
                                    }));
                                }
                            });
                        }
                    }

                    // Look for video JS source elements
                    const doc = await parseHtml(html);
                    const sourceEls = doc.querySelectorAll('source[src], video[src]');
                    sourceEls.forEach(el => {
                        const srcUrl = el.getAttribute('src');
                        if (!srcUrl || seenUrls.has(srcUrl)) return;
                        seenUrls.add(srcUrl);

                        streams.push(new StreamResult({
                            url: srcUrl,
                            quality: el.getAttribute('label') || el.getAttribute('res') || "Auto",
                            headers: {
                                "Referer": baseUrl + "/",
                                "Origin": baseUrl
                            }
                        }));
                    });

                } catch (e) {
                    console.error("Watch page extraction error:", e);
                }
            })();

            // ─── Strategy 2: Try embed page for additional sources ───
            const embedTask = (async () => {
                try {
                    const res = await http_get(embedUrl, {
                        ...headers,
                        "Referer": baseUrl + "/"
                    });
                    if (!res || !res.body) return;

                    const html = res.body;
                    const m3u8Regex = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g;
                    const matches = html.match(m3u8Regex) || [];
                    const seenUrls = new Set(streams.map(s => s.url));

                    matches.forEach(url => {
                        const cleanUrl = url.replace(/["'\\]/g, '').replace(/&amp;/g, '&');
                        if (seenUrls.has(cleanUrl)) return;
                        if (cleanUrl.includes('preview')) return;
                        seenUrls.add(cleanUrl);

                        const qualMatch = cleanUrl.match(/(\d{3,4})p?[\._/]/i);
                        const quality = qualMatch ? `${qualMatch[1]}p` : "Auto";

                        streams.push(new StreamResult({
                            url: cleanUrl,
                            quality: quality,
                            headers: {
                                "Referer": embedUrl,
                                "Origin": baseUrl
                            }
                        }));
                    });

                    // Look for language-specific stream sources
                    const langRegex = /["']?(?:src|url|source|file)["']?\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/gi;
                    let langMatch;
                    while ((langMatch = langRegex.exec(html)) !== null) {
                        const url = langMatch[1].replace(/&amp;/g, '&');
                        if (seenUrls.has(url)) continue;
                        seenUrls.add(url);

                        streams.push(new StreamResult({
                            url: url,
                            quality: "Auto",
                            headers: {
                                "Referer": embedUrl,
                                "Origin": baseUrl
                            }
                        }));
                    }
                } catch (e) {
                    console.error("Embed extraction error:", e);
                }
            })();

            // ─── Strategy 3: Try different language variants ───
            const langTask = (async () => {
                try {
                    const languages = ['hindi', 'eng', 'tam', 'tel'];
                    const seenUrls = new Set(streams.map(s => s.url));

                    for (const lang of languages) {
                        try {
                            const langEmbedUrl = type === "movie"
                                ? `${baseUrl}/embed?tmdb=${tmdbId}&type=movie&lan=${lang}`
                                : `${baseUrl}/embed?tmdb=${tmdbId}&type=tv&s=${media.season}&e=${media.episode}&lan=${lang}`;

                            const res = await http_get(langEmbedUrl, {
                                ...headers,
                                "Referer": baseUrl + "/"
                            });
                            if (!res || !res.body) continue;

                            const m3u8Regex = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g;
                            const matches = res.body.match(m3u8Regex) || [];

                            matches.forEach(url => {
                                const cleanUrl = url.replace(/["'\\]/g, '').replace(/&amp;/g, '&');
                                if (seenUrls.has(cleanUrl) || cleanUrl.includes('preview')) return;
                                seenUrls.add(cleanUrl);

                                const qualMatch = cleanUrl.match(/(\d{3,4})p?[\._/]/i);
                                const quality = qualMatch ? `${qualMatch[1]}p` : "Auto";
                                const langLabel = { hindi: "Hindi", eng: "English", tam: "Tamil", tel: "Telugu" }[lang] || lang;

                                streams.push(new StreamResult({
                                    url: cleanUrl,
                                    quality: `${quality} [${langLabel}]`,
                                    headers: {
                                        "Referer": langEmbedUrl,
                                        "Origin": baseUrl
                                    }
                                }));
                            });
                        } catch (e) { /* skip failed language */ }
                    }
                } catch (e) {
                    console.error("Language variant error:", e);
                }
            })();

            await Promise.all([watchTask, embedTask, langTask]);

            // Deduplicate final results
            const seen = new Set();
            const finalStreams = streams.filter(s => {
                if (!s.url || seen.has(s.url)) return false;
                seen.add(s.url);
                return true;
            });

            // If no direct streams found, add embed URL as fallback
            if (finalStreams.length === 0) {
                finalStreams.push(new StreamResult({
                    url: embedUrl,
                    quality: "Embed Player",
                    headers: {
                        "Referer": baseUrl + "/",
                        "Origin": baseUrl
                    }
                }));
            }

            cb({ success: true, data: finalStreams });
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
