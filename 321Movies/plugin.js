(function() {
    "use strict";

    // ═══════════════════════════════════════════════════════════
    //  321Movies (321movies.xyz) — SkyStream plugin
    //
    //  Next.js TMDB front-end. Catalog/search/metadata come straight
    //  from TMDB using the site's public v4 read token; playback uses
    //  the site's own player API:
    //
    //    GET https://321movies.xyz/api/player/vixsrc-playlist
    //        ?type=movie&id=<tmdbId>
    //        ?type=tv&id=<tmdbId>&season=<S>&episode=<E>
    //      -> { playlist: [ { sources: [ { type: "hls"|"mp4",
    //             file: "enc:<base64url>", label: "Cascade 720p | Hindi",
    //             provider, default } ] } ] }
    //
    //  enc: decode (recovered from their bundle, module 33474):
    //    raw  = base64url_decode(file.slice(4))
    //    salt = raw[0..8]; body = raw[8..]
    //    key  = utf8("j7wYkYhVgQn5x2L6k2M8hVQfD4zN3bP1aR7uT0cXyE6dZX4sWAd87JKMN8HHGG654GVCFRLMNBOPUY7LK")
    //    out[i] = body[i] ^ key[(i + salt[i % 8]) % key.length]
    //  The decoded URL is a ready-to-play proxy URL (piracya.workers.dev
    //  m3u8/mp4 proxies carrying upstream + headers) that the site's
    //  player uses as-is.
    //
    //  STREAM HEADERS: the proxy workers require
    //      Origin: https://321movies.xyz
    //  (verified: without it -> 403, with it -> 200 HLS manifest).
    //
    //  Labels carry quality + audio language (720p | Hindi etc.), so
    //  Hindi tracks are surfaced directly in the source list.
    // ═══════════════════════════════════════════════════════════

    const TMDB  = "https://api.themoviedb.org/3";
    const IMG   = "https://image.tmdb.org/t/p/w500";
    const SITE  = "https://321movies.xyz";
    const PAPI  = SITE + "/api/player/vixsrc-playlist";

    const TMDB_TOKEN = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiYmYxODFkOTRiMzk2MTg1ZDBhYmQ5NzA5M2ZkNDhlMCIsIm5iZiI6MTY5MjUzNzk2MS45MTgwMDAyLCJzdWIiOiI2NGUyMTQ2OTM3MTA5NzAxMWM1NDk3YjgiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.t4GsujVl9LceOrnPmx-WDdncTSAx60QBLAoaiuTCvXI";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    const TMDB_HEADERS = {
        "Accept": "application/json",
        "Authorization": TMDB_TOKEN,
        "User-Agent": UA
    };

    const STREAM_HEADERS = {
        "User-Agent": UA,
        "Origin": SITE
    };

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

    async function tmdb(path) {
        const r = await withTimeout(http_get(TMDB + path, TMDB_HEADERS), 25000);
        let j = {};
        try { j = JSON.parse((r && r.body) || "{}"); } catch (e) { j = {}; }
        return j;
    }

    async function playerApi(qs) {
        const r = await withTimeout(http_get(PAPI + "?" + qs, {
            "Accept": "application/json",
            "User-Agent": UA,
            "Referer": SITE + "/"
        }), 25000);
        let j = {};
        try { j = JSON.parse((r && r.body) || "{}"); } catch (e) { j = {}; }
        return j;
    }

    // ─────────────────────── enc: url decoder ──────────────────────

    const CODEC_KEY = "j7wYkYhVgQn5x2L6k2M8hVQfD4zN3bP1aR7uT0cXyE6dZX4sWAd87JKMN8HHGG654GVCFRLMNBOPUY7LK";

    function b64urlToBytes(s) {
        let t = s.replace(/-/g, "+").replace(/_/g, "/");
        t = t + "=".repeat((4 - (t.length % 4)) % 4);
        try {
            const bin = atob(t);
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
            return out;
        } catch (e) {
            return null;
        }
    }

    function decodeStreamUrl(v) {
        if (!v || v.indexOf("enc:") !== 0) return v || "";
        const raw = b64urlToBytes(v.slice(4));
        if (!raw || raw.length <= 8) return "";
        const salt = raw.slice(0, 8);
        const body = raw.slice(8);
        const key = [];
        for (let i = 0; i < CODEC_KEY.length; i++) key.push(CODEC_KEY.charCodeAt(i) & 255);
        let s = "";
        for (let i = 0; i < body.length; i++) {
            const c = body[i] ^ key[(i + salt[i % salt.length]) % key.length];
            s += String.fromCharCode(c);
        }
        try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    }

    // ─────────────────────────── items ─────────────────────────────

    function yearOf(r) {
        const d = r.release_date || r.first_air_date || "";
        return parseInt(String(d).slice(0, 4), 10) || null;
    }

    function toItem(r) {
        if (!r || !r.id) return null;
        const isTv = (r.media_type || (r.first_air_date ? "tv" : "movie")) === "tv";
        const name = r.title || r.name || "";
        if (!name) return null;
        const poster = r.poster_path ? IMG + r.poster_path : "";
        return mkItem({
            title: String(name).trim(),
            url: JSON.stringify({ mt: isTv ? "tv" : "movie", id: String(r.id) }),
            posterUrl: poster,
            bannerUrl: r.backdrop_path ? IMG + r.backdrop_path : poster,
            type: isTv ? "tv" : "movie",
            year: yearOf(r),
            score: r.vote_average ? parseFloat(r.vote_average) : null
        });
    }

    function mapResults(list) {
        return (list || []).map(toItem).filter(function (x) { return !!x; });
    }

    // ─────────────────────────── home ──────────────────────────────

    async function getHome(cb) {
        try {
            const rows = [
                { name: "Trending Now",   p: "/trending/all/day" },
                { name: "Popular Movies", p: "/movie/popular" },
                { name: "Popular TV",     p: "/tv/popular" },
                { name: "Top Rated Movies", p: "/movie/top_rated" },
                { name: "Top Rated TV",   p: "/tv/top_rated" },
                { name: "Trending TV",    p: "/trending/tv/day" }
            ];
            const settled = await Promise.all(rows.map(function (row) {
                return tmdb(row.p + "?page=1").catch(function () { return {}; });
            }));
            const home = {};
            for (let i = 0; i < rows.length; i++) {
                const items = mapResults(settled[i] && settled[i].results);
                if (items.length) home[rows[i].name] = items;
            }
            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "API_ERROR", message: "321Movies catalog unavailable" });
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── search ────────────────────────────

    async function search(query, cb) {
        try {
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });
            const j = await tmdb("/search/multi?query=" + encodeURIComponent(q) + "&include_adult=false&page=1")
                .catch(function () { return {}; });
            cb({ success: true, data: mapResults(j && j.results) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────── detail + episodes ─────────────────────

    async function load(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.id || !p.mt) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized 321Movies url" });

            const isTv = p.mt === "tv";
            const d = await tmdb("/" + (isTv ? "tv" : "movie") + "/" + p.id).catch(function () { return {}; });
            if (!d || !d.id) return cb({ success: false, errorCode: "DETAIL_ERROR", message: "Title not found" });

            const title = String(d.title || d.name || "Title").trim();
            const poster = d.poster_path ? IMG + d.poster_path : "";
            const banner = d.backdrop_path ? IMG + d.backdrop_path : poster;
            const episodes = [];

            if (!isTv) {
                episodes.push(mkEpisode({
                    name: "Full Movie",
                    url: JSON.stringify({ mt: "movie", id: String(p.id) }),
                    season: 1,
                    episode: 1,
                    posterUrl: poster,
                    description: title
                }));
            } else {
                const seasons = (d.seasons || []).filter(function (s) {
                    return s && parseInt(s.season_number, 10) > 0 && parseInt(s.episode_count, 10) > 0;
                });
                const perSeason = await Promise.all(seasons.map(function (s) {
                    return tmdb("/tv/" + p.id + "/season/" + s.season_number).catch(function () { return {}; });
                }));
                for (let si = 0; si < perSeason.length; si++) {
                    const sn = parseInt(seasons[si].season_number, 10) || (si + 1);
                    const eps = (perSeason[si] && perSeason[si].episodes) || [];
                    for (let ei = 0; ei < eps.length; ei++) {
                        const e = eps[ei] || {};
                        const en = parseInt(e.episode_number, 10) || (ei + 1);
                        const eName = String(e.name || ("Episode " + en)).trim();
                        episodes.push(mkEpisode({
                            name: "S" + sn + " E" + (en < 10 ? "0" + en : en) + " · " + eName,
                            url: JSON.stringify({ mt: "tv", id: String(p.id), s: sn, e: en }),
                            season: sn,
                            episode: en,
                            posterUrl: e.still_path ? "https://image.tmdb.org/t/p/w300" + e.still_path : poster,
                            description: String(e.overview || "").slice(0, 300)
                        }));
                    }
                }
                if (!episodes.length) {
                    episodes.push(mkEpisode({
                        name: "S1 E01",
                        url: JSON.stringify({ mt: "tv", id: String(p.id), s: 1, e: 1 }),
                        season: 1,
                        episode: 1,
                        posterUrl: poster,
                        description: title
                    }));
                }
            }

            cb({
                success: true,
                data: mkItem({
                    title: title,
                    url: url,
                    posterUrl: poster,
                    bannerUrl: banner,
                    type: isTv ? "tv" : "movie",
                    year: yearOf(d),
                    description: String(d.overview || "").slice(0, 700),
                    score: d.vote_average ? parseFloat(d.vote_average) : null,
                    duration: parseInt(d.runtime, 10) || null,
                    tags: (d.genres || []).map(function (g) { return g.name; }).slice(0, 4),
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "DETAIL_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

    function qRank(label) {
        const m = String(label || "").match(/(\d{3,4})\s*p/i);
        return m ? parseInt(m[1], 10) : 0;
    }

    async function loadStreams(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.id || !p.mt) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized episode url" });

            const qs = p.mt === "tv"
                ? "type=tv&id=" + encodeURIComponent(p.id) + "&season=" + encodeURIComponent(parseInt(p.s, 10) || 1) + "&episode=" + encodeURIComponent(parseInt(p.e, 10) || 1)
                : "type=movie&id=" + encodeURIComponent(p.id);
            const j = await playerApi(qs).catch(function () { return {}; });
            const sources = (((j && j.playlist) || [])[0] || {}).sources || [];

            const out = [];
            const seen = {};
            for (let i = 0; i < sources.length; i++) {
                const s = sources[i] || {};
                const u = decodeStreamUrl(s.file);
                if (!u || u.indexOf("http") !== 0) continue;
                if (seen[u]) continue;
                seen[u] = 1;
                out.push({
                    url: u,
                    label: String(s.label || "Stream"),
                    def: !!s.default,
                    q: qRank(s.label)
                });
            }
            // best quality first, site-default pinned to top
            out.sort(function (a, b) { return (b.def - a.def) || (b.q - a.q); });

            const streams = [];
            for (let i = 0; i < out.length && streams.length < 10; i++) {
                streams.push(mkStream({
                    url: out[i].url,
                    source: "321Movies - " + out[i].label,
                    headers: STREAM_HEADERS,
                    isDirect: true
                }));
            }

            if (!streams.length) {
                return cb({
                    success: false,
                    errorCode: "NO_STREAMS",
                    message: "No playable source right now — try again in a moment."
                });
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
                                             
