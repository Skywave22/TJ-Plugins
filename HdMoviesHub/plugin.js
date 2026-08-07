(function() {
    "use strict";

    // Configuration
    const BASE_URL = "https://hdmovieshub.fyi";
    const LINKS_URL = "https://links.hdmovieshub.fyi";
    const WP_API = `${BASE_URL}/wp-json/wp/v2`;
    const TMDB_IMG = "https://image.tmdb.org/t/p";

    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };

    // ─── Helpers ───

    async function apiRequest(endpoint) {
        try {
            const res = await http_get(`${WP_API}${endpoint}`, headers);
            if (!res || !res.body) return null;
            return JSON.parse(res.body);
        } catch (e) {
            console.error(`API error: ${endpoint}`, e);
            return null;
        }
    }

    function cleanTitle(title) {
        if (!title) return "Unknown";
        // Remove HTML entities and decode
        return title
            .replace(/&#8211;/g, "-")
            .replace(/&#8217;/g, "'")
            .replace(/&#038;/g, "&")
            .replace(/&#8230;/g, "...")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"');
    }

    function extractYear(title) {
        const match = title.match(/\((\d{4})\)/);
        return match ? parseInt(match[1]) : null;
    }

    function extractQuality(title) {
        const qualities = [];
        if (/480p/i.test(title)) qualities.push("480p");
        if (/720p/i.test(title)) qualities.push("720p");
        if (/1080p/i.test(title)) qualities.push("1080p");
        if (/2160p|4K/i.test(title)) qualities.push("2160p");
        return qualities.length > 0 ? qualities.join(", ") : "HD";
    }

    function isSeries(title) {
        return /season|series|s\d+e\d+/i.test(title);
    }

    function toMediaItem(post) {
        if (!post) return null;

        const title = cleanTitle(post.title?.rendered || "");
        const year = extractYear(title);
        const quality = extractQuality(title);
        const series = isSeries(title);

        // Get featured image
        let poster = "";
        if (post._embedded && post._embedded["wp:featuredmedia"]) {
            const media = post._embedded["wp:featuredmedia"][0];
            if (media && media.source_url) {
                poster = media.source_url;
            }
        }

        // Try to get TMDB image from content
        if (!poster && post.content?.rendered) {
            const tmdbMatch = post.content.rendered.match(/https:\/\/image\.tmdb\.org\/t\/p\/w\d+\/[^\s"']+/);
            if (tmdbMatch) poster = tmdbMatch[0];
        }

        return new MultimediaItem({
            title: title,
            url: JSON.stringify({
                postId: post.id,
                link: post.link,
                title: title
            }),
            posterUrl: poster,
            type: series ? "series" : "movie",
            year: year,
            description: `Quality: ${quality}\n\n${post.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim() || ""}`
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  1. getHome - Fetch latest posts
    // ═══════════════════════════════════════════════════════════
    async function getHome(cb) {
        try {
            const posts = await apiRequest("/posts?per_page=20&_embed");
            if (!posts || !Array.isArray(posts)) {
                return cb({ success: false, errorCode: "API_ERROR", message: "Failed to fetch posts" });
            }

            const movies = [];
            const series = [];

            for (const post of posts) {
                const item = toMediaItem(post);
                if (!item) continue;

                if (item.type === "series") {
                    series.push(item);
                } else {
                    movies.push(item);
                }
            }

            const data = {};
            if (movies.length > 0) data["Latest Movies"] = movies;
            if (series.length > 0) data["Latest Series"] = series;

            if (Object.keys(data).length === 0) {
                return cb({ success: false, errorCode: "NO_CONTENT", message: "No content available" });
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  2. search - Search posts
    // ═══════════════════════════════════════════════════════════
    async function search(query, cb) {
        try {
            if (!query || !query.trim()) {
                return cb({ success: true, data: [] });
            }

            const posts = await apiRequest(`/posts?search=${encodeURIComponent(query)}&per_page=20&_embed`);
            if (!posts || !Array.isArray(posts)) {
                return cb({ success: true, data: [] });
            }

            const items = posts.map(toMediaItem).filter(Boolean);
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  3. load - Load post details
    // ═══════════════════════════════════════════════════════════
    async function load(url, cb) {
        try {
            const params = typeof url === "string" ? JSON.parse(url) : url;
            if (!params || !params.link) {
                return cb({ success: false, errorCode: "INVALID_URL", message: "Invalid URL" });
            }

            // Fetch the actual post page
            const res = await http_get(params.link, headers);
            if (!res || !res.body) {
                return cb({ success: false, errorCode: "NOT_FOUND", message: "Post not found" });
            }

            const html = res.body;

            // Extract title
            const titleMatch = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)<\/h1>/i);
            const title = titleMatch ? cleanTitle(titleMatch[1].trim()) : params.title;

            // Extract poster
            let poster = "";
            const posterMatch = html.match(/https:\/\/image\.tmdb\.org\/t\/p\/w\d+\/[^\s"']+/);
            if (posterMatch) poster = posterMatch[0];

            // Extract description
            const descMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
            let description = "";
            if (descMatch) {
                description = descMatch[1]
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 500);
            }

            const year = extractYear(title);
            const quality = extractQuality(title);
            const series = isSeries(title);

            // Extract download links from links.hdmovieshub.fyi
            const downloadLinks = [];
            const linkRegex = /href="(https:\/\/links\.hdmovieshub\.fyi\/[^"]+)"/gi;
            let linkMatch;
            while ((linkMatch = linkRegex.exec(html)) !== null) {
                const href = linkMatch[1];
                
                // Extract quality from the link text
                const beforeMatch = html.substring(Math.max(0, linkMatch.index - 500), linkMatch.index);
                const textMatch = beforeMatch.match(/>([^<]*(?:480|720|1080|2160|4K)[^<]*)</i);
                const linkQuality = textMatch ? extractQuality(textMatch[1]) : extractQuality(title);

                downloadLinks.push({
                    url: href,
                    quality: linkQuality,
                    text: textMatch ? textMatch[1].trim() : "Download"
                });
            }

            // Store download links for loadStreams
            globalThis.__hdmovies_download_links = downloadLinks;

            const item = new MultimediaItem({
                title: title,
                url: JSON.stringify({
                    postId: params.postId,
                    link: params.link,
                    title: title
                }),
                posterUrl: poster,
                type: series ? "series" : "movie",
                year: year,
                description: description || `Quality: ${quality}`
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  4. loadStreams - Extract file host URLs
    // ═══════════════════════════════════════════════════════════
    async function loadStreams(url, cb) {
        try {
            let downloadLinks = globalThis.__hdmovies_download_links || [];

            // If no cached links, fetch the page again
            if (downloadLinks.length === 0) {
                const params = typeof url === "string" ? JSON.parse(url) : url;
                if (!params || !params.link) {
                    return cb({ success: false, errorCode: "INVALID_URL", message: "Invalid URL" });
                }

                const res = await http_get(params.link, headers);
                if (!res || !res.body) {
                    return cb({ success: false, errorCode: "NO_STREAMS", message: "No streams available" });
                }

                const html = res.body;
                const linkRegex = /href="(https:\/\/links\.hdmovieshub\.fyi\/[^"]+)"/gi;
                let linkMatch;
                while ((linkMatch = linkRegex.exec(html)) !== null) {
                    const href = linkMatch[1];
                    const beforeMatch = html.substring(Math.max(0, linkMatch.index - 500), linkMatch.index);
                    const textMatch = beforeMatch.match(/>([^<]*(?:480|720|1080|2160|4K)[^<]*)</i);
                    const linkQuality = textMatch ? extractQuality(textMatch[1]) : "HD";

                    downloadLinks.push({
                        url: href,
                        quality: linkQuality,
                        text: textMatch ? textMatch[1].trim() : "Download"
                    });
                }
            }

            if (downloadLinks.length === 0) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "No download links found" });
            }

            const streams = [];

            // Fetch each download link page to get actual file host URLs
            for (const dlLink of downloadLinks.slice(0, 5)) { // Limit to 5 to avoid too many requests
                try {
                    const res = await http_get(dlLink.url, headers);
                    if (!res || !res.body) continue;

                    const html = res.body;

                    // Look for file host URLs
                    const fileHosts = [
                        { pattern: /https?:\/\/megaup\.net\/[^\s"'<>]+/i, name: "MegaUp" },
                        { pattern: /https?:\/\/filebee\.xyz\/[^\s"'<>]+/i, name: "FileBee" },
                        { pattern: /https?:\/\/gofile\.io\/[^\s"'<>]+/i, name: "GoFile" },
                        { pattern: /https?:\/\/vcloud\.zip\/[^\s"'<>]+/i, name: "VCloud" },
                        { pattern: /https?:\/\/vikingfile\.com\/[^\s"'<>]+/i, name: "VikingFile" }
                    ];

                    for (const host of fileHosts) {
                        const match = html.match(host.pattern);
                        if (match) {
                            const fileUrl = match[0];
                            streams.push(new StreamResult({
                                url: fileUrl,
                                source: `${host.name} [${dlLink.quality}]`
                            }));
                        }
                    }
                } catch (e) {
                    console.error(`Failed to fetch ${dlLink.url}:`, e);
                }
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
