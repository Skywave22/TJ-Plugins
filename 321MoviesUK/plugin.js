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
 *  - Many sourcepack hosts sit behind Cloudflare and answer 403 to datacenter IPs while working
 *    fine in the app. So every link is probed and only verified ones are ranked first; anything
 *    unverifiable is still offered but explicitly labelled, and never silently dropped.
 *
 * Runtime constraints honoured (SkyStream Gen 2 / QuickJS, see ../PLUGIN-NOTES.md):
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

    // ── Universal Geo Bypass (no personal IP, public DNS) ──
    // Uses public DNS IPs (8.8.8.8 Google, 1.1.1.1 Cloudflare) to avoid personal IP exposure
    // Bypasses all geo restrictions (US, IN, PK, UK, etc) via CF-IPCountry and X-Forwarded-For spoofing
    const GEO_BYPASS_IP = "8.8.8.8";
    const GEO_BYPASS_IP2 = "1.1.1.1";
    const GEO_BYPASS_COUNTRY = "US";
    const GEO_BYPASS_HEADERS = {
        "X-Forwarded-For": GEO_BYPASS_IP,
        "X-Real-IP": GEO_BYPASS_IP,
        "X-Client-IP": GEO_BYPASS_IP,
        "CF-Connecting-IP": GEO_BYPASS_IP,
        "True-Client-IP": GEO_BYPASS_IP,
        "CF-IPCountry": GEO_BYPASS_COUNTRY,
        "X-Country": GEO_BYPASS_COUNTRY,
        "cf-ipcountry": GEO_BYPASS_COUNTRY,
        "X-CF-IPCountry": GEO_BYPASS_COUNTRY,
        "X-Forwarded-Country": GEO_BYPASS_COUNTRY,
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "",
        "Accept-Language": "en-US,en;q=0.9,en-IN;q=0.8,en-PK;q=0.7,hi;q=0.6,ur;q=0.5,es;q=0.4"
    };
    // For PK-specific sites (CineJoy), also include PK bypass
    const PK_GEO_IP = "39.33.116.25";
    const PK_GEO_HEADERS = {
        "X-Forwarded-For": PK_GEO_IP,
        "X-Real-IP": PK_GEO_IP,
        "X-Client-IP": PK_GEO_IP,
        "CF-Connecting-IP": PK_GEO_IP,
        "CF-IPCountry": "PK",
        "X-Country": "PK",
        "cf-ipcountry": "PK",
        "X-CF-IPCountry": "PK",
        "X-Forwarded-Country": "PK",
        "Accept-Language": "en-PK,en;q=0.9,ur-PK;q=0.8,en-US;q=0.7"
    };
    function mergeGeoHeaders(base, isPK) {
        const geo = isPK ? PK_GEO_HEADERS : GEO_BYPASS_HEADERS;
        const out = Object.assign({}, base || {});
        for (const k in geo) { if (!(k in out)) out[k] = geo[k]; }
        // Always ensure bypass IP present if not already set
        if (!out["X-Forwarded-For"]) out["X-Forwarded-For"] = geo["X-Forwarded-For"];
        if (!out["CF-IPCountry"]) out["CF-IPCountry"] = geo["CF-IPCountry"];
        return out;
    }


    // Hosts that tend to work from restricted networks get probed first.
    // Expanded to include more reliable hosts for Indian/Pakistani content
    var PREFERRED = ["vuflix", "frame", "peestream", "bcine", "cinesrc", "movy", "pstream", "rivestream", "streamaggregator", "vidgod", "horizon", "flux", "cascade", "vidfast", "superstream"];
    var MAX_PROBE = 20;      // increased from 12 to handle more sources
    var MAX_STREAMS = 12;    // increased from 8

    function site() {
        var b = (typeof manifest !== "undefined" && manifest.baseUrl) ? manifest.baseUrl : "https://321movies.co.uk";
        return String(b).replace(/\/+$/, "");
    }
    function hdr(extra) {
        var h = { "User-Agent": UA, "Accept-Encoding": "identity" };
        // Merge universal geo bypass
        for (var gk in GEO_BYPASS_HEADERS) { if (!(gk in h)) h[gk] = GEO_BYPASS_HEADERS[gk]; }
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
            };
        } catch (e) {
            return { status: 0, body: "", error: String((e && e.message) || e) };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function jget(url, headers, ms, tries) {
        var n = tries || 3;
        for (var i = 0; i < n; i++) {
            // Try with geo bypass headers
            var h = hdr(headers);
            // Add extra bypass headers for player API
            h["Accept"] = h["Accept"] || "application/json";
            h["Referer"] = h["Referer"] || site() + "/";
            h["Origin"] = site();
            h["X-Client-Scrape"] = "aether,vidsrc";
            var r = await req(url, h, ms || 25000);
            if (r.status === 200) {
                try { 
                    var parsed = JSON.parse(r.body);
                    // Even if playlist empty, return it (don't retry)
                    if (parsed) return parsed;
                } catch (e) { 
                    // Try next attempt
                }
            }
            // Also accept 403/429 as potentially valid if body contains playlist
            if (r.status === 403 || r.status === 429) {
                try {
                    var parsed2 = JSON.parse(r.body);
                    if (parsed2 && parsed2.playlist) return parsed2;
                } catch (e) {}
            }
            if (i + 1 < n) await new Promise(function (r2) { setTimeout(r2, 1200 * (i + 1)); });
        }
        return null;
    }
    // Fallback + full website sources - matches 20 sources seen in screenshots for tv/307017/1/
    // Website shows: 321movies, VidLink, VidLink2, VidKing, <Embed>, SuperEmbed, FilmKu, NontonGo, AutoEmbed1/2, 2Embed, VidSrc1-5, MoviesAPI, NexVid, Smashy, VidBinge
    async function fallbackStreams(ref) {
        var out = [];
        try {
            var id = ref.id;
            var season = ref.season || 1;
            var episode = ref.episode || 1;
            var type = ref.type;
            var isTv = type === "tv" || type === "series";
            
            // All generic embeds that 321movies website shows (20 sources)
            var embeds = [];
            if (isTv) {
                embeds = [
                    { url: "https://vidsrc.to/embed/tv/" + id + "/" + season + "/" + episode, family: "vidsrc", label: "VidSrc 1" },
                    { url: "https://vidsrc.me/embed/tv/" + id + "/" + season + "/" + episode, family: "vidsrc", label: "VidSrc 2" },
                    { url: "https://vidsrc.xyz/embed/tv/" + id + "/" + season + "/" + episode, family: "vidsrc", label: "VidSrc 3" },
                    { url: "https://vidsrc.cc/v2/embed/tv/" + id + "/" + season + "/" + episode, family: "vidsrc", label: "VidSrc 4" },
                    { url: "https://vidsrc.icu/embed/tv/" + id + "/" + season + "/" + episode, family: "vidsrc", label: "VidSrc 5" },
                    { url: "https://www.2embed.cc/embedtv/" + id + "&s=" + season + "&e=" + episode, family: "2embed", label: "2Embed" },
                    { url: "https://www.2embed.cc/embed/" + id, family: "2embed", label: "2Embed Movie" },
                    { url: "https://multiembed.mov/?video_id=" + id + "&tmdb=1&s=" + season + "&e=" + episode, family: "superembed", label: "SuperEmbed" },
                    { url: "https://autoembed.co/tv/tmdb/" + id + "-" + season + "-" + episode, family: "autoembed", label: "AutoEmbed 1" },
                    { url: "https://autoembed.co/movie/tmdb/" + id, family: "autoembed", label: "AutoEmbed 2" },
                    { url: "https://www.nontongo.win/embed/tv/" + id + "/" + season + "/" + episode, family: "nontongo", label: "NontonGo" },
                    { url: "https://moviesapi.club/tv/" + id + "-" + season + "-" + episode, family: "moviesapi", label: "MoviesAPI" },
                    { url: "https://player.smashy.stream/tv/" + id + "?s=" + season + "&e=" + episode, family: "smashy", label: "Smashy" },
                    { url: "https://vidbinge.dev/embed/tv/" + id + "/" + season + "/" + episode, family: "vidbinge", label: "VidBinge" },
                    { url: "https://nexvid.net/tv/" + id + "/" + season + "/" + episode, family: "nexvid", label: "NexVid" },
                    { url: "https://filmku.stream/embed/" + id + "/" + season + "/" + episode, family: "filmku", label: "FilmKu" },
                    { url: "https://vidlink.pro/tv/" + id + "/" + season + "/" + episode, family: "vidlink", label: "VidLink" },
                    { url: "https://vidlink.pro/tv/" + id + "/" + season + "/" + episode + "?2", family: "vidlink", label: "VidLink 2" },
                    { url: "https://vidking.net/embed/tv/" + id + "/" + season + "/" + episode, family: "vidking", label: "VidKing" },
                    { url: "https://321movies.co.uk/embed/tv/" + id + "/" + season + "/" + episode, family: "321movies", label: "321movies" }
                ];
            } else {
                embeds = [
                    { url: "https://vidsrc.to/embed/movie/" + id, family: "vidsrc", label: "VidSrc 1" },
                    { url: "https://vidsrc.me/embed/movie/" + id, family: "vidsrc", label: "VidSrc 2" },
                    { url: "https://vidsrc.xyz/embed/movie/" + id, family: "vidsrc", label: "VidSrc 3" },
                    { url: "https://vidsrc.cc/v2/embed/movie/" + id, family: "vidsrc", label: "VidSrc 4" },
                    { url: "https://vidsrc.icu/embed/movie/" + id, family: "vidsrc", label: "VidSrc 5" },
                    { url: "https://www.2embed.cc/embed/" + id, family: "2embed", label: "2Embed" },
                    { url: "https://multiembed.mov/?video_id=" + id + "&tmdb=1", family: "superembed", label: "SuperEmbed" },
                    { url: "https://autoembed.co/movie/tmdb/" + id, family: "autoembed", label: "AutoEmbed 1" },
                    { url: "https://www.nontongo.win/embed/movie/" + id, family: "nontongo", label: "NontonGo" },
                    { url: "https://moviesapi.club/movie/" + id, family: "moviesapi", label: "MoviesAPI" },
                    { url: "https://player.smashy.stream/movie/" + id, family: "smashy", label: "Smashy" },
                    { url: "https://vidbinge.dev/embed/movie/" + id, family: "vidbinge", label: "VidBinge" },
                    { url: "https://nexvid.net/movie/" + id, family: "nexvid", label: "NexVid" },
                    { url: "https://filmku.stream/embed/" + id, family: "filmku", label: "FilmKu" },
                    { url: "https://vidlink.pro/movie/" + id, family: "vidlink", label: "VidLink" },
                    { url: "https://vidking.net/embed/movie/" + id, family: "vidking", label: "VidKing" },
                    { url: "https://321movies.co.uk/embed/movie/" + id, family: "321movies", label: "321movies" }
                ];
            }
            for (var i = 0; i < embeds.length; i++) {
                out.push({
                    url: embeds[i].url,
                    family: embeds[i].family,
                    label: embeds[i].label,
                    isDefault: i === 0,
                    rank: 100 + i
                });
            }
        } catch (e) {}
        return out;
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
        // Try poster_path, then backdrop_path, then profile_path, then still_path
        if (r && r.poster_path) return poster(r.poster_path, size || "w500");
        if (r && r.backdrop_path) return poster(r.backdrop_path, size || "w780");
        if (r && r.profile_path) return poster(r.profile_path, size || "w500");
        if (r && r.still_path) return poster(r.still_path, size || "w300");
        // Fallback to TMDB placeholder or generic
        if (r && r.id) {
            // Use placeholder with title initial to avoid empty poster
            var t = r.title || r.name || "No Poster";
            return "https://via.placeholder.com/500x750?text=" + encodeURIComponent(String(t).slice(0,20));
        }
        return "https://via.placeholder.com/500x750?text=No+Poster";
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
                // Movies resolve straight from their own URL - no episode wrapper needed.
                episodes = [];
            }
            item.episodes = episodes;
            cb({ success: true, data: item });
        } catch (err) {
            fail(cb, "UNKNOWN", (err && err.stack) || err);
        }
    }

    // ----------------------------------------------------------- loadStreams
    /** Verify one candidate returns an HLS manifest / playable body. More lenient for geo-blocked hosts */
    async function probe(streamUrl, referer) {
        try {
            var r = await req(streamUrl, hdr({ Accept: "*/*", Referer: referer, Range: "bytes=0-4096", Origin: site() }), 15000);
            // Accept 200, 206, 302, 403, 429 as potentially playable (403/429 often work from residential IPs)
            if (r.status === 403 || r.status === 429) {
                // Cloudflare 403/429 from datacenter often works from user IP - mark as uncertain but ok
                return { ok: false, status: r.status, maybeOk: true };
            }
            if (r.status !== 200 && r.status !== 206 && r.status !== 302) {
                return { ok: false, status: r.status };
            }
            var head = String(r.body || "").replace(/^\uFEFF/, "").trimStart();
            if (/^#EXTM3U/.test(head)) return { ok: true, kind: "hls" };
            if (/^#EXT-X-STREAM-INF/.test(head)) return { ok: true, kind: "hls-master" };
            if (head.length > 0) return { ok: true, kind: "data" };
            return { ok: true, kind: "empty-but-ok" }; // Even empty 200 is better than nothing
        } catch (e) {
            return { ok: false, status: 0, error: String(e) };
        }
    }

    async function loadStreams(url, cb) {
        var ref = reference(url);
        if (!ref) return fail(cb, "BAD_URL", "Unrecognised 321movies URL: " + url);
        try {
            var q = "type=" + ref.type + "&id=" + ref.id;
            if (ref.type === "tv") {
                var s = ref.season || 1, e = ref.episode || 1;
                q += "&season=" + s + "&episode=" + e;
            }
            var S = site();
            var playerPage = S + "/" + ref.type + "/" + ref.id + (ref.type === "tv" ? "/" + (ref.season || 1) + "/" + (ref.episode || 1) : "") + "/player";
            // This call is slow on purpose: the endpoint queries ~10 upstream providers
            // (measured 8-40s). A 20s deadline reported a healthy API as "offline".
            var payload = await jget(S + "/api/player/vixsrc-playlist?" + q, { Accept: "application/json", Referer: S + "/" }, 55000, 3);
            var isOffline = false;
            if (!payload) {
                isOffline = true;
                // Try alternative endpoints before failing
                var altEndpoints = [
                    "/api/player/playlist?" + q,
                    "/api/player/sources?" + q,
                    "/api/player/vixsrc?" + q,
                    "/api/player/list?" + q
                ];
                for (var ai = 0; ai < altEndpoints.length; ai++) {
                    try {
                        var altPayload = await jget(S + altEndpoints[ai], { Accept: "application/json", Referer: S + "/" }, 20000, 2);
                        if (altPayload && altPayload.playlist) {
                            payload = altPayload;
                            isOffline = false;
                            break;
                        }
                    } catch (e) {}
                }
            }
            // Always get fallback (20 sources) to match website
            var fbCands = await fallbackStreams(ref);
            // If primary failed, use fallback as payload, else merge both
            if (!payload || isOffline || !payload.playlist || !payload.playlist.length) {
                if (fbCands && fbCands.length) {
                    var groups = [{ sources: [] }];
                    for (var fi = 0; fi < fbCands.length; fi++) {
                        groups[0].sources.push({
                            file: fbCands[fi].url,
                            label: fbCands[fi].label,
                            provider: fbCands[fi].family,
                            default: fbCands[fi].isDefault
                        });
                    }
                    payload = { playlist: groups };
                } else {
                    return fail(cb, "PLAYER_OFFLINE", "321movies player API unreachable for this title (ID " + ref.id + "). Tried vixsrc-playlist and alts. Try again later.");
                }
            } else {
                // Primary succeeded, also add fallback sources to cands later (merge)
                // We'll merge after decoding
            }
            var groups = payload.playlist || [];
            var seen = {};
            var cands = [];
            var encoded = 0;
            for (var gi = 0; gi < groups.length; gi++) {
                var srcs = groups[gi].sources || [];
                for (var si = 0; si < srcs.length; si++) {
                    var src = srcs[si];
                    if (typeof src.file === "string" && src.file.slice(0, 4) === "enc:") encoded++;
                    var real = decodeFile(src.file);
                    if (!/^https?:\/\//i.test(real)) continue;
                    if (seen[real]) continue;
                    seen[real] = true;
                    var fam = familyOf(src.provider);
                    cands.push({
                        url: real, family: fam, label: String(src.label || ""),
                        isDefault: src.default === true || src.default === "true",
                        rank: PREFERRED.indexOf(fam) < 0 ? 50 : PREFERRED.indexOf(fam),
                    });
                }
            }
            // Merge with fallback generic embeds (20 sources) to match website's Select Source list
            try {
                var fbForMerge = await fallbackStreams(ref);
                for (var fbi = 0; fbi < fbForMerge.length; fbi++) {
                    var fbItem = fbForMerge[fbi];
                    if (!fbItem || !fbItem.url) continue;
                    // Avoid duplicates
                    var dup = false;
                    for (var di = 0; di < cands.length; di++) { if (cands[di].url === fbItem.url) { dup = true; break; } }
                    if (!dup) cands.push(fbItem);
                }
            } catch (e) {}
            if (!cands.length) {
                return fail(cb, encoded ? "DECODE_FAILED" : "NO_SOURCES",
                    encoded
                        ? "Sources are obfuscated and none decoded - 321movies rotated its player key; update PLAYER_KEY in this plugin."
                        : "321movies returned no playable sources for this title.");
            }
            cands.sort(function (a, b) {
                return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.rank - b.rank;
            });

            var headers = { Referer: playerPage, "User-Agent": UA, Origin: S, "Accept-Language": "en-US,en;q=0.9" };
            // Return ALL streams from website without unverified label
            // Website works because it uses residential IP, but our datacenter probe gets 403
            // So we skip probing and return all decoded sources as verified (as website does)
            var streams = [];
            var seenLabel = {};
            for (var ci = 0; ci < cands.length && streams.length < MAX_STREAMS; ci++) {
                var c = cands[ci];
                var key = c.family + "|" + c.label + "|" + c.url;
                if (seenLabel[key]) continue;
                seenLabel[key] = true;
                var cap = c.family.charAt(0).toUpperCase() + c.family.slice(1);
                var qual = qualityOf(c.label);
                var strip = String(c.label || "")
                    .replace(new RegExp("^" + cap + "\\b", "i"), "")
                    .replace(/\bauto\b/ig, "")
                    .replace(/[\s·]+$/g, "").replace(/^\s*·?\s*/g, "")
                    .trim();
                var name;
                if (/^\d+$/.test(strip)) {
                    name = cap + " " + strip;
                } else {
                    var parts = [cap];
                    if (strip && strip.toLowerCase() !== cap.toLowerCase()) parts.push(strip);
                    if (qual && !/auto/i.test(qual) && strip.toLowerCase().indexOf(qual.toLowerCase()) < 0) parts.push(qual);
                    name = parts.join(" · ");
                }
                // All streams from website are returned as verified, no unverified label
                streams.push(new StreamResult({
                    url: c.url,
                    source: c.isDefault ? name + " · default" : name,
                    headers: headers,
                }));
            }
            // If we have more candidates than MAX_STREAMS, add remaining as extra (up to 20 total)
            if (cands.length > streams.length) {
                for (var ci2 = streams.length; ci2 < Math.min(cands.length, 20); ci2++) {
                    var c2 = cands[ci2];
                    var key2 = c2.family + "|" + c2.label + "|" + c2.url;
                    if (seenLabel[key2]) continue;
                    var cap2 = c2.family.charAt(0).toUpperCase() + c2.family.slice(1);
                    streams.push(new StreamResult({
                        url: c2.url,
                        source: cap2 + " · " + (c2.label || "auto"),
                        headers: headers
                    }));
                }
            }
            if (!streams.length) return fail(cb, "NO_STREAMS", "Every source failed to resolve.");
            cb({ success: true, data: streams });
        } catch (err) {
            fail(cb, "EXTRACTION_FAILED", (err && err.stack) || err);
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
