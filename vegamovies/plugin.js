(function() {
    /**
     * VegaMovies â€” SkyStream plugin (Sky Gen 2)
     * ---------------------------------------------------------------
     * Aggregates ALL four Vegamovies mirror domains automatically into
     * ONE provider. No domain selector â€” every title pulls servers and
     * mirrors from every site and merges them.
     *
     *   https://vegamoviez.lol   (WordPress)
     *   https://vegamoviess.fun  (DLE)
     *   https://vega-ts.com      (DLE)
     *   https://vegamovie.me     (DLE)
     *
     * Architecture:
     *   - getHome / search : query ALL mirrors in parallel, merge + dedupe.
     *   - load             : details from the card's own mirror, discover
     *                        the matching page on every mirror (cached in
     *                        the item so loadStreams is fast).
     *   - loadStreams      : fetch each mirror's detail + its NexDrive
     *                        aggregator page IN PARALLEL, merge host
     *                        servers, de-duplicate identical files.
     *
     * Movies : each quality (480p/720p/1080p...) -> NexDrive page -> host
     *          mirrors (fast-dl, VGMLinks, V-Cloud, Filepress, GDToT,
     *          DropGalaxy, ...).
     * Series : quality pack -> NexDrive page that lists every episode,
     *          each episode with the same host mirrors.
     *
     * Anti-bot:
     *   - /go?url= redirector decoded client-side (never hit).
     *   - Ads/trackers filtered (winexch, tinyurl, a-ads, ...).
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

    const BLOCKED_HOSTS = /(winexch|tinyurl|a-ads|nexdrive\.vip\/img|\.css$|\.js$|telegram|googleapis|cloudflare|fonts\.|google\.com\/imgres|sharethis|platform-cdn)/i;
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

    function engineOf(url) {
        return /vegamoviez\.lol/i.test(url) ? "wp" : "dle";
    }

    function slugify(title) {
        return String(title || "").toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/[-\s]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

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

    function hostName(u) {
        const m = /^https?:\/\/([^\/]+)/i.exec(u || "");
        return m ? m[1].replace(/^www\./, "") : "host";
    }

    /* ------------------------------------------------------------------ *
     *  Card parsing (home / search) â€” shared by all 4 mirrors
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
            items.push({ title, href, poster, type: detectType(title, href) });
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

    function parseGroups(html, engine) {
        return engine === "wp" ? parseWPGroups(html) : parseDLEGroups(html);
    }

    function decodeGo(href) {
        const m = /[?&]url=([^&]+)/i.exec(href || "");
        if (!m) return "";
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }

    /* ------------------------------------------------------------------ *
     *  NexDrive aggregator-page parsing
     * ------------------------------------------------------------------ */

    function collectHostLinks(chunk) {
        const links = [];
        const re = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(chunk)) !== null) {
            const u = m[1];
            if (BLOCKED_HOSTS.test(u)) continue;
            if (!HOST_RE.test(u) && !/\.(mp4|m3u8|mkv)(\?|$)/i.test(u)) continue;
            const label = stripTags(m[2]) || hostName(u);
            links.push({ url: u, label, host: hostName(u) });
        }
        return links;
    }

    // Movie: NexDrive page = single file with several host mirrors.
    function parseNexDriveMovie(html) {
        return collectHostLinks(html);
    }

    // Series: NexDrive page = per-episode sections with host mirrors.
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

    // A quality group's button URL points to a NexDrive page.
    function nexDriveOf(group) {
        const btn = group && group.buttons && group.buttons[0];
        return btn ? btn.url : "";
    }

    /* ------------------------------------------------------------------ *
     *  Title matching (find same title on another mirror)
     * ------------------------------------------------------------------ */

    const JUNK_TOKENS = /^(hindi|english|tamil|telugu|kannada|malayalam|marathi|punjabi|korean|tagalog|multi|audio|line|v[0-9]|hq|hd|hdtc|webdl|web|dl|dubbed|dual|480p|720p|1080p|2160p|4k|hdrip|x264|x265|hevc|brrip|dvdrip|full|movie|season|complete|download|quality|clean|org|1gb|300mb|100mb|all|episodes|added|202[0-9]|19[0-9]{2})$/i;

    function coreWords(title) {
        return String(title || "").toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(w => w && w.length > 1 && !JUNK_TOKENS.test(w));
    }

    function matchScore(candTitle, queryTitle) {
        const qc = coreWords(queryTitle).slice(0, 8);
        const cc = coreWords(candTitle).slice(0, 8);
        if (qc.length === 0) return 0;
        let shared = 0;
        for (const w of qc) if (cc.includes(w)) shared++;
        // require at least 2 significant shared words
        return shared >= 2 ? shared : 0;
    }

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

    // Discover the detail URL on every mirror (parallel) â€” cached in item.
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
     *  getHome  â€” aggregate ALL mirrors
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
                    const key = slugify(c.title);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    merged.push({ ...c, src });
                }
            });

            const items = merged.slice(0, 60).map(c => new MultimediaItem({
                title: c.title,
                url: JSON.stringify({ t: c.title, h: c.href, p: c.poster, k: c.type, src: c.src }),
                posterUrl: c.poster,
                type: c.type
            }));

            cb({ success: true, data: { Trending: items, Latest: items.slice(0, 20) } });
        } catch (e) {
            console.error("getHome error:", e);
            cb({ success: false, errorCode: "HTTP_ERROR", message: e && e.message });
        }
    }

    /* ------------------------------------------------------------------ *
     *  search  â€” aggregate ALL mirrors
     * ------------------------------------------------------------------ */

    async function search(query, cb) {
        try {
            const results = await Promise.all(MIRRORS.map(m => searchCards(m.url, query)));
            const merged = [];
            const seen = new Set();
            results.forEach((cards, i) => {
                const src = MIRRORS[i].url;
                for (const c of cards) {
                    const key = slugify(c.title);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    merged.push({ ...c, src });
                }
            });
            const items = merged.map(c => new MultimediaItem({
                title: c.title,
                url: JSON.stringify({ t: c.title, h: c.href, p: c.poster, k: c.type, src: c.src }),
                posterUrl: c.poster,
                type: c.type
            }));
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e && e.message });
        }
    }

    /* ------------------------------------------------------------------ *
     *  load  â€” details + TV series episodes
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
            // Fallback: if origin fetch failed or empty, search for the post.
            if (!body || /just a moment/i.test(body)) {
                const post = await findPost(src, payload.t);
                if (post) { detailUrl = post.href; engine = engineOf(detailUrl); body = await fetchDetail(detailUrl, src); }
            }
            if (!body || /just a moment/i.test(body)) {
                cb({ success: false, errorCode: "BLOCKED", message: "All mirrors blocked for " + (payload.t || detailUrl) });
                return;
            }

            // Title / poster / description / year
            let title = "";
            const h1 = /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(body)
                     || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body);
            if (h1) title = stripTags(h1[1]);
            if (!title) { const og = /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i.exec(body); if (og) title = unescapeHTML(og[1]); }
            if (!title) title = payload.t || "Title";
            title = title.replace(/\s*\|.*$/i, "").replace(/\s*-\s*(Vegamovies|Vegamovise).*$/i, "").trim();

            let poster = payload.p || "";
            if (!poster) {
                const og = /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i.exec(body);
                poster = og ? og[1] : (/(?:class="blog-picture[^"]*"[^>]*src|id="news-id"[^>]*)[="]+([^"\s>]+)/i.exec(body) || [])[1] || "";
            }
            poster = absUrl(poster, src);

            let description = "";
            const dsc = /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i.exec(body);
            if (dsc) description = unescapeHTML(dsc[1]);

            let year = null;
            const ym = title.match(/(19|20)\d{2}/);
            if (ym) year = parseInt(ym[0], 10);

            const type = payload.k || detectType(title, detailUrl);
            // Keep only groups that actually carry a download button.
            const groups = parseGroups(body, engine).filter(g => g.buttons && g.buttons.length > 0);
            const slug = slugify(title);

            // Discover matching pages on the other mirrors (cached for loadStreams).
            let mirrorsMap = {};
            try { mirrorsMap = await discoverMirrorMap(src, title, detailUrl); } catch (e) { mirrorsMap = { [src]: detailUrl }; }

            const common = { title, slug, poster, src, mirrors: mirrorsMap, detailUrl };
            const episodes = [];

            if (type === "series") {
                // Build real episodes: probe each quality pack's NexDrive page
                // until one that lists individual episodes is found.
                let epList = [];
                let chosenQ = null;
                for (const g of groups) {
                    const ndUrl = nexDriveOf(g);
                    if (!ndUrl) continue;
                    try {
                        const nd = await fetchDetail(ndUrl, src);
                        const eps = parseNexDriveSeries(nd);
                        if (eps.length) { epList = eps; chosenQ = g.quality; break; }
                    } catch (e) { /* try next */ }
                }
                if (epList.length === 0) {
                    // Fallback: one quality-pack episode per group.
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
                            name: "S01E" + String(ep.episode).padStart(2, "0"),
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

            const item = new MultimediaItem({
                title: title,
                url: JSON.stringify(common),
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
     *  loadStreams  â€” aggregate servers from ALL mirrors, in parallel
     * ------------------------------------------------------------------ */

    // Resolve servers for a single mirror.
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

            const groups = parseGroups(body, engineOf(detailUrl)).filter(g => g.buttons && g.buttons.length > 0);
            // Select group matching requested quality, else first.
            let group = null;
            if (payload.q) {
                group = groups.find(g => g.quality && extractQuality(g.quality) === payload.q);
            }
            if (!group) group = groups[0];
            if (!group) return [];

            const ndUrl = nexDriveOf(group);
            if (!ndUrl) return [];

            const nd = await fetchDetail(ndUrl, mirror.url);
            if (!nd || /just a moment/i.test(nd)) return [];

            const qLabel = group.quality || payload.q || "Auto";
            const out = [];

            if (payload.type === "series" && payload.ep) {
                const eps = parseNexDriveSeries(nd);
                const ep = eps.find(e => e.episode === payload.ep);
                if (ep) {
                    for (const link of ep.links) {
                        out.push(new StreamResult({
                            url: link.url,
                            source: `${site} [S01E${String(payload.ep).padStart(2, "0")} Â· ${qLabel}] Â· ${link.label || link.host || "Server"}`,
                            headers: { "Referer": mirror.url }
                        }));
                    }
                }
            } else {
                const links = parseNexDriveMovie(nd);
                for (const link of links) {
                    out.push(new StreamResult({
                        url: link.url,
                        source: `${site} [${qLabel}] Â· ${link.label || link.host || "Server"}`,
                        headers: { "Referer": mirror.url }
                    }));
                }
            }
            return out;
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

            // All mirrors resolved in parallel.
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
