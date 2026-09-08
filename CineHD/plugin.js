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

    // ─── nxsha.space (the site's Nxsha/Nitro/Hindi servers) ───
    // Requests and responses are CryptoJS-AES (OpenSSL KDF) wrapped with a
    // hard-coded passphrase (extracted from their bundle). We encrypt the
    // query in-plugin (pure-JS MD5 + AES) and decrypt responses via the
    // app's crypto.decryptAES.
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

    const NX_PROVIDERS = ["rive-citadel", "awsind", "nitro", "mhbox", "holly", "stvv", "castle"];

    async function nxshaSources(p) {
        const out = [];
        try {
            const q1 = nxEncode({ tmdbId: String(p.id), imdb_id: "", type: p.type, season: p.s || 0, episode: p.e || 0 });
            const r1 = await withTimeout(http_get(NX_BASE + "/api/servers?q=" + q1, { "User-Agent": UA, "Referer": NX_BASE + "/" }), 15000);
            if (!r1 || !r1.body) return out;
            const sv = await nxDecode(JSON.parse(r1.body)._hash);
            const servers = (sv.servers || []).filter(function (x) { return x && x.web_support && NX_PROVIDERS.indexOf(x.scraper) >= 0; });
            const CHUNK = 4;
            for (let i = 0; i < servers.length; i += CHUNK) {
                const batch = servers.slice(i, i + CHUNK);
                const results = await Promise.all(batch.map(async function (srv) {
                    try {
                        const q2 = nxEncode({ ex_lang: true, provider: srv.scraper, tmdbId: String(p.id), imdb_id: "", type: p.type, season: p.s || 0, episode: p.e || 0 });
                        const r2 = await withTimeout(http_get(NX_BASE + "/api/sources?q=" + q2, { "User-Agent": UA, "Referer": NX_BASE + "/" }), 15000);
                        const so = await nxDecode(JSON.parse(r2.body)._hash);
                        return (so.sources || []).map(function (x) { return { server: srv.name, src: x }; });
                    } catch (e) { return []; }
                }));
                for (let k = 0; k < results.length; k++) {
                    for (const item of results[k]) out.push(item);
                }
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

            // 2) nxsha servers (Nitro / MhPly Hindi dub / Citadel / AwsPly…)
            let nx = [];
            try { nx = await nxshaSources(p); } catch (e) { nx = []; }
            function nxLabel(item) {
                const lb = (item.src.label || item.src.quality || "").replace(/\s+/g, " ").trim();
                return item.server + " - " + (lb || "Stream");
            }
            const seenSrv = {};
            const nxHindi = [], nxOther = [];
            for (const item of nx) {
                if (!item.src || !item.src.url) continue;
                if (/embed/i.test(item.src.type || "")) continue;
                const lb = item.src.label || "";
                if (/\bsub\b/i.test(lb)) continue; // subtitle-only variants
                const per = seenSrv[item.src.provider] || (seenSrv[item.src.provider] = { h: 0, o: 0 });
                if (/hindi/i.test(lb)) {
                    if (per.h >= 2) continue;
                    per.h++; nxHindi.push(item);
                } else {
                    if (per.o >= 1) continue; // one representative non-Hindi per server
                    per.o++; nxOther.push(item);
                }
            }
            for (const item of nxHindi.concat(nxOther)) {
                if (streams.length >= 16) break;
                addStream(nxLabel(item) + (item.src.type === "mpd" ? " (DASH)" : ""), item.src.url, {
                    "User-Agent": UA,
                    "Referer": NX_BASE + "/"
                });
            }

            // 3) vidrock servers (Nova/Atlas/Luna/Orion hls + Astra mp4)
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

            // 4) remaining vidlove servers
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
