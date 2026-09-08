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

            // Store download links for loadStreams (fresh per title)
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
    // ═══════════════════════════════════════════════════════════
    //  4. loadStreams — resolve each file-host to a playable/direct URL
    //
    //  The gateway pages link out to file hosts (vikingfile, vcloud,
    //  filebee, gofile, megaup). Those pages are NOT playable — the old
    //  version returned them raw, which is why nothing played. Now every
    //  host gets a real resolver; hosts that refuse (bot-walls) are
    //  skipped, and cookies captured along the way ride on the stream so
    //  the player can fetch the file.
    // ═══════════════════════════════════════════════════════════

    function cookieFrom(headersMap) {
        if (!headersMap) return null;
        var keys = Object.keys(headersMap);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].toLowerCase() === 'set-cookie') {
                var raw = headersMap[keys[i]] || '';
                var parts = String(raw).split(',').map(function (c) {
                    return c.split(';')[0].trim();
                }).filter(function (c) { return c.indexOf('=') > 0; });
                return parts.length ? parts.join('; ') : null;
            }
        }
        return null;
    }

    // vikingfile.com/f/<id> → /fast-download/<name> → meta-refresh URL.
    // The meta URL is the direct file endpoint but requires the cookies
    // from the fast-download hop, so we forward them to the player.
    async function resolveViking(pageUrl) {
        const res1 = await http_get(pageUrl, headers);
        const html1 = res1 && res1.body ? String(res1.body) : '';
        const fd = html1.match(/href="(\/fast-download\/[^"]+)"/);
        if (!fd) return null;

        const res2 = await http_get('https://vikingfile.com' + fd[1], headers);
        const html2 = res2 && res2.body ? String(res2.body) : '';
        const meta = html2.match(/URL=(https?:\/\/[^"]+)"/i);
        if (!meta) return null;
        const direct = meta[1].replace(/&amp;/g, '&');

        const cookie = cookieFrom(res2.headers) || cookieFrom(res1.headers);
        return {
            url: direct,
            headers: cookie ? { 'User-Agent': headers['User-Agent'], 'Cookie': cookie } : { 'User-Agent': headers['User-Agent'] }
        };
    }

    // vcloud.zip/<id>: the /d/<id> path serves the file directly when the
    // interstitial cookie rides along. Capture cookies from the page hop.
    async function resolveVcloud(pageUrl) {
        const res = await http_get(pageUrl, headers);
        const html = res && res.body ? String(res.body) : '';
        let d = html.match(/https?:\/\/vcloud\.zip\/d\/([A-Za-z0-9]+)/);
        let id = d ? d[1] : (pageUrl.match(/vcloud\.zip\/(?:s\/)?([A-Za-z0-9]+)/) || [])[1];
        if (!id) return null;
        const cookie = cookieFrom(res.headers);
        return {
            url: 'https://vcloud.zip/d/' + id,
            headers: cookie
                ? { 'User-Agent': headers['User-Agent'], 'Cookie': cookie, 'Referer': pageUrl }
                : { 'User-Agent': headers['User-Agent'], 'Referer': pageUrl }
        };
    }

    // filebee serves an SPA; the direct hop is /d/<id> with the file-page
    // cookies. Best effort — skipped cleanly when blocked.
    async function resolveFilebee(pageUrl) {
        const res = await http_get(pageUrl, headers);
        const id = (pageUrl.match(/filebee\.xyz\/(?:file\/)?([A-Za-z0-9]+)/) || [])[1];
        if (!id) return null;
        const cookie = cookieFrom(res.headers);
        return {
            url: 'https://filebee.xyz/d/' + id,
            headers: cookie
                ? { 'User-Agent': headers['User-Agent'], 'Cookie': cookie, 'Referer': pageUrl }
                : { 'User-Agent': headers['User-Agent'], 'Referer': pageUrl }
        };
    }

    function hostOf(u) {
        const m = String(u).match(/^https?:\/\/([^/]+)/);
        return m ? m[1] : '';
    }

    async function loadStreams(url, cb) {
        try {
            let params = null;
            try { params = typeof url === "string" ? JSON.parse(url) : url; } catch (_) {}
            const pageLink = (params && params.link) || null;

            // Collect gateway pages (cached from load() when available).
            let gateways = globalThis.__hdmovies_download_links || [];
            if (!gateways.length && pageLink) {
                const res = await http_get(pageLink, headers);
                const html = res && res.body ? String(res.body) : '';
                const re = /href="(https:\/\/links\.hdmovieshub\.fyi\/[^"]+)"/gi;
                let m;
                while ((m = re.exec(html)) !== null) {
                    const before = html.substring(Math.max(0, m.index - 500), m.index);
                    const tm = before.match(/>([^<]*(?:480|720|1080|2160|4K)[^<]*)</i);
                    gateways.push({ url: m[1], quality: tm ? extractQuality(tm[1]) : 'HD' });
                }
            }
            if (!gateways.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No download links found on the post page.' });
            }

            const streams = [];
            const deadHosts = [];

            for (const gw of gateways.slice(0, 4)) {
                let html = '';
                try {
                    const res = await http_get(gw.url, headers);
                    html = res && res.body ? String(res.body) : '';
                } catch (e) { continue; }

                const links = {};
                const re = /href="(https?:\/\/[^"']+)"/gi;
                let m;
                while ((m = re.exec(html)) !== null) {
                    const u = m[1];
                    if (/vikingfile\.com\/f\//.test(u)) links.viking = u;
                    else if (/vcloud\.zip\//.test(u) && !/\/d\//.test(u)) links.vcloud = u;
                    else if (/filebee\.xyz\/(?:file\/)?[A-Za-z0-9]{8,}/.test(u) && !links.filebee) links.filebee = u;
                    else if (/gofile\.io\/d\//.test(u)) links.gofile = u;
                    else if (/megaup\.net\//.test(u)) links.megaup = u;
                }

                const q = gw.quality || extractQuality(gw.text || '');

                if (links.viking) {
                    try {
                        const r = await resolveViking(links.viking);
                        if (r) streams.push(new StreamResult({
                            url: r.url, source: 'VikingFile [' + q + ']',
                            headers: r.headers
                        }));
                    } catch (_) { deadHosts.push('vikingfile'); }
                }
                if (links.vcloud) {
                    try {
                        const r = await resolveVcloud(links.vcloud);
                        if (r) streams.push(new StreamResult({
                            url: r.url, source: 'VCloud [' + q + ']',
                            headers: r.headers
                        }));
                    } catch (_) { deadHosts.push('vcloud'); }
                }
                if (links.filebee) {
                    try {
                        const r = await resolveFilebee(links.filebee);
                        if (r) streams.push(new StreamResult({
                            url: r.url, source: 'FileBee [' + q + ']',
                            headers: r.headers
                        }));
                    } catch (_) { deadHosts.push('filebee'); }
                }
                if (streams.length >= 6) break;
            }

            if (!streams.length) {
                const hosts = deadHosts.length ? Array.from(new Set(deadHosts)).join(', ') : 'the linked hosts';
                return cb({ success: false, errorCode: 'NO_STREAMS',
                            message: 'Could not resolve a direct stream from ' + hosts +
                                     ' (they bot-wall datacenter traffic). Try another quality/link.' });
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: 'STREAM_ERROR', message: e.message });
        }
    }

    // ─── Export ───
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
