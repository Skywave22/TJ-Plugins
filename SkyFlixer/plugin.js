(function () {
    /**
     * SkyFlixer (skyflixer.fun) - SkyStream Gen 2 plugin
     *
     * Architecture
     * ------------
     * skyflixer.fun is a Vite/React single-page app. Two things in its bundle
     * define how it works:
     *
     *   1. Catalog. The app talks to a set of four Cloudflare Worker backends
     *      (skyflixer.skyflixer1 / batman18677 / superman88911u / univers-9009
     *      .workers.dev) under /tmdb/*, which is a thin proxy over the TMDB
     *      API - the chunk assets/tmdb-*.js requests /tmdb/trending/{type}/
     *      {window}, /tmdb/discover/movie, /tmdb/search/multi and so on, and
     *      builds poster URLs from image.tmdb.org. So the catalog *is* TMDB.
     *
     *   2. Playback. assets/VideoPlayerPage-*.js fetches a server list and
     *      filters it by hostName, then plays the selected host's sources.
     *      That server list comes from the nxsha.space source API, whose
     *      AES-256-CBC bridge is implemented below.
     *
     * NOTE ON THE WORKERS: as of 2026-09-22 all four backends answer only "/"
     * and "/health" (200) and throw Cloudflare error 1101 on every other
     * route, including /tmdb/*. The site's own catalog API is therefore
     * unavailable, so this plugin queries TMDB directly - the same data the
     * workers proxy, and keyed by the same TMDB ids the site uses. If the
     * workers come back, swap tmdb() for the worker paths in the comment above.
     *
     * Where this differs from the RiveStream plugin in this repository:
     * RiveStream pins six Rive-branded hosts; SkyFlixer asks /api/servers for
     * the full live host list (29 hosts as of writing) and resolves all of
     * them, so it offers many more streams per title.
     *
     * The AES-256-CBC bridge (nxMd5 / nxEvp / nxExpandKey / nxEncode /
     * nxDecode) is shared with the CineHD and RiveStream plugins.
     */

    // ─────────────────────────── config ───────────────────────────

    const TMDB = "https://api.themoviedb.org/3";
    const IMG  = "https://image.tmdb.org/t/p";
    const KEY  = "439c478a771f35c05022f9feabcca01c"; // repo-wide public TMDB key

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // NB: NX_BASE ("https://nxsha.space") and NX_PASS are declared by the
    // AES bridge section further down. NX_HEADERS must therefore be built
    // lazily - see nxHeaders() below.
    function nxHeaders() { return { "User-Agent": UA, "Referer": NX_BASE + "/" }; }

    // rivestream's own server backends, in the order they should be offered.
    // Hosts we ask first, ordered by measured reliability. On 2026-09-22 a
    // ranged request against every source returned for a test title showed
    // these serving real playlists (HTTP 206, #EXTM3U / dash+xml), while the
    // itsnitrox.tech proxy that mbox and bkl-blast publish through answered
    // 427 Forbidden on all 22 of its links. Everything on the live server list
    // is still queried - this only decides the order.
    const PREFERRED_HOSTS = [
        "castle", "rive-citadel", "awsind", "nitro", "bdxs",
        "rive-primevids", "rive-flowcast", "rive-quasar", "rive-guru",
        "rive-hindicast", "mhbox", "watchout"
    ];

    // Display names, taken from the "name" field the server list publishes.
    // Anything missing falls back to the raw scraper id.
    const HOST_PRETTY = {
        "nitro":           "Nitro",
        "mbox":            "MbPly",
        "mhbox":           "MhPly",
        "bkl-blast":       "MbBlast",
        "rive-citadel":    "Citadel",
        "bdxs":            "Multi-blue",
        "watchout":        "Multi-bill",
        "holly":           "Lolly",
        "rive-primevids":  "Prvibd",
        "vidking":         "Vip-4K",
        "stvv":            "Stvvid",
        "imovr":           "Topflix",
        "awsind":          "AwsPly",
        "castle":          "CastVid",
        "ophim":           "Ophm",
        "yomovies":        "StreamX",
        "rive-quasar":     "Kutti",
        "vidapi":          "VidPi",
        "levi":            "Hevily",
        "toonstream":      "TunWatch",
        "tamilblasters":   "TamBlast",
        "rive-flowcast":   "River",
        "hdhub4u":         "4k-bk",
        "k4khdhub":        "4k-Hub",
        "filmyfly":        "FlyVid",
        "streamflix":      "StremFx",
        "rive-guru":       "Gbru",
        "rive-hindicast":  "HindiSk",
        "em-8":            "VidHindi"
    };

    // Hard cap on how many hosts to query per title, so a growing server list
    // cannot make loadStreams crawl.
    const MAX_HOSTS = 24;

    // Hard cap on how many manifests loadStreams will fetch to verify them.
    const MAX_PROBES = 40;

    const MAX_STREAMS = 30;

    // ─────────────────────────── languages ───────────────────────────
    //
    // Languages this plugin can serve, in priority order. The FIRST entry is
    // the plugin's default language. This order is mirrored in plugin.json's
    // "languages" array, and in the code by DEFAULT_LANGUAGE / LANG_CODES in
    // the "language selection" block further down, which is what actually
    // ranks the streams handed to the player.
    //
    //   1. hi   Hindi      <- default
    //   2. en   English
    //   3. ta   Tamil
    //   4. te   Telugu
    //   5. ur   Urdu
    //   6. mal  Malayalam
    //   7. bn   Bengali
    //
    // SkyStream Gen 2 offers no language dropdown for plugins, so "default"
    // means "ranked first in the returned stream list", which is what the
    // player starts on. See the "language selection" block for details.
    const LANGUAGES = ["hi", "en", "ta", "te", "ur", "mal", "bn"];

    // ─────────────────────────── helpers ───────────────────────────

    function mkItem(obj)    { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); }      catch (_) { return obj; } }
    function mkStream(obj)  { try { return new StreamResult(obj); } catch (_) { return obj; } }

    function withTimeout(promise, ms) {
        if (typeof setTimeout !== "function") return promise;
        return new Promise(function (resolve, reject) {
            const t = setTimeout(function () { reject(new Error("timeout")); }, ms);
            Promise.resolve(promise).then(
                function (v) { clearTimeout(t); resolve(v); },
                function (e) { clearTimeout(t); reject(e); }
            );
        });
    }

    async function tmdb(path) {
        const sep = path.indexOf("?") >= 0 ? "&" : "?";
        const res = await http_get(TMDB + path + sep + "api_key=" + KEY, { "User-Agent": UA });
        if (!res || !res.body) return null;
        try { return JSON.parse(res.body); } catch (e) { return null; }
    }

    function poster(p, size) { return p ? IMG + "/" + (size || "w500") + p : ""; }

    function yearOf(d) {
        const m = String(d || "").match(/^(\d{4})/);
        return m ? parseInt(m[1], 10) : null;
    }

    function mediaTypeOf(r) {
        if (r.media_type === "movie" || r.media_type === "tv") return r.media_type;
        return (r.first_air_date || r.name) ? "tv" : "movie";
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

    function tmdbToItem(r) {
        if (!r || !r.id) return null;
        const type = mediaTypeOf(r);
        const title = r.title || r.name || "Unknown";
        return mkItem({
            title: title,
            url: itemUrl(type, r.id, title),
            posterUrl: poster(r.poster_path, "w500"),
            bannerUrl: poster(r.backdrop_path, "w780"),
            type: type,
            year: yearOf(r.release_date || r.first_air_date),
            description: r.overview || "",
            score: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null
        });
    }

    const NX_BASE = "https://nxsha.space";
    const NX_PASS = "S8x!Jk4ZP1uG8$my";

    function nxMd5(str, raw) {
        const msg = raw ? str : unescape(encodeURIComponent(str));
        const n = msg.length;
        const words = [];
        for (let i = 0; i < n; i++) words[i >> 2] = (words[i >> 2] || 0) | (msg.charCodeAt(i) << ((i % 4) << 3));
        words[n >> 2] = (words[n >> 2] || 0) | (0x80 << ((n % 4) << 3));
        const wl = (((n + 8) >> 6) + 1) << 4;
        for (let i = 0; i < wl; i++) words[i] = words[i] || 0;
        words[wl - 2] = n << 3;
        const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
                   5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
                   4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
                   6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
        function rl(v, c) { return (v << c) | (v >>> (32 - c)); }
        let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        for (let i = 0; i < wl; i += 16) {
            const M = words.slice(i, i + 16);
            const oa = a, ob = b, oc = c, od = d;
            for (let j = 0; j < 64; j++) {
                let f, g;
                if (j < 16)      { f = (b & c) | (~b & d);  g = j; }
                else if (j < 32) { f = (d & b) | (~d & c);  g = (5 * j + 1) % 16; }
                else if (j < 48) { f = b ^ c ^ d;           g = (3 * j + 5) % 16; }
                else             { f = c ^ (b | ~d);        g = (7 * j) % 16; }
                const tmp = d;
                d = c; c = b;
                const K = Math.floor(Math.abs(Math.sin(j + 1)) * 4294967296);
                b = (b + rl(((a + f + K + M[g]) | 0), S[j])) | 0;
                a = tmp;
            }
            a = (a + oa) | 0; b = (b + ob) | 0; c = (c + oc) | 0; d = (d + od) | 0;
        }
        function hexw(w) { let s = ""; for (let j = 0; j < 4; j++) s += ((w >> (j * 8)) & 255).toString(16).padStart(2, "0"); return s; }
        return hexw(a) + hexw(b) + hexw(c) + hexw(d);
    }

    const NX_SBOX = new Uint8Array(256);
    (function () {
        const exp = new Uint8Array(256), log = new Uint8Array(256);
        let x = 1;
        for (let i = 0; i < 255; i++) {
            exp[i] = x; log[x] = i;
            x = (x ^ ((x << 1) ^ (x & 0x80 ? 0x11b : 0))) & 255; // multiply by 0x03
        }
        exp[255] = 1; log[0] = 0; // sentinels (inverse of 1 = exp[255 - 0])
        for (let i = 1; i < 256; i++) {
            const s = exp[255 - log[i]];
            NX_SBOX[i] = (s ^ ((s << 1) | (s >> 7)) ^ ((s << 2) | (s >> 6)) ^ ((s << 3) | (s >> 5)) ^ ((s << 4) | (s >> 4)) ^ 0x63) & 255;
        }
        NX_SBOX[0] = 0x63;
    })();

    function nxXtime(a) { return ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 255; }

    function nxExpandKey(keyBytes) {
        const Nk = 8, Nr = 14;
        const w = new Uint8Array(16 * (Nr + 1));
        w.set(keyBytes);
        let rcon = 1;
        for (let i = Nk; i < 4 * (Nr + 1); i++) {
            const t = [w[(i - 1) * 4], w[(i - 1) * 4 + 1], w[(i - 1) * 4 + 2], w[(i - 1) * 4 + 3]];
            if (i % Nk === 0) {
                const tt = t[0];
                t[0] = NX_SBOX[t[1]] ^ rcon; t[1] = NX_SBOX[t[2]]; t[2] = NX_SBOX[t[3]]; t[3] = NX_SBOX[tt];
                rcon = nxXtime(rcon);
            } else if (i % Nk === 4) {
                t[0] = NX_SBOX[t[0]]; t[1] = NX_SBOX[t[1]]; t[2] = NX_SBOX[t[2]]; t[3] = NX_SBOX[t[3]];
            }
            for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - Nk) * 4 + j] ^ t[j];
        }
        return w;
    }

    function nxEncryptBlock(w, input) {
        const Nr = 14;
        const s = new Uint8Array(input);
        function addRK(r) { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; }
        addRK(0);
        const t = new Uint8Array(16);
        for (let round = 1; round <= Nr; round++) {
            for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[c * 4 + r] = NX_SBOX[s[((c + r) % 4) * 4 + r]];
            if (round < Nr) {
                for (let c = 0; c < 4; c++) {
                    const a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3];
                    t[c * 4]     = nxXtime(a0) ^ (nxXtime(a1) ^ a1) ^ a2 ^ a3;
                    t[c * 4 + 1] = a0 ^ nxXtime(a1) ^ (nxXtime(a2) ^ a2) ^ a3;
                    t[c * 4 + 2] = a0 ^ a1 ^ nxXtime(a2) ^ (nxXtime(a3) ^ a3);
                    t[c * 4 + 3] = (nxXtime(a0) ^ a0) ^ a1 ^ a2 ^ nxXtime(a3);
                }
            }
            s.set(t);
            addRK(round);
        }
        return s;
    }

    function nxBytesToB64(bytes) {
        const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let out = "";
        for (let i = 0; i < bytes.length; i += 3) {
            const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
            out += B64C[b1 >> 2];
            out += B64C[((b1 & 3) << 4) | (b2 === undefined ? 0 : b2 >> 4)];
            out += b2 === undefined ? "=" : B64C[((b2 & 15) << 2) | (b3 === undefined ? 0 : b3 >> 6)];
            out += b3 === undefined ? "=" : B64C[b3 & 63];
        }
        return out;
    }

    function nxEvp(pass, salt, keyLen, ivLen) {
        // CryptoJS OpenSSL KDF: D_i = MD5(D_{i-1} || pass || salt)
        const passB = [];
        for (let i = 0; i < pass.length; i++) passB.push(pass.charCodeAt(i) & 255);
        const saltB = Array.from(salt);
        const d = [];
        let prev = [];
        while (d.length < keyLen + ivLen) {
            const bin = String.fromCharCode.apply(null, prev.concat(passB, saltB));
            const hx = nxMd5(bin, true);
            for (let i = 0; i < 32; i += 2) d.push(parseInt(hx.substr(i, 2), 16));
            prev = d.slice(d.length - 16);
        }
        return { key: new Uint8Array(d.slice(0, keyLen)), iv: new Uint8Array(d.slice(keyLen, keyLen + ivLen)) };
    }

    function nxEncode(obj) {
        const salt = new Uint8Array(8);
        for (let i = 0; i < 8; i++) salt[i] = Math.floor(Math.random() * 256);
        const payload = JSON.stringify(Object.assign({}, obj, { _req_ts: Date.now(), _req_salt: Math.random().toString(36).slice(2, 10) }));
        const derived = nxEvp(NX_PASS, salt, 32, 16);
        const w = nxExpandKey(derived.key);
        const raw = unescape(encodeURIComponent(payload));
        const pad = 16 - (raw.length % 16);
        const dataLen = raw.length + pad;
        const out = [0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]; // "Salted__"
        for (let i = 0; i < 8; i++) out.push(salt[i]);
        let prev = derived.iv;
        for (let i = 0; i < dataLen; i += 16) {
            const blk = new Uint8Array(16);
            for (let j = 0; j < 16; j++) {
                const ch = i + j < raw.length ? raw.charCodeAt(i + j) : pad;
                blk[j] = ch ^ prev[j];
            }
            const enc = nxEncryptBlock(w, blk);
            for (let j = 0; j < 16; j++) { out.push(enc[j]); prev[j] = enc[j]; }
        }
        return nxBytesToB64(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    async function nxDecode(b64url) {
        try {
            let std = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
            while (std.length % 4 !== 0) std += "=";
            const bin = atob(std);
            const bytes = [];
            for (let i = 16; i < bin.length; i++) bytes.push(bin.charCodeAt(i)); // skip "Salted__" + 8-byte salt
            const salt = [];
            for (let i = 8; i < 16; i++) salt.push(bin.charCodeAt(i));
            const derived = nxEvp(NX_PASS, salt, 32, 16);
            const ctB64 = nxBytesToB64(bytes);
            const keyB64 = nxBytesToB64(derived.key);
            const ivB64 = nxBytesToB64(derived.iv);
            const plain = await crypto.decryptAES(ctB64, keyB64, ivB64, { mode: "cbc" });
            const o = JSON.parse(String(plain));
            delete o._req_ts; delete o._req_salt;
            return o;
        } catch (e) { return {}; }
    }


    // ─────────────────────────── catalog ───────────────────────────

    async function getHome(cb) {
        try {
            // Mirrors skyflixer.fun's own navigation: /movies, /tv-shows,
            // /anime and /other (cartoons & kids), plus its trending rows.
            const sections = [
                { title: "Trending Movies",   path: "/trending/movie/day" },
                { title: "Trending TV Shows", path: "/trending/tv/day" },
                { title: "Hindi Movies",      path: "/discover/movie?with_original_language=hi&sort_by=popularity.desc" },
                { title: "Now Playing",       path: "/movie/now_playing" },
                { title: "Popular Movies",    path: "/movie/popular" },
                { title: "Popular Series",    path: "/tv/popular" },
                { title: "Airing Today",      path: "/tv/airing_today" },
                { title: "Anime Series",      path: "/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc" },
                { title: "Anime Movies",      path: "/discover/movie?with_genres=16&with_original_language=ja&sort_by=popularity.desc" },
                { title: "Cartoons & Kids",   path: "/discover/tv?with_genres=10762&sort_by=popularity.desc" },
                { title: "Top Rated Movies",  path: "/movie/top_rated" },
                { title: "Upcoming",          path: "/movie/upcoming" }
            ];

            // Fetch every section concurrently - TMDB is the only dependency here.
            const results = await Promise.all(sections.map(function (s) {
                return tmdb(s.path + "?page=1").catch(function () { return null; });
            }));

            const home = {};
            for (let i = 0; i < sections.length; i++) {
                const j = results[i];
                const items = ((j && j.results) || []).map(tmdbToItem).filter(function (x) { return !!x; });
                if (items.length) home[sections[i].title] = items;
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
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });
            const j = await tmdb("/search/multi?query=" + encodeURIComponent(q) + "&page=1&include_adult=false");
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
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized SkyFlixer url" });

            if (p.type === "movie") {
                const d = await tmdb("/movie/" + p.id);
                if (!d) return cb({ success: false, errorCode: "NOT_FOUND", message: "Movie not found" });
                const item = mkItem({
                    title: d.title || "Unknown",
                    url: itemUrl("movie", p.id, d.title),
                    posterUrl: poster(d.poster_path, "w500"),
                    bannerUrl: poster(d.backdrop_path, "w780"),
                    type: "movie",
                    year: yearOf(d.release_date),
                    description: d.overview || "",
                    score: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
                    duration: d.runtime ? parseInt(d.runtime, 10) : null,
                    contentRating: d.adult ? "18+" : null,
                    tags: (d.genres || []).map(function (g) { return g.name; }).slice(0, 5),
                    syncData: { tmdb: String(p.id), imdb: d.imdb_id || "" },
                    // The app only enables Play when the details carry a non-empty
                    // episodes list, so wrap movies in one synthetic episode.
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
                    return tmdb("/tv/" + p.id + "/season/" + s.season_number).catch(function () { return null; });
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
                tags: (d.genres || []).map(function (g) { return g.name; }).slice(0, 5),
                syncData: { tmdb: String(p.id) },
                episodes: episodes
            });
            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

    /**
     * Ask the source API which servers carry this title.
     * Returns [{ scraper, name }] - the raw server list, unfiltered.
     */
    async function skyServers(p) {
        try {
            const q = nxEncode({
                tmdbId: String(p.id),
                imdb_id: "",
                type: p.type,
                season: p.s || 0,
                episode: p.e || 0
            });
            const r = await withTimeout(
                http_get(NX_BASE + "/api/servers?q=" + encodeURIComponent(q), nxHeaders()),
                9000
            );
            if (!r || !r.body) return [];
            const sv = await nxDecode(JSON.parse(r.body)._hash);
            return (sv && sv.servers) || [];
        } catch (e) { return []; }
    }

    /** Resolve one server's playable sources for this title. */
    async function skySources(p, scraper) {
        try {
            const q = nxEncode({
                ex_lang: true,
                provider: scraper,
                tmdbId: String(p.id),
                imdb_id: "",
                type: p.type,
                season: p.s || 0,
                episode: p.e || 0
            });
            const r = await withTimeout(
                http_get(NX_BASE + "/api/sources?q=" + encodeURIComponent(q), nxHeaders()),
                9000
            );
            if (!r || !r.body) return [];
            const so = await nxDecode(JSON.parse(r.body)._hash);
            return ((so && so.sources) || []).map(function (x) { return { scraper: scraper, src: x }; });
        } catch (e) { return []; }
    }

    function pickUrl(src) {
        return (src && (src.url || src.file)) || null;
    }

    /**
     * Whether a source is a small text manifest we can afford to fetch in
     * order to check it. Direct media files are excluded: pulling one down
     * just to test it would cost the user a whole film's worth of bandwidth.
     */
    function isProbeable(item) {
        const t = String((item.src && item.src.type) || "").toLowerCase();
        if (t === "m3u8" || t === "hls" || t === "mpd" || t === "dash") return true;
        if (t === "mp4" || t === "webm" || t === "mkv") return false;
        return /\.m3u8|\.mpd/i.test(String(item.url || "").split("?")[0]);
    }

    /**
     * Fetch a manifest and decide whether the player could actually use it.
     * Hosts routinely publish links that are dead by the time we see them -
     * expired signatures, or a Cloudflare challenge in front of the file - so
     * this is what keeps a broken URL from being handed over as first choice.
     */
    async function looksPlayable(url) {
        try {
            const r = await withTimeout(http_get(url, nxHeaders()), 9000);
            const body = String((r && r.body) || "");
            if (!body) return false;
            if (body.indexOf("#EXTM3U") >= 0) return true;
            if (body.indexOf("<MPD") >= 0 || body.indexOf("urn:mpeg:dash") >= 0) return true;
            const head = body.slice(0, 400);
            if (/<html|<!doctype/i.test(head)) return false;
            if (/forbidden|just a moment|access denied|not found|unauthorized/i.test(head)) return false;
            return true;
        } catch (e) { return false; }
    }

    // ─────────────────────── language selection ───────────────────────
    //
    // The source API carries no discrete language field - the language is baked
    // into the label string ("720p | Hindi"), so it has to be parsed out.
    //
    // DEFAULT_LANGUAGE is the audio this plugin selects by default. SkyStream
    // Gen 2 has no language-dropdown setting for plugins (the plugin.json schema
    // accepts only packageName, name, version, description, baseUrl, authors,
    // languages and categories; only `domains` and `providers` render controls
    // in the settings gear). The app plays the first stream returned, so the
    // default is expressed by ranking DEFAULT_LANGUAGE sources ahead of the
    // rest in the list handed back to the player.

    const DEFAULT_LANGUAGE = LANGUAGES[0]; // "hi" - Hindi, the plugin default

    const LANG_CODES = ["hi", "en", "ta", "te", "ur", "mal", "bn"];

    // Language names and their common aliases, matched against the label text.
    const LANG_PATTERNS = [
        { code: "hi",  re: /\bhindi\b|\u0939\u093f\u0928\u094d\u0926\u0940|\bhin\b/i,                  name: "Hindi" },
        { code: "ta",  re: /\btamil\b|\u0b85\u0ba4\u0bae\u0bbf\u0bb4\u0bcd|\btam\b/i,                  name: "Tamil" },
        { code: "te",  re: /\btelugu\b|\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41|\btel\b/i,                 name: "Telugu" },
        { code: "ur",  re: /\burdu\b|\u0627\u0631\u062f\u0648/i,                                       name: "Urdu" },
        { code: "mal", re: /\bmalayalam\b|\bmal\b/i,                                                    name: "Malayalam" },
        { code: "bn",  re: /\bbengali\b|\bbangla\b|\bben\b/i,                                           name: "Bengali" },
        { code: "en",  re: /\benglish\b|\beng\b/i,                                                      name: "English" }
    ];

    function langName(code) {
        for (const l of LANG_PATTERNS) { if (l.code === code) return l.name; }
        return String(code || "").toUpperCase();
    }

    /**
     * Parse the audio language out of a source label.
     * Returns a LANG_CODES entry, or "" when the label names no language
     * (multi-audio masters that let the player switch tracks itself).
     */
    function sourceLang(item) {
        const lb = String((item.src && (item.src.label || item.src.quality)) || "");
        for (const l of LANG_PATTERNS) { if (l.re.test(lb)) return l.code; }
        return "";
    }

    /** Quality portion of a label: "720p | Hindi" -> "720p". */
    function sourceQuality(item) {
        const lb = String((item.src && (item.src.quality || item.src.label)) || "")
            .replace(/\s+/g, " ")
            .trim();
        const m = lb.match(/(\d{3,4}p|\b4k\b|\bhd\b)/i);
        return m ? m[1].toLowerCase() : "";
    }

    /** Human label: "Citadel - Hindi 720p", language always first. */
    function sourceLabel(item) {
        const pretty = HOST_PRETTY[item.scraper] || String(item.scraper || "Server");
        const lang = sourceLang(item);
        const q = sourceQuality(item);
        const parts = [pretty];
        if (lang) parts.push(langName(lang));
        if (q) parts.push(q);
        return parts.join(" - ");
    }

    async function loadStreams(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized SkyFlixer url" });

            const servers = await skyServers(p);

            // Take the server list as published, dropping hosts that are
            // offline, flagged disabled, or that do not serve this media type.
            // Preferred hosts go first; everything else keeps the list's own
            // order so newly added hosts are picked up without a code change.
            const usable = (servers || []).filter(function (s) {
                if (!s || !s.scraper) return false;
                if (s.isDisable === true) return false;
                if (s.status && String(s.status).toLowerCase() !== "online") return false;
                if (Array.isArray(s.types) && s.types.length && s.types.indexOf(p.type) < 0) return false;
                return true;
            });

            const seenHost = {};
            const deduped = usable.filter(function (s) {
                if (seenHost[s.scraper]) return false;
                seenHost[s.scraper] = 1;
                return true;
            });

            const preferred = deduped.filter(function (s) { return PREFERRED_HOSTS.indexOf(s.scraper) >= 0; })
                .sort(function (a, b) {
                    return PREFERRED_HOSTS.indexOf(a.scraper) - PREFERRED_HOSTS.indexOf(b.scraper);
                });
            const rest = deduped.filter(function (s) { return PREFERRED_HOSTS.indexOf(s.scraper) < 0; });
            const wanted = preferred.concat(rest).slice(0, MAX_HOSTS).map(function (s) { return s.scraper; });

            if (!wanted.length) {
                return cb({
                    success: false,
                    errorCode: "NO_SERVERS",
                    message: "No SkyFlixer host is currently online for this title. Try another title or episode."
                });
            }

            // Phase 1: resolve every wanted server concurrently and collect all
            // sources. Nothing is dropped here - language ranking happens next,
            // so a Hindi track on a later server still beats an English one on
            // an earlier one.
            const all = [];
            const seen = {};
            const batches = [];
            const CHUNK = 8;
            for (let i = 0; i < wanted.length; i += CHUNK) {
                batches.push(wanted.slice(i, i + CHUNK));
            }

            for (const batch of batches) {
                const results = await Promise.all(batch.map(function (scraper) {
                    return skySources(p, scraper).catch(function () { return []; });
                }));
                for (const group of results) {
                    for (const item of group) {
                        const u = pickUrl(item.src);
                        if (!u) continue;
                        if (item.src.isEmbed === true) continue;
                        if (/embed/i.test(String(item.src.type || ""))) continue;
                        // Skip subtitle-only variants.
                        if (/\bsub\b/i.test(String(item.src.label || ""))) continue;
                        const key = String(u).split("?")[0];
                        if (seen[key]) continue;
                        seen[key] = 1;
                        all.push({ item: item, url: u, lang: sourceLang(item) });
                    }
                }
            }

            // Phase 2: rank by language. The default language comes first, then
            // the remaining declared languages in the order of LANG_ORDER, then
            // unnamed multi-audio masters, then anything unrecognised.
            const LANG_ORDER = [DEFAULT_LANGUAGE].concat(LANG_CODES.filter(function (c) {
                return c !== DEFAULT_LANGUAGE;
            }));

            function langRank(code) {
                const i = LANG_ORDER.indexOf(code);
                if (i >= 0) return i;
                return code === "" ? LANG_ORDER.length : LANG_ORDER.length + 1;
            }

            // Stable sort: within one language tier the original server priority
            // (preferred hosts before the rest) is preserved.
            const ranked = all.map(function (s, idx) {
                return { s: s, idx: idx, rank: langRank(s.lang) };
            }).sort(function (a, b) {
                return (a.rank - b.rank) || (a.idx - b.idx);
            }).map(function (x) { return x.s; });

            // Phase 3: verify, then cap.
            //
            // Manifests are fetched and only the ones that come back intact
            // are offered, so the player's first choice is a link that has
            // just been seen to work. Direct media files cannot be probed
            // without downloading them, so they are kept - but ranked behind
            // every verified manifest, unverified.
            //
            // MAX_PROBES bounds the work so a title with a large source list
            // cannot make loadStreams crawl.
            const streams = [];
            let probed = 0;
            const PBATCH = 6;

            function push(s) {
                // NOTE: StreamResult has no `quality` field - the runtime class
                // only takes url, source, headers, subtitles, drmKid, drmKey
                // and licenseUrl (the schema in DEVELOPER.md lists quality, but
                // the injected class drops it). Quality therefore has to ride
                // along inside `source`, which sourceLabel() already does.
                streams.push(mkStream({
                    url: s.url,
                    source: sourceLabel(s.item),
                    headers: nxHeaders()
                }));
            }

            const probeable = ranked.filter(isProbeable);
            for (let i = 0; i < probeable.length && streams.length < MAX_STREAMS && probed < MAX_PROBES; i += PBATCH) {
                const slice = probeable.slice(i, i + PBATCH);
                const ok = await Promise.all(slice.map(function (s) {
                    probed++;
                    return looksPlayable(s.url).catch(function () { return false; });
                }));
                for (let k = 0; k < slice.length && streams.length < MAX_STREAMS; k++) {
                    if (ok[k]) push(slice[k]);
                }
            }

            // Fallbacks: direct files we could not cheaply verify.
            if (streams.length < MAX_STREAMS) {
                const direct = ranked.filter(function (s) { return !isProbeable(s); });
                for (const s of direct) {
                    if (streams.length >= MAX_STREAMS) break;
                    push(s);
                }
            }

            if (!streams.length) {
                return cb({
                    success: false,
                    errorCode: "NO_STREAMS",
                    message: "SkyFlixer hosts listed this title but returned no playable file for it. Try another title or episode."
                });
            }
            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── exports ───────────────────────────

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
