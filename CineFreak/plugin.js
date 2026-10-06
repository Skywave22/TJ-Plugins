(function() {
    "use strict";

    // ═══════════════════════════════════════════════════════════
    //  CineFreak (cinefreak.net) — SkyStream plugin
    //
    //  WordPress download site with its own streaming backend.
    //
    //  SEARCH   GET /search-api.php?q=<query>&pg=<page>
    //           -> { results: [ { t: title, l: slug, i: poster,
    //                c: category, q: quality, tmdb: tmdbId } ],
    //                total, page, total_pages }
    //
    //  DETAIL   GET https://cinefreak.net/<slug>/
    //           page embeds a minified player dataset:
    //             const dataset = {"type":"movie","is_combo":false,
    //               "sources":{"1080p":"cd4a0171","720p":"d23b7aee",...}};
    //           or for series:
    //             const dataset={"type":"series","is_combo":!1,
    //               "seasons":[{ "episodes":[ { "ep_num":"01",
    //                 "sources":{...} }, ... ] }, ...]};
    //           (!1 / !0 are minified false / true -> fixed before parse)
    //
    //  PREPARE  GET  stream-prepare.php?action=status&r720p=<tok>... -> {state}
    //           POST stream-prepare.php?action=start&...  (when not "ready")
    //  PLAYBACK GET https://subtitle.yagaverse.net/stream-api.php
    //             ?key=pushpa&r480p=<tok>&r720p=<tok>&r1080p=<tok>
    //             &id=<primary token>
    //           -> { videoUrl, resolutions: [ { quality, url } ],
    //                audioTracks, subtitleTracks }
    //           The URLs are DIRECT files on Cloudflare R2
    //           (pub-*.r2.dev) — verified HTTP 206 on Range with no
    //           Referer/Origin needed. User-Agent only.
    //
    //  APP CONTRACT (SkyStream engine): every exported function takes a
    //  callback and MUST resolve exactly once with
    //      { success: true, data: <payload> }   on success
    //      { success: false, errorCode, message } on failure
    //  Returning a raw Map is rejected by the engine
    //  (JsPluginException UNKNOWN_ERROR) — envelope is mandatory.
    //  Episode objects use `name` (not `title`) + int season/episode.
    // ═══════════════════════════════════════════════════════════

    // Dynamic base URL: the app injects the domain the user picked in the
    // plugin's settings gear (mirrors), so never hardcode the primary host.
    const SITE       = (typeof manifest !== "undefined" && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, "")
        : "https://cinefreak.net";
    const STREAM_API = "https://subtitle.yagaverse.net/stream-api.php";
    const STREAM_KEY = "pushpa";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // Plain headers only: spoofed X-Forwarded-For / CF-Connecting-IP / True-Client-IP
    // don't change the caller's location, and Cloudflare answers them with HTTP 403.
    function mergeGeoHeaders(base) { return Object.assign({}, base || {}); }


    const HTML_HEADERS = mergeGeoHeaders({
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": SITE + "/"
    }, false);
    const JSON_HEADERS = mergeGeoHeaders({
        "User-Agent": UA,
        "Accept": "application/json",
        "Referer": SITE + "/"
    }, false);
    const STREAM_HEADERS = mergeGeoHeaders({ "User-Agent": UA }, false);

    // ─────────────────────────── helpers ───────────────────────────

    function mkItem(obj)    { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj)  { try { return new StreamResult(obj); } catch (_) { return obj; } }

    function withTimeout(promise, ms) {
        return Promise.race([
            Promise.resolve(promise),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })
        ]);
    }

    async function fetchHtml(url) {
        const r = await withTimeout(http_get(url, HTML_HEADERS), 25000);
        return (r && r.body) || "";
    }

    async function fetchJson(url, headers) {
        const r = await withTimeout(http_get(url, headers || JSON_HEADERS), 25000);
        try { return JSON.parse((r && r.body) || "{}"); } catch (e) { return {}; }
    }

    function decodeEntities(s) {
        return String(s || "")
            .replace(/&#0?38;|&amp;/g, "&")
            .replace(/&#0?8211;|&ndash;/g, "–")
            .replace(/&quot;/g, "\"")
            .replace(/&#0?39;|&apos;/g, "'")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    }

    // "Moana (2026) English WEB-DL 480p, 720p & 1080p | HEVC | Full Movie
    //  Download & Watch Online – GDrive | ESub | CineFreak details"
    //   -> "Moana (2026) English"
    function cleanTitle(t) {
        let s = decodeEntities(t).replace(/\s+details\s*$/i, "");
        s = s.replace(/\s*[–|-]\s*(GDrive|ESub|CineFreak|HD).*$/i, "");
        s = s.replace(/\s*\|\s*(HEVC|ESub|GDrive|CineFreak).*$/i, "");
        s = s.replace(/\b(WEB-?DL|BluRay|HDRip|HDTV|WEBRip|DVDRip)\b.*$/i, "");
        s = s.replace(/\s*(?:Download|Watch\s+Online)\b.*$/i, "");
        s = s.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
        s = s.replace(/\s*&\s*$/, "").replace(/\s*,\s*$/, "").trim();
        return s || decodeEntities(t);
    }

    // ─────────────────────── poster fix ────────────────────────────
    // External image hosts (image.tmdb.org, cineimg.xyz, …) are blocked on
    // some ISPs — route every external poster through the weserv.nl image
    // proxy (reachable everywhere). Same-site URLs pass through unchanged.
    function fixPoster(u) {
        const s = decodeEntities(u || "");
        if (!s || s.indexOf("http") !== 0) return s;
        if (s.indexOf("cinefreak.net/") !== -1) return s;
        if (s.indexOf("images.weserv.nl/") !== -1) return s;
        return "https://images.weserv.nl/?url=" + encodeURIComponent(s.replace(/^https?:\/\//, ""));
    }

    // ─────────────────────── language labels ───────────────────────
    // Stream files are named like "CINEFREAK.TOP - Title [Hindi] 720p
    // ESub.mkv". Dual-audio files (e.g. "[Hindi-Malayalam]") contain BOTH
    // audio tracks in ONE file — labelled as Dual Audio so users switch
    // language via the PLAYER's audio-track menu, not by picking a stream.
    function langOf(url) {
        let s = "";
        try { s = decodeURIComponent(String(url || "")); } catch (e) { s = String(url || ""); }
        const known = ["Hindi", "English", "Bengali", "Bangla", "Tamil", "Telugu", "Kannada",
                       "Malayalam", "Punjabi", "Marathi", "Urdu", "Turkish", "Chinese", "Mandarin",
                       "Cantonese", "Japanese", "Korean", "Spanish", "Indonesian", "Arabic", "French"];
        const found = [];
        const addLang = function (tag) {
            for (let i = 0; i < known.length; i++) {
                if (tag.toLowerCase() === known[i].toLowerCase()) {
                    if (found.indexOf(known[i]) < 0) found.push(known[i]);
                    return;
                }
            }
        };
        // bracket tags, including hyphen/slash/comma separated lists:
        // [Hindi], [Hindi-Malayalam], [Hindi/Tamil], [Hindi, Telugu] ...
        const bracketRe = /\[([A-Za-z][A-Za-z \-+/,&]{1,30})\]/g;
        let m;
        while ((m = bracketRe.exec(s)) !== null) {
            m[1].split(/[\-+/,& ]+/).forEach(function (tok) {
                if (tok.length >= 3) addLang(tok);
            });
        }
        if (!found.length) {
            for (let i = 0; i < known.length; i++) {
                if (found.indexOf(known[i]) < 0 && new RegExp("\\b" + known[i] + "\\b", "i").test(s)) found.push(known[i]);
            }
        }
        const dual = found.length >= 2 || /\bdual[ ._-]*audio\b|multi[ ._-]*audio/i.test(s);
        if (dual) {
            // Hindi first when present (Hindi-first site)
            found.sort(function (a, b) { return (b === "Hindi" ? 1 : 0) - (a === "Hindi" ? 1 : 0); });
            return found.slice(0, 2).join(" + ") + " (Dual Audio)";
        }
        return found[0] || null;
    }

    // ───────────────────── home (category rows) ────────────────────

    const HOME_CATS = [
        { row: "Hindi Movies",   path: "/hindi-movies/",        type: "movie" },
        { row: "English Movies", path: "/english-movies/",      type: "movie" },
        { row: "Hindi Dubbed",   path: "/hindi-dubbed-movies/", type: "movie" },
        { row: "Web Series",     path: "/web-series/",          type: "tv"    },
        { row: "K-Drama",        path: "/k-drama/",             type: "tv"    },
        { row: "Dual Audio",     path: "/dual-audio/",          type: "movie" }
    ];

    function parseCards(html, forcedType) {
        const out = [], seen = {};
        const host = SITE.replace(/^https?:\/\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const anchorRe = new RegExp('<a[^>]+href="https?://(?:www\\.)?' + host + '/([a-z0-9][a-z0-9-]*)/"[^>]*class="movie-card"[^>]*>([\\s\\S]*?)</a>', "g");
        let m;
        while ((m = anchorRe.exec(html)) !== null) {
            const slug = m[1];
            if (seen[slug]) continue;
            const block = m[2];
            const img = block.match(/<img[^>]*\ssrc="([^"]+)"/);
            if (!img) continue;
            seen[slug] = 1;
            const labM = m[0].match(/aria-label="([^"]*)"/);
            const h3 = block.match(/<h3 class="movie-card-title">([\s\S]*?)<\/h3>/);
            const rawTitle = (labM && labM[1]) || (h3 && h3[1]) || slug;
            out.push(mkItem({
                title: cleanTitle(rawTitle),
                url: JSON.stringify({ slug: slug }),
                posterUrl: fixPoster(img[1]),
                bannerUrl: fixPoster(img[1]),
                type: forcedType || "movie"
            }));
        }
        return out;
    }

    async function getHome(cb) {
        try {
            const rows = {};
            await Promise.all(HOME_CATS.map(async function (c) {
                try {
                    const html = await withTimeout(fetchHtml(SITE + c.path), 25000);
                    const items = parseCards(html, c.type);
                    if (items.length) rows[c.row] = items;
                } catch (e) { /* row skipped */ }
            }));
            if (!Object.keys(rows).length) {
                return cb({ success: false, errorCode: "HOME_ERROR", message: "CineFreak catalog unavailable right now." });
            }
            cb({ success: true, data: rows });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── search ────────────────────────────

    async function search(query, cb) {
        try {
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });
            const url = SITE + "/search-api.php?q=" + encodeURIComponent(q) + "&pg=1";
            const j = await withTimeout(fetchJson(url), 25000);
            const results = (j && j.results) || [];
            const out = [];
            for (let i = 0; i < results.length && out.length < 30; i++) {
                const r = results[i] || {};
                if (!r.l) continue;
                const isTv = /series|drama|show|anime|tv\b/i.test(String(r.c || ""));
                out.push(mkItem({
                    title: cleanTitle(r.t),
                    url: JSON.stringify({ slug: String(r.l) }),
                    posterUrl: fixPoster(r.i),
                    bannerUrl: fixPoster(r.i),
                    type: isTv ? "tv" : "movie"
                }));
            }
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── detail ────────────────────────────

    /** Cut the balanced {...} literal that starts at html[i] (string-aware). */
    function sliceObject(html, i) {
        let depth = 0, inStr = false, esc = false;
        for (let k = i; k < html.length; k++) {
            const ch = html[k];
            if (inStr) {
                if (esc) esc = false;
                else if (ch === "\\") esc = true;
                else if (ch === "\"") inStr = false;
                continue;
            }
            if (ch === "\"") inStr = true;
            else if (ch === "{") depth++;
            else if (ch === "}") { depth--; if (depth === 0) return html.slice(i, k + 1); }
        }
        return null;
    }

    // The player script declares `const dataset = {...};` (older builds were minified:
    // `const dataset={..."is_combo":!1...}`), so accept both spellings.
    function extractDataset(html) {
        const m = /const\s+dataset\s*=\s*\{/.exec(html);
        if (!m) return null;
        let raw = sliceObject(html, m.index + m[0].length - 1);
        if (!raw) return null;
        raw = raw.replace(/:\s*!0\b/g, ":true").replace(/:\s*!1\b/g, ":false");
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    async function load(url, cb) {
        try {
            let p = null;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.slug) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized item url" });
            const slug = String(p.slug);
            const html = await fetchHtml(SITE + "/" + slug + "/");

            const tM = html.match(/<meta property="og:title" content="([^"]*)"/);
            const title = tM ? cleanTitle(tM[1]) : cleanTitle(slug.replace(/-/g, " "));
            // og:image on this site is a rank-math SEO overlay URL that
            // returns 404 HTML (renders as a black square). The real poster
            // is the first TMDB/cineimg image embedded in the page body.
            let poster = "";
            const imgScan = /https:\/\/(?:image\.tmdb\.org|cineimg\.xyz)\/[^"'\s)]+\.(?:jpg|jpeg|png|webp)/g;
            let im, firstImg = null;
            while ((im = imgScan.exec(html)) !== null) { firstImg = im[0]; break; }
            if (firstImg) {
                poster = fixPoster(firstImg);
            } else {
                const imgM = html.match(/<meta property="og:image" content="([^"]*)"/);
                if (imgM && imgM[1].indexOf("admin-ajax") < 0) poster = fixPoster(imgM[1]);
            }

            const dM = html.match(/<meta (?:property="og:description"|name="description") content="([^"]*)"/);
            const description = dM ? decodeEntities(dM[1]).replace(/\s+/g, " ").trim() : "";
            const yM = (tM ? tM[1] : slug).match(/\b(19[3-9]\d|20[0-4]\d)\b/);
            const year = yM ? parseInt(yM[1], 10) : undefined;

            const data = extractDataset(html);
            const isSeries = !!(data && data.type === "series");
            const episodes = [];

            if (isSeries && Array.isArray(data.seasons) && data.seasons.length) {
                for (let si = 0; si < data.seasons.length; si++) {
                    const season = data.seasons[si] || {};
                    const eps = season.episodes || [];
                    const sName = String(season.season_name || ("Season " + (si + 1)));
                    for (let ei = 0; ei < eps.length; ei++) {
                        const ep = eps[ei] || {};
                        if (!ep.sources) continue;
                        const num = parseInt(String(ep.ep_num || (ei + 1)), 10) || (ei + 1);
                        const epTitle = String(ep.ep_title || ("Episode " + num));
                        const meta = String(ep.ep_meta || "");
                        episodes.push(mkEpisode({
                            name: sName + " · " + epTitle + (meta ? " · " + meta : ""),
                            url: JSON.stringify({ slug: slug, s: si, e: ei }),
                            season: si + 1,
                            episode: num
                        }));
                    }
                }
            }
            if (!episodes.length) {
                // movie (or series post without per-episode data): single play-all
                episodes.push(mkEpisode({
                    name: title,
                    url: JSON.stringify({ slug: slug, s: -1, e: -1 }),
                    season: 1,
                    episode: 1
                }));
            }

            cb({
                success: true,
                data: mkItem({
                    title: title,
                    url: url,
                    posterUrl: poster,
                    bannerUrl: poster,
                    type: isSeries ? "tv" : "movie",
                    description: description,
                    year: year,
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "DETAIL_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

    function qualityNum(q) {
        const m = String(q || "").match(/(\d{3,4})/);
        return m ? parseInt(m[1], 10) : 0;
    }

    const PREPARE_API = "https://subtitle.yagaverse.net/stream-prepare.php";

    function prepareQuery(sources) {
        return ["480p", "720p", "1080p"].filter(function (q) { return sources[q]; })
            .map(function (q) { return "r" + q + "=" + encodeURIComponent(sources[q]); }).join("&");
    }

    /**
     * Since Oct 2026 the site only streams files that were "prepared" (copied to its R2
     * bucket). The web player asks ?action=status first and, when the file is not ready,
     * POSTs ?action=start and polls. Do the same, within the app's 90 s budget.
     * Returns "ready", or a user-facing reason why it is not.
     */
    async function ensurePrepared(sources) {
        const q = prepareQuery(sources);
        if (!q) return "ready";
        const status = async function () {
            try { return await fetchJson(PREPARE_API + "?action=status&" + q, JSON_HEADERS); } catch (e) { return {}; }
        };
        let st = await status();
        if (!st || !st.state) return "ready"; // check unavailable: the web player then just tries to play
        if (st.state === "ready") return "ready";
        if (st.state === "unavailable") return st.message || "Streaming is unavailable for this title (download-only).";
        if (st.state === "limited") return st.message || "CineFreak is rate-limiting stream preparation. Try again shortly.";
        if (st.state !== "uploading") {
            try {
                const r = await withTimeout(http_post(PREPARE_API + "?action=start&" + q, JSON_HEADERS, ""), 15000);
                st = JSON.parse((r && r.body) || "{}") || {};
            } catch (e) { st = {}; }
            if (st.state === "ready") return "ready";
        }
        const deadline = Date.now() + 55000;
        while (Date.now() < deadline) {
            await new Promise(function (ok) { setTimeout(ok, 4000); });
            st = await status();
            if (st && st.state === "ready") return "ready";
            if (st && (st.state === "failed" || st.state === "unavailable" || st.state === "error")) break;
        }
        const pct = st && st.progress ? " (" + st.progress + "% done)" : "";
        return "CineFreak is preparing this video for streaming" + pct + ". Try again in a minute.";
    }

    async function resolveSources(sources) {
        if (!sources) return [];
        const params = [];
        params.push("key=" + encodeURIComponent(STREAM_KEY));
        const qs = Object.keys(sources);
        for (const q of qs) {
            params.push("r" + encodeURIComponent(q) + "=" + encodeURIComponent(sources[q]));
        }
        const primary = sources["720p"] || sources["1080p"] || sources["480p"] || sources[qs[0]];
        if (primary) params.push("id=" + encodeURIComponent(primary));
        const j = await withTimeout(fetchJson(STREAM_API + "?" + params.join("&")), 25000);
        if (!j) return [];
        const out = [];
        const resolutions = (j.resolutions || []).slice()
            .sort(function (a, b) { return qualityNum(b.quality) - qualityNum(a.quality); });
        for (const r of resolutions) {
            if (!r || !r.url) continue;
            out.push(mkStream({
                url: String(r.url),
                source: "CineFreak · " + String(r.quality || "Auto") + (langOf(r.url) ? " · " + langOf(r.url) : ""),
                headers: STREAM_HEADERS
            }));
        }
        if (!out.length && j.videoUrl) {
            out.push(mkStream({
                url: String(j.videoUrl),
                source: "CineFreak",
                headers: STREAM_HEADERS
            }));
        }
        return out.slice(0, 10);
    }

    async function loadStreams(url, cb) {
        try {
            let p = null;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.slug) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized episode url" });
            const slug = String(p.slug);

            const html = await fetchHtml(SITE + "/" + slug + "/");
            const data = extractDataset(html);
            if (!data) return cb({ success: false, errorCode: "NO_STREAMS", message: "No stream data on this page (download-only post?)" });

            let sources = null;
            if (p.s >= 0 && Array.isArray(data.seasons) && data.seasons[p.s]) {
                const eps = data.seasons[p.s].episodes || [];
                const ep = eps[p.e] || eps[0];
                sources = ep && ep.sources;
            }
            if (!sources) sources = data.sources;

            if (!sources) return cb({ success: false, errorCode: "NO_STREAMS", message: "This post has no online player (download links only)." });
            const prep = await ensurePrepared(sources);
            if (prep !== "ready") return cb({ success: false, errorCode: "NOT_READY", message: prep });

            const streams = await resolveSources(sources);
            if (!streams.length) return cb({ success: false, errorCode: "NO_STREAMS", message: "No playable source right now — try again in a moment." });
            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── exports ───────────────────────────

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();

                
