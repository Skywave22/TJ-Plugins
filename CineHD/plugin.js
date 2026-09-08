(function() {
    "use strict";

    // ═══════════════════════════════════════════════════════════
    //  CineHD (cinehd.vc) — SkyStream plugin
    //
    //  cinehd.vc is a Next.js guide over TMDB ids (/movie/<tmdbId>,
    //  /tv/<tmdbId>). Its play buttons open ~30 public embed players.
    //  The primary player chain (111movies.net → player.vidlove.cc)
    //  exposes a plain JSON API:
    //
    //    https://api.vidlove.cc/movie?id=<tmdbId>&mode=json
    //    https://api.vidlove.cc/tv?id=<tmdbId>&season=S&episode=E&mode=json
    //
    //  → { meta, subtitles, source: { url: <master m3u8>, manifest } }
    //  Verified live: master m3u8 serves 360p/720p/1080p variants and
    //  MPEG-TS segments (2026-09). Alternate servers ride on &sources=.
    //
    //  Catalog/search/details come straight from TMDB with the public
    //  key already used by this repo's MovieBlast plugin.
    // ═══════════════════════════════════════════════════════════

    const TMDB = "https://api.themoviedb.org/3";
    const IMG = "https://image.tmdb.org/t/p";
    const KEY = "439c478a771f35c05022f9feabcca01c"; // repo-wide public TMDB key
    const VLA = "https://api.vidlove.cc";
    const PLAYER_REF = "https://player.vidlove.cc/";
    const SITE = "https://cinehd.vc";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    const STREAM_HEADERS = {
        "User-Agent": UA,
        "Referer": PLAYER_REF
    };

    // ─────────────────────────── helpers ───────────────────────────

    function mkItem(obj)    { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj)  { try { return new StreamResult(obj); } catch (_) { return obj; } }

    async function tmdb(path) {
        const sep = path.indexOf("?") >= 0 ? "&" : "?";
        const res = await http_get(TMDB + path + sep + "api_key=" + KEY, { "User-Agent": UA });
        if (!res || !res.body) return null;
        try { return JSON.parse(res.body); } catch (e) { return null; }
    }

    function poster(p, size) {
        return p ? IMG + "/" + (size || "w500") + p : "";
    }

    function yearOf(d) {
        const m = String(d || "").match(/^(\d{4})/);
        return m ? parseInt(m[1], 10) : null;
    }

    function mediaTypeOf(r) {
        if (r.media_type === "movie" || r.media_type === "tv") return r.media_type;
        return r.first_air_date || r.name ? "tv" : "movie";
    }

    function tmdbToItem(r) {
        if (!r || !r.id) return null;
        const type = mediaTypeOf(r);
        const title = r.title || r.name || "Unknown";
        const url = JSON.stringify({ type: type, id: r.id, title: title });
        return mkItem({
            title: title,
            url: url,
            posterUrl: poster(r.poster_path, "w500"),
            bannerUrl: poster(r.backdrop_path, "w780"),
            type: type,
            year: yearOf(r.release_date || r.first_air_date),
            description: r.overview || "",
            score: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null
        });
    }

    function itemUrl(type, id, title) {
        return JSON.stringify({ type: type, id: id, title: title || "" });
    }

    function parseUrl(url) {
        try {
            const p = JSON.parse(String(url || ""));
            if (p && p.id && (p.type === "movie" || p.type === "tv")) return p;
        } catch (e) {}
        return null;
    }

    // ─────────────────────────── catalog ───────────────────────────

    async function getHome(cb) {
        try {
            const sections = [
                { title: "Trending Movies",  path: "/trending/movie/week" },
                { title: "Trending TV Shows", path: "/trending/tv/week" },
                { title: "In Theaters",      path: "/movie/now_playing" },
                { title: "Top Rated Movies", path: "/movie/top_rated" }
            ];
            const home = {};
            for (let i = 0; i < sections.length; i++) {
                try {
                    const j = await tmdb(sections[i].path + "?page=1");
                    const items = ((j && j.results) || [])
                        .map(tmdbToItem)
                        .filter(function (x) { return !!x; });
                    if (items.length) home[sections[i].title] = items;
                } catch (e) { /* skip broken section */ }
            }
            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "API_ERROR", message: "TMDB catalog unavailable" });
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    async function search(query, cb) {
        try {
            if (!query || !String(query).trim()) return cb({ success: true, data: [] });
            const j = await tmdb("/search/multi?query=" + encodeURIComponent(String(query).trim()) + "&page=1&include_adult=false");
            const results = ((j && j.results) || [])
                .filter(function (r) { return r && (r.media_type === "movie" || r.media_type === "tv"); })
                .map(tmdbToItem)
                .filter(function (x) { return !!x; });
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    async function load(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized CineHD url" });

            if (p.type === "movie") {
                const d = await tmdb("/movie/" + p.id);
                if (!d) return cb({ success: false, errorCode: "NOT_FOUND", message: "Movie not found" });
                const item = mkItem({
                    title: d.title || "Unknown",
                    url: itemUrl("movie", p.id, d.title),
                    posterUrl: poster(d.poster_path, "w500"),
                    bannerUrl: poster(d.backdrop_path, "w780"),
                    logoUrl: null,
                    type: "movie",
                    year: yearOf(d.release_date),
                    description: d.overview || "",
                    score: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
                    duration: d.runtime ? parseInt(d.runtime, 10) : null,
                    tags: (d.genres || []).map(function (g) { return g.name; }).slice(0, 4)
                });
                return cb({ success: true, data: item });
            }

            // TV: details + all seasons' episodes (chunked parallel fetch)
            const d = await tmdb("/tv/" + p.id);
            if (!d) return cb({ success: false, errorCode: "NOT_FOUND", message: "Show not found" });
            const seasons = (d.seasons || [])
                .filter(function (s) { return (s.season_number || 0) > 0 && (s.episode_count || 0) > 0; })
                .sort(function (a, b) { return a.season_number - b.season_number; })
                .slice(0, 15);

            const episodes = [];
            const CHUNK = 5;
            for (let i = 0; i < seasons.length; i += CHUNK) {
                const batch = seasons.slice(i, i + CHUNK);
                const results = await Promise.all(batch.map(function (s) {
                    return tmdb("/tv/" + p.id + "/season/" + s.season_number)
                        .catch(function () { return null; });
                }));
                for (let k = 0; k < results.length; k++) {
                    const sj = results[k];
                    if (!sj || !sj.episodes) continue;
                    for (const ep of sj.episodes) {
                        episodes.push(mkEpisode({
                            title: ep.name || ("Episode " + ep.episode_number),
                            url: JSON.stringify({ type: "tv", id: p.id, s: sj.season_number, e: ep.episode_number, title: d.name }),
                            season: sj.season_number,
                            episode: ep.episode_number,
                            posterUrl: poster(ep.still_path, "w500"),
                            description: ep.overview || "",
                            airDate: ep.air_date || null
                        }));
                    }
                }
            }

            const item = mkItem({
                title: d.name || "Unknown",
                url: itemUrl("tv", p.id, d.name),
                posterUrl: poster(d.poster_path, "w500"),
                bannerUrl: poster(d.backdrop_path, "w780"),
                type: "tv",
                year: yearOf(d.first_air_date),
                description: d.overview || "",
                score: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
                status: d.status === "Ended" ? "completed" : "ongoing",
                tags: (d.genres || []).map(function (g) { return g.name; }).slice(0, 4),
                episodes: episodes
            });
            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

    function qualityFromManifest(manifest) {
        const resolutions = String(manifest || "").match(/RESOLUTION=(\d+)x(\d+)/g) || [];
        let maxH = 0;
        for (const r of resolutions) {
            const m = r.match(/x(\d+)/);
            if (m) maxH = Math.max(maxH, parseInt(m[1], 10));
        }
        if (maxH >= 2160) return "2160p";
        if (maxH >= 1080) return "1080p";
        if (maxH >= 720) return "720p";
        if (maxH >= 480) return "480p";
        if (maxH > 0) return maxH + "p";
        return "Auto";
    }

    // vidlove json api → source url (master m3u8). The default response and
    // the &sources= variants sometimes hit the same upstream — dedupe by url.
    async function vidloveSource(apiPath) {
        const res = await http_get(VLA + apiPath, {
            "User-Agent": UA,
            "Referer": PLAYER_REF,
            "Accept": "application/json"
        });
        if (!res || !res.body) return null;
        let j;
        try { j = JSON.parse(res.body); } catch (e) { return null; }
        if (!j || !j.source || !j.source.url) return null;
        const url = String(j.source.url);
        if (!/^https?:\/\//.test(url)) return null;
        return {
            url: url,
            quality: qualityFromManifest(j.source.manifest)
        };
    }

    async function loadStreams(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized CineHD url" });

            const variants = [
                { label: "", s: "" },
                { label: "Alt 1", s: "&sources=warden" },
                { label: "Alt 2", s: "&sources=cinefreak" },
                { label: "Alt 3", s: "&sources=moviebox" }
            ];

            const base = p.type === "tv"
                ? "/tv?id=" + encodeURIComponent(p.id) + "&season=" + encodeURIComponent(p.s || 1) + "&episode=" + encodeURIComponent(p.e || 1) + "&mode=json"
                : "/movie?id=" + encodeURIComponent(p.id) + "&mode=json";

            const streams = [];
            const seen = {};
            for (const v of variants) {
                let src = null;
                try { src = await vidloveSource(base + v.s); } catch (e) { src = null; }
                if (!src || seen[src.url]) continue;
                seen[src.url] = 1;
                streams.push(mkStream({
                    url: src.url,
                    source: "CineHD" + (v.label ? " • " + v.label : "") + " • " + src.quality,
                    headers: {
                        "User-Agent": UA,
                        "Referer": PLAYER_REF
                    }
                }));
                if (streams.length >= 3) break;
            }

            if (!streams.length) {
                return cb({
                    success: false,
                    errorCode: "NO_STREAMS",
                    message: "No stream source available for this title right now — the CineHD player API returned nothing for it."
                });
            }
            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── export ───────────────────────────

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
