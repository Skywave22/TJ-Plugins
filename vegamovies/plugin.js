(function () {
    // ═══════════════════════════════════════════════════════════════
    //  VegaMovies - Unified SkyStream Plugin
    //  Combines 4 VegaMovies sites into one plugin
    //  Sites: vegamoviez.lol, vegamoviess.fun, vega-ts.com, vegamovie.me
    // ═══════════════════════════════════════════════════════════════

    const Headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };

    const TMDB_API = "https://api.themoviedb.org/3";
    const TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
    const TMDB_ORIG = "https://image.tmdb.org/t/p/original";

    // All 4 source sites
    const SITES = [
        { name: "NL",   base: "https://vegamoviez.lol",  type: "wordpress" },
        { name: "Fun",  base: "https://vegamoviess.fun", type: "dle" },
        { name: "TS",   base: "https://vega-ts.com",     type: "dle" },
        { name: "Me",   base: "https://vegamovie.me",     type: "dle" }
    ];

    // Nexdrive redirector domains per DLE site
    const NEXDRIVE_DOMAINS = ["nexdrive.you", "nexdrive.help", "nexdrive.click", "nexdrive.link"];

    // ── Utility Functions ────────────────────────────────────────

    function clean(text) {
        if (!text) return "";
        return String(text)
            .replace(/<[^>]*>/g, " ")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
            .replace(/&#x27;/g, "'").replace(/&#x2F;/g, "/").replace(/&nbsp;/g, " ")
            .replace(/&#\d+;/g, m => { const c = parseInt(m.slice(2, -1)); return isNaN(c) ? m : String.fromCharCode(c); })
            .replace(/\s+/g, " ").trim();
    }

    function fixUrl(url, base) {
        if (!url) return "";
        url = url.trim();
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return (base || "") + url;
        return url;
    }

    function normTitle(t) {
        return clean(t).toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function parseQuality(text) {
        const s = clean(text).toLowerCase();
        if (s.includes("2160") || s.includes("4k") || s.includes("uhd")) return 2160;
        const m = s.match(/\b(1440|1080|720|576|480|360)p?\b/);
        return m ? parseInt(m[1]) : 0;
    }

    function qualityLabel(q) {
        return q > 0 ? q + "p" : "Unknown";
    }

    function isSeries(title) {
        const t = clean(title).toLowerCase();
        return /\b(season|s\d+|episode|ep\s*\d+|web\s*series)\b/.test(t) ||
               /\b(complete|all\s*episodes)\b/.test(t);
    }

    function isAdult(title) {
        return /\[18\+\]|\b18\+|adult|erotic|brazzers/.test(clean(title).toLowerCase());
    }

    function safeParse(str) {
        try { return JSON.parse(str); } catch { return null; }
    }

    // ── HTML Parser (regex-based, lightweight) ───────────────────

    function extractLinks(html, pattern) {
        const results = [];
        const re = new RegExp(pattern, "gi");
        let m;
        while ((m = re.exec(html)) !== null) results.push(m[1] || m[0]);
        return results;
    }

    function extractAllHrefs(html, base) {
        const links = [];
        const re = /href=["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const url = fixUrl(m[1], base);
            if (url && url.startsWith("http")) links.push(url);
        }
        return links;
    }

    // ── Site-Specific Parsers ────────────────────────────────────

    // Parse WordPress site (vegamoviez.lol) home/search cards
    function parseWPHome(html, baseUrl) {
        const items = [];
        // Match <a href="..." ...> blocks with movie cards
        const cardRe = /<a[^>]*href=["']([^"'#]+)["'][^>]*>[\s\S]*?<\/a>/gi;
        const seen = new Set();
        let m;
        while ((m = cardRe.exec(html)) !== null) {
            const block = m[0];
            const href = fixUrl(m[1], baseUrl);
            if (!href || seen.has(href) || !href.startsWith(baseUrl)) continue;
            if (href.includes("/category/") || href.includes("/tag/") || href.includes("/genre/") ||
                href.includes("/page/") || href.includes("/about") || href.includes("/contact") ||
                href.includes("/privacy") || href.includes("/dmca") || href.includes("/disclaimer")) continue;

            // Extract image
            const imgMatch = block.match(/<img[^>]*(?:data-src|src)=["']([^"']+)["']/i);
            const poster = imgMatch ? fixUrl(imgMatch[1], baseUrl) : "";
            if (!poster || poster.includes("logo") || poster.includes("icon")) continue;

            // Extract title from alt attribute or inner text
            const altMatch = block.match(/alt=["']([^"']+)["']/i);
            let title = altMatch ? clean(altMatch[1]) : "";
            if (!title) {
                const h3Match = block.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i);
                title = h3Match ? clean(h3Match[1]) : "";
            }
            if (!title || title.length < 3) continue;

            seen.add(href);
            items.push(new MultimediaItem({
                title,
                url: JSON.stringify({ url: href, source: "NL", title: title }),
                posterUrl: poster,
                type: isSeries(title) ? "series" : "movie",
                isAdult: isAdult(title)
            }));
        }
        return items;
    }

    // Parse DLE site (vegamoviess.fun, vega-ts.com, vegamovie.me) home/search cards
    function parseDLEHome(html, baseUrl) {
        const items = [];
        const seen = new Set();

        // DLE pattern: <a href="..."><img ... src="..." ...><h3>title</h3></a>
        // or article blocks
        const cardRe = /<a[^>]*href=["']([^"']+\.html)["'][^>]*>[\s\S]*?<\/a>/gi;
        let m;
        while ((m = cardRe.exec(html)) !== null) {
            const block = m[0];
            const href = fixUrl(m[1], baseUrl);
            if (!href || seen.has(href)) continue;
            if (!/\/\d+-.+\.html$/.test(href)) continue;

            // Extract image
            const imgMatch = block.match(/<img[^>]*(?:data-src|src)=["']([^"']+)["']/i);
            const poster = imgMatch ? fixUrl(imgMatch[1], baseUrl) : "";
            if (!poster || poster.includes("logo") || poster.includes("icon")) continue;

            // Extract title from alt or h3
            const altMatch = block.match(/alt=["']([^"']+)["']/i);
            let title = altMatch ? clean(altMatch[1]) : "";
            if (!title) {
                const h3Match = block.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i);
                title = h3Match ? clean(h3Match[1]) : "";
            }
            // Remove quality tags like "| Hindi Dubbed Movie" from DLE titles
            title = title.replace(/\s*\|[^|]*$/i, "").replace(/\s*~\s*[^~]*$/i, "").trim();
            if (!title || title.length < 3) continue;

            seen.add(href);
            items.push(new MultimediaItem({
                title,
                url: JSON.stringify({ url: href, source: baseUrl.includes("vegamoviess") ? "Fun" : baseUrl.includes("vega-ts") ? "TS" : "Me", title: title }),
                posterUrl: poster,
                type: isSeries(title) ? "series" : "movie",
                isAdult: isAdult(title)
            }));
        }
        return items;
    }

    // ── Fetch helpers ────────────────────────────────────────────

    async function fetchPage(url) {
        try {
            const res = await http_get(url, Headers);
            return res && res.body ? res.body : "";
        } catch {
            return "";
        }
    }

    async function fetchMany(requests) {
        if (typeof http_parallel === "function") {
            try {
                const responses = await http_parallel(requests.map(r => ({ url: r.url, headers: r.headers || Headers })));
                return responses.map((res, i) => ({
                    body: (res && res.body) ? res.body : "",
                    meta: requests[i].meta
                }));
            } catch (e) { /* fallback */ }
        }
        return Promise.all(requests.map(async (r) => {
            try {
                const res = await http_get(r.url, r.headers || Headers);
                return { body: (res && res.body) ? res.body : "", meta: r.meta };
            } catch {
                return { body: "", meta: r.meta };
            }
        }));
    }

    // ── Download Link Extraction ─────────────────────────────────

    // Extract download links from WordPress site (vegamoviez.lol)
    function extractWPDownloads(html, baseUrl) {
        const links = [];
        const seen = new Set();

        // Pattern 1: Split by quality headers (h3, h4, h5 with quality info)
        const sections = html.split(/(?=<h[2-5][^>]*>)/i);
        for (const section of sections) {
            const qualMatch = section.match(/<h[2-5][^>]*>([^<]*(?:\d+p|480|720|1080|2160)[^<]*)<\/h[2-5]>/i);
            const quality = qualMatch ? parseQuality(qualMatch[1]) : 0;
            const sizeMatch = section.match(/\[([^\]]*(?:MB|GB)[^\]]*)\]/i);
            const size = sizeMatch ? clean(sizeMatch[1]) : "";

            // Match links with /go?url= wrapper
            const goRe = /href=["']([^"']*\/go\?url=([^"'&]+))[^"']*["'][^>]*>([^<]*)<\/a>/gi;
            let m;
            while ((m = goRe.exec(section)) !== null) {
                const href = decodeURIComponent(m[2]);
                const label = clean(m[3]);

                if (!href || seen.has(href)) continue;
                if (/telegram|facebook|twitter|join|about|contact/i.test(href + label)) continue;
                seen.add(href);

                const source = href.includes("hubcloud") ? "HubCloud" :
                              href.includes("gdflix") ? "GDFlix" :
                              href.includes("drive.google") ? "GDrive" :
                              label || "Direct";

                links.push({
                    url: href,
                    source: source,
                    quality: quality,
                    size: size
                });
            }

            // Also match direct links (non /go?url= wrapper)
            const directRe = /href=["'](https?:\/\/(?:hubcloud|gdflix|drive\.google)[^"']+)["'][^>]*>([^<]*)<\/a>/gi;
            while ((m = directRe.exec(section)) !== null) {
                const href = m[1];
                const label = clean(m[2]);
                if (!href || seen.has(href)) continue;
                seen.add(href);

                links.push({
                    url: href,
                    source: href.includes("hubcloud") ? "HubCloud" : href.includes("gdflix") ? "GDFlix" : "GDrive",
                    quality: quality,
                    size: size
                });
            }
        }

        // Fallback: scan entire page for hubcloud/gdflix URLs
        if (links.length === 0) {
            const fallbackRe = /https?:\/\/(?:hubcloud\.\w+\/drive\/[a-z0-9]+|gdflix\.dev\/file\/[a-zA-Z0-9]+)/gi;
            let m;
            while ((m = fallbackRe.exec(html)) !== null) {
                if (!seen.has(m[0])) {
                    seen.add(m[0]);
                    links.push({
                        url: m[0],
                        source: m[0].includes("hubcloud") ? "HubCloud" : "GDFlix",
                        quality: parseQuality(m[0]),
                        size: ""
                    });
                }
            }
        }

        // Also extract any /go?url= links that weren't in quality sections
        if (links.length === 0) {
            const goRe = /\/go\?url=(https?(?:%3A%2F%2F|:\/\/)[^"'\s&]+)/gi;
            let m;
            while ((m = goRe.exec(html)) !== null) {
                const href = decodeURIComponent(m[1]);
                if (!href || seen.has(href)) continue;
                if (!/hubcloud|gdflix|drive\.google/i.test(href)) continue;
                seen.add(href);
                links.push({
                    url: href,
                    source: href.includes("hubcloud") ? "HubCloud" : href.includes("gdflix") ? "GDFlix" : "GDrive",
                    quality: 0,
                    size: ""
                });
            }
        }

        return links;
    }

    // Extract download links from DLE sites
    function extractDLEDownloads(html, baseUrl) {
        const links = [];
        const seen = new Set();

        // Simple approach: find ALL nexdrive/download URLs and extract quality from surrounding text
        const allUrlRe = /href=["'](https?:\/\/[^"']+)["']/gi;
        let m;
        while ((m = allUrlRe.exec(html)) !== null) {
            const href = m[1];
            if (!href) continue;

            // Only keep download-related domains
            const isDownloadLink = NEXDRIVE_DOMAINS.some(d => href.includes(d)) ||
                href.includes("fast-dl") || href.includes("vgmlinks") ||
                href.includes("hubcloud") || href.includes("gdflix") ||
                href.includes("drive.google") || href.includes("pixeldrain");

            if (!isDownloadLink) continue;
            if (seen.has(href)) continue;
            seen.add(href);

            // Determine source
            let source = "Direct";
            if (NEXDRIVE_DOMAINS.some(d => href.includes(d))) source = "NexDrive";
            else if (href.includes("fast-dl")) source = "FastDL";
            else if (href.includes("vgmlinks")) source = "VGMLinks";
            else if (href.includes("hubcloud")) source = "HubCloud";
            else if (href.includes("gdflix")) source = "GDFlix";

            // Find quality from surrounding context - use smaller window and match nearest heading
            const beforeText = html.substring(Math.max(0, m.index - 300), m.index);
            const afterText = html.substring(m.index, Math.min(html.length, m.index + 200));
            
            // Look for quality in heading tags before the link
            const headingQual = beforeText.match(/<h[2-6][^>]*>[^<]*(?:<[^>]*>)*[^<]*?(\d{3,4})p[^<]*<\/h[2-6]>/i);
            let quality = headingQual ? parseInt(headingQual[1]) : 0;
            if (!quality) quality = parseQuality(beforeText.split(/<h[2-6]/i).pop() + " " + afterText);

            const sizeMatch = (beforeText.substring(beforeText.lastIndexOf("[")) + afterText).match(/\[([^\]]*(?:MB|GB)[^\]]*)\]/i);
            const size = sizeMatch ? clean(sizeMatch[1]) : "";

            links.push({
                url: href,
                source: source,
                quality: quality,
                size: size
            });
        }

        return links;
    }

    // ── NexDrive Redirector Resolver ─────────────────────────────

    async function resolveNexDrive(url) {
        try {
            const html = await fetchPage(url);
            if (!html) return [];

            // Extract download buttons: <a href="..."><button>...</button></a>
            const results = [];
            const re = /<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*target=["']_blank["'][^>]*>/gi;
            let m;
            while ((m = re.exec(html)) !== null) {
                const href = m[1];
                if (!href) continue;
                // Skip telegram, social, etc.
                if (/telegram|t\.me|tinyurl|facebook|twitter|join/i.test(href)) continue;

                let source = "Direct";
                if (href.includes("fast-dl")) source = "FastDL";
                else if (href.includes("vgmlinks")) source = "VGMLinks";
                else if (href.includes("hubcloud")) source = "HubCloud";
                else if (href.includes("gdflix")) source = "GDFlix";

                results.push({ url: href, source });
            }

            // Also extract any hubcloud/gdflix links
            const directRe = /https?:\/\/(?:hubcloud\.\w+\/drive\/[a-z0-9]+|gdflix\.dev\/file\/[a-zA-Z0-9]+)/gi;
            let dm;
            while ((dm = directRe.exec(html)) !== null) {
                if (!results.some(r => r.url === dm[0])) {
                    results.push({
                        url: dm[0],
                        source: dm[0].includes("hubcloud") ? "HubCloud" : "GDFlix"
                    });
                }
            }

            return results;
        } catch {
            return [];
        }
    }

    // ── FastDL / VGMLinks Resolver ──────────────────────────────

    async function resolveFastDL(url) {
        try {
            // Strategy 1: Try GET first to check for direct links
            const res = await http_get(url, Headers);
            if (!res || !res.body) return [];

            let html = res.body;
            let results = extractDownloadUrls(html);

            // Strategy 2: If no direct links, try POST (form submission)
            if (results.length === 0) {
                const formAction = html.match(/<form[^>]*method=["']POST["'][^>]*action=["']([^"']+)["']/i);
                const postUrl = formAction ? fixUrl(formAction[1], url) : url;

                const postRes = await http_get(postUrl, { ...Headers, "Referer": url, "X-Requested-With": "XMLHttpRequest" });
                if (postRes && postRes.body) {
                    html = postRes.body;
                    results = extractDownloadUrls(html);
                }
            }

            // Strategy 3: Look for id="vd" link (fast-dl.one pattern)
            if (results.length === 0) {
                const vdMatch = html.match(/id=["']vd["'][^>]*href=["'](https?:\/\/[^"']+)["']/i);
                if (vdMatch) {
                    results.push({ url: vdMatch[1], source: "FastDL" });
                }
            }

            return results;
        } catch {
            return [];
        }
    }

    function extractDownloadUrls(html) {
        const results = [];
        const seen = new Set();

        // Pattern 1: id="vd" with href (fast-dl.one pattern)
        const vdMatch = html.match(/id=["']vd["'][^>]*href=["'](https?:\/\/[^"']+)["']/i);
        if (vdMatch && vdMatch[1]) {
            results.push({ url: vdMatch[1], source: "GDrive" });
            seen.add(vdMatch[1]);
        }

        // Pattern 2: Direct hubcloud/gdflix/drive.google URLs
        const directRe = /https?:\/\/(?:hubcloud\.\w+\/drive\/[a-z0-9]+|gdflix\.dev\/file\/[a-zA-Z0-9]+|video-downloads\.googleusercontent\.com\/[^\s"']+|drive\.google\.com\/[^\s"']+)/gi;
        let m;
        while ((m = directRe.exec(html)) !== null) {
            if (!seen.has(m[0])) {
                seen.add(m[0]);
                results.push({
                    url: m[0],
                    source: m[0].includes("hubcloud") ? "HubCloud" :
                           m[0].includes("gdflix") ? "GDFlix" :
                           m[0].includes("google") ? "GDrive" : "Direct"
                });
            }
        }

        // Pattern 3: Download buttons with specific classes
        const btnRe = /href=["'](https?:\/\/[^"']+)["'][^>]*class=["'][^"']*(?:btn-dl|download|dl-btn)[^"']*["']/gi;
        while ((m = btnRe.exec(html)) !== null) {
            if (!seen.has(m[1]) && !/telegram|t\.me|tinyurl|facebook/i.test(m[1])) {
                seen.add(m[1]);
                results.push({ url: m[1], source: "Direct" });
            }
        }

        return results;
    }

    // ── HubCloud Resolver using loadExtractor ─────────────────────

    async function resolveHubCloud(url) {
        try {
            // Strategy 1: Use built-in loadExtractor if available
            if (typeof loadExtractor === "function") {
                const streams = [];
                try {
                    await loadExtractor(url, streams);
                    if (streams.length > 0) return streams.map(s => ({
                        url: s.url || s,
                        source: "HubCloud",
                        quality: s.quality || 0
                    }));
                } catch (e) { /* fallback */ }
            }

            // Strategy 2: Manual resolution
            let currentUrl = url.replace("hubcloud.ink", "hubcloud.dad");
            const hdrs = { ...Headers, "Cookie": "xla=s4t", "Referer": currentUrl };
            const res = await http_get(currentUrl, hdrs);
            if (!res || !res.body) return [];

            let html = res.body;
            let finalUrl = currentUrl;

            // Step 1: Find download button
            if (!currentUrl.includes("hubcloud.php")) {
                const dlMatch = html.match(/<a[^>]*id=["']download["'][^>]*href=["']([^"']+)["']/i);
                const scriptMatch = html.match(/var url = ['"]([^'"]+)['"]/);
                let nextHref = dlMatch ? dlMatch[1] : (scriptMatch ? scriptMatch[1] : "");

                if (nextHref) {
                    nextHref = fixUrl(nextHref, currentUrl);
                    finalUrl = nextHref;
                    const res2 = await http_get(finalUrl, { ...Headers, "Cookie": "xla=s4t", "Referer": currentUrl });
                    if (res2 && res2.body) html = res2.body;
                }
            }

            // Step 2: Extract download buttons from final page
            return extractHubCloudButtons(html, finalUrl);
        } catch {
            return [];
        }
    }

    function extractHubCloudButtons(html, baseUrl) {
        const results = [];
        const seen = new Set();

        // Look for button links with download-related classes/text
        const btnRe = /href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = btnRe.exec(html)) !== null) {
            const href = fixUrl(m[1], baseUrl || "");
            const label = clean(m[2]);

            if (!href || !href.startsWith("http")) continue;
            // Skip non-download links
            if (/telegram|facebook|twitter|tinyurl|tutorial|logout|login|winexch/i.test(href + label)) continue;
            // Only keep download-related
            if (!/hubcdn|hubcloud|hubdrive|pixeldrain|pixel|download|fsl|buzz|mega|gpdl|odyssey/i.test(href + label)) continue;

            if (seen.has(href)) continue;
            seen.add(href);

            let source = "HubCloud";
            if (/fsl/i.test(label)) source = "HubCloud [FSL]";
            else if (/s3/i.test(label)) source = "HubCloud [S3]";
            else if (/mega/i.test(label)) source = "HubCloud [Mega]";
            else if (/pixel/i.test(label)) source = "PixelDrain";
            else if (/buzz/i.test(label)) source = "BuzzServer";

            // Fix PixelDrain URLs
            let finalUrl = href;
            if (/pixel/i.test(label) && !/api\/file|download/i.test(finalUrl)) {
                const pid = (finalUrl.match(/\/(?:u|file)\/([^/?#]+)/i) || [])[1];
                if (pid) finalUrl = `https://pixeldrain.com/api/file/${pid}?download`;
            }

            results.push({ url: finalUrl, source });
        }

        // Fallback: regex for direct download URLs
        if (results.length === 0) {
            const dlRe = /https?:\/\/(?:hubcdn\.\w+\/[^\s"']+|pixeldrain\.com\/api\/file\/[^\s"']+)/gi;
            while ((m = dlRe.exec(html)) !== null) {
                if (!seen.has(m[0])) {
                    seen.add(m[0]);
                    results.push({ url: m[0], source: m[0].includes("pixeldrain") ? "PixelDrain" : "HubCDN" });
                }
            }
        }

        return results;
    }

    // ── GDFlix Resolver ──────────────────────────────────────────

    async function resolveGDFlix(url) {
        try {
            const res = await http_get(url, Headers);
            if (!res || !res.body) return [];

            const html = res.body;
            const results = [];
            const seen = new Set();

            // GDFlix pages typically have download buttons
            const btnRe = /href=["'](https?:\/\/[^"']+)["'][^>]*>[^<]*(?:Download|Fast|HubCloud|GDrive|Drive)[^<]*<\/a>/gi;
            let m;
            while ((m = btnRe.exec(html)) !== null) {
                const href = m[1];
                if (!href || seen.has(href)) continue;
                if (/telegram|t\.me|tinyurl/i.test(href)) continue;
                seen.add(href);

                let source = "GDFlix";
                if (href.includes("hubcloud")) source = "HubCloud";
                else if (href.includes("drive.google")) source = "GDrive";

                results.push({ url: href, source });
            }

            // Also scan for hubcloud links
            const hcRe = /https?:\/\/hubcloud\.\w+\/drive\/[a-z0-9]+/gi;
            while ((m = hcRe.exec(html)) !== null) {
                if (!seen.has(m[0])) {
                    seen.add(m[0]);
                    results.push({ url: m[0], source: "HubCloud" });
                }
            }

            return results;
        } catch {
            return [];
        }
    }

    // ── Master Link Resolver ─────────────────────────────────────

    async function resolveLink(link) {
        const url = link.url;
        if (!url) return [];

        try {
            // NexDrive redirector
            if (NEXDRIVE_DOMAINS.some(d => url.includes(d))) {
                const resolved = await resolveNexDrive(url);
                const finalLinks = [];
                for (const r of resolved) {
                    if (r.source === "FastDL" || r.source === "VGMLinks") {
                        const inner = await resolveFastDL(r.url);
                        finalLinks.push(...inner);
                    } else {
                        finalLinks.push(r);
                    }
                }
                return finalLinks.map(l => ({
                    url: l.url,
                    source: `${link.source || l.source} › ${l.source}`,
                    quality: link.quality
                }));
            }

            // HubCloud direct
            if (url.includes("hubcloud")) {
                const resolved = await resolveHubCloud(url);
                return resolved.map(l => ({
                    ...l,
                    quality: link.quality || parseQuality(l.source)
                }));
            }

            // GDFlix
            if (url.includes("gdflix")) {
                const resolved = await resolveGDFlix(url);
                return resolved.map(l => ({
                    ...l,
                    quality: link.quality || 0
                }));
            }

            // FastDL / VGMLinks (direct access)
            if (url.includes("fast-dl") || url.includes("vgmlinks")) {
                const resolved = await resolveFastDL(url);
                return resolved.map(l => ({
                    ...l,
                    quality: link.quality
                }));
            }

            // PixelDrain direct
            if (url.includes("pixeldrain")) {
                return [{ url, source: "PixelDrain", quality: link.quality }];
            }

            // Direct link
            return [{ url, source: link.source || "Direct", quality: link.quality }];
        } catch {
            return [];
        }
    }

    // ── TMDB Integration ─────────────────────────────────────────

    async function tmdbSearch(title) {
        try {
            // Clean title for search - remove year, quality tags, etc.
            let searchTitle = clean(title)
                .replace(/\b\d{4}\b/g, "")
                .replace(/\b(?:hindi|english|tamil|telugu|kannada|malayalam|bengali|punjabi|dual\s*audio|multi\s*audio)\b/gi, "")
                .replace(/\b(?:web-dl|webrip|hdtc|bluray|hdrip|brrip|dvdrip|4k|uhd)\b/gi, "")
                .replace(/\b(?:480p|720p|1080p|2160p)\b/gi, "")
                .replace(/\b(?:season|episode|ep)\s*\d+\b/gi, "")
                .replace(/\[[\d+\]]/g, "")
                .replace(/\s*[-|~]\s*$/g, "")
                .replace(/\s+/g, " ").trim();

            // Extract year for better matching
            const yearMatch = title.match(/\b((?:19|20)\d{2})\b/);
            const year = yearMatch ? yearMatch[1] : "";

            if (!searchTitle || searchTitle.length < 2) searchTitle = clean(title);

            const isMovie = !isSeries(title);
            const targetType = isMovie ? "movie" : "tv";

            let url = `${TMDB_API}/search/${targetType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(searchTitle)}`;
            if (year) url += isMovie ? `&year=${year}` : `&first_air_date_year=${year}`;

            const res = await http_get(url, Headers);
            if (!res || !res.body) return null;
            const json = JSON.parse(res.body);
            const results = Array.isArray(json.results) ? json.results : [];
            if (results.length === 0) return null;

            const inputNorm = normTitle(searchTitle);

            // Try exact match first
            for (const item of results) {
                if (!item) continue;
                const rTitle = item.title || item.name || "";
                const rNorm = normTitle(rTitle);
                if (rNorm === inputNorm) return { id: item.id, type: targetType };
            }

            // Try fuzzy match
            for (const item of results) {
                if (!item) continue;
                const rTitle = item.title || item.name || "";
                const rNorm = normTitle(rTitle);
                if (rNorm.includes(inputNorm) || inputNorm.includes(rNorm)) {
                    return { id: item.id, type: targetType };
                }
            }

            // Fallback to first result
            return { id: results[0].id, type: targetType };
        } catch {
            return null;
        }
    }

    async function tmdbDetails(tmdbId, type) {
        try {
            const url = `${TMDB_API}/${type}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=credits,external_ids`;
            const res = await http_get(url, Headers);
            if (!res || !res.body) return null;
            return JSON.parse(res.body);
        } catch {
            return null;
        }
    }

    function tmdbImg(path, orig) {
        return path ? (orig ? TMDB_ORIG : TMDB_IMG) + path : null;
    }

    // ── Core Plugin Functions ────────────────────────────────────

    async function getHome(cb) {
        try {
            const categories = [
                // WordPress site categories
                { url: "https://vegamoviez.lol/", name: "Latest (NL)", site: SITES[0] },
                { url: "https://vegamoviez.lol/category/movies/", name: "Movies (NL)", site: SITES[0] },
                { url: "https://vegamoviez.lol/category/web-series/", name: "Web Series (NL)", site: SITES[0] },
                // DLE site categories (use vegamoviess.fun as primary DLE source)
                { url: "https://vegamoviess.fun/", name: "Latest (Fun)", site: SITES[1] },
                { url: "https://vegamoviess.fun/bollywood-movies/", name: "Bollywood", site: SITES[1] },
                { url: "https://vegamoviess.fun/hollywood-movies/", name: "Hollywood", site: SITES[1] },
                { url: "https://vegamoviess.fun/dual-audio-hindi-english-movies/", name: "Dual Audio", site: SITES[1] },
                // Also fetch from vega-ts.com for extra variety
                { url: "https://vega-ts.com/", name: "Latest (TS)", site: SITES[2] },
            ];

            const pages = await fetchMany(categories.map(c => ({
                url: c.url,
                headers: Headers,
                meta: c
            })));

            const results = {};
            const trendingItems = [];

            for (const page of pages) {
                const cat = page.meta;
                if (!page.body) continue;

                const items = cat.site.type === "wordpress"
                    ? parseWPHome(page.body, cat.site.base)
                    : parseDLEHome(page.body, cat.site.base);

                if (items.length > 0) {
                    results[cat.name] = items;
                    if (cat.name.startsWith("Latest")) {
                        trendingItems.push(...items.slice(0, 5));
                    }
                }
            }

            // Fetch TMDB data for trending items (top 6)
            const tmdbPromises = trendingItems.slice(0, 6).map(async (item) => {
                try {
                    const parsed = safeParse(item.url);
                    const title = item.title;
                    const tmdb = await tmdbSearch(title);
                    if (tmdb) {
                        const details = await tmdbDetails(tmdb.id, tmdb.type);
                        if (details) {
                            if (details.backdrop_path) item.bannerUrl = tmdbImg(details.backdrop_path, true);
                            if (details.poster_path) item.posterUrl = tmdbImg(details.poster_path);
                            if (details.vote_average) item.score = details.vote_average;
                            if (details.overview && (!item.description || item.description.length < 20)) {
                                item.description = details.overview;
                            }
                        }
                    }
                } catch (e) { /* skip */ }
            });

            await Promise.all(tmdbPromises);

            if (trendingItems.length > 0) {
                // Deduplicate trending
                const seenTitles = new Set();
                results["Trending"] = trendingItems.filter(item => {
                    const key = normTitle(item.title);
                    if (seenTitles.has(key)) return false;
                    seenTitles.add(key);
                    return true;
                }).slice(0, 10);
            }

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const searchUrls = [
                { url: `https://vegamoviez.lol/?s=${encodeURIComponent(query)}`, site: SITES[0] },
                { url: `https://vegamoviess.fun/index.php?do=search&subaction=search&story=${encodeURIComponent(query)}`, site: SITES[1] },
                { url: `https://vega-ts.com/index.php?do=search&subaction=search&story=${encodeURIComponent(query)}`, site: SITES[2] },
                { url: `https://vegamovie.me/index.php?do=search&subaction=search&story=${encodeURIComponent(query)}`, site: SITES[3] },
            ];

            const pages = await fetchMany(searchUrls.map(s => ({
                url: s.url,
                headers: Headers,
                meta: s
            })));

            const allItems = [];
            const seen = new Set();

            for (const page of pages) {
                if (!page.body) continue;
                const items = page.meta.site.type === "wordpress"
                    ? parseWPHome(page.body, page.meta.site.base)
                    : parseDLEHome(page.body, page.meta.site.base);

                for (const item of items) {
                    const key = normTitle(item.title);
                    if (!seen.has(key)) {
                        seen.add(key);
                        allItems.push(item);
                    }
                }
            }

            cb({ success: true, data: allItems });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function load(urlStr, cb) {
        try {
            const data = safeParse(urlStr);
            const pageUrl = data ? data.url : urlStr;
            const source = data ? data.source : "NL";
            const passedTitle = data ? (data.title || "") : "";

            const html = await fetchPage(pageUrl);
            if (!html) return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Failed to load page" });

            // Check for Cloudflare challenge
            const isCF = html.includes("Just a moment") || html.includes("challenge-platform") || html.includes("cf-browser-verification") || html.length < 1000;

            // Determine site type from URL
            const isWP = pageUrl.includes("vegamoviez.lol");
            const site = SITES.find(s => pageUrl.includes(new URL(s.base).hostname)) || SITES[0];

            // If CF-blocked on WP, try DLE sites as fallback
            let workingHtml = html;
            let workingSite = site;
            let workingUrl = pageUrl;

            if (isCF && isWP && passedTitle) {
                console.log("WP site CF-blocked, trying DLE fallback...");
                // Search on DLE sites for the same movie
                const fallbackSearchUrl = `https://vegamoviess.fun/index.php?do=search&subaction=search&story=${encodeURIComponent(passedTitle)}`;
                const searchHtml = await fetchPage(fallbackSearchUrl);
                if (searchHtml) {
                    const items = parseDLEHome(searchHtml, "https://vegamoviess.fun");
                    if (items.length > 0) {
                        const matchData = safeParse(items[0].url);
                        if (matchData) {
                            workingUrl = matchData.url;
                            workingHtml = await fetchPage(workingUrl);
                            workingSite = SITES[1];
                        }
                    }
                }
            }

            // Extract title - use passed title if page is CF-protected
            let title = passedTitle;
            if (!title && !isCF) {
                const tMatch = workingHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                               workingHtml.match(/<title>([^<|]+)[|<]/i);
                title = tMatch ? clean(tMatch[1]) : "";
            }
            if (!title) title = "Unknown";
            // Clean title
            title = title.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s*\|[^|]*$/i, "").replace(/\s*\[.*?\]/g, "").trim();

            // Extract poster
            const ogImg = workingHtml.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
            let poster = ogImg ? ogImg[1] : "";
            if (!poster) {
                const imgMatch = workingHtml.match(/<img[^>]*(?:data-src|src)=["']([^"']*uploads[^"']+)["']/i);
                poster = imgMatch ? imgMatch[1] : "";
            }

            // Extract description
            const descMatch = workingHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                             workingHtml.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
            let description = descMatch ? clean(descMatch[1]) : "";
            if (!description) {
                const plotMatch = workingHtml.match(/(?:synopsis|plot|story)[^:]*:\s*([^<]+)/i);
                description = plotMatch ? clean(plotMatch[1]).substring(0, 500) : "";
            }

            // Extract year
            const yearMatch = workingHtml.match(/\b((?:19|20)\d{2})\b/);
            const year = yearMatch ? parseInt(yearMatch[1]) : null;

            // Extract genres
            const genreMatch = workingHtml.match(/(?:genre|category)[s]?\s*[:=]\s*([^<\n]+)/i);
            const genres = genreMatch ? clean(genreMatch[1]) : "";

            // Extract download links
            const isWorkingWP = workingUrl.includes("vegamoviez.lol");
            const downloadLinks = isWorkingWP
                ? extractWPDownloads(workingHtml, workingSite.base)
                : extractDLEDownloads(workingHtml, workingSite.base);

            // TMDB enrichment
            let tmdbData = null;
            try {
                const tmdb = await tmdbSearch(title);
                if (tmdb) tmdbData = await tmdbDetails(tmdb.id, tmdb.type);
            } catch (e) { /* skip */ }

            const fixedTitle = (tmdbData && (tmdbData.title || tmdbData.name)) || title;
            const fixedPoster = (tmdbData && tmdbImg(tmdbData.poster_path)) || poster;
            const fixedBackdrop = (tmdbData && tmdbImg(tmdbData.backdrop_path, true)) || poster;
            const fixedDesc = (tmdbData && tmdbData.overview) || description;
            const fixedYear = (tmdbData && parseInt((tmdbData.release_date || tmdbData.first_air_date || "").split("-")[0])) || year;
            const score = tmdbData ? tmdbData.vote_average : undefined;
            const imdbId = tmdbData?.external_ids?.imdb_id || "";

            const cast = tmdbData?.credits?.cast?.slice(0, 15).map(c =>
                typeof Actor !== "undefined" ? new Actor({
                    name: clean(c.name),
                    role: clean(c.character),
                    image: tmdbImg(c.profile_path)
                }) : { name: clean(c.name), role: clean(c.character), image: tmdbImg(c.profile_path) }
            ).filter(c => c.name) || [];

            const isSeriesContent = isSeries(title) || isSeries(pageUrl);

            if (!isSeriesContent) {
                // Movie - single episode with all download links
                const episode = new Episode({
                    name: "Full Movie",
                    season: 1,
                    episode: 1,
                    url: JSON.stringify(downloadLinks),
                    posterUrl: fixedPoster
                });

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: fixedTitle,
                        url: urlStr,
                        posterUrl: fixedPoster,
                        bannerUrl: fixedBackdrop,
                        description: fixedDesc,
                        year: fixedYear,
                        score: score ? Math.round(score * 10) / 10 : undefined,
                        type: "movie",
                        cast: cast.length > 0 ? cast : undefined,
                        episodes: [episode]
                    })
                });
            } else {
                // Series - create episodes from download links grouped by quality
                // Group links by quality/section
                const qualityGroups = {};
                for (const link of downloadLinks) {
                    const q = link.quality || 0;
                    const key = qualityLabel(q);
                    if (!qualityGroups[key]) qualityGroups[key] = [];
                    qualityGroups[key].push(link);
                }

                const episodes = [];
                let epNum = 1;
                for (const [qual, links] of Object.entries(qualityGroups)) {
                    episodes.push(new Episode({
                        name: `Full Series ${qual}`,
                        season: 1,
                        episode: epNum++,
                        url: JSON.stringify(links),
                        posterUrl: fixedPoster
                    }));
                }

                if (episodes.length === 0) {
                    // Fallback: single episode with all links
                    episodes.push(new Episode({
                        name: "Full Series",
                        season: 1,
                        episode: 1,
                        url: JSON.stringify(downloadLinks),
                        posterUrl: fixedPoster
                    }));
                }

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: fixedTitle,
                        url: urlStr,
                        posterUrl: fixedPoster,
                        bannerUrl: fixedBackdrop,
                        description: fixedDesc,
                        year: fixedYear,
                        score: score ? Math.round(score * 10) / 10 : undefined,
                        type: "series",
                        cast: cast.length > 0 ? cast : undefined,
                        episodes
                    })
                });
            }
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            let links;
            try {
                links = JSON.parse(dataStr);
                if (!Array.isArray(links)) links = [links];
            } catch {
                links = [{ url: dataStr, source: "Direct", quality: 0 }];
            }

            if (links.length === 0) return cb({ success: true, data: [] });

            const allStreams = [];
            const seen = new Set();

            // Helper to add stream results
            function addStream(stream) {
                if (!stream || !stream.url || seen.has(stream.url)) return;
                seen.add(stream.url);
                const quality = stream.quality || parseQuality((stream.source || "") + " " + (stream.url || ""));
                allStreams.push(new StreamResult({
                    url: stream.url,
                    source: stream.source || "Direct",
                    quality: quality > 0 ? quality : undefined,
                    headers: stream.headers || Headers
                }));
            }

            // Strategy 1: Try loadExtractor for all URLs (built-in SDK extractor)
            if (typeof loadExtractor === "function") {
                const extractPromises = links.map(async (link) => {
                    try {
                        const streams = [];
                        await loadExtractor(link.url, streams);
                        streams.forEach(s => addStream({
                            url: s.url || s,
                            source: link.source || "Extractor",
                            quality: s.quality || link.quality || 0,
                            headers: s.headers
                        }));
                    } catch (e) { /* skip */ }
                });
                await Promise.all(extractPromises);
            }

            // Strategy 2: Custom resolution for links that weren't resolved
            const unresolvedLinks = links.filter(link => {
                // Check if this URL was already resolved
                return !allStreams.some(s => s.url && s.url.includes(new URL(link.url).hostname));
            });

            if (unresolvedLinks.length > 0) {
                const resolutionPromises = unresolvedLinks.map(async (link) => {
                    try {
                        return await resolveLink(link);
                    } catch {
                        return [];
                    }
                });

                const resolvedGroups = await Promise.all(resolutionPromises);
                for (const group of resolvedGroups) {
                    for (const stream of group) {
                        addStream(stream);
                    }
                }
            }

            // Sort by quality (highest first)
            allStreams.sort((a, b) => (b.quality || 0) - (a.quality || 0));

            cb({ success: true, data: allStreams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    // ── Export ───────────────────────────────────────────────────
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
