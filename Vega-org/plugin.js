(function () {
    "use strict";

    // Vega Unified for SkyStream (quick_js_ng)
    // The plugin deliberately owns fail-over itself; no user-selected base URL is required.
    const DOMAINS = [
        "https://vegamoviez.lol",
        "https://vegamoviess.fun",
        "https://vega-ts.com",
        "https://vegamovie.me"
    ];

    const MIRRORS = [
        { url: DOMAINS[0], engine: "wordpress", label: "vegamoviez.lol" },
        { url: DOMAINS[1], engine: "dle",       label: "vegamoviess.fun" },
        { url: DOMAINS[2], engine: "dle",       label: "vega-ts.com" },
        { url: DOMAINS[3], engine: "dle",       label: "vegamovie.me" }
    ];

    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    const STATE_PREFIX = "vega-unified:";
    const MAX_LISTING_ITEMS = 80;
    const MAX_INTERMEDIARY_PAGES = 24;
    const MAX_RESOLVER_DEPTH = 4;
    const CACHE_TTL_MS = 90 * 1000;
    const CACHE_MAX_ENTRIES = 28;
    const HOST_CONFIG_URL = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";
    // Last-resort catalogue used only when every Vega last-mile host is gated.
    // It uses the same HubCloud flow demonstrated by the maintained 4KHDHub plugin.
    const RESCUE_BASE = "https://4khdhub.link";
    const DEBUG = false;

    let dynamicVCloudBase = "https://vcloud.zip";
    let dynamicHubCloudBase = "https://hubcloud.cx";
    let hostConfigLoaded = false;

    const PAGE_CACHE = Object.create(null);
    const CACHE_ORDER = [];

    function log() {
        if (!DEBUG || typeof console === "undefined" || !console.log) return;
        const args = Array.prototype.slice.call(arguments);
        args.unshift("[Vega Unified]");
        console.log.apply(console, args);
    }

    function errorText(error) {
        if (!error) return "Unknown error";
        return String(error.stack || error.message || error);
    }

    function uniqueStrings(values) {
        const seen = Object.create(null);
        const out = [];
        (values || []).forEach(function (value) {
            const item = String(value || "").trim();
            if (!item || seen[item]) return;
            seen[item] = true;
            out.push(item);
        });
        return out;
    }

    function cacheGet(url) {
        const entry = PAGE_CACHE[url];
        if (!entry) return null;
        if (Date.now() - entry.time > CACHE_TTL_MS) {
            delete PAGE_CACHE[url];
            return null;
        }
        return entry.response;
    }

    function cachePut(url, response) {
        if (!url || !response || response.status < 200 || response.status >= 400) return;
        if (!response.body || response.body.length > 900000) return;
        if (isChallengePage(response.body)) return;
        if (!PAGE_CACHE[url]) CACHE_ORDER.push(url);
        PAGE_CACHE[url] = { time: Date.now(), response: response };
        while (CACHE_ORDER.length > CACHE_MAX_ENTRIES) {
            const oldest = CACHE_ORDER.shift();
            if (oldest) delete PAGE_CACHE[oldest];
        }
    }

    function statusOf(response) {
        if (!response) return 0;
        const value = response.statusCode != null ? response.statusCode :
            (response.status != null ? response.status : response.code);
        return parseInt(value, 10) || 0;
    }

    function bodyOf(response) {
        if (response == null) return "";
        if (typeof response === "string") return String(response);
        if (response.body != null) return String(response.body);
        return "";
    }

    function headerValue(headers, wanted) {
        if (!headers || typeof headers !== "object") return "";
        const lower = String(wanted || "").toLowerCase();
        const keys = Object.keys(headers);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i].toLowerCase() === lower) {
                const value = headers[keys[i]];
                return Array.isArray(value) ? value.join(",") : String(value || "");
            }
        }
        return "";
    }

    function normalizeResponse(raw, requestUrl) {
        return {
            status: statusOf(raw),
            body: bodyOf(raw),
            headers: raw && raw.headers ? raw.headers : {},
            requestUrl: requestUrl,
            finalUrl: raw && raw.finalUrl ? String(raw.finalUrl) : requestUrl
        };
    }

    function requestHeaders(referer) {
        const headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.8",
            "Accept-Encoding": "identity"
        };
        if (referer) headers.Referer = referer;
        return headers;
    }

    async function getOne(url, referer, bypassCache, extraHeaders) {
        if (!bypassCache) {
            const cached = cacheGet(url);
            if (cached) return cached;
        }
        try {
            const headers = Object.assign(requestHeaders(referer), extraHeaders || {});
            const raw = await http_get(url, headers);
            const response = normalizeResponse(raw, url);
            cachePut(url, response);
            return response;
        } catch (error) {
            return { status: 0, body: "", headers: {}, requestUrl: url, finalUrl: url, error: errorText(error) };
        }
    }

    async function getMany(entries, bypassCache) {
        const input = [];
        const byUrl = Object.create(null);
        (entries || []).forEach(function (entry) {
            const normalized = typeof entry === "string" ? { url: entry, referer: "" } : entry;
            if (!normalized || !normalized.url || byUrl[normalized.url]) return;
            byUrl[normalized.url] = normalized;
            input.push(normalized);
        });

        const results = new Array(input.length);
        const pending = [];
        const pendingIndexes = [];

        input.forEach(function (entry, index) {
            const cached = bypassCache ? null : cacheGet(entry.url);
            if (cached) {
                results[index] = cached;
            } else {
                pending.push({ url: entry.url, headers: requestHeaders(entry.referer || "") });
                pendingIndexes.push(index);
            }
        });

        if (pending.length > 0) {
            let rawResults = null;
            if (typeof http_parallel === "function") {
                try {
                    rawResults = await http_parallel(pending);
                } catch (_) {
                    rawResults = null;
                }
            }
            if (!Array.isArray(rawResults) || rawResults.length !== pending.length) {
                rawResults = await Promise.all(pending.map(function (request) {
                    return http_get(request.url, request.headers).catch(function (error) {
                        return { status: 0, body: "", headers: {}, error: errorText(error) };
                    });
                }));
            }
            rawResults.forEach(function (raw, pendingIndex) {
                const resultIndex = pendingIndexes[pendingIndex];
                const response = normalizeResponse(raw, pending[pendingIndex].url);
                results[resultIndex] = response;
                cachePut(pending[pendingIndex].url, response);
            });
        }

        return results;
    }

    function decodeHtml(value) {
        let text = String(value || "");
        const named = {
            amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " ",
            ndash: "â€“", mdash: "â€”", hellip: "â€¦", rsquo: "â€™", lsquo: "â€˜",
            rdquo: "â€", ldquo: "â€œ", times: "Ã—", copy: "Â©"
        };
        text = text.replace(/&#(x?[0-9a-f]+);?/gi, function (_, code) {
            let number;
            if (String(code).toLowerCase().charAt(0) === "x") {
                number = parseInt(String(code).slice(1), 16);
            } else {
                number = parseInt(code, 10);
            }
            if (!isFinite(number) || number < 0) return _;
            try {
                return typeof String.fromCodePoint === "function" ? String.fromCodePoint(number) : String.fromCharCode(number);
            } catch (_) {
                return "";
            }
        });
        text = text.replace(/&([a-z]+);/gi, function (whole, name) {
            return Object.prototype.hasOwnProperty.call(named, name.toLowerCase()) ? named[name.toLowerCase()] : whole;
        });
        return text;
    }

    function stripTags(html) {
        return decodeHtml(String(html || "")
            .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " "))
            .replace(/\s+/g, " ")
            .trim();
    }

    function htmlToLines(html) {
        return decodeHtml(String(html || "")
            .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n")
            .replace(/<[^>]+>/g, " "))
            .replace(/[ \t]+/g, " ")
            .replace(/\s*\n\s*/g, "\n")
            .trim();
    }

    function parseAttrs(source) {
        const attrs = Object.create(null);
        const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
        let match;
        while ((match = regex.exec(String(source || ""))) !== null) {
            attrs[match[1].toLowerCase()] = decodeHtml(match[2] != null ? match[2] : (match[3] != null ? match[3] : match[4]));
        }
        return attrs;
    }

    function allAnchors(html) {
        const out = [];
        const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = regex.exec(String(html || ""))) !== null) {
            const attrs = parseAttrs(match[1]);
            out.push({
                href: attrs.href || "",
                title: attrs.title || "",
                className: attrs.class || "",
                id: attrs.id || "",
                rel: attrs.rel || "",
                text: stripTags(match[2]),
                inner: match[2],
                index: match.index
            });
        }
        return out;
    }

    function firstTagAttr(html, tag, attr, requiredAttr, requiredValue) {
        const regex = new RegExp("<" + tag + "\\b([^>]*)>", "gi");
        let match;
        while ((match = regex.exec(String(html || ""))) !== null) {
            const attrs = parseAttrs(match[1]);
            if (requiredAttr && String(attrs[requiredAttr.toLowerCase()] || "").toLowerCase() !== String(requiredValue || "").toLowerCase()) continue;
            if (attrs[attr.toLowerCase()] != null) return attrs[attr.toLowerCase()];
        }
        return "";
    }

    function metaContent(html, key, value) {
        const regex = /<meta\b([^>]*)>/gi;
        let match;
        while ((match = regex.exec(String(html || ""))) !== null) {
            const attrs = parseAttrs(match[1]);
            if (String(attrs[key] || "").toLowerCase() === String(value || "").toLowerCase()) return attrs.content || "";
        }
        return "";
    }

    function canonicalFromHtml(html) {
        const regex = /<link\b([^>]*)>/gi;
        let match;
        while ((match = regex.exec(String(html || ""))) !== null) {
            const attrs = parseAttrs(match[1]);
            if (String(attrs.rel || "").toLowerCase().split(/\s+/).indexOf("canonical") >= 0) return attrs.href || "";
        }
        return metaContent(html, "property", "og:url");
    }

    function schemeAndHost(url) {
        const match = String(url || "").match(/^(https?):\/\/([^\/?#]+)/i);
        return match ? { scheme: match[1].toLowerCase(), host: match[2].toLowerCase(), origin: match[1].toLowerCase() + "://" + match[2] } : null;
    }

    function hostname(url) {
        const parsed = schemeAndHost(url);
        return parsed ? parsed.host.split(":")[0] : "";
    }

    function originOf(url) {
        const parsed = schemeAndHost(url);
        return parsed ? parsed.origin : "";
    }

    function pathOf(url) {
        const match = String(url || "").match(/^https?:\/\/[^\/]+(\/[^?#]*)?/i);
        return match ? (match[1] || "/") : "/";
    }

    function resolveUrl(base, href) {
        let target = decodeHtml(String(href || "").trim()).replace(/\\\//g, "/");
        if (!target || /^javascript:/i.test(target) || target.charAt(0) === "#") return "";
        if (/^https?:\/\//i.test(target)) return target;
        if (/^\/\//.test(target)) return "https:" + target;
        try {
            if (typeof URL === "function") return new URL(target, base).toString();
        } catch (_) {}
        const origin = originOf(base);
        if (!origin) return "";
        if (target.charAt(0) === "/") return origin + target;
        const path = pathOf(base);
        const folder = path.slice(0, path.lastIndexOf("/") + 1);
        return origin + folder + target;
    }

    function cleanDisplayTitle(value) {
        let title = stripTags(value)
            .replace(/^\s*download\s+/i, "")
            .replace(/\s*[|â€“-]\s*vegamovies(?:\s*3\.0)?\s*$/i, "")
            .replace(/\s*-\s*nextgen\s+drive\s*$/i, "")
            .replace(/\s*\|\s*(?:full movie|hindi dubbed movie)(?=\s|\[|\(|$)/ig, "")
            .replace(/\s+/g, " ")
            .trim();
        return title || "Untitled";
    }

    function inferType(title, html) {
        const titleText = String(title || "").toLowerCase();
        if (/\banime\b/.test(titleText)) return "anime";
        if (/\bseason\s*\d+\b|\bs\d{1,2}e\d{1,3}\b|\ball\s+episodes?\b|\bep\s*[-:#]?\s*\d+\s+added\b|\bweb[ -]?series\b/.test(titleText)) return "series";

        // Detail pages repeat generic menu/footer phrases such as â€œTV Seriesâ€.
        // Only explicit, title-specific labels in the article body may promote a
        // movie-looking title to a series.
        const articleText = htmlToLines(String(html || "").slice(0, 70000)).toLowerCase();
        if (/\bseries\s*(?:info|name)\s*:|\bseries[- ]synopsis\s*\/\s*plot|\bfull\s+web[ -]?series\b|\bepisode\s+size\s*:/.test(articleText)) return "series";
        return "movie";
    }

    function yearFromText(value) {
        const matches = String(value || "").match(/\b(?:19|20)\d{2}\b/g) || [];
        if (!matches.length) return undefined;
        const year = parseInt(matches[matches.length - 1], 10);
        return year >= 1900 && year <= 2100 ? year : undefined;
    }

    function seasonFromText(value) {
        let match = String(value || "").match(/\bseason\s*[:#-]?\s*(\d{1,3})\b/i);
        if (!match) match = String(value || "").match(/\bS(\d{1,3})(?:E\d+)?\b/i);
        return match ? (parseInt(match[1], 10) || 1) : 1;
    }

    function isAdultTitle(value) {
        return /(^|\W)18\+?(\W|$)|\badult\b|\berotic\b|\bunrated\b|\bxxx\b/i.test(String(value || ""));
    }

    function canonicalItemKey(title, url) {
        let text = cleanDisplayTitle(title).toLowerCase();
        const yearMatch = text.match(/\b(?:19|20)\d{2}\b/);
        const seasonMatch = text.match(/\bseason\s*(\d{1,3})\b/i);
        if (yearMatch && yearMatch.index != null) {
            const head = text.slice(0, yearMatch.index)
                .replace(/\b(download|watch|full|movie|series|web|dual|multi|audio|hindi|english|tamil|telugu|korean|french)\b/g, " ")
                .replace(/[^a-z0-9]+/g, " ")
                .trim();
            if (head) return head + "-" + yearMatch[0] + (seasonMatch ? "-s" + seasonMatch[1] : "");
        }
        let path = pathOf(url).replace(/^\/+|\/+$/g, "").replace(/\.html?$/i, "").replace(/^\d+-/, "");
        path = path.replace(/-(?:480p|720p|1080p|2160p|4k|web-?dl|webrip|bluray).*$/i, "");
        if (path) return path.toLowerCase();
        return text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }

    function looksLikeDetailUrl(url, title) {
        if (!/^https?:\/\//i.test(String(url || ""))) return false;
        const path = pathOf(url).toLowerCase();
        if (path === "/" || /\/(?:page|category|categories|genre|tag|author|xfsearch|wp-content|templates|uploads)\//.test(path)) return false;
        if (/\/(?:bollywood-movies|hollywood-movies|movies|tv-shows|web-series|anime|action|adventure|drama|comedy|horror|search)\/?$/.test(path)) return false;
        if (/\.html?$/.test(path)) return true;
        if (/\b(?:19|20)\d{2}\b/.test(String(title || "")) && path.split("/").filter(Boolean).length <= 2) return true;
        return path.split("/").filter(Boolean).length === 1 && path.indexOf("-") >= 0;
    }

    function imageFromBlock(block, base) {
        const regex = /<img\b([^>]*)>/gi;
        let match;
        while ((match = regex.exec(String(block || ""))) !== null) {
            const attrs = parseAttrs(match[1]);
            const src = attrs["data-src"] || attrs["data-lazy-src"] || attrs.src || "";
            if (!src || /emoji|logo|avatar|favicon/i.test(src)) continue;
            return resolveUrl(base, src);
        }
        return "";
    }

    function parseListingBlock(block, pageUrl, mirrorIndex) {
        const anchors = allAnchors(block);
        if (!anchors.length) return null;
        let chosen = null;
        let bestScore = -1;
        anchors.forEach(function (anchor) {
            const href = resolveUrl(pageUrl, anchor.href);
            const candidateTitle = anchor.title || anchor.text || "";
            if (!looksLikeDetailUrl(href, candidateTitle)) return;
            let score = 0;
            if (anchor.title) score += 4;
            if (anchor.text && anchor.text.length > 8) score += 3;
            if (/blog-img|img-box|post-title/i.test(anchor.className)) score += 3;
            if (/<img\b/i.test(anchor.inner)) score += 2;
            if (score > bestScore) {
                bestScore = score;
                chosen = { href: href, title: candidateTitle };
            }
        });
        if (!chosen) return null;

        let title = chosen.title;
        if (!title) {
            const heading = String(block).match(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/i);
            title = heading ? stripTags(heading[1]) : "";
        }
        if (!title) return null;
        title = cleanDisplayTitle(title);
        const poster = imageFromBlock(block, chosen.href || pageUrl);
        return {
            title: title,
            url: chosen.href,
            poster: poster,
            type: inferType(title, ""),
            year: yearFromText(title),
            adult: isAdultTitle(title),
            mirrorIndex: mirrorIndex,
            order: 0
        };
    }

    function parseListing(html, pageUrl, mirrorIndex) {
        const out = [];
        const seen = Object.create(null);
        const articleRegex = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi;
        let match;
        while ((match = articleRegex.exec(String(html || ""))) !== null) {
            if (!/\bpost-item\b/i.test(match[1]) && !/\btype-post\b/i.test(match[1])) continue;
            const item = parseListingBlock(match[0], pageUrl, mirrorIndex);
            if (!item || seen[item.url]) continue;
            item.order = out.length;
            seen[item.url] = true;
            out.push(item);
            if (out.length >= MAX_LISTING_ITEMS) break;
        }

        if (!out.length) {
            // Newer Vega templates use a simple movies-grid containing image anchors.
            const anchors = allAnchors(html);
            anchors.forEach(function (anchor) {
                if (out.length >= MAX_LISTING_ITEMS || !/<img\b/i.test(anchor.inner)) return;
                const href = resolveUrl(pageUrl, anchor.href);
                const imgTitle = (anchor.inner.match(/<img\b([^>]*)>/i) || [])[1] || "";
                const imageAttrs = parseAttrs(imgTitle);
                const title = cleanDisplayTitle(anchor.title || imageAttrs.alt || anchor.text || "");
                if (!title || !looksLikeDetailUrl(href, title) || seen[href]) return;
                seen[href] = true;
                out.push({
                    title: title,
                    url: href,
                    poster: resolveUrl(href, imageAttrs["data-src"] || imageAttrs.src || ""),
                    type: inferType(title, ""),
                    year: yearFromText(title),
                    adult: isAdultTitle(title),
                    mirrorIndex: mirrorIndex,
                    order: out.length
                });
            });
        }
        return out;
    }

    function makeState(kind, payload) {
        // Match the format used by maintained SkyStream providers: opaque JSON.
        // Plain JSON survives app routing/history unchanged and is easier for the
        // CLI and player to pass back into load()/loadStreams().
        return JSON.stringify(Object.assign({ __vegaUnified: 2, kind: kind }, payload || {}));
    }

    function parseState(value) {
        const input = String(value || "");

        // Current JSON state.
        try {
            const parsed = JSON.parse(input);
            if (parsed && parsed.__vegaUnified && parsed.kind) {
                const data = Object.assign({}, parsed);
                const kind = data.kind;
                delete data.__vegaUnified;
                delete data.kind;
                return { kind: kind, data: data };
            }
        } catch (_) {}

        // Backward compatibility with v1 URLs already saved in user history.
        if (input.indexOf(STATE_PREFIX) !== 0) return null;
        const rest = input.slice(STATE_PREFIX.length);
        const split = rest.indexOf(":");
        if (split < 0) return null;
        try {
            return { kind: rest.slice(0, split), data: JSON.parse(decodeURIComponent(rest.slice(split + 1))) };
        } catch (_) {
            return null;
        }
    }

    function mergeRawItems(itemLists) {
        const groups = Object.create(null);
        const order = [];
        let sequence = 0;
        (itemLists || []).forEach(function (list) {
            (list || []).forEach(function (item) {
                const key = canonicalItemKey(item.title, item.url);
                if (!key) return;
                if (!groups[key]) {
                    groups[key] = {
                        key: key,
                        title: item.title,
                        poster: item.poster,
                        type: item.type,
                        year: item.year,
                        adult: item.adult,
                        urls: [],
                        mirrorIndexes: [],
                        order: sequence++
                    };
                    order.push(key);
                }
                const group = groups[key];
                if (group.urls.indexOf(item.url) < 0) group.urls.push(item.url);
                if (group.mirrorIndexes.indexOf(item.mirrorIndex) < 0) group.mirrorIndexes.push(item.mirrorIndex);
                if (!group.poster && item.poster) group.poster = item.poster;
                if (!group.year && item.year) group.year = item.year;
                if (group.type === "movie" && item.type !== "movie") group.type = item.type;
                group.adult = group.adult || item.adult;
                // Prefer a useful title without mirror-specific suffixes; avoid replacing it with SEO spam.
                if (item.title.length < group.title.length && item.title.length >= 8) group.title = item.title;
            });
        });
        return order.map(function (key) { return groups[key]; });
    }

    function groupToMedia(group) {
        const mirrorCount = group.mirrorIndexes.length || group.urls.length;
        const itemUrl = makeState("item", {
            key: group.key,
            title: group.title,
            type: group.type,
            urls: group.urls.slice(0, 8)
        });
        return new MultimediaItem({
            title: group.title,
            url: itemUrl,
            posterUrl: group.poster || "",
            type: group.type || "movie",
            year: group.year,
            description: "Indexed from " + mirrorCount + " active Vega mirror" + (mirrorCount === 1 ? "" : "s") + ".",
            isAdult: !!group.adult,
            headers: group.urls.length ? { Referer: originOf(group.urls[0]) + "/", "User-Agent": USER_AGENT } : undefined
        });
    }

    function isChallengePage(html) {
        const text = String(html || "").toLowerCase();
        return text.indexOf("just a moment") >= 0 && text.indexOf("cf_chl") >= 0 ||
            text.indexOf("attention required! | cloudflare") >= 0 ||
            text.indexOf("cf-browser-verification") >= 0;
    }

    function isUsableListingResponse(response) {
        return response && response.status >= 200 && response.status < 400 && response.body.length > 500 && !isChallengePage(response.body);
    }

    function homeUrl(mirror) {
        return mirror.url + "/";
    }

    function searchUrl(mirror, query, page) {
        const encoded = encodeURIComponent(query);
        const pageNumber = parseInt(page, 10) || 1;
        if (mirror.engine === "wordpress") {
            return mirror.url + (pageNumber > 1 ? "/page/" + pageNumber + "/" : "/") + "?s=" + encoded;
        }
        return mirror.url + "/index.php?do=search&subaction=search&story=" + encoded +
            (pageNumber > 1 ? "&search_start=" + pageNumber : "");
    }

    async function scanMirrorListings(urlEntries) {
        const responses = await getMany(urlEntries.map(function (entry) {
            return { url: entry.url, referer: entry.referer || entry.mirror.url + "/" };
        }));
        const lists = [];
        responses.forEach(function (response, index) {
            if (!isUsableListingResponse(response)) {
                lists.push([]);
                return;
            }
            const base = canonicalFromHtml(response.body) || response.finalUrl || urlEntries[index].url;
            lists.push(parseListing(response.body, base, urlEntries[index].index));
        });
        return { responses: responses, groups: mergeRawItems(lists) };
    }

    async function searchAllGroups(query, page) {
        const entries = MIRRORS.map(function (mirror, index) {
            return { url: searchUrl(mirror, query, page), mirror: mirror, index: index, referer: mirror.url + "/" };
        });
        return await scanMirrorListings(entries);
    }

    async function getHome(cb) {
        try {
            const entries = MIRRORS.map(function (mirror, index) {
                return { url: homeUrl(mirror), mirror: mirror, index: index, referer: mirror.url + "/" };
            });
            const scan = await scanMirrorListings(entries);
            if (!scan.groups.length) {
                const statuses = scan.responses.map(function (response, i) {
                    return MIRRORS[i].label + "=" + response.status;
                }).join(", ");
                return cb({ success: false, errorCode: "ALL_MIRRORS_DOWN", message: "No Vega mirror returned a usable catalogue (" + statuses + ")." });
            }

            const all = scan.groups.map(groupToMedia);
            const movies = scan.groups.filter(function (group) { return group.type === "movie"; }).map(groupToMedia);
            const shows = scan.groups.filter(function (group) { return group.type === "series" || group.type === "anime"; }).map(groupToMedia);
            const data = {
                "Trending": all.slice(0, 20),
                "Latest Movies": movies.slice(0, 36)
            };
            if (shows.length) data["Series & Anime"] = shows.slice(0, 36);
            cb({ success: true, data: data });
        } catch (error) {
            cb({ success: false, errorCode: "HOME_ERROR", message: errorText(error) });
        }
    }

    async function search(query, page, cb) {
        if (typeof page === "function") {
            cb = page;
            page = 1;
        }
        try {
            const term = String(query || "").trim();
            if (!term) return cb({ success: true, data: [] });
            const scan = await searchAllGroups(term, page || 1);
            const relevant = scan.groups.filter(function (group) {
                return titleSimilarity(term, group.title) >= 0.45;
            });
            cb({ success: true, data: (relevant.length ? relevant : scan.groups).map(groupToMedia) });
        } catch (error) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: errorText(error) });
        }
    }

    function extractEntryHtml(html) {
        const input = String(html || "");
        const startMatch = input.match(/<div\b[^>]*class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>/i);
        if (!startMatch || startMatch.index == null) return input;
        const start = startMatch.index + startMatch[0].length;
        const tail = input.slice(start);
        const endMatch = tail.match(/<div\b[^>]*(?:id=["']reports["']|class=["'][^"']*(?:comments-area|related-posts)[^"']*["'])/i);
        return endMatch && endMatch.index != null ? tail.slice(0, endMatch.index) : tail.slice(0, 80000);
    }

    function headingTitle(html) {
        let match = String(html || "").match(/<h1\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
        if (match) return stripTags(match[1]);
        const og = metaContent(html, "property", "og:title");
        if (og) return og;
        match = String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
        return match ? stripTags(match[1]) : "";
    }

    function synopsisFromHtml(entryHtml) {
        const regex = /<h[2-5]\b[^>]*>[\s\S]*?(?:synopsis|plot)[\s\S]*?<\/h[2-5]>\s*<(?:p|div)\b[^>]*>([\s\S]*?)<\/(?:p|div)>/i;
        const match = String(entryHtml || "").match(regex);
        return match ? stripTags(match[1]) : "";
    }

    function cleanDescription(value) {
        let text = stripTags(value);
        text = text.replace(/^(?:download|watch)\s+[^.!?]{10,180}[.!?]\s*/i, "");
        if (text.length > 1400) text = text.slice(0, 1397).trim() + "â€¦";
        return text;
    }

    function extractQuality(text) {
        const value = String(text || "");
        const found = [];
        let match;
        const regex = /\b(2160p|1080p|720p|576p|480p|360p|4k|2k)\b/ig;
        while ((match = regex.exec(value)) !== null) {
            const q = match[1].toUpperCase().replace("P", "p");
            if (found.indexOf(q) < 0) found.push(q);
        }
        return found.join("/");
    }

    function isKnownLinkHost(url) {
        const host = hostname(url);
        return /(^|\.)(?:nexdrive\.|vgmlinks\.|vcloud\.|hubcloud\.|fast-dl\.|filepress\.|gdtot\.|dropgalaxy\.|pixeldrain\.|gofile\.io$|1fichier\.com$|vikingfile\.com$|megaup\.net$|drive\.google\.com$|mixdrop\.|streamtape\.|filemoon\.|dood\.|voe\.)/i.test(host);
    }

    function isLikelyDownloadAnchor(anchor, href, detailHost) {
        const text = (anchor.text + " " + anchor.className + " " + anchor.inner).toLowerCase();
        if (!href || /^javascript:/i.test(href)) return false;
        const host = hostname(href);
        if (host && host === detailHost && !/\.(?:m3u8|mp4|mkv|webm)(?:[?#]|$)/i.test(href)) return false;
        return /dwd-button|\bdownload\b|g-direct|v-?cloud|episode|server|instant|resumable|mirror/i.test(text) || isKnownLinkHost(href) || isDirectMediaUrl(href);
    }

    function extractDownloadEntries(html, baseUrl) {
        const input = String(html || "");
        let section = extractEntryHtml(input);
        const marker = section.search(/download-links-div|(?:download\s+links|\*{2,}\s*download)/i);
        if (marker >= 0) section = section.slice(marker);
        const stop = section.search(/(?:id=["']reports["']|comments-area|winding\s+up|wrapping\s+up)/i);
        if (stop > 0) section = section.slice(0, stop);

        const detailHost = hostname(baseUrl);
        const out = [];
        const seen = Object.create(null);
        allAnchors(section).forEach(function (anchor) {
            const href = resolveUrl(baseUrl, anchor.href);
            if (!isLikelyDownloadAnchor(anchor, href, detailHost) || seen[href]) return;

            // A download button is usually wrapped by its own H3. Looking for a
            // heading with one large regex consumes that wrapper and hides the
            // nested anchor. Instead, inspect only headings fully closed before
            // this anchor; the last quality heading is then the correct label.
            const prefix = section.slice(Math.max(0, anchor.index - 1800), anchor.index);
            const headingRegex = /<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>/gi;
            let headingMatch;
            let contextHeading = "";
            while ((headingMatch = headingRegex.exec(prefix)) !== null) {
                const heading = stripTags(headingMatch[1]);
                if (/\b(?:2160p|1080p|720p|576p|480p|360p|4k|2k|season\s*\d+|episodes?)\b/i.test(heading)) contextHeading = heading;
            }

            seen[href] = true;
            const quality = extractQuality(contextHeading + " " + anchor.text);
            const labelParts = [];
       
            out.push({
                url: href,
                label: labelParts.join(" â€¢ ") || "Download mirror",
                quality: quality,
                referer: baseUrl
            });
        });

        // Some templates place buttons outside entry-content; make a constrained fallback pass.
        if (!out.length) {
            allAnchors(input).forEach(function (anchor) {
                const href = resolveUrl(baseUrl, anchor.href);
                if (!isLikelyDownloadAnchor(anchor, href, detailHost) || seen[href]) return;
                seen[href] = true;
                out.push({ url: href, label: anchor.text || "Download mirror", quality: extractQuality(anchor.text), referer: baseUrl });
            });
        }
        return out.slice(0, 20);
    }

    function extractPlayerConfig(html, baseUrl) {
        const out = [];
        const input = String(html || "");
        const srcMatch = input.match(/IndStreamPlayerConfigs\s*=\s*\{[\s\S]*?\bsrc\s*:\s*["']([^"']+)["']/i);
        if (!srcMatch) return out;
        const scriptRegex = /<script\b([^>]*)><\/script>/gi;
        let match;
        while ((match = scriptRegex.exec(input)) !== null) {
            const attrs = parseAttrs(match[1]);
            if (attrs.src && /player[^/]*\.js/i.test(attrs.src)) {
                out.push({ id: srcMatch[1], scriptUrl: resolveUrl(baseUrl, attrs.src), referer: baseUrl });
            }
        }
        if (!out.length) out.push({ id: srcMatch[1], scriptUrl: "https://allmovieland.link/player.js", referer: baseUrl });
        return out;
    }

    function parseDetailPage(response) {
        const html = response.body;
        if (!response || response.status < 200 || response.status >= 400 || !html || isChallengePage(html)) return null;
        let title = cleanDisplayTitle(headingTitle(html));
        if (!title || /^just a moment/i.test(title) || /404 not found/i.test(title)) return null;
        const entry = extractEntryHtml(html);
        const lines = htmlToLines(entry);
        let description = synopsisFromHtml(entry) || metaContent(html, "name", "description") || metaContent(html, "property", "og:description");
        description = cleanDescription(description);
        let poster = metaContent(html, "property", "og:image");
        if (!poster) poster = imageFromBlock(entry, response.finalUrl || response.requestUrl);
        poster = resolveUrl(response.finalUrl || response.requestUrl, poster);

        let runtime;
        const runtimeMatch = lines.match(/\bRuntime\s*:?[ \t]*(\d{1,3})\s*(?:min|minutes?)/i);
        if (runtimeMatch) runtime = parseInt(runtimeMatch[1], 10) || undefined;
        let score;
        const scoreMatch = lines.match(/IMDb\s*(?:Rating)?\s*:?[ \t]*-?\s*(\d+(?:\.\d+)?)/i);
        if (scoreMatch) {
            const parsed = parseFloat(scoreMatch[1]);
            if (parsed >= 0 && parsed <= 10) score = parsed;
        }
        let tags = [];
        const genreMatch = lines.match(/\bGenres?\s*:?[ \t]*([^\n]{2,160})/i);
        if (genreMatch) {
            tags = genreMatch[1].split(/[,|/]/).map(function (tag) { return tag.trim(); }).filter(function (tag) {
                return tag && tag.length < 35 && !/^(cast|quality|language|size|format|runtime)/i.test(tag);
            }).slice(0, 12);
        }
        const canonical = resolveUrl(response.finalUrl || response.requestUrl, canonicalFromHtml(html)) || response.finalUrl || response.requestUrl;
        return {
            title: title,
            description: description,
            poster: poster,
            year: yearFromText(lines) || yearFromText(title),
            duration: runtime,
            score: score,
            tags: tags,
            type: inferType(title, entry),
            adult: isAdultTitle(title),
            url: canonical,
            requestUrl: response.requestUrl,
            html: html,
            entries: extractDownloadEntries(html, canonical),
            players: extractPlayerConfig(html, canonical)
        };
    }

    function swapDomainCandidates(url) {
        const path = pathOf(url);
        if (!path || path === "/") return [];
        return DOMAINS.map(function (domain) { return domain + path; });
    }

    async function fetchDetails(urls, allowSwaps) {
        let candidates = uniqueStrings(urls || []).slice(0, 10);
        if (allowSwaps && candidates.length <= 1 && candidates.length) {
            candidates = uniqueStrings(candidates.concat(swapDomainCandidates(candidates[0]))).slice(0, 10);
        }
        const responses = await getMany(candidates.map(function (url) { return { url: url, referer: originOf(url) + "/" }; }));
        const details = [];
        responses.forEach(function (response) {
            const detail = parseDetailPage(response);
            if (detail) details.push(detail);
        });
        return details;
    }

    function mirrorLookupQuery(title) {
        const cleaned = cleanDisplayTitle(title)
            .replace(/\[[^\]]*\]/g, " ")
            .replace(/\((?!\d{4}\))[^)]*\)/g, " ")
            .replace(/\b(?:2160p|1080p|720p|576p|480p|360p|4k|web-?dl|webrip|bluray|hdtc|hq|x26[45]|hevc|dual audio|multi audio|hindi dubbed movie|full movie)\b/ig, " ")
            .replace(/\s+/g, " ")
            .trim();
        return cleaned.split(" ").slice(0, 9).join(" ");
    }

    async function discoverMatchingUrls(title, key) {
        const query = mirrorLookupQuery(title);
        if (!query) return [];
        try {
            const scan = await searchAllGroups(query, 1);
            let best = null;
            scan.groups.forEach(function (group) {
                if (group.key === key || canonicalItemKey(group.title, group.urls[0]) === canonicalItemKey(title, "")) best = group;
            });
            return best ? best.urls : [];
        } catch (_) {
            return [];
        }
    }

    function mergeDetails(details, stateData) {
        const first = details[0];
        let bestDescription = first.description || "";
        let poster = first.poster || "";
        let year = first.year;
        let duration = first.duration;
        let score = first.score;
        let tags = first.tags || [];
        let type = stateData && stateData.type ? stateData.type : first.type;
        let adult = first.adult;
        const entries = [];
        const players = [];
        const urls = [];
        const entrySeen = Object.create(null);
        const playerSeen = Object.create(null);

        details.forEach(function (detail) {
            if (detail.description && detail.description.length > bestDescription.length) bestDescription = detail.description;
            if (!poster && detail.poster) poster = detail.poster;
            if (!year && detail.year) year = detail.year;
            if (!duration && detail.duration) duration = detail.duration;
            if (score == null && detail.score != null) score = detail.score;
            if ((!tags || !tags.length) && detail.tags.length) tags = detail.tags;
            if (type === "movie" && detail.type !== "movie") type = detail.type;
            adult = adult || detail.adult;
            if (urls.indexOf(detail.url) < 0) urls.push(detail.url);
            detail.entries.forEach(function (entry) {
                if (entrySeen[entry.url]) return;
                entrySeen[entry.url] = true;
                entries.push(entry);
            });
            detail.players.forEach(function (player) {
                const playerKey = player.scriptUrl + "|" + player.id;
                if (playerSeen[playerKey]) return;
                playerSeen[playerKey] = true;
                players.push(player);
            });
        });

        return {
            title: cleanDisplayTitle((stateData && stateData.title) || first.title),
            key: (stateData && stateData.key) || canonicalItemKey(first.title, first.url),
            description: bestDescription,
            poster: poster,
            year: year,
            duration: duration,
            score: score,
            tags: tags || [],
            type: type,
            adult: adult,
            urls: uniqueStrings(((stateData && stateData.urls) || []).concat(urls)),
            entries: entries,
            players: players,
            details: details
        };
    }

    function parseEpisodeGroups(html, pageUrl, outerEntry) {
        const input = String(html || "");
        const pageTitle = cleanDisplayTitle(headingTitle(input) || stripTags((input.match(/<div\b[^>]*class=["'][^"']*\btitle-main\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || ""));
        const season = seasonFromText(pageTitle || outerEntry.label || "");
        const pageQuality = extractQuality(pageTitle + " " + (outerEntry.quality || outerEntry.label || ""));
        const groups = [];
        const regex = /<h[2-5]\b[^>]*class=["'][^"']*\bep-title-h4\b[^"']*["'][^>]*>([\s\S]*?)<\/h[2-5]>\s*<div\b[^>]*class=["'][^"']*\bep-buttons-wrap\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
        let match;
        while ((match = regex.exec(input)) !== null) {
            const heading = stripTags(match[1]);
            const numberMatch = heading.match(/episodes?\s*[:#-]?\s*(\d{1,3})/i) || heading.match(/\bE(?:pisode)?\s*(\d{1,3})\b/i);
            if (!numberMatch) continue;
            const episodeNumber = parseInt(numberMatch[1], 10) || 1;
            const links = [];
            allAnchors(match[2]).forEach(function (anchor) {
                const href = resolveUrl(pageUrl, anchor.href);
                if (!href || (!isKnownLinkHost(href) && !isDirectMediaUrl(href))) return;
                links.push({
                    url: href,
                    label: [pageQuality, anchor.text].filter(Boolean).join(" â€¢ ") || "Mirror",
                    quality: pageQuality || extractQuality(anchor.text),
                    referer: pageUrl
                });
            });
            if (links.length) groups.push({ season: season, episode: episodeNumber, links: links });
        }

        // Older NexDrive pages use a heading followed by a paragraph instead of ep-buttons-wrap.
        if (!groups.length) {
            const tokenRegex = /<h[2-5]\b([^>]*)>([\s\S]*?)<\/h[2-5]>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
            let currentEpisode = 0;
            let token;
            const byEpisode = Object.create(null);
            while ((token = tokenRegex.exec(input)) !== null) {
                if (token[1] != null) {
                    const heading = stripTags(token[2]);
                    const number = heading.match(/episodes?\s*[:#-]?\s*(\d{1,3})/i);
                    currentEpisode = number ? (parseInt(number[1], 10) || 0) : 0;
                    continue;
                }
                if (!currentEpisode) continue;
                const attrs = parseAttrs(token[3]);
                const href = resolveUrl(pageUrl, attrs.href || "");
                if (!href || (!isKnownLinkHost(href) && !isDirectMediaUrl(href))) continue;
                if (!byEpisode[currentEpisode]) byEpisode[currentEpisode] = [];
                byEpisode[currentEpisode].push({
                    url: href,
                    label: [pageQuality, stripTags(token[4])].filter(Boolean).join(" â€¢ "),
                    quality: pageQuality,
                    referer: pageUrl
                });
            }
            Object.keys(byEpisode).forEach(function (episode) {
                groups.push({ season: season, episode: parseInt(episode, 10), links: byEpisode[episode] });
            });
        }
        return groups;
    }

    async function buildEpisodes(detail) {
        const intermediaryEntries = detail.entries.filter(function (entry) {
            return !isDirectMediaUrl(entry.url);
        }).slice(0, 14);
        const responses = await getMany(intermediaryEntries.map(function (entry) {
            return { url: entry.url, referer: entry.referer || detail.urls[0] || "" };
        }));
        const map = Object.create(null);

        responses.forEach(function (response, index) {
            if (!response || response.status < 200 || response.status >= 400 || !response.body || isChallengePage(response.body)) return;
            const groups = parseEpisodeGroups(response.body, response.finalUrl || response.requestUrl, intermediaryEntries[index]);
            groups.forEach(function (group) {
                const key = group.season + ":" + group.episode;
                if (!map[key]) map[key] = { season: group.season, episode: group.episode, links: [] };
                const known = Object.create(null);
                map[key].links.forEach(function (link) { known[link.url] = true; });
                group.links.forEach(function (link) {
                    if (!known[link.url]) {
                        known[link.url] = true;
                        map[key].links.push(link);
                    }
                });
            });
        });

        let groups = Object.keys(map).map(function (key) { return map[key]; });
        groups.sort(function (a, b) { return a.season === b.season ? a.episode - b.episode : a.season - b.season; });

        if (!groups.length && detail.entries.length) {
            // A few posts expose only a complete-season ZIP. Keep it as an explicit pack,
            // rather than inventing episode numbers that do not exist on the source page.
            groups = [{ season: seasonFromText(detail.title), episode: 0, links: detail.entries.slice(0, 20), pack: true }];
        }

        return groups.map(function (group) {
            const name = group.pack ? "Season " + group.season + " Pack / All Episodes" :
                "S" + String(group.season).padStart(2, "0") + "E" + String(group.episode).padStart(2, "0");
            return new Episode({
                name: name,
                url: makeState("episode", {
                    title: detail.title,
                    season: group.season,
                    episode: group.episode,
                    links: group.links.slice(0, 24)
                }),
                season: group.season,
                episode: group.episode,
                posterUrl: detail.poster || "",
                description: group.pack ? "Complete-season download mirrors supplied by Vega." : "Multiple quality and host mirrors are resolved at playback time.",
                dubStatus: /hindi|dual audio|multi audio/i.test(detail.title) ? "dubbed" : "none",
                headers: detail.urls.length ? { Referer: detail.urls[0], "User-Agent": USER_AGENT } : undefined
            });
        });
    }

    async function load(url, cb) {
        try {
            const state = parseState(url);
            let stateData;
            let urls;
            if (state && state.kind === "item") {
                stateData = state.data || {};
                urls = stateData.urls || [];
            } else if (/^https?:\/\//i.test(String(url || ""))) {
                stateData = { title: "", key: canonicalItemKey("", url), urls: [url] };
                urls = [url];
            } else {
                return cb({ success: false, errorCode: "BAD_URL", message: "Unsupported Vega item URL." });
            }

            let details = await fetchDetails(urls, true);
            if (!details.length) {
                return cb({ success: false, errorCode: "DETAIL_UNAVAILABLE", message: "Every candidate mirror failed or returned an anti-bot page." });
            }

            if ((!urls || urls.length < 3) && (stateData.title || details[0].title)) {
                const discovered = await discoverMatchingUrls(stateData.title || details[0].title, stateData.key || canonicalItemKey(details[0].title, details[0].url));
                const missing = uniqueStrings(discovered).filter(function (candidate) {
                    return urls.indexOf(candidate) < 0;
                });
                if (missing.length) {
                    const extraDetails = await fetchDetails(missing, false);
                    details = details.concat(extraDetails);
                }
            }

            const merged = mergeDetails(details, stateData);
            const mediaUrl = makeState("item", {
                key: merged.key,
                title: merged.title,
                type: merged.type,
                urls: merged.urls.slice(0, 10)
            });

            let episodes;
            if (merged.type === "series" || merged.type === "anime") {
                episodes = await buildEpisodes(merged);
            } else {
                // SkyStream enables its Play/Download controls only when details
                // contain at least one Episode, including movies. This mirrors the
                // maintained 4KHDHub provider's â€œFull Movieâ€ episode contract.
                episodes = [new Episode({
                    name: "Full Movie",
                    season: 1,
                    episode: 1,
                    url: mediaUrl,
                    posterUrl: merged.poster || "",
                    description: "All available Vega mirrors and qualities",
                    dubStatus: /hindi|dual audio|multi audio/i.test(merged.title) ? "dubbed" : "none",
                    headers: merged.urls.length ? { Referer: merged.urls[0], "User-Agent": USER_AGENT } : undefined
                })];
            }

            cb({
                success: true,
                data: new MultimediaItem({
                    title: merged.title,
                    url: mediaUrl,
                    posterUrl: merged.poster || "",
                    bannerUrl: merged.poster || "",
                    type: merged.type,
                    description: merged.description || "",
                    year: merged.year,
                    duration: merged.duration,
                    score: merged.score,
                    tags: merged.tags,
                    episodes: episodes,
                    isAdult: !!merged.adult,
                    status: "completed",
                    headers: merged.urls.length ? { Referer: merged.urls[0], "User-Agent": USER_AGENT } : undefined
                })
            });
        } catch (error) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: errorText(error) });
        }
    }

    function isDirectMediaUrl(url) {
        const value = String(url || "").replace(/\\\//g, "/");
        if (/^magnet:/i.test(value)) return false;
        return /\.(?:m3u8|mp4|mkv|webm|mov|m4v|mpd)(?:[?#]|$)/i.test(value) ||
            /\/api\/file\/[^/?#]+\?download(?:&|$)/i.test(value);
    }

    function gatewayKind(url) {
        const host = hostname(url);
        if (/^nexdrive\./i.test(host)) return "nexdrive";
        if (/^vgmlinks\./i.test(host)) return "vgmlinks";
        if (/^(?:www\.)?vcloud\./i.test(host)) return "vcloud";
        if (/^(?:www\.)?hubcloud\./i.test(host)) return "hubcloud";
        if (/^fast-dl\./i.test(host)) return "fastdl";
        if (/^filepress\./i.test(host)) return "filepress";
        if (/^gdtot\./i.test(host)) return "gdtot";
        if (/^dropgalaxy\./i.test(host)) return "dropgalaxy";
        return "";
    }

    function knownExtractorHost(url) {
        const host = hostname(url);
        return /(?:^|\.)(?:mixdrop\.|streamtape\.|filemoon\.|dood\.|voe\.|pixeldrain\.|gofile\.io$)/i.test(host);
    }

    function pixelDrainDirect(url) {
        const match = String(url || "").match(/https?:\/\/(?:www\.)?pixeldrain\.(?:com|dev)\/u\/([^/?#]+)/i);
        if (!match) return "";
        const base = originOf(url);
        return base + "/api/file/" + match[1] + "?download";
    }

    function decodeDoubleAtob(html) {
        const match = String(html || "").match(/\bvar\s+url\s*=\s*atob\s*\(\s*atob\s*\(\s*["']([^"']+)["']\s*\)\s*\)/i);
        if (!match) return "";
        try { return atob(atob(match[1])); } catch (_) { return ""; }
    }

    function rot13(value) {
        let out = "";
        const input = String(value || "");
        for (let i = 0; i < input.length; i++) {
            const code = input.charCodeAt(i);
            if (code >= 65 && code <= 90) out += String.fromCharCode(((code - 65 + 13) % 26) + 65);
            else if (code >= 97 && code <= 122) out += String.fromCharCode(((code - 97 + 13) % 26) + 97);
            else out += input.charAt(i);
        }
        return out;
    }

    function decodeChunkedRedirect(html) {
        try {
            let combined = "";
            const regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
            let match;
            while ((match = regex.exec(String(html || ""))) !== null) combined += match[1] || match[2] || "";
            if (!combined) return "";
            const stage1 = atob(combined);
            const stage2 = rot13(atob(stage1));
            const object = JSON.parse(atob(stage2));
            return object && object.o ? atob(object.o).trim() : "";
        } catch (_) {
            return "";
        }
    }

    function extractMediaUrls(html, baseUrl) {
        let text = String(html || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
        if (text.indexOf("p,a,c,k,e,d") >= 0 && typeof getAndUnpack === "function") {
            try { text += "\n" + String(getAndUnpack(text) || ""); } catch (_) {}
        }
        const out = [];
        const seen = Object.create(null);
        const absolute = /https?:\/\/[^\s"'<>\\\]]+/gi;
        let match;
        while ((match = absolute.exec(text)) !== null) {
            let value = match[0].replace(/[),;]+$/, "");
            if (!isDirectMediaUrl(value)) continue;
            const pixel = pixelDrainDirect(value);
            if (pixel) value = pixel;
            if (!seen[value]) { seen[value] = true; out.push(value); }
        }
        const relative = /["'](\/[^"']+\.(?:m3u8|mp4|mkv|webm|mpd)(?:\?[^"']*)?)["']/gi;
        while ((match = relative.exec(text)) !== null) {
            const value = resolveUrl(baseUrl, match[1]);
            if (value && !seen[value]) { seen[value] = true; out.push(value); }
        }
        return out;
    }

    function extractTurnstileKey(html) {
        const regex = /<[^>]+class=["'][^"']*cf-turnstile[^"']*["'][^>]*>/gi;
        const match = regex.exec(String(html || ""));
        if (!match) return "";
        return parseAttrs(match[0])["data-sitekey"] || "";
    }

    function isTurnstileGate(html) {
        const text = String(html || "");
        return /cf-turnstile/i.test(text) && /click\s+to\s+verify|solve\s+captcha|download-button/i.test(text);
    }

    function directServerByLabel(url, label) {
        if (!url || gatewayKind(url)) return false;
        if (isDirectMediaUrl(url) || pixelDrainDirect(url)) return true;
        return /\b(?:fsl(?:v2)?\s*server|s3\s*server|mega\s*server|download\s*file|server\s*:\s*10gbps|buzzserver|direct\s*server|zipdisk)\b/i.test(String(label || ""));
    }

    function parseDynamicHrefMap(html, baseUrl) {
        const map = Object.create(null);
        const patterns = [
            /\$\(\s*["']#([^"']+)["']\s*\)\.attr\(\s*["']href["']\s*,\s*["']([^"']+)["']\s*\)/gi,
            /document\.getElementById\(\s*["']([^"']+)["']\s*\)\.href\s*=\s*["']([^"']+)["']/gi
        ];
        patterns.forEach(function (pattern) {
            let match;
            while ((match = pattern.exec(String(html || ""))) !== null) map[match[1]] = resolveUrl(baseUrl, match[2]);
        });
        return map;
    }

    function extractPageLinks(html, pageUrl, inheritedLabel) {
        const out = [];
        const seen = Object.create(null);
        const dynamicHrefMap = parseDynamicHrefMap(html, pageUrl);
        const decoded = decodeDoubleAtob(html);
        if (decoded) {
            const target = resolveUrl(pageUrl, decoded);
            if (target) {
                seen[target] = true;
                out.push({ url: target, label: inheritedLabel || "V-Cloud", referer: pageUrl, quality: extractQuality(inheritedLabel) });
            }
        }

        const chunkedRedirect = decodeChunkedRedirect(html);
        if (chunkedRedirect) {
            const target = resolveUrl(pageUrl, chunkedRedirect);
            if (target && !seen[target]) {
                seen[target] = true;
                out.push({ url: target, label: inheritedLabel || "Redirect", referer: pageUrl, quality: extractQuality(inheritedLabel) });
            }
        }

        const simpleUrl = String(html || "").match(/\bvar\s+url\s*=\s*["']([^"']+)["']/i);
        if (simpleUrl) {
            const target = resolveUrl(pageUrl, simpleUrl[1]);
            if (target && !seen[target]) {
                seen[target] = true;
                out.push({ url: target, label: inheritedLabel || "Mirror", referer: pageUrl, quality: extractQuality(inheritedLabel) });
            }
        }

        const pxl = String(html || "").match(/\bvar\s+pxl\s*=\s*["']([^"']+)["']/i);
        if (pxl) {
            const target = pixelDrainDirect(pxl[1]) || pxl[1];
            if (target && !seen[target]) {
                seen[target] = true;
                out.push({ url: target, label: "Pixeldrain", referer: pageUrl, quality: extractQuality(inheritedLabel) });
            }
        }

        const metaRefresh = String(html || "").match(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url\s*=\s*([^"';>]+)["']/i);
        if (metaRefresh) {
            const target = resolveUrl(pageUrl, metaRefresh[1]);
            if (target && !seen[target]) {
                seen[target] = true;
                out.push({ url: target, label: inheritedLabel || "Redirect", referer: pageUrl, quality: extractQuality(inheritedLabel) });
            }
        }

        const locationRegex = /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/gi;
        let locationMatch;
        while ((locationMatch = locationRegex.exec(String(html || ""))) !== null) {
            const target = resolveUrl(pageUrl, locationMatch[1]);
            if (target && !seen[target]) {
                seen[target] = true;
                out.push({ url: target, label: inheritedLabel || "Redirect", referer: pageUrl, quality: extractQuality(inheritedLabel) });
            }
        }

        allAnchors(html).forEach(function (anchor) {
            let href = resolveUrl(pageUrl, dynamicHrefMap[anchor.id] || anchor.href);
            if (!href || /(?:t\.me|telegram|facebook|twitter|instagram|javascript:)/i.test(href)) return;
            const pixel = pixelDrainDirect(href);
            if (pixel) href = pixel;
            const label = [inheritedLabel, anchor.text].filter(Boolean).join(" â€¢ ");
            if (!isKnownLinkHost(href) && !isDirectMediaUrl(href) && !directServerByLabel(href, anchor.text) && !knownExtractorHost(href)) return;
            if (seen[href]) return;
            seen[href] = true;
            out.push({ url: href, label: label || hostname(href), referer: pageUrl, quality: extractQuality(label) });
        });

        extractMediaUrls(html, pageUrl).forEach(function (url) {
            if (seen[url]) return;
            seen[url] = true;
            out.push({ url: url, label: inheritedLabel || "Direct", referer: pageUrl, quality: extractQuality(inheritedLabel) });
        });
        return out;
    }

    async function refreshDynamicHosts() {
        if (hostConfigLoaded) return;
        hostConfigLoaded = true;
        try {
            const response = await getOne(HOST_CONFIG_URL, "", false);
            if (!response || response.status < 200 || response.status >= 400 || !response.body) return;
            const config = JSON.parse(response.body);
            if (/^https?:\/\//i.test(String(config.vcloud || ""))) dynamicVCloudBase = String(config.vcloud).replace(/\/+$/, "");
            if (/^https?:\/\//i.test(String(config.hubcloud || ""))) dynamicHubCloudBase = String(config.hubcloud).replace(/\/+$/, "");
        } catch (_) {}
    }

    function gatewayAlternates(url) {
        const kind = gatewayKind(url);
        const path = pathOf(url);
        if (kind === "vcloud") {
            return uniqueStrings([
                dynamicVCloudBase + path,
                "https://vcloud.zip" + path,
                url
            ]);
        }
        if (kind === "hubcloud") {
            return uniqueStrings([
                url,
                dynamicHubCloudBase + path,
                "https://hubcloud.dad" + path
            ]);
        }
        return [];
    }

    function normalizeSourceLabel(label, url) {
        let text = stripTags(label || "")
            .replace(/[â¬‡ï¸âš¡âœ…]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (text.length > 110) text = text.slice(0, 107) + "â€¦";
        return text || hostname(url) || "Vega mirror";
    }

    function makeStream(url, label, referer, explicitHeaders) {
        const headers = Object.assign({}, explicitHeaders || {});
        if (referer && !headers.Referer) headers.Referer = referer;
        if (!headers["User-Agent"]) headers["User-Agent"] = USER_AGENT;
        return new StreamResult({
            url: url,
            source: normalizeSourceLabel(label, url),
            headers: headers
        });
    }

    async function tryNativeExtractor(entry) {
        if (typeof globalThis.loadExtractor !== "function") return [];
        if (!knownExtractorHost(entry.url) && gatewayKind(entry.url) !== "hubcloud") return [];

        const found = [];
        const seen = Object.create(null);
        function accept(link) {
            if (!link || !link.url || seen[link.url]) return;
            seen[link.url] = true;
            const headers = Object.assign({}, link.headers || {});
            if ((link.referer || entry.referer) && !headers.Referer) headers.Referer = link.referer || entry.referer;
            if (!headers["User-Agent"]) headers["User-Agent"] = USER_AGENT;
            found.push(new StreamResult({
                url: link.url,
                source: normalizeSourceLabel(link.source || link.name || entry.label, link.url),
                headers: headers,
                subtitles: link.subtitles,
                drmKid: link.drmKid,
                drmKey: link.drmKey,
                licenseUrl: link.licenseUrl,
                quality: link.quality
            }));
        }

        try {
            // Current maintained plugins use callback form. Also accept an array
            // return for runtimes implementing the older Promise-based SDK shape.
            const returned = await globalThis.loadExtractor(entry.url, accept);
            if (Array.isArray(returned)) returned.forEach(accept);
        } catch (_) {
            return [];
        }
        return found;
    }

    async function solveTurnstileGate(gate) {
        if (!gate || typeof solveCaptcha !== "function") return null;
        const siteKey = extractTurnstileKey(gate.body);
        if (!siteKey) return null;
        try {
            const token = await solveCaptcha(siteKey, gate.url);
            if (!token || token === "mock_captcha_token") return null;
            const body = "cf-turnstile-response=" + encodeURIComponent(token) +
                "&g-recaptcha-response=" + encodeURIComponent(token);
            const headers = requestHeaders(gate.referer || gate.url);
            headers["Content-Type"] = "application/x-www-form-urlencoded";
            // If verification redirects straight to a large file, request only a probe range.
            headers.Range = "bytes=0-1";
            const raw = await http_post(gate.url, headers, body);
            return normalizeResponse(raw, gate.url);
        } catch (_) {
            return null;
        }
    }

    async function resolveEntries(seedEntries, allowCaptcha) {
        const streams = [];
        const streamSeen = Object.create(null);
        const visited = Object.create(null);
        const queued = Object.create(null);
        const gates = [];
        let queue = [];
        let pageBudget = MAX_INTERMEDIARY_PAGES;

        function addStream(stream) {
            if (!stream || !stream.url || streamSeen[stream.url]) return;
            streamSeen[stream.url] = true;
            streams.push(stream);
        }

        function enqueue(entry, depth) {
            if (!entry || !entry.url || !/^https?:\/\//i.test(entry.url)) return;
            const url = entry.url.replace(/&amp;/g, "&");
            if (queued[url] || visited[url]) return;
            queued[url] = true;
            queue.push({
                url: url,
                label: entry.label || hostname(url),
                quality: entry.quality || extractQuality(entry.label),
                referer: entry.referer || "",
                depth: depth || 0
            });
        }

        (seedEntries || []).forEach(function (entry) {
            const pixel = pixelDrainDirect(entry.url);
            if (pixel) addStream(makeStream(pixel, (entry.label || "") + " â€¢ Pixeldrain", entry.referer));
            else if (isDirectMediaUrl(entry.url)) addStream(makeStream(entry.url, entry.label, entry.referer));
            else enqueue(entry, 0);
        });

        function resolverPriority(entry) {
            if (isDirectMediaUrl(entry.url) || pixelDrainDirect(entry.url)) return 0;
            const kind = gatewayKind(entry.url);
            if (kind === "vcloud" || kind === "hubcloud") return 1;
            if (knownExtractorHost(entry.url)) return 2;
            if (kind === "nexdrive") return 3;
            if (kind === "vgmlinks") return 4;
            if (kind === "fastdl") return 5;
            return 6;
        }

        for (let depth = 0; depth <= MAX_RESOLVER_DEPTH && queue.length && pageBudget > 0; depth++) {
            const current = queue.filter(function (entry) { return entry.depth === depth; })
                .sort(function (a, b) { return resolverPriority(a) - resolverPriority(b); })
                .slice(0, pageBudget);
            queue = queue.filter(function (entry) { return entry.depth !== depth; });
            if (!current.length) continue;
            pageBudget -= current.length;

            const expanded = [];
            current.forEach(function (entry) {
                delete queued[entry.url];
                if (visited[entry.url]) return;
                visited[entry.url] = true;
                const alternatives = gatewayAlternates(entry.url);
                expanded.push(entry);
                if (alternatives.length > 1) {
                    alternatives.forEach(function (url) {
                        if (url !== entry.url && !visited[url]) expanded.push(Object.assign({}, entry, { url: url }));
                    });
                }
            });

            const nativeResults = await Promise.all(expanded.map(tryNativeExtractor));
            nativeResults.forEach(function (links) { links.forEach(addStream); });

            const toFetch = expanded.filter(function (entry) {
                const pixel = pixelDrainDirect(entry.url);
                if (pixel) {
                    addStream(makeStream(pixel, entry.label + " â€¢ Pixeldrain", entry.referer));
                    return false;
                }
                if (isDirectMediaUrl(entry.url) || directServerByLabel(entry.url, entry.label)) {
                    addStream(makeStream(entry.url, entry.label, entry.referer));
                    return false;
                }
                return true;
            });
            if (!toFetch.length) continue;

            // Extraction requests use individual http_get calls, matching the
            // maintained providers. Besides preserving per-request cookies, this
            // lets SkyStream associate Cloudflare WebView clearance with this
            // plugin namespace (http_parallel cannot carry that caller context).
            const responses = await Promise.all(toFetch.map(function (entry) {
                const kind = gatewayKind(entry.url);
                const extraHeaders = (kind === "vcloud" || kind === "hubcloud") ? { Cookie: "xla=s4t" } : {};
                return getOne(entry.url, entry.referer || "", true, extraHeaders);
            }));

            responses.forEach(function (response, index) {
                const entry = toFetch[index];
                if (!response) return;
                const finalUrl = response.finalUrl || entry.url;
                const contentType = headerValue(response.headers, "content-type").toLowerCase();
                if ((/^video\//.test(contentType) || /application\/(?:octet-stream|x-matroska)/.test(contentType) || isDirectMediaUrl(finalUrl)) && !/text\/html/.test(contentType)) {
                    addStream(makeStream(finalUrl, entry.label, entry.referer));
                    return;
                }
                if (response.status < 200 || response.status >= 400 || !response.body || isChallengePage(response.body)) return;
                if (isTurnstileGate(response.body)) {
                    gates.push({ url: entry.url, body: response.body, referer: entry.referer, label: entry.label });
                    return;
                }
                const links = extractPageLinks(response.body, finalUrl, entry.label);
                links.forEach(function (link) {
                    if (isDirectMediaUrl(link.url) || pixelDrainDirect(link.url) || directServerByLabel(link.url, link.label)) {
                        const direct = pixelDrainDirect(link.url) || link.url;
                        addStream(makeStream(direct, link.label, link.referer));
                    } else if (entry.depth < MAX_RESOLVER_DEPTH) {
                        enqueue(link, entry.depth + 1);
                    }
                });
            });
        }

        if (!streams.length && allowCaptcha && gates.length) {
            // One user-visible challenge at most. Mirror redundancy is exhausted first.
            // Prefer V-Cloud/HubCloud because their post-verification page exposes
            // several resumable/direct servers, unlike a single-use fast-download gate.
            gates.sort(function (a, b) {
                function priority(gate) {
                    const kind = gatewayKind(gate.url);
                    if (kind === "vcloud" || kind === "hubcloud") return 0;
                    if (kind === "vgmlinks") return 1;
                    if (kind === "fastdl") return 2;
                    return 3;
                }
                return priority(a) - priority(b);
            });
            const selectedGate = gates[0];
            const solved = await solveTurnstileGate(selectedGate);
            if (solved) {
                const contentType = headerValue(solved.headers, "content-type").toLowerCase();
                if ((/^video\//.test(contentType) || /application\/(?:octet-stream|x-matroska)/.test(contentType) || isDirectMediaUrl(solved.finalUrl)) && !/text\/html/.test(contentType)) {
                    addStream(makeStream(solved.finalUrl, selectedGate.label, selectedGate.referer));
                } else if (solved.body && !isTurnstileGate(solved.body)) {
                    const links = extractPageLinks(solved.body, solved.finalUrl || solved.requestUrl, selectedGate.label);
                    const nested = await resolveEntries(links, false);
                    nested.forEach(addStream);
                }
            }
        }
        return streams;
    }

    async function playerSeeds(players) {
        if (!players || !players.length) return [];
        const scripts = uniqueStrings(players.map(function (player) { return player.scriptUrl; }));
        const responses = await getMany(scripts.map(function (url) { return { url: url, referer: "" }; }));
        const domainByScript = Object.create(null);
        responses.forEach(function (response, index) {
            if (!response || response.status < 200 || response.status >= 400) return;
            const match = response.body.match(/(?:AwsIndStreamDomain|playerDomain|streamDomain)\s*=\s*["'](https?:\/\/[^"']+)["']/i);
            if (match) domainByScript[scripts[index]] = match[1].replace(/\/+$/, "");
        });
        const out = [];
        players.forEach(function (player) {
            const domain = domainByScript[player.scriptUrl];
            if (!domain) return;
            out.push({ url: domain + "/play/" + encodeURIComponent(player.id), label: "Watch Online", referer: player.referer });
        });
        return out;
    }

    function coreLookupTitle(value) {
        let text = cleanDisplayTitle(value)
            .replace(/\[[^\]]*\]/g, " ")
            .replace(/\([^)]*\)/g, " ");
        const year = text.search(/\b(?:19|20)\d{2}\b/);
        if (year > 0) text = text.slice(0, year);
        return text.toLowerCase()
            .replace(/\b(?:download|watch|season|episode|episodes|complete|all|hindi|english|tamil|telugu|korean|french|dual|multi|audio|dubbed|movie|series|web|webrip|webdl|bluray|hdtc|hevc|x264|x265|4k|2160p|1080p|720p|480p)\b/g, " ")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function titleSimilarity(left, right) {
        const a = coreLookupTitle(left);
        const b = coreLookupTitle(right);
        if (!a || !b) return 0;
        if (a === b) return 1;
        if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 0.9;
        const aWords = a.split(" ");
        const bWords = b.split(" ");
        let overlap = 0;
        aWords.forEach(function (word) { if (bWords.indexOf(word) >= 0) overlap++; });
        return overlap / Math.max(aWords.length, bWords.length);
    }

    async function findRescueItem(title, requestedType) {
        const query = coreLookupTitle(title);
        if (!query || query.length < 3) return null;
        const response = await getOne(RESCUE_BASE + "/?s=" + encodeURIComponent(query), RESCUE_BASE + "/", true);
        if (!response || response.status < 200 || response.status >= 400 || !response.body) return null;
        const items = parseListing(response.body, RESCUE_BASE + "/", 100);
        let best = null;
        let bestScore = 0;
        items.forEach(function (item) {
            const urlType = /-series-|\/series\//i.test(item.url) ? "series" : "movie";
            if ((requestedType === "series" || requestedType === "anime") && urlType !== "series") return;
            if (requestedType === "movie" && urlType !== "movie") return;
            const score = titleSimilarity(title, item.title);
            if (score > bestScore) {
                bestScore = score;
                best = item;
            }
        });
        return bestScore >= 0.72 ? best : null;
    }

    async function rescueHubCloudSeeds(context) {
        if (!context || !context.title) return [];
        try {
            const requestedType = context.type || (context.episode != null ? "series" : "movie");
            const item = await findRescueItem(context.title, requestedType);
            if (!item) return [];
            const response = await getOne(item.url, RESCUE_BASE + "/", true);
            if (!response || response.status < 200 || response.status >= 400 || !response.body) return [];

            const wantedSeason = parseInt(context.season, 10) || 0;
            const wantedEpisode = parseInt(context.episode, 10) || 0;
            const out = [];
            const seen = Object.create(null);
            allAnchors(response.body).forEach(function (anchor) {
                const href = resolveUrl(item.url, anchor.href);
                if (!/https?:\/\/hubcloud\./i.test(href) || seen[href]) return;
                const surrounding = response.body.slice(Math.max(0, anchor.index - 1800), anchor.index + anchor.inner.length + 300);
                const contextText = stripTags(surrounding);
                const marker = contextText.match(/\bS(\d{1,3})E(\d{1,3})\b/i);

                if (wantedEpisode > 0) {
                    if (!marker) return;
                    if ((parseInt(marker[1], 10) || 0) !== wantedSeason || (parseInt(marker[2], 10) || 0) !== wantedEpisode) return;
                } else if (requestedType === "movie" && marker) {
                    return;
                }

                seen[href] = true;
                const quality = extractQuality(contextText + " " + anchor.text);
                out.push({
                    url: href,
                    label: ["Vega rescue HubCloud", quality, anchor.text].filter(Boolean).join(" â€¢ "),
                    quality: quality,
                    referer: item.url
                });
            });
            return out.slice(0, 20);
        } catch (_) {
            return [];
        }
    }

    async function seedsFromItemState(data) {
        const details = await fetchDetails((data && data.urls) || [], true);
        if (!details.length) return [];
        const merged = mergeDetails(details, data || {});
        const players = await playerSeeds(merged.players);
        return merged.entries.concat(players);
    }

    async function loadStreams(url, cb) {
        try {
            await refreshDynamicHosts();
            const state = parseState(url);
            let seeds = [];
            let rescueContext = null;
            if (state && state.kind === "episode") {
                rescueContext = Object.assign({ type: "series" }, state.data || {});
                seeds = (state.data && state.data.links) || [];
            } else if (state && state.kind === "item") {
                rescueContext = state.data || {};
                seeds = await seedsFromItemState(state.data || {});
            } else if (/^https?:\/\//i.test(String(url || ""))) {
                const host = hostname(url);
                if (DOMAINS.some(function (domain) { return hostname(domain) === host; }) || /vegamovie/i.test(host)) {
                    seeds = await seedsFromItemState({ urls: [url], title: "", key: canonicalItemKey("", url) });
                } else {
                    seeds = [{ url: url, label: hostname(url), referer: "" }];
                }
            } else {
                return cb({ success: false, errorCode: "BAD_URL", message: "Unsupported stream URL." });
            }

            let streams = seeds.length ? await resolveEntries(seeds, true) : [];

            // Vega's NexDrive/V-Cloud domains periodically put every route behind
            // a human Turnstile. If that happens, resolve the same title through
            // the maintained 4KHDHub-style HubCloud path supplied as the working
            // reference. It is strictly a last resort; Vega mirrors remain first.
            if (!streams.length && rescueContext) {
                const rescueSeeds = await rescueHubCloudSeeds(rescueContext);
                if (rescueSeeds.length) streams = await resolveEntries(rescueSeeds, false);
            }

            if (!streams.length) {
                return cb({
                    success: false,
                    errorCode: seeds.length ? "NO_DIRECT_STREAMS" : "NO_MIRRORS",
                    message: "No playable direct source survived the Vega mirrors or the compatible HubCloud rescue path."
                });
            }
            streams.sort(function (a, b) {
                return (parseInt(extractQuality(b.source), 10) || 0) - (parseInt(extractQuality(a.source), 10) || 0);
            });
            cb({ success: true, data: streams });
        } catch (error) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: errorText(error) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
