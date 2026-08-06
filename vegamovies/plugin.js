(function() {
    /**
     * VegaMovies â€” SkyStream plugin (Sky Gen 2)
     * ---------------------------------------------------------------
     * Aggregates ALL four Vegamovies mirror domains automatically into
     * ONE provider. No domain selector.
     *
     *   https://vegamoviez.lol   (WordPress â€” HubCloud / GDFlix hosts)
     *   https://vegamoviess.fun  (DLE)
     *   https://vega-ts.com      (DLE)
     *   https://vegamovie.me     (DLE)
     *
     * Features:
     *   - Home / search aggregate all 4 mirrors, merge + de-duplicate.
     *   - Movies + TV Series, each with real episodes.
     *   - Rich metadata: title, poster, year, rating, genres, cast,
     *     duration, description.
     *   - Playable direct streams first (HubCloud -> .mkv / PixelDrain /
     *     R2), gateway fallbacks appended.
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

    const BLOCKED_HOSTS = /(winexch|tinyurl|a-ads|nexdrive\.vip\/img|\.css$|\.js$|telegram|googleapis|cloudflare|fonts\.|google\.com\/imgres|sharethis|platform-cdn|googletagmanager)/i;
    const HOST_RE = /(hubcloud|hubdrive|gdflix|gdtot|filepress|dropgalaxy|vcloud|vgmlinks|fast-dl|nexdrive|dood|streamruby|filemoon|mixdrop|streamtape|voe\.|pixeldrain)/i;

    function getBaseUrl() {
        if (typeof manifest !== "undefined" && manifest && manifest.baseUrl) return manifest.baseUrl;
        return MIRRORS[0].url;
    }

    /* ------------------------------------------------------------------ *
     *  Helpers
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
            .replace(/&nbsp;/gi, " ")
            .replace(/&#(\d+);/g, (m, d) => { const c = parseInt(d, 10); return isNaN(c) ? m : String.fromCharCode(c); })
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

    function engineOf(url) { return /vegamoviez\.lol/i.test(url) ? "wp" : "dle"; }

    function slugify(title) {
        return String(title || "").toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "").replace(/[-\s]+/g, "-").replace(/^-+|-+$/g, "");
    }

    function extractQuality(text) {
        const t = String(text || "");
        let m = t.match(/(\d{3,4})\s*p/i);
        if (m) return m[1] + "p";
        if (/\b4k\b/i.test(t)) return "4K";
        if (/2160p/i.test(t)) return "2160p";
        return null;
    }

    function extractYear(text) {
        const m = String(text || "").match(/(19|20)\d{2}/);
        return m ? parseInt(m[0], 10) : null;
    }

    function isSeriesText(title, href) {
        const s = String(title || "") + " " + String(href || "");
        return /(season|web.?series|episode|s0\d|tv.?shows|-\s*s\d|all episodes|complete series|netflix series|amazon series)/i.test(s);
    }

    function detectType(title, href, hint) {
        if (hint === "series" || hint === "movie") return hint;
        return isSeriesText(title, href) ? "series" : "movie";
    }

    function hostName(u) {
        const m = /^https?:\/\/([^\/]+)/i.exec(u || "");
        return m ? m[1].replace(/^www\./, "") : "host";
    }

    function pad2(n) { return String(n || 0).padStart(2, "0"); }

    /* ------------------------------------------------------------------ *
     *  Dedup / title matching
     * ------------------------------------------------------------------ */

    const JUNK_TOKENS = /^(hindi|english|tamil|telugu|kannada|malayalam|marathi|punjabi|korean|tagalog|multi|audio|line|v[0-9]|hq|hd|hdtc|webdl|web|dl|dubbed|dual|480p|720p|1080p|2160p|4k|hdrip|x264|x265|hevc|brrip|dvdrip|full|movie|season|complete|download|quality|clean|org|1gb|300mb|100mb|all|episodes|added|202[0-9]|19[0-9]{2}|netflix|prime|amazon|ott|original|online|watch|in|the|a|of|and)$/i;

    function coreWords(title) {
        return String(title || "").toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
            .filter(w => w && w.length > 1 && !JUNK_TOKENS.test(w));
    }

    // Stable key for de-duplicating the same title across mirrors.
    function dedupeKey(title) {
        const y = extractYear(title) || "";
        const words = coreWords(title);
        return (words.slice(0, 4).join(" ") + " " + y).toLowerCase().trim();
    }

    function matchScore(candTitle, queryTitle) {
        const qc = coreWords(queryTitle).slice(0, 8);
        const cc = coreWords(candTitle).slice(0, 8);
        if (qc.length === 0) return 0;
        let shared = 0;
        for (const w of qc) if (cc.includes(w)) shared++;
        return shared >= 2 ? shared : 0;
    }

    /* ------------------------------------------------------------------ *
     *  Card parsing (home / search)
     * ------------------------------------------------------------------ */

    function parseCards(html, baseUrl) {
        const items = [];
        const re = /<article[^>]*post-item[^>]*>([\s\S]*?)<\/article>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const block = m[1];
            let href = "", title = "", poster = "";
            let t = /class="entry-title[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
            if (t) { href = t[1]; title = stripTags(t[2]); }
            if (!title || !href) {
                t = /<a[^>]*href="([^"]+)"[^>]*>[^<]*<img[^>]*>/i.exec(block);
                if (t) href = t[1];
                t = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(block);
                if (t) title = stripTags(t[1]);
            }
            const p = /class="blog-picture[^"]*"[^>]*src="([^"]+)"/i.exec(block)
                   || /<img[^>]*src="([^"]+)"/i.exec(block);
            if (p) poster = p[1];
            if (!href || href.startsWith("#")) continue;
            href = absUrl(href, baseUrl);
            poster = absUrl(poster, baseUrl);
            title = stripTags(title) || hostName(href);
            if (poster && /(placeholder|logo|banner|default)/i.test(poster)) poster = "";
            const type = isSeriesText(title, href) ? "series" : "movie";
            items.push({ title, href, poster, type, year: extractYear(title) });
        }
        return items;
    }

    /* ------------------------------------------------------------------ *
     *  Quality-group parsing (detail pages)
     * ------------------------------------------------------------------ */

    function parseDLEGroups(html) {
        const groups = [];
        const qRe = /<h([1-5])[^>]*>([\s\S]*?)<\/h\1>/gi;
        const btnRe = /<a[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        const toks = [];
        let m;
        while ((m = qRe.exec(html)) !== null) { const q = extractQuality(stripTags(m[2])); if (q) toks.push({ type: "q", q, pos: m.index }); }
        while ((m = btnRe.exec(html)) !== null) { const u = m[1]; if (!BLOCKED_HOSTS.test(u)) toks.push({ type: "b", url: u, label: stripTags(m[2]) || "Download", pos: m.index }); }
        toks.sort((a, b) => a.pos - b.pos);
        let cur = null;
        for (const t of toks) {
            if (t.type === "q") { cur = { quality: t.q, buttons: [] }; groups.push(cur); }
            else if (t.type === "b") { if (!cur) { cur = { quality: null, buttons: [] }; groups.push(cur); } cur.buttons.push({ url: t.url, label: t.label }); }
        }
        return groups;
    }

    function parseWPGroups(html) {
        const groups = [];
        const qRe = /<h([1-5])[^>]*>([\s\S]*?)<\/h\1>/gi;
        const sRe = /<strong[^>]*>([\s\S]*?)<\/strong>/gi;
        const aRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        const toks = [];
        let m;
        while ((m = qRe.exec(html)) !== null) { const q = extractQuality(stripTags(m[2])); if (q) toks.push({ type: "q", q, pos: m.index }); }
        while ((m = sRe.exec(html)) !== null) { const q = extractQuality(stripTags(m[1])); if (q) toks.push({ type: "q", q, pos: m.index }); }
        while ((m = aRe.exec(html)) !== null) {
            const href = m[1];
            if (!/\/go\?url=/i.test(href)) continue;
            const dest = decodeGo(href);
            if (!dest || BLOCKED_HOSTS.test(dest)) continue;
            toks.push({ type: "b", url: dest, label: stripTags(m[2]) || "Link", pos: m.index });
        }
        toks.sort((a, b) => a.pos - b.pos);
        let cur = null;
        for (const t of toks) {
            if (t.type === "q") { cur = { quality: t.q, buttons: [] }; groups.push(cur); }
            else if (t.type === "b") { if (!cur) { cur = { quality: null, buttons: [] }; groups.push(cur); } cur.buttons.push({ url: t.url, label: t.label }); }
        }
        return groups;
    }

    function parseGroups(html, engine) { return engine === "wp" ? parseWPGroups(html) : parseDLEGroups(html); }

    function decodeGo(href) {
        const m = /[?&]url=([^&]+)/i.exec(href || "");
        if (!m) return "";
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }

    /* ------------------------------------------------------------------ *
     *  Metadata extraction
     * ------------------------------------------------------------------ */

    // Extract a field value from raw DLE-style HTML: <strong>Label:</strong> VALUE <br/>
    function fieldRaw(html, label) {
        const m = new RegExp("<strong>\\s*" + label + "\\s*:?\\s*</strong>\\s*(.*?)<br", "is").exec(html);
        return m ? stripTags(m[1]).trim() : "";
    }

    // Extract a field from stripped text (WP fallback), stopping at the next known label.
    function fieldText(txt, label) {
        const labels = "Cast|Starring|Director|Language|Country|Runtime|Quality|Release Year|Size|Format|Genres|Rating|Resolution|Duration|Title|Movie Name|Web-Series Name";
        const re = new RegExp("\\b" + label + "\\s*:?\\s*([\\s\\S]{3,200}?)(?=\\s*(?:" + labels + ")\\s*:|\\s*$)", "i");
        const m = re.exec(txt);
        return m ? m[1].trim() : "";
    }

    function parseDuration(str) {
        if (!str) return null;
        const s = String(str);
        const h = parseInt((s.match(/(\d+)\s*h/i) || [])[1], 10) || 0;
        let mins = 0;
        const mm = s.match(/(\d+)\s*min/i) || s.match(/(\d+)\s*m\b/i);
        if (mm) mins = parseInt(mm[1], 10);
        else { const d = s.match(/(\d+)/); if (d) mins = parseInt(d[1], 10); }
        return h * 60 + mins || null;
    }

    function parseGenres(str) {
        if (!str) return [];
        return String(str).split(/[,;]/).map(g => g.trim()).filter(g => g && g.length > 2 && !/(quality|language|country|director|starring|runtime|resolution|size|format|released)/i.test(g)).slice(0, 8);
    }

    // Extract metadata from a detail page (works for DLE + WP).
    function extractMeta(html) {
        const meta = {};
        const txt = stripTags(html);

        // Poster
        const ogi = /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i.exec(html);
        meta.poster = ogi ? ogi[1] : "";

        // Description
        const ogd = /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i.exec(html);
        meta.description = ogd ? unescapeHTML(ogd[1]) : "";

        // Score (IMDb Rating) â€” DLE raw: 'IMDb Rating:</strong>- 8/324'
        let m = /IMDb Rating:?<\/strong>\s*-?\s*(\d+(?:\.\d+)?)/i.exec(html);
        if (m) meta.score = parseFloat(m[1]);
        else { m = /Rating\s*:?\s*(\d+(?:\.\d+)?)\s*\/\s*10/i.exec(txt); if (m) meta.score = parseFloat(m[1]); }

        // Year
        let ry = fieldRaw(html, "Release Year");
        if (!ry) ry = fieldText(txt, "Release Year");
        m = ry.match(/(\d{4})/);
        meta.year = m ? parseInt(m[1], 10) : extractYear(txt);

        // Genres
        let gstr = fieldRaw(html, "Genres");
        if (!gstr) gstr = fieldText(txt, "Genres");
        meta.genres = parseGenres(gstr);

        // Cast
        let cstr = fieldRaw(html, "Cast") || fieldRaw(html, "Starring");
        if (!cstr) cstr = fieldText(txt, "Cast") || fieldText(txt, "Starring");
        meta.cast = cstr ? String(cstr).split(/[,;]/).map(c => c.trim()).filter(c => c && c.length > 2 && !/\d/.test(c)).slice(0, 10) : [];

        // Director
        meta.director = fieldRaw(html, "Director") || fieldText(txt, "Director");

        // Duration
        const rt = fieldRaw(html, "Runtime") || fieldText(txt, "Runtime");
        meta.duration = parseDuration(rt);

        // Language
        meta.language = fieldRaw(html, "Language") || fieldText(txt, "Language");

        return meta;
    }

    /* ------------------------------------------------------------------ *
     *  Direct-media detection / extraction
     * ------------------------------------------------------------------ */

    function isDirectMedia(u) {
        return /\.(mp4|m3u8|mkv|webm|m4v)(\?|$)/i.test(u)
            || /\.r2\.cloudflarestorage\.com\//i.test(u)
            || /pixeldrain\.com\/api\/file\//i.test(u);
    }

    function extractDirectMedia(html) {
        const out = [];
        const seen = new Set();
        const re = /https?:\/\/[^"'\s<>]+/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            let u = m[0].replace(/[>)\],;'"]+$/, "");
            if (BLOCKED_HOSTS.test(u)) continue;
            if (!isDirectMedia(u)) continue;
            if (/\.(css|js|png|jpg|jpeg|webp|svg|ico|gif)(\?|$)/i.test(u)) continue;
            if (seen.has(u)) continue;
            seen.add(u);
            out.push({ url: u, label: "Direct", direct: true });
        }
        return out;
    }

    function pixelDrainId(url) {
        const m = url.match(/pixeldrain\.(?:dev|com|io)\/(?:u\/|file\/)?([A-Za-z0-9_-]{6,})/);
        return m ? m[1] : "";
    }

    function extractPixelDrainApiUrl(html) {
        const m = html.match(/pixeldrain\.(?:dev|com|io)\/u\/([A-Za-z0-9_-]{6,})/i)
               || html.match(/pixeldrain\.(?:dev|com|io)\/file\/([A-Za-z0-9_-]{6,})/i);
        if (m) return { url: "https://pixeldrain.com/api/file/" + m[1], label: "PixelDrain", direct: true };
        return null;
    }

    function collectHostLinks(chunk) {
        const links = [];
        const seen = new Set();
        const re = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(chunk)) !== null) {
            const u = m[1];
            if (BLOCKED_HOSTS.test(u)) continue;
            if (!HOST_RE.test(u) && !isDirectMedia(u)) continue;
            if (seen.has(u)) continue;
            seen.add(u);
            const label = stripTags(m[2]) || hostName(u);
            links.push({ url: u, label, host: hostName(u) });
        }
        return links;
    }

    function parseNexDriveMovie(html) { return collectHostLinks(html); }

    function parseNexDriveSeries(html) {
        const eps = [];
        const re = /<h4[^>]*class="ep-title-h4"[^>]*>([\s\S]*?)<\/h4>/gi;
        const positions = [];
        let m;
        while ((m = re.exec(html)) !== null) {
            const head = stripTags(m[1]);
            const num = parseInt((head.match(/Episodes?:?\s*(\d+)/i) || [])[1], 10) || 0;
            positions.push({ start: m.index + m[0].length, num });
        }
        for (let i = 0; i < positions.length; i++) {
            const start = positions[i].start;
            const end = i + 1 < positions.length ? positions[i + 1].start : html.length;
            const links = collectHostLinks(html.slice(start, end));
            if (positions[i].num > 0 && links.length) eps.push({ episode: positions[i].num, links });
        }
        return eps;
    }

    /* ------------------------------------------------------------------ *
     *  Host resolvers -> direct playable streams
     * ------------------------------------------------------------------ */

    async function resolveHubCloud(pageUrl) {
        const out = [];
        try {
            const res = await http_get(pageUrl, HEADERS);
            const body = res && res.body ? res.body : "";
            if (!body || /just a moment/i.test(body)) return out;
            let gen = "";
            let g = /<a[^>]*id="download"[^>]*href="([^"]+)"/i.exec(body);
            if (g) gen = g[1];
            if (!gen) { g = /href="(https?:\/\/[^"]*gamerxyt[^"]*\.php[^"]*)"/i.exec(body); if (g) gen = g[1]; }
            if (!gen) { g = /href="([^"]*\.php[^"]*(?:host=hubcloud)[^"]*)"/i.exec(body); if (g) gen = g[1]; }
            let finalBody = body;
            if (gen) {
                const url2 = absUrl(gen, pageUrl);
                const r2 = await http_get(url2, { ...HEADERS, "Referer": pageUrl });
                if (r2 && r2.body && !/just a moment/i.test(r2.body)) finalBody = r2.body;
            }
            extractDirectMedia(finalBody).forEach(d => out.push(d));
            const pd = extractPixelDrainApiUrl(finalBody);
            if (pd) out.push(pd);
            if (out.length === 0) {
                extractDirectMedia(body).forEach(d => out.push(d));
                const pd2 = extractPixelDrainApiUrl(body);
                if (pd2) out.push(pd2);
            }
        } catch (e) { console.error("HubCloud error:", e && e.message); }
        return out;
    }

    async function resolveGDFlix(pageUrl) {
        const out = [];
        try {
            const res = await http_get(pageUrl, { ...HEADERS });
            const body = res && res.body ? res.body : "";
            if (!body || /just a moment/i.test(body)) return out;
            const pd = extractPixelDrainApiUrl(body);
            if (pd) out.push(pd);
            extractDirectMedia(body).forEach(d => out.push(d));
        } catch (e) { /* ignore */ }
        return out;
    }

    async function resolveGeneric(pageUrl) {
        const out = [];
        try {
            const res = await http_get(pageUrl, { ...HEADERS });
            const body = res && res.body ? res.body : "";
            if (!body || /just a moment/i.test(body)) return out;
            const pd = extractPixelDrainApiUrl(body);
            if (pd) out.push(pd);
            extractDirectMedia(body).forEach(d => out.push(d));
        } catch (e) { /* ignore */ }
        return out;
    }

    /* ------------------------------------------------------------------ *
     *  Search helpers
     * ------------------------------------------------------------------ */

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
        } catch (e) { return []; }
    }

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
            return best;
        } catch (e) { return null; }
    }

    async function discoverMirrorMap(src, title, originDetail) {
        const map = { [src]: originDetail };
        const others = MIRRORS.filter(m => m.url !== src);
        const results = await Promise.all(others.map(async m => {
            const post = await findPost(m.url, title);
            return post ? { url: m.url, detail: post.href } : null;
        }));
        results.forEach(r => { if (r && r.detail) map[r.url] = r.detail; });
        return map;
    }

    function fetchDetail(detailUrl, referer) {
        return http_get(detailUrl, { ...HEADERS, "Referer": referer }).then(res => (res && res.body) || "").catch(() => "");
    }

    /* ------------------------------------------------------------------ *
     *  getHome â€” Movies + Series rows
     * ------------------------------------------------------------------ */

    async function getHome(cb) {
        try {
            const results = await Promise.all(MIRRORS.map(async m => {
                const res = await http_get(m.url, HEADERS);
                const body = res && res.body ? res.body : "";
                return parseCards(body, m.url);
            }));

            const merged = [];
            const seen = new Set();
            results.forEach((cards, i) => {
                const src = MIRRORS[i].url;
                for (const c of cards) {
                    const key = dedupeKey(c.title);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    merged.push({ ...c, src });
                }
            });

            const movies = merged.filter(c => c.type === "movie");
            const series = merged.filter(c => c.type === "series");

            const toItem = c => new MultimediaItem({
                title: c.title,
                url: JSON.stringify({ t: c.title, h: c.href, p: c.poster, k: c.type, src: c.src }),
                posterUrl: c.poster,
                type: c.type,
                year: c.year,
                description: ""
            });

            const trending = merged.slice(0, 30).map(toItem);
            const movieItems = movies.slice(0, 30).map(toItem);
            const seriesItems = series.slice(0, 30).map(toItem);

            const data = { "Trending": trending };
            if (movieItems.length) data["Movies"] = movieItems;
            if (seriesItems.length) data["Series"] = seriesItems;

            cb({ success: true, data });
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
            const results = await Promise.all(MIRRORS.map(m => searchCards(m.url, query)));
            const merged = [];
            const seen = new Set();
            results.forEach((cards, i) => {
                const src = MIRRORS[i].url;
                for (const c of cards) {
                    const key = dedupeKey(c.title);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    merged.push({ ...c, src });
                }
            });
            const items = merged.map(c => new MultimediaItem({
                title: c.title,
                url: JSON.stringify({ t: c.title, h: c.href, p: c.poster, k: c.type, src: c.src }),
                posterUrl: c.poster,
                type: c.type,
                year: c.year
            }));
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e && e.message });
        }
    }

    /* ------------------------------------------------------------------ *
     *  load â€” rich metadata + episodes
     * ------------------------------------------------------------------ */

    async function load(urlStr, cb) {
        try {
            const payload = safeParse(urlStr) || { t: urlStr };
            const src = payload.src || getBaseUrl();
            const originDetail = payload.h || "";

            let detailUrl = originDetail, body = "", engine = "";
            if (detailUrl) {
                engine = engineOf(detailUrl);
                body = await fetchDetail(detailUrl, src);
            }
            if (!body || /just a moment/i.test(body)) {
                const post = await findPost(src, payload.t);
                if (post) { detailUrl = post.href; engine = engineOf(detailUrl); body = await fetchDetail(detailUrl, src); }
            }
            if (!body || /just a moment/i.test(body)) {
                cb({ success: false, errorCode: "BLOCKED", message: "All mirrors blocked for " + (payload.t || detailUrl) });
                return;
            }

            const meta = extractMeta(body);

            let title = "";
            const h1 = /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(body)
                     || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body);
            if (h1) title = stripTags(h1[1]);
            if (!title) { const og = /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i.exec(body); if (og) title = unescapeHTML(og[1]); }
            if (!title) title = payload.t || "Title";
            title = title.replace(/\s*\|.*$/i, "").replace(/\s*-\s*(Vegamovies|Vegamovise).*$/i, "").trim();

            const poster = absUrl(meta.poster || payload.p || "", src);
            const type = detectType(title, detailUrl, payload.k);
            const year = meta.year || extractYear(title);

            const groups = parseGroups(body, engine).filter(g => g.buttons && g.buttons.length > 0);
            const slug = slugify(title);

            let mirrorsMap = {};
            try { mirrorsMap = await discoverMirrorMap(src, title, detailUrl); } catch (e) { mirrorsMap = { [src]: detailUrl }; }

            const common = { title, slug, poster, src, mirrors: mirrorsMap, detailUrl };
            const episodes = [];

            if (type === "series") {
                let epList = [], chosenQ = null;
                for (const g of groups) {
                    const ndUrl = g.buttons[0].url;
                    if (/nexdrive/i.test(hostName(ndUrl))) {
                        try {
                            const nd = await fetchDetail(ndUrl, src);
                            const eps = parseNexDriveSeries(nd);
                            if (eps.length) { epList = eps; chosenQ = g.quality; break; }
                        } catch (e) { /* try next */ }
                    }
                }
                if (epList.length === 0) {
                    const seenQ = new Set();
                    groups.forEach(g => {
                        const q = g.quality || "Auto";
                        if (seenQ.has(q)) return;
                        seenQ.add(q);
                        episodes.push(new Episode({
                            name: "Season Pack Â· " + q,
                            url: JSON.stringify({ ...common, q: g.quality, type: "series" }),
                            season: 1, episode: episodes.length + 1, posterUrl: poster
                        }));
                    });
                } else {
                    epList.forEach(ep => {
                        episodes.push(new Episode({
                            name: "S01E" + pad2(ep.episode),
                            url: JSON.stringify({ ...common, ep: ep.episode, q: chosenQ, type: "series" }),
                            season: 1, episode: ep.episode, posterUrl: poster
                        }));
                    });
                }
            } else {
                const seenQ = new Set();
                groups.forEach(g => {
                    const q = g.quality || "Auto";
                    if (seenQ.has(q)) return;
                    seenQ.add(q);
                    episodes.push(new Episode({
                        name: "Full Movie Â· " + q,
                        url: JSON.stringify({ ...common, q, type: "movie" }),
                        season: 1, episode: episodes.length + 1, posterUrl: poster
                    }));
                });
                if (episodes.length === 0) {
                    episodes.push(new Episode({
                        name: "Full Movie",
                        url: JSON.stringify({ ...common, q: null, type: "movie" }),
                        season: 1, episode: 1, posterUrl: poster
                    }));
                }
            }

            const cast = (meta.cast || []).map(n => new Actor({ name: n }));

            const item = new MultimediaItem({
                title,
                url: JSON.stringify(common),
                posterUrl: poster,
                description: meta.description || "",
                year: year,
                score: meta.score,
                duration: meta.duration,
                type: type,
                status: "completed",
                tags: meta.genres,
                cast: cast.length ? cast : undefined,
                episodes: episodes
            });
            cb({ success: true, data: item });
        } catch (e) {
            console.error("load error:", e);
            cb({ success: false, errorCode: "LOAD_ERROR", message: e && e.message });
        }
    }

    /* ------------------------------------------------------------------ *
     *  loadStreams â€” aggregate servers, direct streams first
     * ------------------------------------------------------------------ */

    async function resolveDownload(url, referer) {
        const out = [];
        const seen = new Set();
        const host = hostName(url);
        const push = c => { if (c && c.url && !seen.has(c.url)) { seen.add(c.url); out.push(c); } };
        if (isDirectMedia(url)) { push({ url, label: host, direct: true }); return out; }
        try {
            if (/hubcloud/i.test(host)) {
                (await resolveHubCloud(url)).forEach(push);
                if (!out.length) push({ url, label: "HubCloud", direct: false });
            } else if (/gdflix/i.test(host)) {
                (await resolveGDFlix(url)).forEach(push);
                if (!out.length) push({ url, label: "GDFlix", direct: false });
            } else if (/pixeldrain/i.test(host)) {
                const id = pixelDrainId(url);
                if (id) push({ url: "https://pixeldrain.com/api/file/" + id, label: "PixelDrain", direct: true });
                else push({ url, label: "PixelDrain", direct: false });
            } else if (/nexdrive/i.test(host)) {
                const page = await fetchDetail(url, referer);
                const links = collectHostLinks(page);
                for (const l of links) (await resolveDownload(l.url, referer)).forEach(push);
                if (!out.length) push({ url, label: "NexDrive", direct: false });
            } else {
                (await resolveGeneric(url)).forEach(push);
                if (!out.length) push({ url, label: host, direct: false });
            }
        } catch (e) {
            if (!out.length) push({ url, label: host, direct: false });
        }
        return out;
    }

    async function resolveMirror(mirror, payload, mirrorsMap) {
        const site = hostName(mirror.url);
        try {
            let detailUrl = (mirrorsMap && mirrorsMap[mirror.url]) || "";
            if (!detailUrl) {
                const post = await findPost(mirror.url, payload.t);
                if (!post) return [];
                detailUrl = post.href;
            }
            const body = await fetchDetail(detailUrl, mirror.url);
            if (!body || /just a moment/i.test(body)) return [];

            const groups = parseGroups(body, engineOf(detailUrl)).filter(g => g.buttons && g.buttons.length);
            let group = null;
            if (payload.q) group = groups.find(g => g.quality && extractQuality(g.quality) === payload.q);
            if (!group) group = groups[0];
            if (!group) return [];

            const qLabel = group.quality || payload.q || "Auto";
            const btnUrl = group.buttons[0].url;
            const direct = [], fallback = [];
            const addR = (s, epLabel) => {
                if (!s) return;
                const label = `${site} [${epLabel}${qLabel}] Â· ${s.label || s.host || "Server"}`;
                const sr = new StreamResult({ url: s.url, source: label, headers: { "Referer": mirror.url } });
                if (s.direct) direct.push(sr); else fallback.push(sr);
            };

            if (payload.type === "series" && payload.ep) {
                if (/nexdrive/i.test(hostName(btnUrl))) {
                    const nd = await fetchDetail(btnUrl, mirror.url);
                    const eps = parseNexDriveSeries(nd);
                    const ep = eps.find(e => e.episode === payload.ep);
                    if (ep) for (const link of ep.links) (await resolveDownload(link.url, mirror.url)).forEach(s => addR(s, "S01E" + pad2(payload.ep) + " Â· "));
                } else {
                    (await resolveDownload(btnUrl, mirror.url)).forEach(s => addR(s, "S01E" + pad2(payload.ep) + " Â· "));
                }
            } else {
                (await resolveDownload(btnUrl, mirror.url)).forEach(s => addR(s, ""));
            }
            return direct.concat(fallback);
        } catch (e) {
            console.error("resolveMirror", site, "error:", e && e.message);
            return [];
        }
    }

    async function loadStreams(urlStr, cb) {
        const streams = [];
        const seen = new Set();
        const add = sr => { if (!sr || !sr.url || seen.has(sr.url)) return; seen.add(sr.url); streams.push(sr); };
        try {
            const payload = safeParse(urlStr) || { t: urlStr };
            const mirrorsMap = payload.mirrors || null;
            const results = await Promise.all(MIRRORS.map(m => resolveMirror(m, payload, mirrorsMap)));
            results.forEach(list => list.forEach(add));
            if (streams.length === 0) { cb({ success: true, data: [] }); return; }
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
