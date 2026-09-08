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

    function withTimeout(promise, ms) {
        if (typeof setTimeout !== 'function') return promise;
        return new Promise(function (resolve, reject) {
            const t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            promise.then(
                function (v) { clearTimeout(t); resolve(v); },
                function (e) { clearTimeout(t); reject(e); }
            );
        });
    }

    // ─── Domain failover ───
    // The brand rotates/blocks domains (ISP blocks + stale mirrors).
    // hdmovieshub.fyi froze in Aug 2026 and is ISP-blocked for some users;
    // hdmovieshub.online is the live site (fresh daily posts, same WP REST).
    // We probe candidates once per session and remember the working one.
    const BASES = ["https://hdmovieshub.online", "https://hdmovieshub.fyi"];
    let ACTIVE_BASE = null;

    async function pickBase() {
        if (ACTIVE_BASE) return ACTIVE_BASE;
        const candidates = BASES.slice();
        try {
            const saved = await getPreference("hdmh_base");
            if (saved && typeof saved === "string" && saved.indexOf("http") === 0 && candidates.indexOf(saved) < 0) {
                candidates.unshift(saved);
            }
        } catch (e) {}
        for (let i = 0; i < candidates.length; i++) {
            try {
                const res = await withTimeout(
                    http_get(candidates[i] + "/wp-json/wp/v2/posts?per_page=1", headers), 12000);
                if (res && res.body) {
                    const j = JSON.parse(res.body);
                    if (Array.isArray(j)) {
                        ACTIVE_BASE = candidates[i];
                        try { setPreference("hdmh_base", ACTIVE_BASE); } catch (e) {}
                        return ACTIVE_BASE;
                    }
                }
            } catch (e) { /* try next */ }
        }
        return null;
    }

    async function apiRequest(endpoint) {
        try {
            const base = await pickBase();
            if (!base) return null;
            const res = await http_get(`${base}/wp-json/wp/v2${endpoint}`, headers);
            if (!res || !res.body) { ACTIVE_BASE = null; return null; }
            return JSON.parse(res.body);
        } catch (e) {
            console.error(`API error: ${endpoint}`, e);
            ACTIVE_BASE = null;
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

            // Extract poster: og:image first (works on every domain), then TMDB
            let poster = "";
            const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
            if (ogMatch && ogMatch[1].indexOf("http") === 0) poster = ogMatch[1];
            if (!poster) {
                const posterMatch = html.match(/https:\/\/image\.tmdb\.org\/t\/p\/w\d+\/[^\s"']+/);
                if (posterMatch) poster = posterMatch[0];
            }

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

            // Extract link candidates for loadStreams. Three kinds:
            //  gw    - links.hdmovieshub.<tld>/<quality>/ gateway pages (.fyi era)
            //  view  - linkszilla/mobilejsr "view" hub pages (.online era)
            //  direct- file-host links placed straight in the post
            const downloadLinks = [];
            const seenLinks = {};
            function pushLink(href, kind, linkQuality, text) {
                if (!href || seenLinks[href]) return;
                seenLinks[href] = 1;
                downloadLinks.push({ url: href, kind: kind, quality: linkQuality, text: text || "Download" });
            }
            const linkRegex = /href="(https?:\/\/[^"]+)"/gi;
            let linkMatch;
            while ((linkMatch = linkRegex.exec(html)) !== null) {
                const href = linkMatch[1].replace(/&amp;/g, "&");

                // quality from surrounding link text
                const beforeMatch = html.substring(Math.max(0, linkMatch.index - 500), linkMatch.index);
                const textMatch = beforeMatch.match(/>([^<]*(?:480|720|1080|2160|4K)[^<]*)</i);
                const linkQuality = textMatch ? extractQuality(textMatch[1]) : extractQuality(title);
                const linkText = textMatch ? textMatch[1].trim() : "Download";

                if (/links\.hdmovieshub\.[a-z.]+\/(?!wp-)/i.test(href)) {
                    pushLink(href, "gw", linkQuality, linkText);
                } else if (/\/view\/[A-Za-z0-9]+/i.test(href) && /linkszilla|mobilejsr|linkzymedia|links4u/i.test(href)) {
                    pushLink(href, "view", linkQuality, linkText);
                } else if (/hubcloud\.(cx|club|fans)\/drive\/|gdflix\.(dev|io)\/file\/|pixeldrain\.(com|dev)\/u\/|vikingfile\.com\/f\//i.test(href)) {
                    pushLink(href, "direct", linkQuality, linkText);
                }
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

    // hubcloud.cx/drive/<id> → id="download" → gamerxyt hop → signed R2
    // direct file (8h TTL). pixel.hubcloud/pixeldrain links ride along.
    async function resolveHubcloud(pageUrl) {
        const res = await withTimeout(http_get(pageUrl, headers), 15000);
        const html = res && res.body ? String(res.body) : '';
        const dl = (html.match(/id=["']download["'][^>]*href=["']([^"']+)["']/) ||
                    html.match(/href=["']([^"']*hubcloud\.php[^"']+)["']/) || [])[1];
        const out = [];
        if (!dl) return out;
        const dUrl = dl.replace(/&amp;/g, '&');
        if (/hubcloud\.php|gamerxyt/.test(dUrl)) {
            const d2 = await withTimeout(http_get(dUrl, { 'User-Agent': headers['User-Agent'], 'Referer': pageUrl }), 15000);
            const d2h = d2 && d2.body ? String(d2.body) : '';
            const r2 = (d2h.match(/https:\/\/[^"'\s<>]*r2\.cloudflarestorage\.com[^"'\s<>]+/) || [])[0];
            if (r2) out.push(r2);
            const px = (d2h.match(/https:\/\/pixel\.hubcloud\.cx\/\?id=[^"'\s<>]+/) || [])[0];
            if (px) out.push(px);
            if (!out.length) {
                const pd = (d2h.match(/https:\/\/pixeldrain\.(?:com|dev)\/u\/[A-Za-z0-9]+/) || [])[0];
                if (pd) { const dd = pixeldrainDirect(pd); if (dd) out.push(dd); }
            }
        } else if (/r2\.cloudflarestorage\.com|pixel\.hubcloud/.test(dUrl)) {
            out.push(dUrl);
        }
        return out;
    }

    function pixeldrainDirect(u) {
        const m = String(u).match(/pixeldrain\.(?:com|dev)\/u\/([A-Za-z0-9]+)/);
        return m ? 'https://pixeldrain.com/api/file/' + m[1] + '?download' : null;
    }

    // gdflix /file/<id> → /cloud/<ts>/<id> page → "<hex>::<hex>/<name>" direct
    async function resolveGdflix(pageUrl) {
        const res = await withTimeout(http_get(pageUrl, headers), 15000);
        const html = res && res.body ? String(res.body) : '';
        let cloud = (html.match(/href=["']([^"']*\/cloud\/[^"']+)["']/) || [])[1];
        if (!cloud) return [];
        cloud = cloud.replace(/&amp;/g, '&');
        if (cloud.indexOf('http') !== 0) {
            const b = (pageUrl.match(/^(https?:\/\/[^\/]+)/) || [])[1];
            if (!b) return [];
            cloud = b + cloud;
        }
        const c2 = await withTimeout(http_get(cloud, { 'User-Agent': headers['User-Agent'], 'Referer': pageUrl }), 15000);
        const c2h = c2 && c2.body ? String(c2.body) : '';
        const out = [], seen = {};
        const re = /https?:\/\/[^\s"'<>]+::[^\s"'<>]+\/[^"'\s<>]+/g;
        let m;
        while ((m = re.exec(c2h))) {
            const u = m[0];
            if (seen[u]) continue;
            if (!/\/[A-Za-z0-9_.-]+\.(mkv|mp4|zip)(\?|$)/i.test(u) && !/\?bytes=\d+/.test(u)) continue;
            seen[u] = 1; out.push(u);
            if (out.length >= 2) break;
        }
        return out;
    }

    // linkszilla/mobilejsr "view" hub page → the real file-host links.
    // Only resolvable hosts are returned; dead/blocked ones are skipped.
    // Also returns the hubcloud page title so callers can verify the files
    // actually belong to the requested movie (generic hubs exist).
    async function resolveViewHub(pageUrl) {
        const res = await withTimeout(http_get(pageUrl, headers), 15000);
        const html = res && res.body ? String(res.body) : '';
        const found = { hub: null, viking: null, gdflix: null, pixel: null, hubTitle: '' };
        const re = /href="(https?:\/\/[^"']+)"/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const u = m[1].replace(/&amp;/g, '&');
            if (!found.hub && /hubcloud\.(cx|club|fans)\/drive\//.test(u)) found.hub = u;
            else if (!found.viking && /vikingfile\.com\/f\//.test(u)) found.viking = u;
            else if (!found.gdflix && /gdflix\.(dev|io)\/file\//.test(u)) found.gdflix = u;
            else if (!found.pixel && /pixeldrain\.(com|dev)\/u\//.test(u)) found.pixel = u;
        }
        if (found.hub) {
            try {
                const hp = await withTimeout(http_get(found.hub, headers), 12000);
                const ht = hp && hp.body ? String(hp.body) : '';
                const tm = ht.match(/<title>([^<]{4,150})<\/title>/);
                if (tm) found.hubTitle = tm[1].replace(/\.(mkv|mp4|avi|zip)\b.*$/i, '').trim();
            } catch (e) {}
        }
        return found;
    }

    // word-overlap check: does a file title plausibly match the post title?
    function titlesMatch(postTitle, fileTitle) {
        if (!fileTitle) return true; // nothing to compare → allow
        const stop = /^(the|a|an|of|full|movie|hq|hd|esubs|sub|subs|org|dual|audio|hindi|english|tamil|telugu|malayalam|kannada|bengali|pakistan|punjabi|web|dl|hdrip|hdts|hdcam|pre|dvdscr|x264|x265|hevc|aac|ddp|dd|5|1|2|0|480p|720p|1080p|2160p|4k|300mb|700mb|2024|2025|2026)$/i;
        const words = function (s) {
            return String(s || '').toLowerCase().replace(/\((\d{4})\)/g, ' ')
                .replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
                .filter(function (w) { return w.length > 2 && !stop.test(w); });
        };
        const a = words(postTitle), b = words(fileTitle);
        if (!a.length) return true;
        for (let i = 0; i < a.length; i++) {
            if (b.indexOf(a[i]) >= 0) return true;
        }
        return false;
    }

    // Mirror fallback: fresh posts on the live domain often carry only
    // captcha-walled links, while the older mirror (.fyi) has proper
    // per-title gateway pages for the same movie. Search the mirror and
    // return its gateway links.
    async function mirrorGateways(postTitle) {
        try {
            // progressive narrowing: full clean title → fewer words
            let t = String(postTitle || '')
                .replace(/\((\d{4})\)/g, ' ')
                .replace(/\b(480p|720p|1080p|2160p|4k|web[- ]?dl|hdrip|hdts|hdtc|dvdscr|x264|x265|hevc|esubs|dual audio|org|hq|full movie|download|free|300mb|700mb|1-?2gb|2-?3gb|multi[- ]?audio|hindi|english|spanish|tamil|telugu|dubbed)\b/gi, ' ')
                .replace(/[^a-zA-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
            let words = t.split(' ').filter(Boolean);
            if (!words.length) return [];
            const tries = [words.slice(0, 4).join(' '), words.slice(0, 2).join(' '), words[0]];
            for (let i = 0; i < tries.length; i++) {
                const q = tries[i];
                if (!q) continue;
                const res = await withTimeout(
                    http_get(BASES[1] + "/wp-json/wp/v2/posts?search=" + encodeURIComponent(q) + "&per_page=5", headers), 12000);
                if (!res || !res.body) continue;
                let posts = null;
                try { posts = JSON.parse(res.body); } catch (e) { continue; }
                if (!Array.isArray(posts) || !posts.length) continue;
                // pick the post whose title best matches
                let best = null, bestScore = 0;
                for (const p of posts) {
                    const pt = cleanTitle(p.title && p.title.rendered || '');
                    let score = 0;
                    const wa = words, wb = String(pt).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/);
                    for (const w of wa) if (wb.indexOf(w) >= 0) score++;
                    if (score > bestScore) { bestScore = score; best = p; }
                }
                if (!best || bestScore < 1) continue;
                const page = await withTimeout(http_get(best.link, headers), 12000);
                const html = page && page.body ? String(page.body) : '';
                const out = [];
                const re = /href="(https?:\/\/links\.hdmovieshub\.[a-z.]+\/[^"]+)"/gi;
                let m;
                while ((m = re.exec(html)) !== null) {
                    const before = html.substring(Math.max(0, m.index - 500), m.index);
                    const tm = before.match(/>([^<]*(?:480|720|1080|2160|4K)[^<]*)</i);
                    out.push({ url: m[1], kind: 'gw', quality: tm ? extractQuality(tm[1]) : 'HD', text: tm ? tm[1] : 'Mirror' });
                    if (out.length >= 4) break;
                }
                if (out.length) return out;
            }
        } catch (e) {}
        return [];
    }


    async function resolveOneHost(kind, u) {
        // returns array of {url, headers, host}
        try {
            if (kind === 'hub' || /hubcloud\./.test(u)) {
                const rs = await resolveHubcloud(u);
                return rs.map(function (x) { return { url: x, headers: { 'User-Agent': headers['User-Agent'] }, host: 'HubCloud' }; });
            }
            if (kind === 'viking' || /vikingfile\.com/.test(u)) {
                const r = await resolveViking(u);
                return r ? [{ url: r.url, headers: r.headers, host: 'VikingFile' }] : [];
            }
            if (kind === 'gdflix' || /gdflix\./.test(u)) {
                const rs = await resolveGdflix(u);
                return rs.map(function (x) { return { url: x, headers: { 'User-Agent': headers['User-Agent'], 'Referer': u }, host: 'GDFlix' }; });
            }
            if (kind === 'pixel' || /pixeldrain\./.test(u)) {
                const d = pixeldrainDirect(u);
                return d ? [{ url: d, headers: { 'User-Agent': headers['User-Agent'] }, host: 'PixelDrain' }] : [];
            }
            if (kind === 'vcloud' || /vcloud\.zip/.test(u)) {
                const r = await resolveVcloud(u);
                return r ? [{ url: r.url, headers: r.headers, host: 'VCloud' }] : [];
            }
            if (kind === 'filebee' || /filebee\.xyz/.test(u)) {
                const r = await resolveFilebee(u);
                return r ? [{ url: r.url, headers: r.headers, host: 'FileBee' }] : [];
            }
        } catch (e) {}
        return [];
    }

    async function loadStreams(url, cb) {
        try {
            let params = null;
            try { params = typeof url === "string" ? JSON.parse(url) : url; } catch (_) {}
            const pageLink = (params && params.link) || null;

            // Link candidates cached from load() when available.
            let candidates = globalThis.__hdmovies_download_links || [];
            if (!candidates.length && pageLink) {
                const res = await http_get(pageLink, headers);
                const html = res && res.body ? String(res.body) : '';
                const re = /href="(https?:\/\/[^"]+)"/gi;
                let m;
                while ((m = re.exec(html)) !== null) {
                    const u = m[1].replace(/&amp;/g, '&');
                    if (/links\.hdmovieshub\.[a-z.]+\//.test(u)) candidates.push({ url: u, kind: 'gw', quality: 'HD' });
                    else if (/\/view\/[A-Za-z0-9]+/.test(u) && /linkszilla|mobilejsr/i.test(u)) candidates.push({ url: u, kind: 'view', quality: 'HD' });
                    else if (/hubcloud\.|gdflix\.|pixeldrain\.|vikingfile\.com\/f\//.test(u)) candidates.push({ url: u, kind: 'direct', quality: 'HD' });
                }
            }
            if (!candidates.length) {
                return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No download links found on the post page.' });
            }

            const streams = [];
            const deadHosts = [];
            const seenUrls = {};

            function addResolved(rs, q) {
                for (const r of rs) {
                    if (!r || !r.url || seenUrls[r.url]) continue;
                    seenUrls[r.url] = 1;
                    streams.push(new StreamResult({
                        url: r.url,
                        source: r.host + ' [' + q + ']',
                        headers: r.headers || null
                    }));
                }
            }

            // Process candidate links (gateways + view hubs + direct hosts)
            for (const cand of candidates.slice(0, 6)) {
                if (streams.length >= 6) break;
                const q = cand.quality || 'HD';

                if (cand.kind === 'view') {
                    try {
                        const hosts = await resolveViewHub(cand.url);
                        // Generic hubs exist that point at a different movie —
                        // verify the hubcloud file title matches before using.
                        if (hosts.hub && hosts.hubTitle &&
                            !titlesMatch((params && params.title) || '', hosts.hubTitle) && !hosts.viking) {
                            deadHosts.push('link hub (different title)');
                            continue;
                        }
                        // order: hubcloud (R2) > viking > gdflix > pixeldrain
                        for (const hk of ['hub', 'viking', 'gdflix', 'pixel']) {
                            if (!hosts[hk]) continue;
                            const rs = await resolveOneHost(hk, hosts[hk]);
                            addResolved(rs, q);
                            if (streams.length >= 3) break;
                        }
                        if (!streams.length) deadHosts.push('link hub');
                    } catch (e) { deadHosts.push('link hub'); }
                    continue;
                }

                if (cand.kind === 'direct') {
                    const hk = /hubcloud\./.test(cand.url) ? 'hub'
                             : /vikingfile\.com/.test(cand.url) ? 'viking'
                             : /gdflix\./.test(cand.url) ? 'gdflix'
                             : /pixeldrain\./.test(cand.url) ? 'pixel' : null;
                    if (!hk) continue;
                    const rs = await resolveOneHost(hk, cand.url);
                    addResolved(rs, q);
                    if (!rs.length) deadHosts.push(hk);
                    continue;
                }

                // gateway page (.fyi era): scrape the file hosts it links to
                let html = '';
                try {
                    const res = await http_get(cand.url, headers);
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
                    else if (/hubcloud\.(?:cx|club|fans)\/drive\//.test(u) && !links.hub) links.hub = u;
                    else if (/gofile\.io\/d\//.test(u)) links.gofile = u;
                    else if (/megaup\.net\//.test(u)) links.megaup = u;
                }

                // hubcloud first (cleanest direct), then viking, vcloud, filebee
                for (const hk of ['hub', 'viking', 'vcloud', 'filebee']) {
                    if (!links[hk]) continue;
                    const rs = await resolveOneHost(hk, links[hk]);
                    addResolved(rs, q);
                    if (!rs.length) deadHosts.push(hk === 'hub' ? 'hubcloud' : hk);
                    if (streams.length >= 3) break;
                }
                if (!streams.length && (links.gofile || links.megaup)) {
                    deadHosts.push(links.gofile ? 'gofile (premium-only)' : 'megaup (dead)');
                }
            }

            // Mirror fallback: fresh posts often carry only captcha-walled
            // links; the .fyi mirror has real gateway pages for the same
            // title. Try it before giving up.
            if (!streams.length) {
                const mirrors = await mirrorGateways((params && params.title) || '');
                for (const gw of mirrors.slice(0, 3)) {
                    if (streams.length >= 4) break;
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
                        else if (/hubcloud\.(?:cx|club|fans)\/drive\//.test(u) && !links.hub) links.hub = u;
                    }
                    for (const hk of ['hub', 'viking', 'vcloud', 'filebee']) {
                        if (!links[hk]) continue;
                        const rs = await resolveOneHost(hk, links[hk]);
                        addResolved(rs, gw.quality || 'HD');
                        if (!rs.length) deadHosts.push(hk === 'hub' ? 'hubcloud' : hk);
                        if (streams.length >= 4) break;
                    }
                }
            }

            if (!streams.length) {
                const hosts = deadHosts.length ? Array.from(new Set(deadHosts)).join(', ') : 'the linked hosts';
                return cb({ success: false, errorCode: 'NO_STREAMS',
                            message: 'Could not resolve a direct stream from ' + hosts +
                                     '. This title may be newer than the mirror archive and its links are captcha-protected. Try another post or quality.' });
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
