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
    //    NOTE: only the episode's DEFAULT quality object exists on the
    //    CDN — every other code 403s (verified 2026-09). So we expose
    //    the default-quality playlist as the primary stream.
    //  Verified live: Kaiju No.8 S02E01 480p HLS, 200 + VOD playlist.
    // ═══════════════════════════════════════════════════════════

    const API = "https://blakiteapi.xyz";
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
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
            description: (tmd.synopsis || "").slice(0, 400),
            score: tmd.rating ? parseFloat(tmd.rating) : null,
            tags: (tmd.genres || []).slice(0, 4)
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
                    description: tmd.synopsis || ""
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
                    description: (tmd.synopsis || "").slice(0, 700),
                    score: tmd.rating ? parseFloat(tmd.rating) : null,
                    tags: (tmd.genres || []).slice(0, 4),
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "DETAIL_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

    function buildStreamUrl(data) {
        // pick the range for the episode's default quality
        let range = "", code = QCODES[String(data.quality || "").toLowerCase()];
        if (!code) {
            // qid fallback: 1..5 -> first..fifth code
            const order = ["oaa", "baa", "caa", "gaa", "haa"];
            code = order[Math.max(0, Math.min(4, (parseInt(data.qid, 10) || 1) - 1))];
        }
        const ranges = String(data.ranges || "").split("\n");
        for (let i = 0; i < ranges.length; i++) {
            const m = ranges[i].match(/^(\d+)-(\d+)\s*\(([^)]+)\)/);
            if (m && m[3].toLowerCase() === String(data.quality || "").toLowerCase()) { range = m[1] + "-" + m[2]; break; }
        }
        if (String(data.format || "").toUpperCase() === "M3U8") {
            return "https://hugh.cdn.rumble.cloud/video/" + data.dataId + "." + code +
                   ".tar?r_file=chunklist.m3u8&r_type=application%2Fvnd.apple.mpegurl" +
                   (range ? "&r_range=" + range : "");
        }
        return "https://hugh.cdn.rumble.cloud/video/" + data.dataId + "." + code + ".mp4";
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

            const q = String(data.quality || "auto").toLowerCase();
            const streams = [mkStream({
                url: buildStreamUrl(data),
                source: "SubDub - " + q + (String(data.format || "").toUpperCase() === "M3U8" ? " - HLS" : ""),
                quality: q,
                headers: { "User-Agent": UA },
                isDirect: true
            })];

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
