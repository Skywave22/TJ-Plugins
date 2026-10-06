(function() {
    "use strict";

    // ═══════════════════════════════════════════════════════════
    //  SubDubAnime (subdubanime.site) — SkyStream plugin
    //
    //  Hindi/English dubbed + subbed anime. The Blogger site is a
    //  client-side shell over a dedicated API:
    //
    //    GET https://blakiteapi.xyz/api/getAllAnime.php
    //      -> { success, data: { movies, series, dramas } }
    //         each: { <zeroPaddedTmdbId>: {
    //           tmdbId, title, language, type,
    //           IMAGES: { poster, backdrop },
    //           TMDB_DATA: { genres, synopsis, rating, releaseDate },
    //           seasons: { "1": { status, totalEpisodes } } } }
    //
    //    GET https://blakiteapi.xyz/api/get.php?tmdbId=<id>          (movies)
    //    GET https://blakiteapi.xyz/api/get.php?id=<s>-<e>&tmdbId=..  (series)
    //      -> { data: { dataId, quality, qid, format, ranges } }
    //
    //  Stream URL (from their /watch/player.js):
    //    https://hugh.cdn.rumble.cloud/video/<dataId>.<code>.tar
    //      ?r_file=chunklist.m3u8
    //      &r_type=application%2Fvnd.apple.mpegurl
    //      &r_range=<start-end of the quality's range>
    //    codes: oaa=240p baa=360p caa=480p gaa=720p haa=1080p
    //    `quality` is only the player's default (usually 480p). For HLS the
    //    `ranges` field lists every rendition ("<start>-<end> (1080p)"),
    //    and for MP4 `qid` is the highest code available (5 = 1080p);
    //    all of those are served (checked 2026-10: 240p..1080p, 206/200).
    // ═══════════════════════════════════════════════════════════

    const API = "https://blakiteapi.xyz";
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // Plain headers only: spoofed X-Forwarded-For / CF-Connecting-IP / True-Client-IP
    // don't change the caller's location, and Cloudflare answers them with HTTP 403.

    const QCODES = { "240p": "oaa", "360p": "baa", "480p": "caa", "720p": "gaa", "1080p": "haa" };

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

    let catalogCache = null, catalogTs = 0;
    async function catalog() {
        const now = Date.now();
        if (catalogCache && now - catalogTs < 1800000) return catalogCache; // 30 min
        const r = await withTimeout(http_get(API + "/api/getAllAnime.php", { "User-Agent": UA }), 25000);
        const j = JSON.parse((r && r.body) || "{}");
        const d = (j && j.data) || {};
        catalogCache = {
            movies: d.movies || {},
            series: d.series || {},
            dramas: d.dramas || {}
        };
        catalogTs = now;
        return catalogCache;
    }

    function yearOf(s) {
        const m = String(s || "").match(/^(\d{4})/);
        return m ? parseInt(m[1], 10) : null;
    }

    // The upstream API embeds a TMDB snapshot. The app's item parser requires
    // description to be a string and every tag to be a string - one malformed
    // value would fail the whole dashboard - so normalise defensively.
    function toText(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }
    function toScore(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
    function toTags(v) {
        if (!Array.isArray(v)) return [];
        return v.map(function (g) { return typeof g === "string" ? g : (g && (g.name || g.title)) || ""; })
            .filter(Boolean).slice(0, 4);
    }

    function entryToItem(entry, cat) {
        if (!entry || !entry.tmdbId || !entry.title) return null;
        const img = entry.IMAGES || {};
        const tmd = entry.TMDB_DATA || {};
        const url = JSON.stringify({ cat: cat, id: String(entry.tmdbId), t: entry.title });
        const isSeries = cat !== "movies";
        return mkItem({
            title: entry.title,
            url: url,
            posterUrl: img.poster || "",
            bannerUrl: img.backdrop || img.poster || "",
            type: isSeries ? "tv" : "movie",
            year: yearOf(tmd.releaseDate),
            description: toText(tmd.synopsis).slice(0, 400),
            score: toScore(tmd.rating),
            tags: toTags(tmd.genres)
        });
    }

    // flattened entries of a category, newest first
    function sortedEntries(obj, field) {
        const arr = [];
        for (const k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) arr.push(obj[k]);
        }
        arr.sort(function (a, b) {
            return String(b[field] || "").localeCompare(String(a[field] || ""));
        });
        return arr;
    }

    // ─────────────────────────── home ──────────────────────────────

    async function getHome(cb) {
        try {
            const c = await catalog();
            const home = {};

            const latest = sortedEntries(c.series, "updatedAt").slice(0, 24)
                .map(function (e) { return entryToItem(e, "series"); })
                .filter(function (x) { return !!x; });
            if (latest.length) home["Latest Anime"] = latest;

            const ongoing = sortedEntries(c.series, "updatedAt").filter(function (e) {
                const s = e.seasons || {};
                for (const n in s) if (s[n] && s[n].status === "Ongoing") return true;
                return false;
            }).slice(0, 24).map(function (e) { return entryToItem(e, "series"); })
              .filter(function (x) { return !!x; });
            if (ongoing.length) home["Ongoing"] = ongoing;

            const completed = sortedEntries(c.series, "updatedAt").filter(function (e) {
                const s = e.seasons || {};
                let any = false, allDone = false;
                for (const n in s) { any = true; if (s[n] && s[n].status === "Completed") allDone = true; }
                return any && allDone;
            }).slice(0, 24).map(function (e) { return entryToItem(e, "series"); })
              .filter(function (x) { return !!x; });
            if (completed.length) home["Completed"] = completed;

            const movies = sortedEntries(c.movies, "updatedAt").slice(0, 24)
                .map(function (e) { return entryToItem(e, "movies"); })
                .filter(function (x) { return !!x; });
            if (movies.length) home["Anime Movies"] = movies;

            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "API_ERROR", message: "SubDubAnime catalog unavailable" });
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── search ────────────────────────────

    async function search(query, cb) {
        try {
            if (!query || !String(query).trim()) return cb({ success: true, data: [] });
            const q = String(query).trim().toLowerCase();
            const c = await catalog();
            const out = [];
            ["series", "movies", "dramas"].forEach(function (cat) {
                const arr = sortedEntries(c[cat], "updatedAt");
                for (let i = 0; i < arr.length; i++) {
                    if (String(arr[i].title || "").toLowerCase().indexOf(q) >= 0) {
                        const it = entryToItem(arr[i], cat);
                        if (it && out.length < 30) out.push(it);
                    }
                }
            });
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────── detail + episodes ─────────────────────

    async function load(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.cat || !p.id) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized SubDubAnime url" });

            const c = await catalog();
            const entry = c[p.cat] && (c[p.cat][String(p.id).padStart(10, "0")] || c[p.cat][String(p.id)]);
            if (!entry) return cb({ success: false, errorCode: "NOT_FOUND", message: "Title not in catalog (try search)" });

            const img = entry.IMAGES || {};
            const tmd = entry.TMDB_DATA || {};
            const title = entry.title;
            const episodes = [];

            if (p.cat === "movies") {
                episodes.push(mkEpisode({
                    name: "Full Movie",
                    url: JSON.stringify({ cat: "movies", id: String(entry.tmdbId), t: title }),
                    season: 1,
                    episode: 1,
                    posterUrl: img.poster || "",
                    description: toText(tmd.synopsis)
                }));
            } else {
                const seasons = entry.seasons || {};
                const nums = Object.keys(seasons).map(function (n) { return parseInt(n, 10); })
                    .filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; });
                if (!nums.length) return cb({ success: false, errorCode: "NO_EPISODES", message: "No seasons listed for this anime yet." });
                for (let si = 0; si < nums.length; si++) {
                    const s = nums[si];
                    const info = seasons[String(s)] || {};
                    const total = parseInt(info.totalEpisodes, 10) || 0;
                    for (let e = 1; e <= total; e++) {
                        episodes.push(mkEpisode({
                            name: "S" + s + " E" + (e < 10 ? "0" + e : e) + (info.status === "Ongoing" && si === nums.length - 1 ? "" : ""),
                            url: JSON.stringify({ cat: p.cat, id: String(entry.tmdbId), s: s, e: e, t: title }),
                            season: s,
                            episode: e,
                            posterUrl: img.poster || "",
                            description: title + " — Season " + s + ", Episode " + e
                        }));
                    }
                }
            }
            if (!episodes.length) return cb({ success: false, errorCode: "NO_EPISODES", message: "No episodes listed yet." });

            cb({
                success: true,
                data: mkItem({
                    title: title,
                    url: url,
                    posterUrl: img.poster || "",
                    bannerUrl: img.backdrop || img.poster || "",
                    type: p.cat === "movies" ? "movie" : "tv",
                    year: yearOf(tmd.releaseDate),
                    description: toText(tmd.synopsis).slice(0, 700),
                    score: toScore(tmd.rating),
                    tags: toTags(tmd.genres),
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "DETAIL_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

    const QORDER = ["240p", "360p", "480p", "720p", "1080p"];
    const CDN = "https://hugh.cdn.rumble.cloud/video/";

    // Every rendition the episode has, highest first: [{q, url, hls}]
    function allRenditions(data) {
        const out = [];
        const id = String(data.dataId);
        if (String(data.format || "").toUpperCase() === "M3U8") {
            const lines = String(data.ranges || "").split("\n");
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^(\d+)-(\d+)\s*\(([^)]+)\)/);
                if (!m) continue;
                const q = m[3].toLowerCase(), code = QCODES[q];
                if (!code) continue;
                out.push({ q: q, hls: true, url: CDN + id + "." + code +
                    ".tar?r_file=chunklist.m3u8&r_type=application%2Fvnd.apple.mpegurl&r_range=" + m[1] + "-" + m[2] });
            }
        } else {
            const top = Math.max(1, Math.min(5, parseInt(data.qid, 10) || 0)) ||
                        (QORDER.indexOf(String(data.quality || "").toLowerCase()) + 1) || 3;
            for (let k = 0; k < top; k++) {
                out.push({ q: QORDER[k], hls: false, url: CDN + id + "." + QCODES[QORDER[k]] + ".mp4" });
            }
        }
        out.sort(function (x, y) { return QORDER.indexOf(y.q) - QORDER.indexOf(x.q); });
        return out;
    }

    // ── stream verification (TJ-Plugins shared helper) ─────────────────────────
    // Each candidate is requested once, with the exact headers the player will send.
    //   ok      -> HLS playlist / DASH manifest / media bytes  -> listed first
    //   unknown -> 401/403/426/429/timeout (often an IP/region block that works on a phone)
    //              -> kept after the verified ones, labelled "(may not play)"
    //   dead    -> 404/410/451/5xx, DNS failure, HTML error page -> dropped
    function __tjDeadline(promise, ms) {
        return new Promise(function (resolve) {
            const t = setTimeout(function () { resolve(null); }, ms);
            Promise.resolve(promise).then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(null); });
        });
    }
    async function __tjProbe(s) {
        const u = String((s && s.url) || "");
        if (!/^https?:\/\//i.test(u)) return "ok"; // magnet:, magic_m3u8:, MAGIC_PROXY… resolved by the app
        // Freshly minted Google download links ignore Range and stream the whole
        // file; probing them only burns data (and crashes the CLI, which buffers it).
        if (/^https:\/\/video-downloads\.googleusercontent\.com\//i.test(u)) return "ok";
        const h = Object.assign({}, s.headers || {}, { "Range": "bytes=0-2047" });
        const r = await __tjDeadline(http_get(u, h), 9000);
        if (!r) return "unknown";
        const st = Number(r.status || r.statusCode || 0);
        const body = String(r.body || "").replace(/^\uFEFF/, "").replace(/^\s+/, "").slice(0, 600);
        if (st === 200 || st === 206) {
            if (/^#EXTM3U/.test(body) || /<MPD[\s>]/i.test(body)) return "ok";
            if (/^<(!doctype|html|head|body)/i.test(body)) return "dead";
            return "ok";
        }
        if (st === 0) {
            const err = String(r.error || "");
            // The app refuses bodies over 8 MB (it hangs up on the Content-Length):
            // a server that ignores Range and sends a huge body is serving the file.
            if (/too ?large|exceed/i.test(err)) return "ok";
            return /host lookup|ENOTFOUND|getaddrinfo|No address/i.test(err) ? "dead" : "unknown";
        }
        if (st === 401 || st === 403 || st === 426 || st === 429) return "unknown";
        return "dead";
    }
    async function verifyStreams(list, maxUnverified) {
        const verdicts = await Promise.all(list.map(__tjProbe));
        const ok = [], unknown = [];
        list.forEach(function (s, i) {
            if (verdicts[i] === "ok") ok.push(s);
            else if (verdicts[i] === "unknown") unknown.push(s);
        });
        const keep = unknown.slice(0, Math.max(0, (maxUnverified == null ? 4 : maxUnverified) - Math.min(ok.length, 2)));
        keep.forEach(function (s) { s.source = String(s.source || "Stream") + " (may not play)"; });
        const out = ok.concat(keep), count = {}, idx = {};
        out.forEach(function (s) { const k = String(s.source || "Stream"); count[k] = (count[k] || 0) + 1; });
        out.forEach(function (s) {
            const k = String(s.source || "Stream");
            if (count[k] > 1) { idx[k] = (idx[k] || 0) + 1; s.source = k + " #" + idx[k]; }
        });
        return out;
    }

    async function loadStreams(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.cat || !p.id) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized episode url" });

            let apiUrl;
            if (p.cat === "movies") {
                apiUrl = API + "/api/get.php?tmdbId=" + encodeURIComponent(String(p.id));
            } else {
                apiUrl = API + "/api/get.php?id=" + encodeURIComponent((p.s || 1) + "-" + (p.e || 1)) +
                         "&tmdbId=" + encodeURIComponent(String(p.id));
            }
            const r = await withTimeout(http_get(apiUrl, { "User-Agent": UA, "Referer": API + "/" }), 20000);
            let j;
            try { j = JSON.parse((r && r.body) || "{}"); } catch (e) { j = {}; }
            const data = j && j.data;
            if (!data || !data.dataId) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "This episode is not uploaded yet — try the previous episode or another anime." });
            }

            // 240p only if nothing better exists
            let rends = allRenditions(data);
            if (rends.length > 1) rends = rends.filter(function (x) { return x.q !== "240p"; });
            const candidates = rends.slice(0, 4).map(function (x) {
                return mkStream({
                    url: x.url,
                    source: "SubDub - " + x.q + (x.hls ? " - HLS" : ""),
                    headers: { "User-Agent": UA }
                });
            });
            // Higher renditions exist for many episodes but not all (the CDN 403s
            // the missing ones), so list only verified extras; the API's default
            // quality is always kept as the fallback.
            const defQ = String(data.quality || "").toLowerCase();
            const streams = candidates.length ? await verifyStreams(candidates, 0) : [];
            if (!streams.some(function (st) { return String(st.source).indexOf(" " + defQ) >= 0; })) {
                const d = rends.filter(function (x) { return x.q === defQ; })[0];
                if (d) streams.push(mkStream({ url: d.url, source: "SubDub - " + d.q + (d.hls ? " - HLS" : ""), headers: { "User-Agent": UA } }));
            }
            if (!streams.length) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "This episode's video is not available on the server right now — try another episode." });
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String((e && e.message) || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
