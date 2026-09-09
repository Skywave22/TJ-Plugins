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
    //             const dataset={"type":"movie","is_combo":!1,
    //               "sources":{"1080p":"cd4a0171","720p":"d23b7aee",...}};
    //           or for series:
    //             const dataset={"type":"series","is_combo":!1,
    //               "seasons":[{ "episodes":[ { "ep_num":"01",
    //                 "sources":{...} }, ... ] }, ...]};
    //           (!1 / !0 are minified false / true -> fixed before parse)
    //
    //  PLAYBACK GET https://subtitle.yagaverse.net/stream-api.php
    //             ?key=pushpa&r480p=<tok>&r720p=<tok>&r1080p=<tok>
    //             &id=<primary token>
    //           -> { videoUrl, resolutions: [ { quality, url } ],
    //                audioTracks, subtitleTracks }
    //           The URLs are DIRECT files on Cloudflare R2
    //           (pub-*.r2.dev) — verified HTTP 206 on Range with no
    //           Referer/Origin needed. User-Agent only.
    // ═══════════════════════════════════════════════════════════

    const SITE       = "https://cinefreak.net";
    const STREAM_API = "https://subtitle.yagaverse.net/stream-api.php";
    const STREAM_KEY = "pushpa";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    const HTML_HEADERS = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": SITE + "/"
    };
    const JSON_HEADERS = {
        "User-Agent": UA,
        "Accept": "application/json",
        "Referer": SITE + "/"
    };
    const STREAM_HEADERS = { "User-Agent": UA };

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
        const anchorRe = /<a[^>]+href="https:\/\/cinefreak\.net\/([a-z0-9][a-z0-9-]*)\/"[^>]*class="movie-card"[^>]*>([\s\S]*?)<\/a>/g;
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
                posterUrl: decodeEntities(img[1]),
                bannerUrl: decodeEntities(img[1]),
                type: forcedType || "movie"
            }));
        }
        return out;
    }

    async function getHome() {
        const rows = {};
        await Promise.all(HOME_CATS.map(async function (c) {
            try {
                const html = await withTimeout(fetchHtml(SITE + c.path), 25000);
                const items = parseCards(html, c.type);
                if (items.length) rows[c.row] = items;
            } catch (e) { /* row skipped */ }
        }));
        return rows;
    }

    // ─────────────────────────── search ────────────────────────────

    async function search(query) {
        const q = String(query || "").trim();
        if (!q) return [];
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
                posterUrl: r.i ? decodeEntities(r.i) : "",
                bannerUrl: r.i ? decodeEntities(r.i) : "",
                type: isTv ? "tv" : "movie"
            }));
        }
        return out;
    }

    // ─────────────────────────── detail ────────────────────────────

    function extractDataset(html) {
        const di = html.indexOf("const dataset=");
        if (di < 0) return null;
        const start = di + "const dataset=".length;
        let end = html.indexOf(";let currentSeasonIdx", start);
        if (end < 0) end = html.indexOf(";</script>", start);
        if (end < 0) return null;
        let raw = html.slice(start, end);
        raw = raw.replace(/!0\b/g, "true").replace(/!1\b/g, "false");
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    async function load(url) {
        let p = null;
        try { p = JSON.parse(url); } catch (e) { p = null; }
        if (!p || !p.slug) throw new Error("Unrecognized item url");
        const slug = String(p.slug);
        const html = await fetchHtml(SITE + "/" + slug + "/");

        const tM = html.match(/<meta property="og:title" content="([^"]*)"/);
        const imgM = html.match(/<meta property="og:image" content="([^"]*)"/);
        const title = tM ? cleanTitle(tM[1]) : cleanTitle(slug.replace(/-/g, " "));
        const poster = imgM ? decodeEntities(imgM[1]) : "";

        const data = extractDataset(html);
        const episodes = [];

        if (data && data.type === "series" && Array.isArray(data.seasons) && data.seasons.length) {
            for (let si = 0; si < data.seasons.length; si++) {
                const season = data.seasons[si] || {};
                const eps = season.episodes || [];
                const sName = String(season.season_name || ("Season " + (si + 1)));
                for (let ei = 0; ei < eps.length; ei++) {
                    const ep = eps[ei] || {};
                    if (!ep.sources) continue;
                    const num = String(ep.ep_num || (ei + 1));
                    const epTitle = String(ep.ep_title || ("Episode " + num));
                    const meta = String(ep.ep_meta || "");
                    episodes.push(mkEpisode({
                        title: sName + " · " + epTitle + (meta ? " · " + meta : ""),
                        url: JSON.stringify({ slug: slug, s: si, e: ei })
                    }));
                }
            }
        }
        if (!episodes.length) {
            // movie (or series post without per-episode data): single play-all
            episodes.push(mkEpisode({
                title: "Play Full Movie",
                url: JSON.stringify({ slug: slug, s: -1, e: -1 })
            }));
        }

        return mkItem({
            title: title,
            url: url,
            posterUrl: poster,
            bannerUrl: poster,
            type: (data && data.type === "series") ? "tv" : "movie",
            episodes: episodes
        });
    }

    // ─────────────────────────── streams ───────────────────────────

    function qualityNum(q) {
        const m = String(q || "").match(/(\d{3,4})/);
        return m ? parseInt(m[1], 10) : 0;
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
                source: "CineFreak · " + String(r.quality || "Auto"),
                headers: STREAM_HEADERS,
                isDirect: true
            }));
        }
        if (!out.length && j.videoUrl) {
            out.push(mkStream({
                url: String(j.videoUrl),
                source: "CineFreak",
                headers: STREAM_HEADERS,
                isDirect: true
            }));
        }
        return out.slice(0, 10);
    }

    async function loadStreams(url) {
        let p = null;
        try { p = JSON.parse(url); } catch (e) { p = null; }
        if (!p || !p.slug) throw new Error("Unrecognized episode url");
        const slug = String(p.slug);

        // cache the page across episode switches inside one call session
        const html = await fetchHtml(SITE + "/" + slug + "/");
        const data = extractDataset(html);
        if (!data) throw new Error("No stream data on page (download-only post?)");

        let sources = null;
        if (p.s >= 0 && Array.isArray(data.seasons) && data.seasons[p.s]) {
            const eps = data.seasons[p.s].episodes || [];
            const ep = eps[p.e] || eps[0];
            sources = ep && ep.sources;
        }
        if (!sources) sources = data.sources;

        const streams = await resolveSources(sources);
        if (!streams.length) throw new Error("No playable source right now — try again in a moment.");
        return streams;
    }

    // ─────────────────────────── exports ───────────────────────────

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
