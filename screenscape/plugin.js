// Screenscape â€” SkyStream (Sky Gen 2) plugin
// Movies + TV Shows.  https://screenscape.me  /  https://main.screenscape.me
//
// Architecture:
//   - BROWSING (getHome / search / load) uses the TMDB API directly. Screenscape
//     is 100% TMDB-based (every URL is a TMDB id, all art is image.tmdb.org), and
//     the site itself is Cloudflare-gated, so TMDB is the reliable metadata source.
//   - PLAYBACK (loadStreams) returns Screenscape's OFFICIAL embed URL:
//       https://main.screenscape.me/embed?tmdb=<id>&type=movie
//       https://main.screenscape.me/embed?tmdb=<id>&type=tv&s=<s>&e=<e>
//     The embed handles Cloudflare, ads and multi-server switching itself, so the
//     app plays it in its webview/player. This is the documented, stable API.
//
// Runtime conventions (verified against skystream-cli v1.9.x):
//   - http_get(url, headers) -> { status, body }
//   - item URLs are JSON-encoded so type/id/season/episode survive across calls.

(function () {
    "use strict";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const H = { "User-Agent": UA };

    const TMDB = "https://api.themoviedb.org/3";
    const IMG = "https://image.tmdb.org/t/p/w500";
    const IMG_ORIG = "https://image.tmdb.org/t/p/original";
    // Community TMDB v3 keys (widely used in open-source apps); tried in order.
    const KEYS = [
        "3fd2be6f0c70a2a598f084ddfb75487c",
        "a07e22bc18f5cb106bfe4cc1f83ad8ed",
        "e55425032d3d0f371fc776f302e7c09b"
    ];

    const EMBED = "https://main.screenscape.me/embed";

    /* ------------------------------ helpers ----------------------------- */

    function safeParse(s) {
        if (!s) return null;
        if (typeof s === "object") return s;
        try { return JSON.parse(s); } catch (e) { return null; }
    }

    async function httpGet(url, attempts) {
        attempts = attempts || 3;
        let last = null;
        for (let i = 0; i < attempts; i++) {
            try {
                const res = await http_get(url, H);
                if (res && res.status >= 200 && res.status < 300 && res.body) return res;
                last = res;
            } catch (e) { last = null; }
            if (i < attempts - 1) await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
        return last;
    }

    // GET a TMDB endpoint (path may contain a query string) as parsed JSON,
    // trying each API key until one succeeds.
    async function tmdb(path, extraQuery) {
        const sep = path.indexOf("?") >= 0 ? "&" : "?";
        for (const key of KEYS) {
            const url = `${TMDB}/${path}${sep}api_key=${key}${extraQuery ? "&" + extraQuery : ""}`;
            const res = await httpGet(url, 2);
            if (res && res.body) {
                const json = safeParse(res.body);
                if (json && !json.status_code) return json;   // status_code present => TMDB error
            }
        }
        return null;
    }

    function poster(p) { return p ? IMG + p : ""; }
    function backdrop(p) { return p ? IMG_ORIG + p : ""; }
    function year(d) { return d && d.length >= 4 ? parseInt(d.slice(0, 4), 10) : undefined; }

    // Map a TMDB result (movie/tv/multi) to a MultimediaItem.
    function toItem(r, forcedType) {
        const mt = forcedType || r.media_type || (r.title ? "movie" : "tv");
        if (mt !== "movie" && mt !== "tv") return null;      // skip 'person' etc.
        const title = r.title || r.name || "Untitled";
        const date = r.release_date || r.first_air_date || "";
        return new MultimediaItem({
            title: title,
            // Encode everything loadStreams/load needs.
            url: JSON.stringify({ id: r.id, mtype: mt }),
            posterUrl: poster(r.poster_path),
            bannerUrl: backdrop(r.backdrop_path),
            type: mt === "tv" ? "series" : "movie",
            year: year(date),
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
                { name: "Popular Movies", path: "movie/popular" },
                { name: "Trending TV Series", path: "tv/popular" },
                { name: "Top Rated Movies", path: "movie/top_rated" },
                { name: "Top Rated TV", path: "tv/top_rated" },
                { name: "Now Playing", path: "movie/now_playing" }
            ];

            const results = await Promise.all(rows.map(async (row) => {
                const json = await tmdb(row.path);
                const forced = row.path.startsWith("movie/") ? "movie"
                            : row.path.startsWith("tv/") ? "tv" : null;
                const items = mapResults(json, forced);
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
            const id = info.id;
            const mtype = info.mtype || "movie";
            if (!id) throw new Error("Missing id");

            if (mtype === "movie") {
                const d = await tmdb(`movie/${id}`, "append_to_response=credits,similar");
                if (!d) throw new Error("TMDB movie not found");

                const item = new MultimediaItem({
                    title: d.title || d.original_title || "Untitled",
                    url: JSON.stringify({ id: id, mtype: "movie" }),
                    posterUrl: poster(d.poster_path),
                    bannerUrl: backdrop(d.backdrop_path),
                    type: "movie",
                    year: year(d.release_date),
                    score: d.vote_average ? Math.round(d.vote_average * 10) / 10 : undefined,
                    duration: d.runtime || undefined,
                    description: d.overview || "",
                    cast: buildCast(d.credits),
                    recommendations: mapResults(d.similar, "movie")
                });
                return cb({ success: true, data: item });
            }

            // TV series -> build episode list across all seasons.
            const d = await tmdb(`tv/${id}`, "append_to_response=credits,similar");
            if (!d) throw new Error("TMDB tv not found");

            const seasons = (d.seasons || []).filter(s => s.season_number >= 1 && s.episode_count > 0);
            const episodes = [];
            // Fetch each season's episode list (in parallel).
            const seasonData = await Promise.all(
                seasons.map(s => tmdb(`tv/${id}/season/${s.season_number}`))
            );
            seasonData.forEach((sd, idx) => {
                if (!sd || !sd.episodes) return;
                const sNum = seasons[idx].season_number;
                sd.episodes.forEach(ep => {
                    episodes.push(new Episode({
                        name: ep.name || `S${sNum}E${ep.episode_number}`,
                        url: JSON.stringify({ id: id, mtype: "tv", s: sNum, e: ep.episode_number }),
                        season: sNum,
                        episode: ep.episode_number,
                        posterUrl: ep.still_path ? poster(ep.still_path) : poster(d.poster_path),
                        airDate: ep.air_date || undefined,
                        runtime: ep.runtime || undefined,
                        rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : undefined
                    }));
                });
            });

            const item = new MultimediaItem({
                title: d.name || d.original_name || "Untitled",
                url: JSON.stringify({ id: id, mtype: "tv" }),
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
            });
            cb({ success: true, data: item });
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
            const id = info.id;
            const mtype = info.mtype || "movie";
            if (!id) throw new Error("Missing id");

            let embedUrl;
            if (mtype === "tv") {
                const s = info.s || 1, e = info.e || 1;
                embedUrl = `${EMBED}?tmdb=${id}&type=tv&s=${s}&e=${e}`;
            } else {
                embedUrl = `${EMBED}?tmdb=${id}&type=movie`;
            }

            // Return the official embed as the playable source. SkyStream opens it
            // in its webview/embedded player; the embed resolves the real stream,
            // handles Cloudflare, server switching and ads on its side.
            const streams = [
                new StreamResult({
                    url: embedUrl,
                    source: "Screenscape",
                    headers: { "Referer": "https://main.screenscape.me/", "User-Agent": UA }
                })
            ];

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    /* ------------------------------ exports ----------------------------- */

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
