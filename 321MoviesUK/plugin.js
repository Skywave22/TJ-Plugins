/**
 * SkyStream provider plugin — 321movies.co.uk
 *
 * How this plugin gets its data (all verified against the live site, Sept 2026):
 *  - 321movies.co.uk is a client-rendered Next.js app: its HTML contains no links, so DOM
 *    scraping is useless. Its catalogue is the TMDB v3 API, using the public read token that
 *    the site itself ships inside its browser bundle (NEXT_PUBLIC_TMDB_ACCESS_TOKEN).
 *  - Playable sources come from the site's own player API:
 *      GET {SITE}/api/player/vixsrc-playlist?type=movie&id={tmdbId}
 *      GET {SITE}/api/player/vixsrc-playlist?type=tv&id={tmdbId}&season={s}&episode={e}
 *    -> { "playlist": [ { "sources": [ { type, file, label, provider, default } ] } ] }
 *    where `file` is "enc:" + base64url(XOR-obfuscated URL). The XOR key is a public constant
 *    in the site's player bundle; it is link obfuscation, NOT DRM, and is not bypassed here.
 *  - Every decoded source is probed with the headers the player will use (site Referer/Origin).
 *    Verified ones are listed first (Hindi audio, then best quality); 403/timeouts are kept,
 *    labelled "(may not play)"; definitively dead ones (404/451/5xx/DNS/HTML) are dropped.
 *  - No spoofed X-Forwarded-For / CF-Connecting-IP headers: Cloudflare answers 403 to them.
 *
 * Runtime constraints honoured (SkyStream Gen 2 / QuickJS):
 *  - no fetch()/XHR: uses http_get; no Node-only globals; no `new URL`.
 *  - StreamResult has no `quality` field -> the quality label is carried in `source`.
 *  - cb() is called exactly once on every path.
 */
