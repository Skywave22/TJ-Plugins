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
    const VROCK = "https://vidrock.net";
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
                    tags: (d.genres || []).map(function (g) { return g.name; }).slice(0, 4),
                    // The app only enables the Play button when the details
                    // carry a non-empty episodes list — wrap movies in one
                    // synthetic "Full Movie" episode (same as MovieBlast).
                    episodes: [mkEpisode({
                        name: "Full Movie",
                        url: itemUrl("movie", p.id, d.title),
                        season: 1,
                        episode: 1,
                        posterUrl: poster(d.poster_path, "w500"),
                        description: d.overview || "",
                        rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
                        runtime: d.runtime ? parseInt(d.runtime, 10) : null,
                        airDate: d.release_date || null
                    })]
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
                            name: ep.name || ("Episode " + ep.episode_number),
                            url: JSON.stringify({ type: "tv", id: p.id, s: sj.season_number, e: ep.episode_number, title: d.name }),
                            season: sj.season_number,
                            episode: ep.episode_number,
                            posterUrl: poster(ep.still_path, "w500"),
                            description: ep.overview || "",
                            rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : null,
                            runtime: ep.runtime ? parseInt(ep.runtime, 10) : null,
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

    function withTimeout(promise, ms) {
        if (typeof setTimeout !== "function") return promise;
        return new Promise(function (resolve, reject) {
            const t = setTimeout(function () { reject(new Error("timeout")); }, ms);
            promise.then(
                function (v) { clearTimeout(t); resolve(v); },
                function (e) { clearTimeout(t); reject(e); }
            );
        });
    }

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

    // ─── vidrock: /api/{movie/<id>|tv/<id>/<s>/<e>} → named servers with
    // AES-256-GCM encrypted urls (base64url(iv||ct||tag), key hard-coded in
    // their bundle). Decrypted urls are direct m3u8 / streamrk playlists.
    const VROCK_KEY_HEX = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";

    function hexToB64(hex) {
        const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
        let out = "";
        for (let i = 0; i < bytes.length; i += 3) {
            const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
            out += B64C.charAt(b1 >> 2);
            out += B64C.charAt(((b1 & 3) << 4) | (isNaN(b2) ? 0 : (b2 >> 4)));
            out += isNaN(b2) ? "=" : B64C.charAt(((b2 & 15) << 2) | (isNaN(b3) ? 0 : (b3 >> 6)));
            out += isNaN(b3) ? "=" : B64C.charAt(b3 & 63);
        }
        return out;
    }
    const VROCK_KEY_B64 = hexToB64(VROCK_KEY_HEX);

    function b64urlToB64(token) {
        let std = String(token).replace(/-/g, "+").replace(/_/g, "/");
        const pad = std.length % 4;
        if (pad === 2) std += "==";
        else if (pad === 3) std += "=";
        else if (pad === 1) throw new Error("bad b64url length");
        return std;
    }

    // base64url(iv||ct||tag): the first 16 base64 chars = exactly the 12-byte IV.
    async function vidrockDecrypt(token) {
        const std = b64urlToB64(token);
        const ivB64 = std.slice(0, 16);
        const dataB64 = std.slice(16);
        const plain = await crypto.decryptAES(dataB64, VROCK_KEY_B64, ivB64, { mode: "gcm" });
        return String(plain);
    }

    async function vidrockSources(apiPath) {
        const res = await http_get(VROCK + "/api/" + apiPath, {
            "User-Agent": UA,
            "Referer": VROCK + "/"
        });
        if (!res || !res.body) return [];
        let j;
        try { j = JSON.parse(res.body); } catch (e) { return []; }
        const out = [];
        const names = Object.keys(j);
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const s = j[name];
            if (!s || typeof s !== "object" || !s.url) continue;
            let decrypted = null;
            try { decrypted = await vidrockDecrypt(s.url); } catch (e) { continue; }
            if (!/^https?:\/\//.test(decrypted)) continue;
            out.push({ name: name, url: decrypted, type: s.type, language: s.language || "" });
        }
        return out;
    }

    // streamrk playlist → [{resolution, url}] direct mp4s
    async function streamrkMp4s(playlistUrl, label) {
        const out = [];
        try {
            const res = await withTimeout(http_get(playlistUrl, {
                "User-Agent": UA,
                "Referer": VROCK + "/"
            }), 12000);
            if (!res || !res.body) return out;
            const arr = JSON.parse(res.body);
            if (!Array.isArray(arr)) return out;
            arr.sort(function (a, b) { return (b.resolution || 0) - (a.resolution || 0); });
            for (let i = 0; i < Math.min(2, arr.length); i++) {
                if (!arr[i].url || String(arr[i].url).indexOf("http") !== 0) continue;
                out.push({
                    name: label + " • MP4 " + (arr[i].resolution || "?") + "p",
                    url: arr[i].url,
                    headers: { "User-Agent": UA, "Referer": VROCK + "/" }
                });
            }
        } catch (e) {}
        return out;
    }

    async function loadStreams(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized CineHD url" });

            const vlBase = p.type === "tv"
                ? "/tv?id=" + encodeURIComponent(p.id) + "&season=" + encodeURIComponent(p.s || 1) + "&episode=" + encodeURIComponent(p.e || 1) + "&mode=json"
                : "/movie?id=" + encodeURIComponent(p.id) + "&mode=json";

            // Hindi/multi-audio family first (user preference), then the rest
            const vlHindi = [
                { label: "MovieBox",   s: "&sources=moviebox" },
                { label: "MovieBox 2", s: "&sources=moviebox2" }
            ];
            const vlRest = [
                { label: "Best",         s: "" },
                { label: "Grand Warden", s: "&sources=warden" },
                { label: "PEKKA",        s: "&sources=cinefreak" },
                { label: "VidAPI",       s: "&sources=vidapi" },
                { label: "IPCloud",      s: "&sources=ipcloud" },
                { label: "TCloud",       s: "&sources=tcloud" }
            ];

            const vrPath = p.type === "tv"
                ? "tv/" + encodeURIComponent(p.id) + "/" + encodeURIComponent(p.s || 1) + "/" + encodeURIComponent(p.e || 1)
                : "movie/" + encodeURIComponent(p.id);

            const streams = [];
            const seen = {};
            function addStream(label, url, headers) {
                if (!url || seen[url]) return;
                seen[url] = 1;
                streams.push(mkStream({
                    url: url,
                    source: label,
                    headers: headers || STREAM_HEADERS
                }));
            }
            async function addVidlove(variants) {
                for (const v of variants) {
                    if (streams.length >= 12) break;
                    let src = null;
                    try { src = await vidloveSource(vlBase + v.s); } catch (e) { src = null; }
                    if (!src) continue;
                    addStream(v.label + " - " + src.quality, src.url, STREAM_HEADERS);
                }
            }

            // 1) vidlove Hindi family (MovieBox) - default per user preference
            await addVidlove(vlHindi);

            // 2) vidrock servers (Nova/Atlas/Luna/Orion hls + Astra mp4)
            let vr = [];
            try { vr = await vidrockSources(vrPath); } catch (e) { vr = []; }
            for (const v of vr) {
                if (v.type === "mp4" && /streamrk\.site\/playlist/.test(v.url)) {
                    const mp4s = await streamrkMp4s(v.url, "Rock " + v.name);
                    for (const m of mp4s) addStream(m.name, m.url, m.headers);
                } else {
                    addStream("Rock " + v.name + (v.language ? " - " + v.language : "") + " - HLS", v.url, {
                        "User-Agent": UA,
                        "Referer": VROCK + "/"
                    });
                }
            }

            // 3) remaining vidlove servers
            await addVidlove(vlRest);

            if (!streams.length) {
                return cb({
                    success: false,
                    errorCode: "NO_STREAMS",
                    message: "No stream source available for this title right now - both CineHD player APIs returned nothing for it. Try another title."
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
