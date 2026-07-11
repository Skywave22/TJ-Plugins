// PopcornMovies — SkyStream (Sky Gen 2) plugin
// Movies + TV Shows.  https://popcornmovies.io
//
// Architecture:
//   - BROWSING (getHome / search / load): TMDB API directly (rich, reliable metadata;
//     PopcornMovies is TMDB-based so ids line up 1:1).
//   - PLAYBACK (loadStreams): PopcornMovies' own /api/sources endpoint, which returns
//     DIRECT .m3u8 (HLS) + .mp4 URLs, multiple servers/qualities AND subtitles.
//     Flow:  GET /watch/<type>/<id>  -> scrape "playToken" from the page
//            GET /api/sources?type=&tmdbId=&title=[&season=&episode=]
//                 headers: x-play-token + sec-fetch-site:same-origin (required)
//     Streams are served via api.dlproxy.com and are directly playable.
//
// Runtime conventions (verified against skystream-cli v1.9.x):
//   - http_get(url, headers) -> { status, body }
//   - item URLs are JSON-encoded so id/type/season/episode/title survive across calls.

(function () {
    "use strict";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const H = { "User-Agent": UA };

    const SITE = "https://popcornmovies.io";
    const TMDB = "https://api.themoviedb.org/3";
    const IMG = "https://image.tmdb.org/t/p/w500";
    const IMG_ORIG = "https://image.tmdb.org/t/p/original";
    const KEYS = [
        "3fd2be6f0c70a2a598f084ddfb75487c",
        "a07e22bc18f5cb106bfe4cc1f83ad8ed",
        "e55425032d3d0f371fc776f302e7c09b"
    ];

    // Language code -> friendly label for subtitles.
    const LANG_LABELS = {
        en: "English", eng: "English", es: "Spanish", spa: "Spanish", fr: "French",
        fra: "French", de: "German", it: "Italian", pt: "Portuguese", ru: "Russian",
        ar: "Arabic", hi: "Hindi", ja: "Japanese", ko: "Korean", zh: "Chinese",
        tr: "Turkish", nl: "Dutch", pl: "Polish", sv: "Swedish", id: "Indonesian",
        th: "Thai", vi: "Vietnamese", tl: "Tagalog", und: "Unknown"
    };

    /* ------------------------------ helpers ----------------------------- */

    function safeParse(s) {
        if (!s) return null;
        if (typeof s === "object") return s;
        try { return JSON.parse(s); } catch (e) { return null; }
    }

    async function httpGet(url, hdrs, attempts) {
        attempts = attempts || 3;
        let last = null;
        for (let i = 0; i < attempts; i++) {
            try {
                const res = await http_get(url, hdrs || H);
                if (res && res.status >= 200 && res.status < 300 && res.body) return res;
                last = res;
            } catch (e) { last = null; }
            if (i < attempts - 1) await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
        return last;
    }

    async function tmdb(path, extraQuery) {
        const sep = path.indexOf("?") >= 0 ? "&" : "?";
        for (const key of KEYS) {
            const url = `${TMDB}/${path}${sep}api_key=${key}${extraQuery ? "&" + extraQuery : ""}`;
            const res = await httpGet(url, H, 2);
            if (res && res.body) {
                const json = safeParse(res.body);
                if (json && !json.status_code) return json;
            }
        }
        return null;
    }

    function poster(p) { return p ? IMG + p : ""; }
    function backdrop(p) { return p ? IMG_ORIG + p : ""; }
    function year(d) { return d && d.length >= 4 ? parseInt(d.slice(0, 4), 10) : undefined; }

    function toItem(r, forcedType) {
        const mt = forcedType || r.media_type || (r.title ? "movie" : "tv");
        if (mt !== "movie" && mt !== "tv") return null;
        const title = r.title || r.name || "Untitled";
        return new MultimediaItem({
            title: title,
            url: JSON.stringify({ id: r.id, mtype: mt, title: title }),
            posterUrl: poster(r.poster_path),
            bannerUrl: backdrop(r.backdrop_path),
            type: mt === "tv" ? "series" : "movie",
            year: year(r.release_date || r.first_air_date || ""),
            score: r.vote_average ? Math.round(r.vote_average * 10) / 10 : undefined,
            description: r.overview || ""
        });
    }

    function mapResults(json, forcedType) {
        if (!json || !json.results) return [];
        return json.results.map(r => toItem(r, forcedType)).filter(Boolean);
    }

    /* ------------------------------ getHome ----------------------------- */

    async function getHome(cb) {
        try {
            const rows = [
                { name: "Trending", path: "trending/all/week" },
                { name: "Popular Movies", path: "movie/popular", t: "movie" },
                { name: "Popular TV Shows", path: "tv/popular", t: "tv" },
                { name: "Top Rated Movies", path: "movie/top_rated", t: "movie" },
                { name: "Top Rated TV", path: "tv/top_rated", t: "tv" },
                { name: "Now Playing", path: "movie/now_playing", t: "movie" }
            ];
            const results = await Promise.all(rows.map(async (row) => {
                const json = await tmdb(row.path);
                const items = mapResults(json, row.t || null);
                return items.length ? { name: row.name, items } : null;
            }));
            const data = {};
            results.filter(Boolean).forEach(r => { data[r.name] = r.items; });
            if (Object.keys(data).length === 0) {
                return cb({ success: false, errorCode: "HTTP_ERROR", message: "Could not reach TMDB." });
            }
            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "UNKNOWN", message: e.message });
        }
    }

    /* ------------------------------- search ----------------------------- */

    async function search(query, cb) {
        try {
            const json = await tmdb("search/multi", "query=" + encodeURIComponent(query) + "&include_adult=false");
            cb({ success: true, data: mapResults(json) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    /* -------------------------------- load ------------------------------ */

    async function load(urlStr, cb) {
        try {
            const info = safeParse(urlStr) || {};
            const id = info.id, mtype = info.mtype || "movie";
            if (!id) throw new Error("Missing id");

            if (mtype === "movie") {
                const d = await tmdb(`movie/${id}`, "append_to_response=credits,similar");
                if (!d) throw new Error("TMDB movie not found");
                const title = d.title || d.original_title || "Untitled";
                return cb({
                    success: true,
                    data: new MultimediaItem({
                        title: title,
                        url: JSON.stringify({ id, mtype: "movie", title }),
                        posterUrl: poster(d.poster_path),
                        bannerUrl: backdrop(d.backdrop_path),
                        type: "movie",
                        year: year(d.release_date),
                        score: d.vote_average ? Math.round(d.vote_average * 10) / 10 : undefined,
                        duration: d.runtime || undefined,
                        description: d.overview || "",
                        cast: buildCast(d.credits),
                        recommendations: mapResults(d.similar, "movie")
                    })
                });
            }

            const d = await tmdb(`tv/${id}`, "append_to_response=credits,similar");
            if (!d) throw new Error("TMDB tv not found");
            const title = d.name || d.original_name || "Untitled";
            const seasons = (d.seasons || []).filter(s => s.season_number >= 1 && s.episode_count > 0);
            const seasonData = await Promise.all(seasons.map(s => tmdb(`tv/${id}/season/${s.season_number}`)));
            const episodes = [];
            seasonData.forEach((sd, idx) => {
                if (!sd || !sd.episodes) return;
                const sNum = seasons[idx].season_number;
                sd.episodes.forEach(ep => {
                    episodes.push(new Episode({
                        name: ep.name || `S${sNum}E${ep.episode_number}`,
                        url: JSON.stringify({ id, mtype: "tv", title, s: sNum, e: ep.episode_number }),
                        season: sNum,
                        episode: ep.episode_number,
                        posterUrl: ep.still_path ? poster(ep.still_path) : poster(d.poster_path),
                        airDate: ep.air_date || undefined,
                        runtime: ep.runtime || undefined,
                        rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : undefined
                    }));
                });
            });
            cb({
                success: true,
                data: new MultimediaItem({
                    title: title,
                    url: JSON.stringify({ id, mtype: "tv", title }),
                    posterUrl: poster(d.poster_path),
                    bannerUrl: backdrop(d.backdrop_path),
                    type: "series",
                    year: year(d.first_air_date),
                    score: d.vote_average ? Math.round(d.vote_average * 10) / 10 : undefined,
                    status: d.status && /ended|canceled/i.test(d.status) ? "completed" : "ongoing",
                    description: d.overview || "",
                    cast: buildCast(d.credits),
                    recommendations: mapResults(d.similar, "tv"),
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    function buildCast(credits) {
        if (!credits || !credits.cast) return [];
        return credits.cast.slice(0, 20).map(c => new Actor({
            name: c.name,
            role: c.character || "",
            image: c.profile_path ? poster(c.profile_path) : ""
        }));
    }

    /* ----------------------------- loadStreams -------------------------- */

    async function loadStreams(urlInfo, cb) {
        try {
            const info = safeParse(urlInfo) || {};
            const id = info.id, mtype = info.mtype || "movie";
            if (!id) throw new Error("Missing id");

            const watchPath = `/watch/${mtype}/${id}`;
            const title = info.title || "";

            // 1) Load the watch page and scrape the fresh play token.
            const wp = await httpGet(SITE + watchPath, H, 3);
            if (!wp || !wp.body) throw new Error("Watch page unreachable");
            const tokMatch = wp.body.match(/playToken\\*"\s*:\s*\\*"([0-9]+\.[a-f0-9]+)/i) ||
                             wp.body.match(/playToken"\s*:\s*"([0-9]+\.[a-f0-9]+)/i);
            if (!tokMatch) throw new Error("Play token not found");
            const token = tokMatch[1];

            // 2) Build the sources query.
            let q = `type=${mtype}&tmdbId=${id}&title=${encodeURIComponent(title)}`;
            if (mtype === "tv") q += `&season=${info.s || 1}&episode=${info.e || 1}`;

            // 3) Call /api/sources with the required headers.
            const apiHeaders = {
                "User-Agent": UA,
                "Referer": SITE + watchPath,
                "x-play-token": token,
                "sec-fetch-site": "same-origin",
                "sec-fetch-mode": "cors",
                "sec-fetch-dest": "empty",
                "Accept": "*/*"
            };
            const res = await httpGet(`${SITE}/api/sources?${q}`, apiHeaders, 3);
            if (!res || !res.body) throw new Error("Sources API unreachable");
            const json = safeParse(res.body);
            const srcs = (json && json.sources) || [];
            if (!srcs.length) {
                return cb({ success: false, errorCode: "NOT_FOUND", message: "No streams available for this title yet." });
            }

            // Shared subtitles for all streams.
            const subtitles = buildSubtitles(json.subtitles);

            // 4) Map sources -> StreamResult, most-RELIABLE first.
            //    Provider reliability (observed): rigel & mintaka are rock-solid;
            //    oneroom/delta (mp4) are solid; vega/moviesapi is flaky (often 404/502)
            //    so it must NOT be first, or the app auto-plays a dead source and the
            //    title looks broken. Within a tier, prefer higher resolution & HLS.
            const providerScore = (p) => {
                p = String(p || "").toLowerCase();
                if (p.indexOf("rigel") >= 0) return 500;
                if (p.indexOf("mintaka") >= 0 || p.indexOf("vidlink") >= 0) return 480;
                if (p.indexOf("oneroom") >= 0 || p.indexOf("delta") >= 0) return 300;
                if (p.indexOf("vega") >= 0 || p.indexOf("moviesapi") >= 0) return 50; // flaky -> last
                return 100;
            };
            const resScore = (s) => {
                const q = String(s.quality || "").toLowerCase();
                if (q.indexOf("2160") >= 0 || q.indexOf("4k") >= 0) return 40;
                if (q.indexOf("1080") >= 0) return 35;
                if (q.indexOf("auto") >= 0) return 33;   // adaptive ~ high
                if (q.indexOf("720") >= 0) return 25;
                if (q.indexOf("480") >= 0) return 15;
                if (q.indexOf("360") >= 0) return 8;
                return 5;
            };
            const rank = (s) =>
                providerScore(s.provider || s.label) + resScore(s) +
                ((s.kind || "").toLowerCase() === "hls" ? 2 : 0);
            const sorted = srcs.slice().sort((a, b) => rank(b) - rank(a));

            const streams = [];
            const seen = {};
            sorted.forEach((s) => {
                if (!s || !s.url || seen[s.url]) return;
                seen[s.url] = true;
                const q = normQuality(s.quality);
                const kind = (s.kind || "").toUpperCase();
                const server = s.label || s.provider || "Popcorn";
                streams.push(new StreamResult({
                    url: s.url,
                    source: `${server} • ${q}${kind ? " " + kind : ""}`,
                    headers: { "Referer": SITE + "/", "User-Agent": UA },
                    subtitles: subtitles.length ? subtitles : undefined
                }));
            });

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    function normQuality(q) {
        q = String(q || "").toLowerCase();
        if (q.indexOf("2160") >= 0 || q === "4k") return "2160p";
        if (q.indexOf("1080") >= 0) return "1080p";
        if (q.indexOf("720") >= 0) return "720p";
        if (q.indexOf("480") >= 0) return "480p";
        if (q.indexOf("360") >= 0) return "360p";
        if (q.indexOf("auto") >= 0) return "Auto";
        return q ? q : "Auto";
    }

    function buildSubtitles(subs) {
        if (!Array.isArray(subs)) return [];
        const out = [];
        const seenLang = {};
        // Keep the first subtitle per language (skip unknown/und), so the picker
        // is clean instead of showing dozens of duplicates.
        subs.forEach(s => {
            if (!s || !s.url) return;
            let code = (s.language || s.lang || s.label || "und").toLowerCase();
            if (code === "und" || code === "unknown" || !code) return;
            if (seenLang[code]) return;
            seenLang[code] = true;
            out.push({
                url: s.url,
                lang: code,
                label: LANG_LABELS[code] || (s.label || code.toUpperCase())
            });
        });
        // English first, then alphabetical by label.
        out.sort((a, b) => {
            const ae = a.lang.indexOf("en") === 0, be = b.lang.indexOf("en") === 0;
            if (ae !== be) return ae ? -1 : 1;
            return a.label.localeCompare(b.label);
        });
        return out;
    }

    /* ------------------------------ exports ----------------------------- */

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
