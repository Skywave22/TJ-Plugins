(function() {
    "use strict";

    // ═══════════════════════════════════════════════════════════
    //  NetMirror (netmirror.center) — SkyStream plugin
    //
    //  Netflix-style catalog (Bollywood/Hollywood/Anime/dramas,
    //  heavily Hindi). React shell over two APIs:
    //
    //    catalog : https://api2.imdb3.shop/api
    //      - /tranding/list?id=<row>&page=0        (curated rows)
    //      - /movies/list/filter?page=0&sort_by=date&dubbing=Hindi
    //      - /movie/<tmdbId> | /tv/<tmdbId>        (detail; needs
    //        header "Content-Type: application/json" or rows come
    //        back EMPTY — the app sends it on every GET)
    //
    //    search : https://api2.imdb4.shop/api/search2/<query>?page=0
    //      (query is a PATH segment, spaces -> "+")
    //
    //  Playback is HMAC-signed: sig = HMAC_SHA256("net###@@sss",
    //  "<tmdbId>:<unixSeconds>") (key extracted from their bundle).
    //  Two player flows, both returning DIRECT file links:
    //
    //    movie w/ embed_json -> <name>.php?url=<enc>&...&nid=<tmdbId>
    //      -> page holds pub-*.r2.dev/<hash>?token=<epoch> direct file
    //    tv / fallback       -> watchbox.php?id=<subjectid>&se=&ep=
    //      &dp=<dp>&na=<b64(title)> -> page holds artplayer quality
    //      list (360P..1080P) with signed bcdnxw.hakunaymatata.com MP4s
    //
    //  Links are minted per-request (sign/t expire in minutes), so
    //  everything resolves at Play time. Verified live 2026-09:
    //  Mirzapur movie (3.97GB R2, 206 ranged) + Reacher S1E1.
    // ═══════════════════════════════════════════════════════════

    const API = "https://api2.imdb3.shop/api";
    const SEARCH = "https://api2.imdb4.shop/api/search2";
    const PLAY = "https://bet.watch21.shop/play";
    const SITE = "https://netmirror.center";
    const KEY = "net###@@sss";
    const JSON_HDR = { "Content-Type": "application/json" };

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // ────────────────── sha256 + hmac (pure JS) ──────────────────

    function sha256Bytes(msgBytes) {
        const K = new Uint32Array([
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
        ]);
        const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
        const len = msgBytes.length;
        const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
        padded.set(msgBytes);
        padded[len] = 0x80;
        const dv = new DataView(padded.buffer);
        dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
        dv.setUint32(padded.length - 4, (len << 3) >>> 0);
        const w = new Uint32Array(64);
        for (let i = 0; i < padded.length; i += 64) {
            for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
            for (let t = 16; t < 64; t++) {
                const s0 = ((w[t-15] >>> 7) | (w[t-15] << 25)) ^ ((w[t-15] >>> 18) | (w[t-15] << 14)) ^ (w[t-15] >>> 3);
                const s1 = ((w[t-2] >>> 17) | (w[t-2] << 15)) ^ ((w[t-2] >>> 19) | (w[t-2] << 13)) ^ (w[t-2] >>> 10);
                w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0;
            }
            let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
            for (let t = 0; t < 64; t++) {
                const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
                const ch = (e & f) ^ (~e & g);
                const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
                const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
                const mj = (a & b) ^ (a & c) ^ (b & c);
                const t2 = (S0 + mj) >>> 0;
                h = g; g = f; f = e; e = (d + t1) >>> 0;
                d = c; c = b; b = a; a = (t1 + t2) >>> 0;
            }
            H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
            H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
        }
        const out = new Uint8Array(32);
        const odv = new DataView(out.buffer);
        for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
        return out;
    }

    function utf8Bytes(str) {
        const raw = unescape(encodeURIComponent(str));
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 255;
        return out;
    }

    function hmacSha256Hex(keyStr, msgStr) {
        let key = utf8Bytes(keyStr);
        if (key.length > 64) key = sha256Bytes(key);
        const ip = new Uint8Array(64), op = new Uint8Array(64);
        for (let i = 0; i < 64; i++) {
            const k = i < key.length ? key[i] : 0;
            ip[i] = k ^ 0x36; op[i] = k ^ 0x5c;
        }
        const msg = utf8Bytes(msgStr);
        const inner = new Uint8Array(64 + msg.length);
        inner.set(ip); inner.set(msg, 64);
        const ih = sha256Bytes(inner);
        const outer = new Uint8Array(96);
        outer.set(op); outer.set(ih, 64);
        const digest = sha256Bytes(outer);
        let s = "";
        for (let i = 0; i < digest.length; i++) s += (digest[i] < 16 ? "0" : "") + digest[i].toString(16);
        return s;
    }

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

    async function apiGet(path) {
        const r = await withTimeout(http_get(path.indexOf("http") === 0 ? path : API + path, Object.assign({ "User-Agent": UA }, JSON_HDR)), 25000);
        try { return JSON.parse((r && r.body) || "{}"); } catch (e) { return {}; }
    }

    function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

    // detail cache: load() stores what it fetched, loadStreams reuses it
    // (one less round-trip at play time + survives transient API flaps)
    const detailCache = {};

    // Detail fetch with retry + cross-type fallback: the site's own data is
    // inconsistent (movies listed under /tv and vice versa), so we try both
    // routes and remember the result per tmdbId.
    async function getDetail(mt, id) {
        if (detailCache[id]) return detailCache[id];
        const paths = ["/" + mt + "/" + id, "/" + (mt === "tv" ? "movie" : "tv") + "/" + id];
        for (let attempt = 0; attempt < 2; attempt++) {
            for (let pi = 0; pi < paths.length; pi++) {
                try {
                    const j = await apiGet(paths[pi] + (paths[pi].indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now());
                    const it = j && j.results && j.results[0];
                    if (it && it.title) { detailCache[id] = it; return it; }
                } catch (e) {}
            }
            if (attempt === 0) await sleep(600);
        }
        return detailCache[id] || null;
    }

    function toItem(r) {
        if (!r || !r.id || !r.title) return null;
        const mt = r.media_type === "movie" || r.media_type === "tv"
            ? r.media_type
            : (/\sS\d/i.test(String(r.title)) ? "tv" : "movie");
        return mkItem({
            title: String(r.title).trim(),
            url: JSON.stringify({ mt: mt, id: String(r.id) }),
            posterUrl: r.backdrop_path || "",
            bannerUrl: r.backdrop_path || "",
            type: mt,
            year: parseInt(String(r.release_date || "").slice(0, 4), 10) || null,
            score: r.vote_average ? parseFloat(r.vote_average) : null
        });
    }

    // ─────────────────────────── home ──────────────────────────────

    async function getHome(cb) {
        try {
            const rows = [
                { qs: "/tranding/list?id=11&page=0",  name: "Trending Now" },
                { qs: "/movies/list/filter?page=0&sort_by=date&dubbing=Hindi", name: "Hindi Movies" },
                { qs: "/tranding/list?id=12&page=0",  name: "Trending in Cinema" },
                { qs: "/tranding/list?id=13&page=0",  name: "Hollywood" },
                { qs: "/tranding/list?id=30&page=0",  name: "Anime" },
                { qs: "/tranding/list?id=37&page=0",  name: "Reality TV" },
                { qs: "/tranding/list?id=5&page=0",   name: "Love Week Special" }
            ];
            const settled = await Promise.all(rows.map(function (row) {
                return apiGet(row.qs).catch(function () { return {}; });
            }));
            const home = {};
            for (let i = 0; i < rows.length; i++) {
                const results = (settled[i] && settled[i].results) || [];
                const items = results.map(toItem).filter(function (x) { return !!x; });
                if (items.length) home[rows[i].name] = items;
            }
            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "API_ERROR", message: "NetMirror catalog unavailable" });
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── search ────────────────────────────

    async function search(query, cb) {
        try {
            if (!query || !String(query).trim()) return cb({ success: true, data: [] });
            const q = encodeURIComponent(String(query).trim()).replace(/%20/g, "+").replace(/%2F/g, "--slash--");
            const r = await withTimeout(http_get(SEARCH + "/" + q + "?page=0", Object.assign({ "User-Agent": UA }, JSON_HDR)), 25000);
            let j = {};
            try { j = JSON.parse((r && r.body) || "{}"); } catch (e) {}
            const results = (j && j.results) || [];
            cb({ success: true, data: results.map(toItem).filter(function (x) { return !!x; }) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────── detail + episodes ─────────────────────

    async function load(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.id || !p.mt) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized NetMirror url" });

            const it = await getDetail(p.mt, p.id);
            const title = (it && it.title ? String(it.title) : String(p.t || "")).trim() || "Title";
            const poster = (it && it.backdrop_path) || "";
            const episodes = [];

            if (p.mt === "movie") {
                // No API dependency for the button: the episode payload carries
                // everything loadStreams needs (it re-fetches detail itself).
                episodes.push(mkEpisode({
                    name: "Full Movie",
                    url: JSON.stringify({ mt: "movie", id: String(p.id), t: title }),
                    season: 1,
                    episode: 1,
                    posterUrl: poster,
                    description: it ? (it.dis || "").slice(0, 300) : ""
                }));
            } else {
                const seasons = (it && it.season) || [];
                for (let si = 0; si < seasons.length; si++) {
                    const s = parseInt(seasons[si].se, 10) || (si + 1);
                    const total = parseInt(seasons[si].ep, 10) || 0;
                    for (let e = 1; e <= total; e++) {
                        episodes.push(mkEpisode({
                            name: "S" + s + " E" + (e < 10 ? "0" + e : e),
                            url: JSON.stringify({ mt: "tv", id: String(p.id), s: s, e: e, t: title }),
                            season: s,
                            episode: e,
                            posterUrl: poster,
                            description: title + " — Season " + s + ", Episode " + e
                        }));
                    }
                }
                // API unreachable right now: still light up the Play button
                // with a first-episode entry (loadStreams retries at play time).
                if (!episodes.length) {
                    episodes.push(mkEpisode({
                        name: "S1 E01",
                        url: JSON.stringify({ mt: "tv", id: String(p.id), s: 1, e: 1, t: title }),
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
                    bannerUrl: poster,
                    type: p.mt === "tv" ? "tv" : "movie",
                    year: it ? (parseInt(String(it.release_date || "").slice(0, 4), 10) || null) : null,
                    description: it ? (it.dis || "").slice(0, 700) : "",
                    score: it && it.vote_average ? parseFloat(it.vote_average) : null,
                    duration: it && it.duration ? parseInt(it.duration, 10) : null,
                    tags: it ? String(it.genre || "").split(",").map(function (g) { return g.trim(); }).filter(function (g) { return g; }).slice(0, 4) : [],
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "DETAIL_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

    function pushStream(list, seen, label, u) {
        if (!u || seen[u]) return;
        seen[u] = 1;
        if (list.length >= 8) return;
        list.push(mkStream({
            url: u,
            source: label,
            headers: { "User-Agent": UA },
            isDirect: true
        }));
    }

    // pull direct links out of a player page
    function parsePlayerPage(html) {
        const out = [];
        const seen = {};
        // labeled qualities: html:'480P', url:'https://...'
        const qr = /html\s*:\s*['"]([^'"]{2,12})['"][^}]{0,120}?url\s*:\s*['"](https?:\/\/[^'"]+)['"]/g;
        let m;
        while ((m = qr.exec(html))) {
            const label = m[1];
            const u = m[2];
            if (/^custom_|notfound/.test(label + u)) continue;
            if (!/\.(mp4|mkv|m3u8)(\?|$)/i.test(u) && !/r2\.dev|token=\d/.test(u)) continue;
            if (!seen[u]) { seen[u] = 1; out.push({ label: label, url: u }); }
        }
        if (!out.length) {
            // fallback: any direct file / r2 token link
            const fr = /['"](https?:\/\/[^'"]+?\.r2\.dev\/[^'"]+?token=\d+|https?:\/\/[^'"]+?\.(?:mp4|mkv)(?:\?[^'"]*)?)['"]/g;
            while ((m = fr.exec(html))) {
                const u = m[1];
                if (/hakunaymatata\.com\/bt\/|custom_/.test(u)) continue;
                if (seen[u]) continue;
                seen[u] = 1;
                out.push({ label: "Stream", url: u });
            }
        }
        return out;
    }

    async function fetchPlayerPage(playUrl) {
        const hosts = [PLAY, "https://play.watch21.shop/play"];
        for (let i = 0; i < hosts.length; i++) {
            try {
                const r = await withTimeout(http_get(playUrl.replace(PLAY, hosts[i]), {
                    "User-Agent": UA,
                    "Referer": SITE + "/"
                }), 25000);
                const html = (r && r.body) || "";
                if (html.length > 2000 && !/Not Found\. or Unauthorised/i.test(html.slice(0, 400))) {
                    const parsed = parsePlayerPage(html);
                    if (parsed.length) return parsed;
                }
            } catch (e) {}
        }
        return [];
    }

    async function loadStreams(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.id || !p.mt) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized episode url" });

            const it = await getDetail(p.mt, p.id);
            if (!it) return cb({ success: false, errorCode: "NO_STREAMS", message: "NetMirror source is not responding right now — please try again in a moment." });

            const title = String(it.title || "").trim();
            const ts = Math.floor(Date.now() / 1000);
            const sig = hmacSha256Hex(KEY, p.id + ":" + ts);
            const auth = "&ts=" + ts + "&sig=" + sig + "&nid=" + p.id + "&exten=1&tv=&token=";
            const s = parseInt(p.s, 10) || 0;
            const e = parseInt(p.e, 10) || 0;

            const streams = [];
            const seen = {};

            // flow 1: embed_json servers (mostly movies)
            let servers = it.embed_json || [];
            if (typeof servers === "string") {
                try { servers = JSON.parse(servers); } catch (e) { servers = []; }
            }
            let be = null;
            for (let i = 0; i < servers.length; i++) {
                if (Number(servers[i].se) === s && Number(servers[i].ep) === e) { be = servers[i]; break; }
            }
            if (!be && servers.length === 1) be = servers[0];

            if (be) {
                const playUrl = PLAY + "/" + be.name + ".php?url=" + encodeURIComponent(be.url) +
                    "&size=" + encodeURIComponent(be.size || "") + "&se=" + (be.se || 0) + "&ep=" + (be.ep || 0) +
                    "&name=" + encodeURIComponent(be.name) + auth;
                const links = await fetchPlayerPage(playUrl);
                for (let i = 0; i < links.length; i++) {
                    pushStream(streams, seen, "NetMirror - " + links[i].label, links[i].url);
                }
            }

            // flow 2: watchbox (tv, and movies without embed_json)
            if (!streams.length && it.subjectid && it.dp) {
                const na = encodeURIComponent(btoa(unescape(encodeURIComponent(title))));
                const wbUrl = PLAY + "/watchbox.php?id=" + it.subjectid + "&se=" + s + "&ep=" + e +
                    "&dp=" + it.dp + "&na=" + na + auth;
                const links = await fetchPlayerPage(wbUrl);
                for (let i = 0; i < links.length; i++) {
                    pushStream(streams, seen, "NetMirror - " + links[i].label, links[i].url);
                }
            }

            if (!streams.length) {
                return cb({
                    success: false,
                    errorCode: "NO_STREAMS",
                    message: "No playable source right now — the player link may have expired. Try again."
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