(function () {
    "use strict";

    var TMDB = "https://api.themoviedb.org/3";
    var IMG = "https://image.tmdb.org/t/p/";
    var TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiYmYxODFkOTRiMzk2MTg1ZDBhYmQ5NzA5M2ZkNDhlMCIsIm5iZiI6MTY5MjUzNzk2MS45MTgwMDAyLCJzdWIiOiI2NGUyMTQ2OTM3MTA5NzAxMWM1NDk3YjgiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.t4GsujVl9LceOrnPmx-WDdncTSAx60QBLAoaiuTCvXI";
    var PLAYER_KEY = "j7wYkYhVgQn5x2L6k2M8hVQfD4zN3bP1aR7uT0cXyE6dZX4sWAd87JKMN8HHGG654GVCFRLMNBOPUY7LK";
    var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // Sources the site's player marks as most reliable are tried first.
    var PREFERRED = ["rivestream", "streamaggregator", "peestream", "movy", "pstream", "frame", "bcine", "cinesrc", "vidgod"];
    var MAX_STREAMS = 16;

    function site() {
        var b = (typeof manifest !== "undefined" && manifest.baseUrl) ? manifest.baseUrl : "https://321movies.co.uk";
        return String(b).replace(/\/+$/, "");
    }
    function hdr(extra) {
        var h = { "User-Agent": UA };
        if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k]; } }
        return h;
    }
    function fail(cb, code, msg) { cb({ success: false, errorCode: code, message: String(msg || code) }); }

    /** GET with a hard deadline; never throws. */
    async function req(url, headers, ms) {
        var timer = null;
        try {
            var p = http_get(url, headers || hdr());
            var race = await Promise.race([
                Promise.resolve(p),
                new Promise(function (_, rej) {
                    timer = setTimeout(function () { rej(new Error("timeout after " + (ms || 15000) + "ms")); }, ms || 15000);
                }),
            ]);
            return {
                status: Number(race && (race.status || race.statusCode)) || 0,
                body: String((race && race.body) || ""),
                error: race && race.error ? String(race.error) : "",
            };
        } catch (e) {
            return { status: 0, body: "", error: String((e && e.message) || e) };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** GET + JSON.parse with retries. Returns null when every attempt failed. */
    async function jget(url, headers, ms, tries) {
        var n = tries || 3;
        for (var i = 0; i < n; i++) {
            var h = hdr(headers);
            if (!h.Accept) h.Accept = "application/json";
            var r = await req(url, h, ms || 20000);
            if (r.status === 200) {
                try { var parsed = JSON.parse(r.body); if (parsed) return parsed; } catch (e) { /* retry */ }
            }
            if (r.status === 404) return null;
            if (i + 1 < n) await new Promise(function (r2) { setTimeout(r2, 1500 * (i + 1)); });
        }
        return null;
    }

    async function tmdbGet(path) {
        var sep = path.indexOf("?") < 0 ? "?" : "&";
        var url = TMDB + path + sep + "language=en-US";
        var h = { Authorization: "Bearer " + TMDB_TOKEN, Accept: "application/json" };
        // A dashboard fans out ~7 calls at once and TMDB answers 429; back off and retry
        // instead of dropping a row (or failing getHome outright).
        for (var attempt = 0; attempt < 3; attempt++) {
            var out = await jget(url, h, 20000, 2);
            if (out) return out;
            await new Promise(function (r) { setTimeout(r, 350 * (attempt + 1)); });
        }
        return null;
    }

    function poster(path, size) {
        if (!path) return "";
        var sz = size || "w500";
        // Ensure path starts with /
        var p = String(path);
        if (p.charAt(0) !== "/") p = "/" + p;
        return IMG + sz + p;
    }
    function posterFallback(r, size) {
        if (r && r.poster_path) return poster(r.poster_path, size || "w500");
        if (r && r.backdrop_path) return poster(r.backdrop_path, size || "w780");
        if (r && r.profile_path) return poster(r.profile_path, size || "w500");
        if (r && r.still_path) return poster(r.still_path, size || "w300");
        return "";
    }
    function yearOf(d) { var m = /^(\d{4})/.exec(String(d || "")); return m ? parseInt(m[1], 10) : undefined; }

    /** Decode "enc:<base64url>" into a real URL. Tries primary key then fallback keys */
    var PLAYER_KEYS = [
        PLAYER_KEY,
        "j7wYkYhVgQn5x2L6k2M8hVQfD4zN3bP1aR7uT0cXyE6dZX4sWAd87JKMN8HHGG654GVCFRLMNBOPUY7LK",
        "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6",
        "321movies-default-key-2024"
    ];
    function tryDecodeWithKey(raw, key) {
        try {
            var out = "";
            for (var i = 8; i < raw.length; i++) {
                var salt = raw.charCodeAt((i - 8) % 8);
                out += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt((i - 8 + salt) % key.length));
            }
            return /^https?:\/\//i.test(out) ? out : "";
        } catch (e) { return ""; }
    }
    function decodeFile(file) {
        if (typeof file !== "string" || !file) return "";
        if (file.slice(0, 4) !== "enc:") return file;
        try {
            var b64 = file.slice(4).replace(/-/g, "+").replace(/_/g, "/");
            while (b64.length % 4) b64 += "=";
            var raw = atob(b64);
            if (raw.length < 9) return "";
            for (var ki = 0; ki < PLAYER_KEYS.length; ki++) {
                var decoded = tryDecodeWithKey(raw, PLAYER_KEYS[ki]);
                if (decoded) return decoded;
            }
            return "";
        } catch (e) {
            return "";
        }
    }

    /** /movie/550 , /tv/1399 , /tv/1399/1/5  ->  {type,id,season,episode} */
    function reference(url) {
        var s = String(url || "");
        var m = /\/(movie|tv|series)\/(\d+)(?:\/(?:season\/)?(\d+))?(?:\/(?:episode\/)?(\d+))?/i.exec(s);
        if (!m) return null;
        var type = /^series$/i.test(m[1]) ? "tv" : m[1].toLowerCase();
        return { type: type, id: m[2], season: m[3] ? parseInt(m[3], 10) : null, episode: m[4] ? parseInt(m[4], 10) : null };
    }

    function qualityOf(label) {
        var l = String(label || "");
        if (/4k|2160/i.test(l)) return "4K" + (/hdr/i.test(l) ? " HDR" : "");
        var m = /(720|1080|480|360)0?p?/i.exec(l);
        if (m) return m[1] + "p";
        return /auto/i.test(l) ? "Auto" : "";
    }
    function familyOf(provider) {
        return String(provider || "other").replace(/^sourcepack-/, "");
    }

    function toItem(r, forced) {
        if (!r || !r.id) return null;
        var type = forced || (r.media_type === "tv" || r.first_air_date ? "series" : "movie");
        if (type === "tv") type = "series";
        var title = r.title || r.name || r.original_title || r.original_name || "Untitled";
        var id = String(r.id);
        var pUrl = posterFallback(r, "w500");
        var bUrl = poster(r.backdrop_path || r.poster_path, "w1280");
        // Ensure we always have at least one image
        if (!pUrl && bUrl) pUrl = bUrl;
        return new MultimediaItem({
            title: title,
            url: site() + "/" + (type === "series" ? "tv" : "movie") + "/" + id,
            posterUrl: pUrl,
            bannerUrl: bUrl,
            type: type,
            year: yearOf(type === "series" ? r.first_air_date : r.release_date),
            score: typeof r.vote_average === "number" ? Math.round(r.vote_average * 10) / 10 : undefined,
            description: r.overview || "",
            isAdult: !!r.adult,
            syncData: { tmdb: id },
        });
    }

    // ---------------------------------------------------------------- getHome
    var ROWS = [
        ["Trending", "/trending/movie/day", "movie"],
        ["Popular Movies", "/movie/popular", "movie"],
        ["Popular Series", "/tv/popular", "series"],
        ["Trending Series", "/trending/tv/week", "series"],
        ["Top Rated Movies", "/movie/top_rated", "movie"],
        ["Airing Today", "/tv/airing_today", "series"],
        ["Upcoming", "/movie/upcoming", "movie"],
    ];

    async function getHome(cb) {
        try {
            var lists = await Promise.all(ROWS.map(function (r) { return tmdbGet(r[1]); }));
            var data = {};
            for (var i = 0; i < ROWS.length; i++) {
                var res = lists[i] && lists[i].results;
                if (!res || !res.length) continue;
                var items = [];
                for (var j = 0; j < res.length; j++) {
                    if (res[j] && res[j].adult) continue;
                    var it = toItem(res[j], ROWS[i][2]);
                    if (it) items.push(it);
                }
                if (items.length) data[ROWS[i][0]] = items;
            }
            if (!Object.keys(data).length) {
                return fail(cb, "UPSTREAM_ERROR", "TMDB returned nothing - check network access to api.themoviedb.org or a rotated public token.");
            }
            cb({ success: true, data: data });
        } catch (e) {
            fail(cb, "UNKNOWN", (e && e.stack) || e);
        }
    }

    // ----------------------------------------------------------------- search
    async function search(query, cb) {
        try {
            var q = encodeURIComponent(String(query || "").trim());
            if (!q) return cb({ success: true, data: [] });
            var res = await tmdbGet("/search/multi?query=" + q + "&include_adult=false&page=1");
            if (!res || !res.results) {
                res = await tmdbGet("/search/movie?query=" + q + "&include_adult=false&page=1");
            }
            var out = [];
            var rows = (res && res.results) || [];
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                if (!r || r.media_type === "person" || r.adult) continue;
                var it = toItem(r);
                if (it) out.push(it);
            }
            cb({ success: true, data: out });
        } catch (e) {
            fail(cb, "UNKNOWN", (e && e.stack) || e);
        }
    }

    // ------------------------------------------------------------------- load
    async function load(url, cb) {
        var ref = reference(url);
        if (!ref) return fail(cb, "BAD_URL", "Unrecognised 321movies URL: " + url);
        try {
            var path = ref.type === "tv"
                ? "/tv/" + ref.id + "?append_to_response=credits,videos,seasons,content_ratings"
                : "/movie/" + ref.id + "?append_to_response=credits,videos,content_ratings";
            var d = await tmdbGet(path);
            if (!d || !d.id) return fail(cb, "NOT_FOUND", "TMDB has no entry for " + path);

            var title = d.title || d.name || "Untitled";
            var item = toItem(d, ref.type === "tv" ? "series" : "movie");
            item.description = d.overview || item.description;
            item.url = site() + "/" + (ref.type === "tv" ? "tv" : "movie") + "/" + d.id;
            item.tags = (d.genres || []).map(function (g) { return g.name; });
            if (d.runtime) item.duration = d.runtime;
            if (d.status) item.status = /released|ended/i.test(d.status) ? "completed" : "ongoing";
            var rating = ((d.content_ratings && (d.content_ratings.results || d.content_ratings.us || [])) || [])
                .map(function (x) { return x.rating; }).filter(Boolean);
            if (rating.length) item.contentRating = rating[0];
            item.cast = (d.credits && d.credits.cast ? d.credits.cast.slice(0, 12) : []).map(function (c) {
                return new Actor({ name: c.name, role: c.character, image: poster(c.profile_path, "w185") });
            });
            item.trailers = ((d.videos && d.videos.results) || [])
                .filter(function (v) { return v.site === "YouTube" && v.type === "Trailer"; }).slice(0, 3)
                .map(function (v) { return new Trailer({ url: "https://www.youtube.com/watch?v=" + v.key }); });

            var episodes = [];
            if (ref.type === "tv") {
                var wantSeason = ref.season;
                var seasons = (d.seasons || []).filter(function (s) {
                    return s.season_number > 0 && (wantSeason ? s.season_number === wantSeason : true);
                }).slice(0, 40);
                var eps = await Promise.all(seasons.map(function (s) {
                    return tmdbGet("/tv/" + d.id + "/season/" + s.season_number);
                }));
                for (var si = 0; si < seasons.length; si++) {
                    var sd = eps[si];
                    if (!sd || !sd.episodes) continue;
                    for (var ei = 0; ei < sd.episodes.length; ei++) {
                        var e = sd.episodes[ei];
                        episodes.push(new Episode({
                            name: e.name || ("Episode " + e.episode_number),
                            url: site() + "/tv/" + d.id + "/" + sd.season_number + "/" + e.episode_number,
                            season: sd.season_number,
                            episode: e.episode_number,
                            description: e.overview || "",
                            posterUrl: poster(e.still_path || e.poster_path || d.poster_path, "w300") || posterFallback(d, "w500"),
                            runtime: e.runtime,
                            airDate: e.air_date,
                            rating: typeof e.vote_average === "number" ? e.vote_average : undefined,
                        }));
                    }
                }
            } else {
                // One playable entry for a movie, like the reference plugins do.
                episodes = [new Episode({ name: title, url: item.url, season: 1, episode: 1, posterUrl: item.posterUrl })];
            }
            item.episodes = episodes;
            cb({ success: true, data: item });
        } catch (err) {
            fail(cb, "UNKNOWN", (err && err.stack) || err);
        }
    }

    // ----------------------------------------------------------- loadStreams
    /**
     * Checks one decoded source with the same headers the player will send.
     * ok      -> answered with an HLS playlist / media bytes
     * dead    -> definitive failure (404/410/451/5xx, DNS error, HTML error page)
     * unknown -> 401/403/429/timeout: often a datacenter/IP block that works on a phone
     */
    async function probe(streamUrl, headers) {
        var r = await req(streamUrl, Object.assign({}, headers, { Accept: "*/*", Range: "bytes=0-2047" }), 9000);
        if (r.status === 200 || r.status === 206) {
            var head = String(r.body || "").replace(/^\uFEFF/, "").replace(/^\s+/, "");
            if (/^#EXTM3U/.test(head)) return "ok";
            if (/^<(!doctype|html|\?xml(?![\s\S]*<MPD))/i.test(head)) return /<MPD/i.test(head) ? "ok" : "dead";
            return head.length ? "ok" : "unknown";
        }
        if (r.status === 401 || r.status === 403 || r.status === 429 || r.status === 0) return r.error && /ENOTFOUND|getaddrinfo|Failed host lookup/i.test(r.error) ? "dead" : "unknown";
        return "dead";
    }

    function langOf(label) {
        var m = /\b(Hindi|English|Tamil|Telugu|Urdu|Malayalam|Bengali|Spanish|French)\b/i.exec(String(label || ""));
        return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : "";
    }
    function qualityRank(q) {
        if (/4K/.test(q)) return 0;
        var m = /(\d{3,4})p/.exec(q);
        return m ? 3000 - parseInt(m[1], 10) : 2500;
    }

    /**
     * The site's player endpoint aggregates ~10 upstream providers. A title nobody has
     * opened recently takes ~20 s on the first call (longer than the app's 15 s HTTP
     * timeout); the server keeps working and caches the answer, so the retry returns in
     * well under a second. Hence: several short attempts, never one long one.
     */
    async function playerPlaylist(S, q) {
        var url = S + "/api/player/vixsrc-playlist?" + q;
        var h = { Accept: "application/json", Referer: S + "/", Origin: S };
        for (var i = 0; i < 4; i++) {
            var r = await req(url, hdr(h), 15000);
            if (r.status === 200) {
                try {
                    var j = JSON.parse(r.body);
                    if (j && j.playlist && j.playlist.length) return j;
                } catch (e) { /* retry */ }
            }
            if (r.status === 404) return null;
            await new Promise(function (ok) { setTimeout(ok, 2000); });
        }
        return null;
    }

    async function loadStreams(url, cb) {
        var ref = reference(url);
        if (!ref) return fail(cb, "BAD_URL", "Unrecognised 321movies URL: " + url);
        try {
            var S = site();
            var q = "type=" + ref.type + "&id=" + ref.id;
            if (ref.type === "tv") q += "&season=" + (ref.season || 1) + "&episode=" + (ref.episode || 1);

            var payload = await playerPlaylist(S, q);
            if (!payload) return fail(cb, "PLAYER_OFFLINE", "321movies' player returned no sources for this title right now. Try again in a minute.");

            var seen = {}, cands = [], encoded = 0;
            (payload.playlist || []).forEach(function (g) {
                (g.sources || []).forEach(function (src) {
                    if (typeof src.file === "string" && src.file.slice(0, 4) === "enc:") encoded++;
                    var real = decodeFile(src.file);
                    if (!/^https?:\/\//i.test(real) || seen[real]) return;
                    seen[real] = true;
                    var fam = familyOf(src.provider);
                    cands.push({
                        url: real, family: fam, label: String(src.label || ""),
                        rank: PREFERRED.indexOf(fam) < 0 ? 50 : PREFERRED.indexOf(fam),
                    });
                });
            });
            if (!cands.length) {
                return fail(cb, encoded ? "DECODE_FAILED" : "NO_SOURCES", encoded
                    ? "321movies changed its source obfuscation key; the plugin needs an update."
                    : "321movies returned no sources for this title.");
            }

            // The player's CDNs/proxies check the site's Referer/Origin (verified: 403 without, 200 with).
            var headers = { "User-Agent": UA, Referer: S + "/", Origin: S };
            var verdicts = await Promise.all(cands.map(function (c) { return probe(c.url, headers); }));

            var ok = [], unknown = [];
            cands.forEach(function (c, i) {
                if (verdicts[i] === "ok") ok.push(c);
                else if (verdicts[i] === "unknown") unknown.push(c);
            });
            var order = function (a, b) {
                return (langOf(b.label) === "Hindi") - (langOf(a.label) === "Hindi") ||
                    qualityRank(qualityOf(a.label)) - qualityRank(qualityOf(b.label)) || a.rank - b.rank;
            };
            ok.sort(order); unknown.sort(order);

            var streams = [], names = {};
            function add(c, unverified) {
                if (streams.length >= MAX_STREAMS) return;
                var fam = c.family.charAt(0).toUpperCase() + c.family.slice(1);
                var label = c.label.replace(/\bauto\b/ig, "").replace(/\s*\|\s*/g, " · ").replace(/\s+/g, " ").trim() || fam;
                var name = label + (unverified ? " (may not play)" : "");
                var n = names[name] = (names[name] || 0) + 1;
                if (n > 1) name += " #" + n;
                streams.push(new StreamResult({ url: c.url, source: name, headers: headers }));
            }
            ok.forEach(function (c) { add(c, false); });
            unknown.slice(0, Math.max(0, 6 - ok.length)).forEach(function (c) { add(c, true); });

            if (!streams.length) return fail(cb, "NO_STREAMS", "All " + cands.length + " sources for this title are offline right now.");
            cb({ success: true, data: streams });
        } catch (err) {
            fail(cb, "EXTRACTION_FAILED", String((err && err.message) || err));
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
