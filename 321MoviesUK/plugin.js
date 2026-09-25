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

    // Hosts that tend to work from restricted networks get probed first.
    var PREFERRED = ["vuflix", "frame", "peestream", "bcine", "cinesrc", "movy", "pstream", "rivestream", "streamaggregator", "vidgod"];
    var MAX_PROBE = 12;      // candidate links to verify
    var MAX_STREAMS = 8;     // results handed back to the player

    function site() {
        var b = (typeof manifest !== "undefined" && manifest.baseUrl) ? manifest.baseUrl : "https://321movies.co.uk";
        return String(b).replace(/\/+$/, "");
    }
    function hdr(extra) {
        var h = { "User-Agent": UA, "Accept-Encoding": "identity" };
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
        var n = tries || 1;
        for (var i = 0; i < n; i++) {
            var r = await req(url, hdr(headers), ms);
            if (r.status === 200) {
                try { return JSON.parse(r.body); } catch (e) { return null; }
            }
            // 429/5xx/0(timeout) on a gateway that fans out to ~10 upstreams is usually
            // transient - retry once or twice before calling the endpoint dead.
            if (i + 1 < n) await new Promise(function (r2) { setTimeout(r2, 900 * (i + 1)); });
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

    function poster(path, size) { return path ? IMG + size + path : ""; }
    function yearOf(d) { var m = /^(\d{4})/.exec(String(d || "")); return m ? parseInt(m[1], 10) : undefined; }

    /** Decode "enc:<base64url>" into a real URL. Returns "" when the key has rotated. */
    function decodeFile(file) {
        if (typeof file !== "string" || !file) return "";
        if (file.slice(0, 4) !== "enc:") return file; // already a plain URL
        try {
            var b64 = file.slice(4).replace(/-/g, "+").replace(/_/g, "/");
            while (b64.length % 4) b64 += "=";
            var raw = atob(b64);
            if (raw.length < 9) return "";
            var out = "";
            for (var i = 8; i < raw.length; i++) {
                var salt = raw.charCodeAt((i - 8) % 8);
                out += String.fromCharCode(raw.charCodeAt(i) ^ PLAYER_KEY.charCodeAt((i - 8 + salt) % PLAYER_KEY.length));
            }
            return /^https?:\/\//i.test(out) ? out : "";
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
        return new MultimediaItem({
            title: title,
            url: site() + "/" + (type === "series" ? "tv" : "movie") + "/" + id,
            posterUrl: poster(r.poster_path, "w500"),
            bannerUrl: poster(r.backdrop_path, "w1280"),
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
                            posterUrl: poster(e.still_path, "w300"),
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
    /** Verify one candidate returns an HLS manifest / playable body. */
    async function probe(streamUrl, referer) {
        var r = await req(streamUrl, hdr({ Accept: "*/*", Referer: referer, Range: "bytes=0-4096" }), 12000);
        if (r.status !== 200 && r.status !== 206) {
            return { ok: false, status: r.status };
        }
        var head = String(r.body || "").replace(/^\uFEFF/, "").trimStart();
        if (/^#EXTM3U/.test(head)) return { ok: true, kind: "hls" };
        if (/^#EXT-X-STREAM-INF/.test(head)) return { ok: true, kind: "hls-master" };
        if (head.length > 0) return { ok: true, kind: "data" }; // 200 with body: player will sort it out
        return { ok: false, status: r.status };
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
            var payload = await jget(S + "/api/player/vixsrc-playlist?" + q, { Accept: "application/json", Referer: S + "/" }, 55000, 2);
            if (!payload) {
                return fail(cb, "PLAYER_OFFLINE", "321movies player API unreachable (blocked, moved, or rate-limited).");
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
            if (!cands.length) {
                return fail(cb, encoded ? "DECODE_FAILED" : "NO_SOURCES",
                    encoded
                        ? "Sources are obfuscated and none decoded - 321movies rotated its player key; update PLAYER_KEY in this plugin."
                        : "321movies returned no playable sources for this title.");
            }
            cands.sort(function (a, b) {
                return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.rank - b.rank;
            });

            var headers = { Referer: playerPage, "User-Agent": UA, Origin: S };
            // Drop exact duplicates only (same family + same label). Keying on quality alone
            // collapsed genuine mirrors - "Vuflix 1/2/3" are separate hosts, not the same link.
            var perFamily = {};
            var toProbe = [];
            for (var ci = 0; ci < cands.length && toProbe.length < MAX_PROBE; ci++) {
                var c = cands[ci];
                var key = c.family + "|" + c.label;
                if (perFamily[key]) continue;
                perFamily[key] = true;
                toProbe.push(c);
            }

            var probed = await Promise.all(toProbe.map(async function (c) {
                var p = await probe(c.url, playerPage);
                return { c: c, p: p };
            }));

            var verified = [];
            var uncertain = [];
            for (var pi = 0; pi < probed.length; pi++) {
                var pc = probed[pi];
                var cap = pc.c.family.charAt(0).toUpperCase() + pc.c.family.slice(1);
                var qual = qualityOf(pc.c.label);
                // Strip the family name and a trailing "Auto" out of the source label so
                // "Vuflix 1" -> just "Vuflix", and "Horizon Auto" -> "Frame · Horizon".
                var strip = String(pc.c.label || "")
                    .replace(new RegExp("^" + cap + "\\b", "i"), "")
                    .replace(/\bauto\b/ig, "")
                    .replace(/[\s·]+$/g, "").replace(/^\s*·?\s*/g, "")
                    .trim();
                var name;
                if (/^\d+$/.test(strip)) {
                    name = cap + " " + strip;   // mirror index stays visible: "Vuflix 1" vs "Vuflix 2"
                } else {
                    var parts = [cap];
                    if (strip && strip.toLowerCase() !== cap.toLowerCase()) parts.push(strip);
                    // Don't repeat a quality the label already carries ("Cascade 720p" + "720p").
                    if (qual && !/auto/i.test(qual) && strip.toLowerCase().indexOf(qual.toLowerCase()) < 0) parts.push(qual);
                    name = parts.join(" · ");
                }
                if (pc.p.ok) {
                    verified.push(new StreamResult({
                        url: pc.c.url,
                        source: pc.c.isDefault ? name + " · default" : name,
                        headers: headers,
                    }));
                } else {
                    uncertain.push(new StreamResult({
                        url: pc.c.url,
                        source: name + " · unverified (may be geo/CDN blocked)",
                        headers: headers,
                    }));
                }
            }

            var streams = verified.slice(0, MAX_STREAMS);
            // Verified links first, but keep blocked ones as labelled fallbacks: a host that 403s
            // this test network may still play on the user's IP, and the player can hop to it if
            // the first pick stalls. Only discard them when there is already enough choice.
            if (streams.length && streams.length < MAX_STREAMS && uncertain.length) {
                streams = streams.concat(uncertain.slice(0, MAX_STREAMS - streams.length));
            }
            // Nothing verified from this network: still hand the user real options, clearly labelled.
            if (!streams.length) {
                var fallback = uncertain.length ? uncertain : cands.slice(0, 4).map(function (c) {
                    return new StreamResult({ url: c.url, source: c.family + " · unverified", headers: headers });
                });
                streams = fallback.slice(0, MAX_STREAMS);
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
