// KatMovieHD â€” SkyStream (Sky Gen 2) plugin
// Movies + Web Series (Hindi Dual-Audio), WordPress download site.
//
// Runtime conventions (verified against skystream-cli v1.9.x):
//   - http_get(url, headers) -> { status, body }
//   - parseHtml(html) -> DOM document (querySelector/querySelectorAll)
//   - parse_html(html, selector, attr) -> [{text, attr, innerHTML}]
//   - There is NO global loadExtractor. The published 'skystream-extractors'
//     npm package currently ships with broken internal import paths (its files
//     do `import './core/extractor_api.js'` but core/ is one level up), so it
//     cannot be bundled. Following the reference plugins, the HubCloud extractor
//     is inlined below (ported from skystream-extractors/src/extractors/hub_cloud.ts).
//   - A custom "kmhd.eu" extractor is also inlined: it unlocks the links.kmhd.eu
//     shortener (via the `unlocked=true` cookie), reads the SvelteKit hydration
//     payload, builds the embedded HubCloud URL, and resolves it to real streams.
//     /pack/<id> season packs are expanded into per-episode /file/The_<key> links.
//   - all requests carry a desktop User-Agent
//   - item URLs are JSON-encoded so posters survive across load()/loadStreams()

(function () {
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    };

    const getBaseUrl = () => {
        if (typeof manifest !== "undefined" && manifest.baseUrl) return manifest.baseUrl;
        return "https://new.katmoviehd.top";
    };

    function safeParse(data) {
        if (!data) return null;
        if (typeof data === "object") return data;
        try { return JSON.parse(data); } catch (e) { return null; }
    }

    // Guess movie vs series from KatMovieHD's long post titles.
    function guessType(title) {
        return /\b(season|s\d{1,2}\b|web[\s-]?series|episodes?|tv series)\b/i.test(title || "")
            ? "series" : "movie";
    }

    // Build a MultimediaItem from a listing element (li.post / article).
    function toMedia(el) {
        const lnk = el.querySelector("h2 a") || el.querySelector("a");
        if (!lnk) return null;
        const href = lnk.getAttribute("href");
        if (!href) return null;

        const title =
            (lnk.getAttribute("title") ||
             el.querySelector("h2")?.textContent ||
             lnk.textContent || "Untitled").trim();

        const img = el.querySelector("img");
        const poster =
            img?.getAttribute("data-src") ||
            img?.getAttribute("data-lazy-src") ||
            img?.getAttribute("src") || "";

        return new MultimediaItem({
            title: title,
            url: JSON.stringify({ url: href, poster: poster }),
            posterUrl: poster,
            type: guessType(title)
        });
    }

    function collectItems(doc) {
        const posts = doc.querySelectorAll("li.post, .post, article");
        const items = Array.from(posts).map(toMedia).filter(Boolean);
        const seen = new Set();
        return items.filter(it => {
            if (seen.has(it.url)) return false;
            seen.add(it.url);
            return true;
        });
    }

    /* ------------------------------ getHome ----------------------------- */

    async function getHome(cb) {
        try {
            const baseUrl = getBaseUrl();
            const categories = [
                { path: "/", name: "Latest" },
                { path: "/category/dubbed-movie/", name: "Dubbed Movies" },
                { path: "/category/tv-series-dubbed/", name: "TV Series" },
                { path: "/category/dual-audio/", name: "Dual Audio" },
                { path: "/category/hindi-dubbed/", name: "Hindi Dubbed" }
            ];

            const results = await Promise.all(categories.map(async (cat) => {
                try {
                    const res = await http_get(`${baseUrl}${cat.path}`, headers);
                    if (!res || !res.body) return null;
                    const doc = await parseHtml(res.body);
                    const items = collectItems(doc);
                    if (items.length > 0) return { name: cat.name, items };
                } catch (e) {
                    console.error(`getHome category ${cat.name}: ${e.message}`);
                }
                return null;
            }));

            const data = {};
            results.filter(Boolean).forEach(r => { data[r.name] = r.items; });
            if (data["Latest"]) data["Trending"] = data["Latest"].slice(0, 10);

            if (Object.keys(data).length === 0) {
                return cb({ success: false, errorCode: "NOT_FOUND", message: "No content found" });
            }
            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HTTP_ERROR", message: e.message });
        }
    }

    /* ------------------------------- search ----------------------------- */

    async function search(query, cb) {
        try {
            const baseUrl = getBaseUrl();
            const res = await http_get(`${baseUrl}/?s=${encodeURIComponent(query)}`, headers);
            const doc = await parseHtml(res.body);
            cb({ success: true, data: collectItems(doc) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    /* -------------------------------- load ------------------------------ */

    async function load(urlStr, cb) {
        try {
            const media = safeParse(urlStr) || { url: urlStr };
            const res = await http_get(media.url, headers);
            const doc = await parseHtml(res.body);

            const title =
                doc.querySelector("h1.entry-title")?.textContent?.trim() ||
                doc.querySelector("h1")?.textContent?.trim() ||
                doc.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ||
                "No Title";

            const poster =
                doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
                doc.querySelector(".post-thumbnail img")?.getAttribute("src") ||
                media.poster || "";

            const plot =
                doc.querySelector(".entry-content p")?.textContent?.trim() || "";

            // IMDb score, if present in the info block.
            let score;
            const m = res.body.match(/IMDb Rating[:\-\s]*([\d.]+)/i);
            if (m) score = parseFloat(m[1]);

            const type = guessType(title);

            if (type === "series") {
                const entries = extractDownloadEntries(doc);
                const episodes = entries.map((e, i) => new Episode({
                    name: e.label,
                    url: JSON.stringify({ url: e.url }),
                    posterUrl: poster,
                    season: 1,
                    episode: i + 1
                }));

                return cb({
                    success: true,
                    data: new MultimediaItem({
                        title, posterUrl: poster, description: plot, score,
                        url: JSON.stringify({ url: media.url }),
                        type: "series",
                        episodes
                    })
                });
            }

            cb({
                success: true,
                data: new MultimediaItem({
                    title, posterUrl: poster, description: plot, score,
                    url: JSON.stringify({ url: media.url }),
                    type: "movie"
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    // Collect download anchors (quality label + host URL) from a detail DOM.
    function extractDownloadEntries(doc) {
        const out = [];
        const seen = new Set();
        const anchors = Array.from(doc.querySelectorAll("a[href]"));
        for (const a of anchors) {
            const href = a.getAttribute("href") || "";
            if (!/(hubcloud|links\.kmhd|gdflix|gdtot|filepress)/i.test(href)) continue;
            if (/directlink/i.test(href)) continue;
            const label = (a.textContent || "").trim() || "Download";
            if (/download links|watch online/i.test(label) || label.startsWith(":")) continue;
            if (seen.has(href)) continue;
            seen.add(href);
            out.push({ label, url: href });
        }
        return out;
    }

    /* ----------------------------- loadStreams -------------------------- */

    async function loadStreams(urlInfo, cb) {
        try {
            const media = safeParse(urlInfo) || { url: urlInfo };
            const streams = [];

            // If we were handed a host link directly (e.g. an episode URL).
            if (/^https?:\/\/(?:[\w.-]*hubcloud|links\.kmhd)/i.test(media.url)) {
                await resolveEntry({ label: "", url: media.url }, streams);
            } else {
                const res = await http_get(media.url, headers);
                const doc = await parseHtml(res.body);
                const entries = extractDownloadEntries(doc);
                await Promise.all(entries.map(e => resolveEntry(e, streams)));
            }

            const seen = new Set();
            const finalStreams = streams.filter(s => {
                if (seen.has(s.url)) return false;
                seen.add(s.url);
                return true;
            });

            cb({ success: true, data: finalStreams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    // Inlined HubCloud extractor (ported from skystream-extractors hub_cloud.ts).
    // Resolves a hubcloud "drive" page into direct, PLAYABLE server links.
    // HubCloud exposes several "servers", but only some are directly playable:
    //   - FSL / FSLv2 (cloudflarestorage.com, cdn.fsl-buckets, cdn.*.buzz) = direct .mkv  (KEEP, priority)
    //   - Server:10Gbps (pixel.hubcloud.cx / *.workers.dev)                = often 500/redirect (try, else drop)
    //   - Buzz Server (bzzhr.co)                                           = shortlink page (try to resolve)
    //   - PixelServer (pixeldrain.dev/u/..)                                = frequently dead/decoy (drop unless valid)
    //   - "Download From Telegram" (hubcloud.cx/tg/go)                     = not a video (drop)
    async function hubCloudExtract(url) {
        const results = [];
        const res = await http_get(url, headers);
        if (!res || res.status !== 200) return results;

        let finalBody = res.body;

        // Step 1: follow the "Generate Direct Download Link" button to the final
        // page (usually gamerxyt.com/hubcloud.php) that lists the real servers.
        const dl = await parse_html(res.body, "a#download", "href");
        if (dl && dl.length && dl[0].attr) {
            let nextUrl = dl[0].attr;
            if (nextUrl.startsWith("/")) {
                try { nextUrl = `https://${new URL(url).hostname}${nextUrl}`; } catch (e) {}
            }
            const nextRes = await http_get(nextUrl, { ...headers, Referer: url });
            if (nextRes && nextRes.status === 200) finalBody = nextRes.body;
        }

        // Step 2: read every server link (a.btn) with its label.
        const serverLinks = await parse_html(finalBody, "a.btn", "href");
        const candidates = [];
        for (const link of serverLinks) {
            let href = link.attr;
            const label = (link.text || "").replace(/downl?oad/ig, "").replace(/[\[\]]/g, "").trim();
            if (!href || href.startsWith("/")) continue;
            // Drop known non-playable servers outright.
            if (/winexch|tinyurl|\/tg\/go|t\.me|telegram/i.test(href)) continue;
            candidates.push({ href, label });
        }

        // Step 3: classify + resolve. Direct-file hosts are ranked first.
        const isDirect = (u) =>
            /cloudflarestorage\.com|fsl-buckets|fukggl|\.buzz\/|\/[^?]+\.(mkv|mp4|avi|mov)(\?|$)/i.test(u);

        for (const c of candidates) {
            let finalUrl = c.href;
            let ok = false;

            if (isDirect(finalUrl)) {
                ok = true;                                   // FSL / FSLv2 â€” already a direct file
            } else if (/bzzhr\.co/i.test(finalUrl)) {
                const r = await resolveBuzz(finalUrl);       // Buzz shortlink -> direct file
                if (r) { finalUrl = r; ok = true; }
            } else if (/pixel\.hubcloud|workers\.dev/i.test(finalUrl)) {
                const r = await resolveRedirect(finalUrl);   // 10Gbps -> follow redirect if alive
                if (r && isDirect(r)) { finalUrl = r; ok = true; }
            } else if (/pixeldrain/i.test(finalUrl)) {
                const r = await resolvePixeldrain(finalUrl); // pixeldrain -> /api/file/<id>?download
                if (r) { finalUrl = r; ok = true; }
            }

            if (ok) {
                results.push({
                    url: finalUrl,
                    source: c.label || "HubCloud",
                    _direct: isDirect(finalUrl),
                    headers: { Referer: "https://hubcloud.club", "User-Agent": headers["User-Agent"] }
                });
            }
        }

        // Direct-file servers first (most reliable for the player).
        results.sort((a, b) => (b._direct ? 1 : 0) - (a._direct ? 1 : 0));
        results.forEach(r => { delete r._direct; });
        return results;
    }

    // Resolve a bzzhr.co "Buzz" shortlink page to a direct file URL.
    async function resolveBuzz(url) {
        try {
            const res = await http_get(url, { ...headers, Referer: "https://hubcloud.club" });
            if (!res || !res.body) return null;
            const m = res.body.match(/https?:\/\/[^"'\s]+\.(?:mkv|mp4|avi|mov)[^"'\s]*/i) ||
                      res.body.match(/(?:window\.location(?:\.href)?\s*=\s*|href=)["']([^"']+)["']/i);
            if (m) return m[1] || m[0];
        } catch (e) {}
        return null;
    }

    // Follow a redirecting "server" page (10Gbps) one hop; return final URL if alive.
    async function resolveRedirect(url) {
        try {
            const res = await http_get(url, { ...headers, Referer: "https://hubcloud.club" });
            if (!res) return null;
            const loc = res.headers && (res.headers.location || res.headers.Location);
            if (loc) return loc;
            const m = (res.body || "").match(/https?:\/\/[^"'\s]+\.(?:mkv|mp4)[^"'\s]*/i);
            return m ? m[0] : null;
        } catch (e) { return null; }
    }

    // Convert a pixeldrain view URL to its direct download endpoint (validate first).
    async function resolvePixeldrain(url) {
        try {
            const id = (url.match(/pixeldrain\.\w+\/u\/([A-Za-z0-9]+)/) || [])[1];
            if (!id) return null;
            // Validate the file exists (many hubcloud pixeldrain links are decoys/404).
            const info = await http_get(`https://pixeldrain.com/api/file/${id}/info`, headers);
            if (!info || info.status !== 200 || /"success"\s*:\s*false/.test(info.body || "")) return null;
            return `https://pixeldrain.com/api/file/${id}?download`;
        } catch (e) { return null; }
    }

    /* --------------------- kmhd.eu shortener extractor ------------------ */
    // links.kmhd.eu serves a SvelteKit app. A /file/<id> page is gated behind an
    // `unlocked=true` cookie; once set, its hydration payload embeds `upload_links`
    // (per-host IDs) + `links` (host URL prefixes). We build the HubCloud URL and
    // resolve it. A /pack/<id> page lists episodes as `info: { The_<key>: {name} }`,
    // each of which maps to /file/The_<key>.

    const KMHD_COOKIE = { ...headers, Cookie: "unlocked=true" };

    // Extract a JS-object string value: key:"value"
    function jsStr(body, key) {
        const m = body.match(new RegExp(key + ':"([^"]*)"'));
        return m ? m[1] : null;
    }

    // Resolve a single links.kmhd.eu /file/<id> page -> stream results.
    async function kmhdResolveFile(fileUrl, streams, labelQuality) {
        const res = await http_get(fileUrl, KMHD_COOKIE);
        if (!res || !res.body) return;
        const body = res.body;

        // Prefer the embedded HubCloud (hubdrive) link â€” we can resolve it fully.
        const hubId = jsStr(body, "hubdrive_res");
        const hubPrefixM = body.match(/hubdrive_res:\{[^}]*?link:"([^"]+)"/);
        if (hubId && hubId !== "None" && hubPrefixM) {
            const hubUrl = hubPrefixM[1].replace(/\/$/, "") + "/" + hubId;
            const links = await hubCloudExtract(hubUrl);
            for (const l of links) {
                streams.push(new StreamResult({
                    url: l.url,
                    source: (l.source || "HubCloud") + (labelQuality ? ` [${labelQuality}]` : ""),
                    headers: l.headers
                }));
            }
            if (links.length) return;
        }

        // Fallback: surface other host mirrors (gdflix, 1fichier, etc.) as links.
        const name = jsStr(body, "name") || "kmhd";
        const hostKeys = ["gdflix_res", "katdrive_res", "fichier_res", "sendcm_res", "ffast_res"];
        for (const key of hostKeys) {
            const id = jsStr(body, key);
            const prefixM = body.match(new RegExp(key + ':\\{[^}]*?link:"([^"]+)"'));
            if (id && id !== "None" && prefixM) {
                const full = prefixM[1].replace(/\/$/, "") + "/" + id.replace(/^\//, "");
                streams.push(new StreamResult({
                    url: full,
                    source: key.replace("_res", "") + (labelQuality ? ` [${labelQuality}]` : "")
                }));
            }
        }
    }

    // Resolve a links.kmhd.eu URL (file OR pack) into streams.
    async function kmhdResolve(url, streams, labelQuality) {
        // /pack/<id> -> expand into per-episode /file/The_<key> then resolve each.
        if (/\/pack\//i.test(url)) {
            const res = await http_get(url, KMHD_COOKIE);
            if (!res || !res.body) return;
            const keys = [];
            const re = /(The_[0-9a-f]+):\{name:"/g;
            let m;
            while ((m = re.exec(res.body)) !== null) keys.push(m[1]);
            const origin = url.replace(/(https?:\/\/[^/]+).*/, "$1");
            // Resolve each episode file (sequentially to be gentle on the host).
            for (const k of keys) {
                try {
                    await kmhdResolveFile(`${origin}/file/${k}`, streams, labelQuality);
                } catch (e) {
                    console.error(`kmhd pack episode ${k}: ${e.message}`);
                }
            }
            return;
        }

        // /file/<id> (may 302 to /locked first; the cookie lets it through).
        await kmhdResolveFile(url, streams, labelQuality);
    }

    async function resolveEntry(entry, streams) {
        const qMatch = entry.label.match(/(2160p|1080p|720p|480p|4k)/i);
        const quality = qMatch ? qMatch[1] : undefined;
        try {
            if (/links\.kmhd/i.test(entry.url)) {
                // Custom kmhd.eu shortener -> unlock + resolve to real streams.
                const before = streams.length;
                await kmhdResolve(entry.url, streams, quality);
                if (streams.length === before) {
                    streams.push(new StreamResult({
                        url: entry.url,
                        source: (entry.label || "kmhd") + (quality ? ` [${quality}]` : "")
                    }));
                }
            } else if (/hubcloud/i.test(entry.url)) {
                // Resolve the HubCloud "drive" page into real download links.
                const links = await hubCloudExtract(entry.url);
                if (Array.isArray(links) && links.length) {
                    for (const l of links) {
                        streams.push(new StreamResult({
                            url: l.url,
                            source: (l.source || "HubCloud") + (quality ? ` [${quality}]` : ""),
                            headers: l.headers
                        }));
                    }
                } else {
                    // Extractor returned nothing -> keep the raw page as a fallback.
                    streams.push(new StreamResult({
                        url: entry.url,
                        source: "HubCloud" + (quality ? ` [${quality}]` : "")
                    }));
                }
            } else {
                // Shortener / unsupported host -> surface as external link.
                streams.push(new StreamResult({
                    url: entry.url,
                    source: (entry.label || "External")
                }));
            }
        } catch (e) {
            console.error(`resolveEntry ${entry.url}: ${e.message}`);
            streams.push(new StreamResult({ url: entry.url, source: "External" }));
        }
    }

    // Export to global scope
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
