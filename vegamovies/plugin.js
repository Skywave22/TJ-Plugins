(function() {
    /**
     * VegaMovies â€” SkyStream plugin (Sky Gen 2)
     * ---------------------------------------------------------------
     * Aggregates movie/TV streaming & download sources across four
     * Vegamovies mirror domains into a single plugin:
     *
     *   https://vegamoviez.lol   (WordPress engine)
     *   https://vegamoviess.fun  (DLE engine)
     *   https://vega-ts.com      (DLE engine)
     *   https://vegamovie.me     (DLE engine)
     *
     * All mirrors share the same "article.post-item" card theme, so
     * browsing/searching is uniform. Each mirror's detail page is
     * fetched and its download/server links extracted, then merged so
     * that when you open a title you get servers from ALL four sites.
     *
     * Anti-bot handling:
     *  - /go?url= redirector (Cloudflare-gated) is bypassed by decoding
     *    the destination URL from the query string client-side.
     *  - Ad / tracker links (winexch, tinyurl, a-ads ...) are discarded.
     *  - Hosts that can resolve to a direct link are followed
     *    (HubCloud generator button). Others are returned as labelled
     *    server links for the app's playback layer / magic proxy.
     */

    /* ------------------------------------------------------------------ *
     *  Configuration
     * ------------------------------------------------------------------ */

    const MIRRORS = [
        { url: "https://vegamoviez.lol",  engine: "wp"  },
        { url: "https://vegamoviess.fun", engine: "dle" },
        { url: "https://vega-ts.com",     engine: "dle" },
        { url: "https://vegamovie.me",    engine: "dle" }
    ];

    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };

    // Hosts we do NOT treat as video servers (ads / tracking / nav).
    const BLOCKED_HOSTS = /(winexch|tinyurl|a-ads|nexdrive\.vip\/img|\.css$|\.js$|telegram|googleapis|cloudflare|fonts\.|google\.com\/imgres|sharethis|platform-cdn)/i;
    // Known download-gateway hosts that represent real "servers".
    const HOST_RE = /(hubcloud|hubdrive|gdflix|gdtot|filepress|dropgalaxy|vcloud|vgmlinks|fast-dl|nexdrive|dood|streamruby|filemoon|mixdrop|streamtape|voe\.|pixeldrain)/i;

    function getBaseUrl() {
        if (typeof manifest !== "undefined" && manifest && manifest.baseUrl) return manifest.baseUrl;
        return MIRRORS[0].url;
    }

    /* ------------------------------------------------------------------ *
     *  Small helpers
     * ------------------------------------------------------------------ */

    function safeParse(str) {
        if (!str) return null;
        if (typeof str === "object") return str;
        try { return JSON.parse(str); } catch (e) { return null; }
    }

    function unescapeHTML(str) {
        if (!str) return "";
        return String(str)
            .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
            .replace(/&nbsp;/gi, " ").replace(/&#(\d+);/g, (m, d) => { const c = parseInt(d, 10); return isNaN(c) ? m : String.fromCharCode(c); })
            .replace(/&#x([0-9a-f]+);/gi, (m, h) => { const c = parseInt(h, 16); return isNaN(c) ? m : String.fromCharCode(c); });
    }

    function stripTags(html) {
        if (!html) return "";
        return unescapeHTML(String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    }

    function absUrl(u, base) {
        if (!u) return "";
        u = u.trim();
        if (/^https?:\/\//i.test(u)) return u;
        if (u.startsWith("//")) return "https:" + u;
        if (u.startsWith("/")) {
            const m = /^(https?:\/\/[^/]+)/i.exec(base || "");
            return (m ? m[1] : getBaseUrl()) + u;
        }
        return u;
    }

    function getBaseDomain(url) {
        const m = /^(https?:\/\/[^/]+)/i.exec(url || "");
        return m ? m[1] : "";
    }

    function engineOf(domain) {
        const d = String(domain || "").toLowerCase();
        if (d.includes("vegamoviez.lol")) return "wp";
        return "dle";
    }

    // Derive a WordPress-style slug from a title.
    function slugify(title) {
        return String(title || "")
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/[-\s]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function normalize(s) {
        return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
    }

    // Pull a resolution label (480p / 720p / 1080p / 2160p / 4K) from a string.
    function extractQuality(text) {
        const t = String(text || "");
        let m = t.match(/(\d{3,4})\s*p/i);
        if (m) return m[1] + "p";
        if (/\b4k\b/i.test(t)) return "4K";
        if (/2160p/i.test(t)) return "2160p";
        return null;
    }

    function detectType(title, href) {
        const s = String(title || "") + " " + String(href || "");
        if (/(season|web.?series|episode|s0\d|tv.?shows|-\s*s\d|all episodes)/i.test(s)) return "series";
        return "movie";
    }

    // Host-name from a URL for labels.
    function hostName(u) {
        const m = /^https?:\/\/([^\/]+)/i.exec(u || "");
        return m ? m[1].replace(/^www\./, "") : "host";
    }

    /* ------------------------------------------------------------------ *
     *  HTML / card parsing
     * ------------------------------------------------------------------ */

    // Parse home/search cards: <article class="post-item">â€¦</article>
    function parseCards(html, baseUrl) {
        const items = [];
        const re = /<article[^>]*post-item[^>]*>([\s\S]*?)<\/article>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const block = m[1];
            // title + href from the entry-title anchor (fallback: any anchor around an image)
            let href = "", title = "", poster = "";

            let t = /class="entry-title[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
            if (t) { href = t[1]; title = stripTags(t[2]); }
            if (!title || !href) {
                t = /<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img[^>]*>/i.exec(block);
                if (t) href = t[1];
                t = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(block);
                if (t) title = stripTags(t[1]);
            }
            const p = /class="blog-picture[^"]*"[^>]*src="([^"]+)"/i.exec(block);
            if (p) poster = p[1];
            else { const pi = /<img[^>]*src="([^"]+)"[^>]*>/i.exec(block); if (pi) poster = pi[1]; }

            if (!href || href.startsWith("#")) continue;
            href = absUrl(href, baseUrl);
            poster = absUrl(poster, baseUrl);
            title = stripTags(title) || hostName(href);
            if (poster && /(placeholder|logo|banner|default)/i.test(poster)) poster = "";

            items.push({
                title: title,
                href: href,
                poster: poster,
                type: detectType(title, href)
            });
        }
        return items;
    }

    // Parse the "Download Links" section of a DLE detail page.
    // Returns [{ quality, links: [{ label, url }] }]
    function parseDLEDownloads(html) {
        const groups = [];
        const headingRe = /<h([1-5])[^>]*>([\s\S]*?)<\/h\1>/gi;
        const btnRe = /<a[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

        // Walk through the html in order: track current quality heading, then collect btn links.
        const tokens = [];
        let hm;
        while ((hm = headingRe.exec(html)) !== null) {
            const txt = stripTags(hm[2]);
            const q = extractQuality(txt);
            if (q) tokens.push({ type: "q", q: q, pos: hm.index });
        }
        let bm;
        while ((bm = btnRe.exec(html)) !== null) {
            const url = bm[1];
            const label = stripTags(bm[2]) || "Download";
            if (BLOCKED_HOSTS.test(url)) continue;
            tokens.push({ type: "btn", url: url, label: label, pos: bm.index });
        }
        tokens.sort((a, b) => a.pos - b.pos);

        let cur = null;
        for (const tk of tokens) {
            if (tk.type === "q") {
                cur = { quality: tk.q, links: [] };
                groups.push(cur);
            } else if (tk.type === "btn") {
                if (!cur) { cur = { quality: null, links: [] }; groups.push(cur); }
                cur.links.push({ label: tk.label, url: tk.url });
            }
        }
        return groups;
    }

    // Parse the "Download Links" section of a WordPress detail page.
    // The anchors route through /go?url=<destination>; we decode client-side.
    function parseWordPressDownloads(html) {
        const groups = [];
        const headingRe = /<h([1-5])[^>]*>([\s\S]*?)<\/h\1>/gi;
        const strongRe = /<strong[^>]*>([\s\S]*?)<\/strong>/gi;
        const aRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

        const tokens = [];
        let hm;
        while ((hm = headingRe.exec(html)) !== null) {
            const txt = stripTags(hm[2]);
            const q = extractQuality(txt);
            if (q) tokens.push({ type: "q", q: q, pos: hm.index });
        }
        let sm;
        while ((sm = strongRe.exec(html)) !== null) {
            const txt = stripTags(sm[1]);
            const q = extractQuality(txt);
            if (q) tokens.push({ type: "q", q: q, pos: sm.index });
        }
        let am;
        while ((am = aRe.exec(html)) !== null) {
            const href = am[1];
            if (!/\/go\?url=/i.test(href)) continue;
            const label = stripTags(am[2]) || "Link";
            const dest = decodeGo(href);
            if (!dest || BLOCKED_HOSTS.test(dest)) continue;
            tokens.push({ type: "link", dest: dest, label: label, href: href, pos: am.index });
        }
        tokens.sort((a, b) => a.pos - b.pos);

        let cur = null;
        for (const tk of tokens) {
            if (tk.type === "q") {
                cur = { quality: tk.q, links: [] };
                groups.push(cur);
            } else if (tk.type === "link") {
                if (!cur) { cur = { quality: null, links: [] }; groups.push(cur); }
                cur.links.push({ label: tk.label, dest: tk.dest, href: tk.href });
            }
        }
        return groups;
    }

    // Decode a /go?url=<enc> redirector href to its destination URL.
    function decodeGo(href) {
        const m = /[?&]url=([^&]+)/i.exec(href || "");
        if (!m) return "";
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }

    /* ------------------------------------------------------------------ *
     *  Download-gateway resolvers (best-effort direct-link extraction)
     * ------------------------------------------------------------------ */

    // HubCloud: follow the "Generate Download Link" button then collect a.btn links.
    async function resolveHubCloud(pageUrl) {
        const out = [];
        try {
            const res = await http_get(pageUrl, HEADERS);
            const body = res && res.body ? res.body : "";
            if (!body || /just a moment/i.test(body)) return out;

            // Find the generator button URL.
            let gen = "";
            let g = /<a[^>]*id="download"[^>]*href="([^"]+)"/i.exec(body);
            if (g) gen = g[1];
            if (!gen) g = /<a[^>]*href="([^"]*\.php[^"]*)"[^>]*>/i.exec(body);
            if (g) gen = g[1];
            // Known hubcloud generator pattern.
            const gp = /href="(https?:\/\/[^"]*(?:gamerxyt|hubcloud)[^"]*\.php[^"]*)"/i.exec(body);
            if (gp) gen = gp[1];

            let finalBody = body;
            if (gen) {
                const url2 = absUrl(gen, pageUrl);
                const r2 = await http_get(url2, { ...HEADERS, "Referer": pageUrl });
                if (r2 && r2.body && !/just a moment/i.test(r2.body)) finalBody = r2.body;
            }

            const btnRe = /<a[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            let m;
            while ((m = btnRe.exec(finalBody)) !== null) {
                let u = m[1];
                if (BLOCKED_HOSTS.test(u)) continue;
                if (u.startsWith("/") && !u.startsWith("//")) continue; // relative nav
                const label = stripTags(m[2]) || "HubCloud";
                out.push({ url: absUrl(u, pageUrl), label: label, host: "hubcloud" });
            }
            // Direct file links inside the page.
            const dm = finalBody.match(/https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mkv)(?:[^"'\s]*)/gi);
            if (dm) dm.forEach(u => { if (!out.some(o => o.url === u)) out.push({ url: u, label: "HubCloud Direct", host: "hubcloud" }); });
        } catch (e) {
            console.error("HubCloud resolve error:", e && e.message);
        }
        return out;
    }

    // GDFlix: best-effort â€” follow redirects and look for a direct file URL.
    async function resolveGDFlix(pageUrl) {
        const out = [];
        try {
            const res = await http_get(pageUrl, { ...HEADERS, "Referer": getBaseUrl() });
            const body = res && res.body ? res.body : "";
            if (!body) return out;
            const dm = body.match(/https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mkv)(?:[^"'\s]*)/gi);
            if (dm) dm.forEach(u => out.push({ url: u, label: "GDFlix Direct", host: "gdflix" }));
        } catch (e) { /* ignore */ }
        return out;
    }

    // NexDrive aggregator page â†’ collect its real host-mirror links.
    function parseNexDrive(pageHtml) {
        const links = [];
        const re = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(pageHtml)) !== null) {
            const u = m[1];
            if (BLOCKED_HOSTS.test(u)) continue;
            if (!HOST_RE.test(u) && !/\.(mp4|m3u8|mkv)(\?|$)/i.test(u)) continue;
            const label = stripTags(m[2]) || hostName(u);
            links.push({ url: u, label: label, host: hostName(u) });
        }
        return links;
    }

    // For a given download URL, produce candidate server streams.
    async function resolveDownload(url, refererBase) {
        const results = [];
        const host = hostName(url);
        try {
            if (/hubcloud/i.test(host)) {
                const r = await resolveHubCloud(url);
                r.forEach(x => results.push(x));
                if (r.length === 0) results.push({ url: url, label: "HubCloud", host: "hubcloud" });
            } else if (/gdflix/i.test(host)) {
                const r = await resolveGDFlix(url);
                r.forEach(x => results.push(x));
                if (r.length === 0) results.push({ url: url, label: "GDFlix", host: "gdflix" });
            } else if (/nexdrive/i.test(host)) {
                const res = await http_get(url, { ...HEADERS, "Referer": refererBase });
                const body = res && res.body ? res.body : "";
                const mirrors = parseNexDrive(body);
                mirrors.forEach(x => results.push(x));
                if (mirrors.length === 0) results.push({ url: url, label: "NexDrive", host: "nexdrive" });
            } else {
                // Any other real host â†’ offer the link itself.
                results.push({ url: url, label: host, host: host });
            }
        } catch (e) {
            results.push({ url: url, label: host, host: host });
        }
        return results;
    }

    /* ------------------------------------------------------------------ *
     *  getHome
     * ------------------------------------------------------------------ */

    async function getHome(cb) {
        try {
            const baseUrl = getBaseUrl();
            const res = await http_get(baseUrl, HEADERS);
            const body = res && res.body ? res.body : "";
            const cards = parseCards(body, baseUrl).slice(0, 40);

            if (cards.length === 0) {
                cb({ success: false, errorCode: "PARSE_ERROR", message: "No items parsed from " + baseUrl });
                return;
            }

            const items = cards.map(c => new MultimediaItem({
                title: c.title,
                url: JSON.stringify({ t: c.title, h: c.href, p: c.poster, k: c.type }),
                posterUrl: c.poster,
                type: c.type
            }));

            const map = { Trending: items };
            if (items.length > 8) map["Latest"] = items.slice(0, 20);
            cb({ success: true, data: map });
        } catch (e) {
            console.error("getHome error:", e);
            cb({ success: false, errorCode: "HTTP_ERROR", message: e && e.message });
        }
    }

    /* ------------------------------------------------------------------ *
     *  search
     * ------------------------------------------------------------------ */

    async function search(query, cb) {
        try {
            const baseUrl = getBaseUrl();
            const engine = engineOf(baseUrl);
            const q = encodeURIComponent(query);
            const url = engine === "wp"
                ? `${baseUrl}/?s=${q}`
                : `${baseUrl}/index.php?do=search&subaction=search&story=${q}`;

            const res = await http_get(url, HEADERS);
            const body = res && res.body ? res.body : "";
            const cards = parseCards(body, baseUrl);

            const items = cards.map(c => new MultimediaItem({
                title: c.title,
                url: JSON.stringify({ t: c.title, h: c.href, p: c.poster, k: c.type }),
                posterUrl: c.poster,
                type: c.type
            }));
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e && e.message });
        }
    }

    /* ------------------------------------------------------------------ *
     *  load  (detail + quality-grouped episodes)
     * ------------------------------------------------------------------ */

    async function load(urlStr, cb) {
        try {
            const data = safeParse(urlStr) || { t: "Title", h: urlStr };
            const href = data.h || urlStr;
            const baseUrl = getBaseUrl();
            const engine = engineOf(baseUrl);

            const res = await http_get(href, { ...HEADERS, "Referer": baseUrl });
            const body = res && res.body ? res.body : "";
            if (!body || /just a moment/i.test(body)) {
                cb({ success: false, errorCode: "BLOCKED", message: "Cloudflare/anti-bot blocked " + href });
                return;
            }

            // Title
            let title = "";
            const h1 = /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(body);
            if (h1) title = stripTags(h1[1]);
            if (!title) { const og = /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i.exec(body); if (og) title = unescapeHTML(og[1]); }
            if (!title) title = data.t || "Title";
            title = title.replace(/\s*\|.*$/i, "").replace(/\s*-\s*(Vegamovies|Vegamovise).*$/i, "").trim();

            // Poster
            let poster = data.p || "";
            if (!poster) {
                const og = /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i.exec(body);
                if (og) poster = og[1];
                else { const img = /class="blog-picture[^"]*"[^>]*src="([^"]+)"/i.exec(body); if (img) poster = img[1]; }
            }
            poster = absUrl(poster, baseUrl);

            // Description
            let description = "";
            const dsc = /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i.exec(body);
            if (dsc) description = unescapeHTML(dsc[1]);

            // Year
            let year = null;
            const ym = title.match(/(19|20)\d{2}/);
            if (ym) year = parseInt(ym[0], 10);

            const type = data.k || detectType(title, href);

            // Download groups
            const groups = engine === "wp" ? parseWordPressDownloads(body) : parseDLEDownloads(body);

            // Build quality-grouped episodes. Each episode carries the info
            // loadStreams needs to aggregate servers from all four mirrors.
            const episodes = [];
            const seenQ = new Set();
            groups.forEach(g => {
                const q = g.quality || "Auto";
                if (seenQ.has(q)) return;
                seenQ.add(q);
                episodes.push(new Episode({
                    name: (type === "series" ? "Season Â· " : "Full Movie Â· ") + q,
                    url: JSON.stringify({ t: title, q: q, h: href, p: poster, k: type, s: slugify(title) }),
                    season: 1,
                    episode: episodes.length + 1,
                    posterUrl: poster
                }));
            });
            if (episodes.length === 0) {
                episodes.push(new Episode({
                    name: "Full Movie",
                    url: JSON.stringify({ t: title, q: null, h: href, p: poster, k: type, s: slugify(title) }),
                    season: 1, episode: 1, posterUrl: poster
                }));
            }

            const item = new MultimediaItem({
                title: title,
                url: JSON.stringify({ t: title, h: href, p: poster, k: type, s: slugify(title) }),
                posterUrl: poster,
                description: description,
                year: year,
                type: type,
                episodes: episodes
            });
            cb({ success: true, data: item });
        } catch (e) {
            console.error("load error:", e);
            cb({ success: false, errorCode: "LOAD_ERROR", message: e && e.message });
        }
    }

    /* ------------------------------------------------------------------ *
     *  loadStreams  â€” aggregate servers from ALL FOUR mirrors
     * ------------------------------------------------------------------ */

    // Tokens we ignore when matching a movie name across mirrors.
    const JUNK_TOKENS = /^(hindi|english|tamil|telugu|kannada|malayalam|marathi|punjabi|korean|tagalog|multi|audio|line|v[0-9]|v3|v4|hq|hd|hdtc|webdl|web|dl|dubbed|dual|480p|720p|1080p|2160p|4k|4k|hdrip|x264|x265|hevc|brrip|dvdrip|full|movie|season|complete|download|quality|clean|org|1gb|300mb|100mb|all|episodes|added|202[0-9]|19[0-9]{2})$/i;

    // Extract the "core" words of a title (name words that matter for matching).
    function coreWords(title) {
        return String(title || "").toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(w => w && !JUNK_TOKENS.test(w));
    }

    // Score how well a candidate title matches a query title (0..N shared core words).
    function matchScore(candTitle, queryTitle) {
        const qc = coreWords(queryTitle).slice(0, 7);
        const cc = coreWords(candTitle).slice(0, 7);
        let score = 0;
        for (const w of qc) if (cc.includes(w)) score++;
        return score;
    }

    // Run the mirror's search and return parsed candidate cards.
    async function searchCards(mirror, title) {
        try {
            const q = encodeURIComponent(title);
            const engine = engineOf(mirror);
            const url = engine === "wp"
                ? `${mirror}/?s=${q}`
                : `${mirror}/index.php?do=search&subaction=search&story=${q}`;
            const res = await http_get(url, HEADERS);
            const body = res && res.body ? res.body : "";
            if (!body || /just a moment/i.test(body)) return [];
            return parseCards(body, mirror);
        } catch (e) {
            return [];
        }
    }

    // Find the best-matching post card for a title on a mirror.
    async function findPost(mirror, title) {
        try {
            const cards = await searchCards(mirror, title);
            if (cards.length === 0) return null;
            let best = null, bestScore = 0;
            for (const c of cards) {
                if (/(trailer|official trailer|teaser)/i.test(c.title)) continue;
                const score = matchScore(c.title, title);
                if (score > bestScore) { bestScore = score; best = c; }
            }
            if (!best || bestScore < 3) return null;
            return best;
        } catch (e) {
            return null;
        }
    }

    // Fetch a mirror's detail page and return download groups.
    async function fetchMirrorGroups(mirror, payload) {
        const engine = engineOf(mirror);
        let detailUrl = "";

        if (engine === "wp") {
            // Try the derived slug first, then fall back to WordPress search.
            const slug = payload.s || slugify(payload.t);
            detailUrl = `${mirror}/${slug}/`;
            const probe = await http_get(detailUrl, { ...HEADERS, "Referer": mirror });
            const probeBody = probe && probe.body ? probe.body : "";
            if (!probeBody || /just a moment/i.test(probeBody) || parseWordPressDownloads(probeBody).length === 0) {
                const post = await findPost(mirror, payload.t);
                if (!post) return { engine: engine, groups: [] };
                detailUrl = post.href;
            }
        } else {
            const post = await findPost(mirror, payload.t);
            if (!post) return { engine: engine, groups: [] };
            detailUrl = post.href;
        }

        try {
            const res = await http_get(detailUrl, { ...HEADERS, "Referer": mirror });
            const body = res && res.body ? res.body : "";
            if (!body || /just a moment/i.test(body)) return { engine: engine, groups: [] };
            const groups = engine === "wp" ? parseWordPressDownloads(body) : parseDLEDownloads(body);
            return { engine: engine, groups: groups, url: detailUrl };
        } catch (e) {
            return { engine: engine, groups: [] };
        }
    }

    async function loadStreams(urlStr, cb) {
        const streams = [];
        const seen = new Set();
        const add = (sr) => {
            if (!sr || !sr.url) return;
            if (seen.has(sr.url)) return;
            seen.add(sr.url);
            streams.push(sr);
        };

        try {
            const payload = safeParse(urlStr) || { t: urlStr };
            const wantQ = payload.q ? extractQuality(payload.q) : null;
            const baseUrl = getBaseUrl();

            for (const mirror of MIRRORS) {
                const siteLabel = hostName(mirror.url);
                try {
                    const { engine, groups } = await fetchMirrorGroups(mirror.url, payload);
                    const matched = groups.filter(g => !wantQ || !g.quality || extractQuality(g.quality) === wantQ);
                    const groupsToUse = matched.length > 0 ? matched : groups.slice(0, 1);
                    if (groupsToUse.length === 0) continue;

                    // Resolve links from every group that matches the quality.
                    for (const group of groupsToUse) {
                    for (const link of group.links) {
                        const dlUrl = link.dest || link.url;
                        let candidates = [];
                        try {
                            candidates = await resolveDownload(dlUrl, mirror.url);
                        } catch (e) {
                            candidates = [{ url: dlUrl, label: hostName(dlUrl), host: hostName(dlUrl) }];
                        }
                        for (const cand of candidates) {
                            const qLabel = group.quality ? `${group.quality}` : (wantQ || "Auto");
                            add(new StreamResult({
                                url: cand.url,
                                source: `${siteLabel} [${qLabel}] Â· ${cand.label || cand.host || "Server"}`,
                                headers: { "Referer": mirror.url }
                            }));
                        } // end cand loop
                    } // end link loop
                    } // end group loop
                } catch (e) {
                    console.error("mirror", mirror.url, "error:", e && e.message);
                }
            }

            if (streams.length === 0) {
                cb({ success: true, data: [] });
                return;
            }
            cb({ success: true, data: streams });
        } catch (e) {
            console.error("loadStreams error:", e);
            cb({ success: false, errorCode: "STREAM_ERROR", message: e && e.message });
        }
    }

    /* ------------------------------------------------------------------ */

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
