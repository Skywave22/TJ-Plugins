(function () {
    /**
     * NetflixMirror (net52.cc) - SkyStream Gen 2 plugin
     *
     * Port of the GPLv3 CloudStream extension Sushan64/NetMirror-Extension
     * (package com.horis.cncverse). Original authors retain copyright; this
     * derivative is distributed under the same licence.
     *
     * One plugin serves four OTT catalogs - Netflix, Prime Video, Hotstar and
     * Disney+ - selected via manifest.providerId (the `providers` array in
     * plugin.json renders the picker in the app's settings gear).
     *
     * Request flow, all verified live:
     *   1. POST net52.cc/verify.php with a random g-recaptcha-response; the 301
     *      carries Set-Cookie: t_hash_t=... which every later call needs.
     *   2. GET  net52.cc/mobile/{home,search.php,post.php,episodes.php}
     *      with that cookie plus ott=<service> and hd=on.
     *   3. GET  <mobiledetect>/checknewtv.php -> {token_hash}; base64-decoding
     *      it yields the real player API base.
     *   4. GET  <apiBase>/newtv/player.php?id=<id> with an `Ott` header ->
     *      {video_link} pointing at an HLS master playlist.
     *
     * Two different User-Agents matter: the site endpoints reject the desktop
     * UA on /mobile/home (404), and the player API expects its own tagged one.
     */

    // ─────────────────────────── config ───────────────────────────

    const MAIN = "https://net52.cc";
    const PLAY_PHP = "https://net77.cc/play.php";
    const IMG = "https://imgcdn.kim/poster/v";

    // Site endpoints want the Android WebView UA the original app sends.
    const UA_WEB = "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 " +
        "Safari/537.36 /OS.Gatu v3.0";
    // The player API wants its own tagged Firefox UA.
    const UA_TV = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 " +
        "Firefox/136.0 /OS.GatuNewTV v1.0";

    // Rotating mirrors for step 3, in the order the upstream extension tries
    // them. Most do not resolve; the first two are the live ones.
    const TV_DOMAINS = [
        "https://mobiledetects.com", "https://mobiledetect.app",
        "https://mobiledetect.art", "https://mobiledetect.cc",
        "https://mobiledetect.click", "https://mobiledetect.ink",
        "https://mobiledetect.live", "https://mobiledetect.pro",
        "https://mobiledetect.shop", "https://mobiledetect.site",
        "https://mobiledetects.art", "https://mobiledetects.cc",
        "https://mobiledetects.info", "https://mobiledetects.live",
        "https://mobiledetects.pro", "https://mobiledetects.top"
    ];

    // plugin.json's `providers[].id` -> the `Ott` value the API expects.
    // Disney+ shares Hotstar's "hs" channel upstream.
    const OTT = { nf: "nf", pv: "pv", hs: "hs", dp: "hs" };
    const PRETTY = { nf: "Netflix", pv: "Prime Video", hs: "Hotstar", dp: "Disney+" };

    function ott() {
        try {
            const id = (typeof manifest !== "undefined" && manifest && manifest.providerId) || "nf";
            return OTT[id] || "nf";
        } catch (e) { return "nf"; }
    }
    function service() {
        try {
            const id = (typeof manifest !== "undefined" && manifest && manifest.providerId) || "nf";
            return PRETTY[id] || "Netflix";
        } catch (e) { return "Netflix"; }
    }

    const MAX_EPISODE_PAGES = 40;

    // ─────────────────────────── helpers ───────────────────────────

    function mkItem(obj) { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj) { try { return new StreamResult(obj); } catch (_) { return obj; } }

    function now() { return Math.floor(Date.now() / 1000); }

    /** RFC4122-ish v4 uuid. The verify endpoint accepts any opaque token. */
    function uuid() {
        const h = "0123456789abcdef";
        let s = "";
        for (let i = 0; i < 36; i++) {
            if (i === 8 || i === 13 || i === 18 || i === 23) { s += "-"; continue; }
            if (i === 14) { s += "4"; continue; }
            s += h[Math.floor(Math.random() * 16)];
        }
        return s;
    }

    function siteHeaders() {
        return {
            "User-Agent": UA_WEB,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
            "X-Requested-With": "XMLHttpRequest",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Upgrade-Insecure-Requests": "1"
        };
    }

    function cookieHeader(h) {
        const o = siteHeaders();
        o["Cookie"] = "t_hash_t=" + h + "; ott=" + ott() + "; hd=on";
        o["Referer"] = MAIN + "/home";
        return o;
    }

    function tvHeaders() {
        return {
            "User-Agent": UA_TV,
            "X-Requested-With": "NetmirrorNewTV v1.0",
            "Accept": "application/json, text/plain, */*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Ott": ott()
        };
    }

    function jsonOf(body) {
        try { return JSON.parse(String(body || "")); } catch (e) { return null; }
    }

    function withTimeout(p, ms) {
        return Promise.race([
            p,
            new Promise(function (_, rej) {
                setTimeout(function () { rej(new Error("timeout")); }, ms);
            })
        ]);
    }

    // ─────────────────────── auth (t_hash_t cookie) ───────────────────────

    let COOKIE = "";

    /** Pull t_hash_t out of a response header map (keys arrive lower-cased). */
    function readHash(headers) {
        if (!headers) return "";
        const keys = Object.keys(headers);
        for (const k of keys) {
            if (k.toLowerCase() !== "set-cookie") continue;
            const v = headers[k];
            const list = Array.isArray(v) ? v : [String(v)];
            for (const c of list) {
                if (c.indexOf("t_hash_t=") >= 0) {
                    return c.split("t_hash_t=")[1].split(";")[0];
                }
            }
        }
        return "";
    }

    async function bypass() {
        if (COOKIE) return COOKIE;
        // Reuse a cookie from a previous run; it is valid for ~3 days.
        try {
            const saved = getPreference("nm_cookie");
            if (saved && String(saved).length > 20) { COOKIE = String(saved); return COOKIE; }
        } catch (e) {}

        const h = siteHeaders();
        h["Content-Type"] = "application/x-www-form-urlencoded";
        h["Origin"] = "https://net77.cc";
        h["Referer"] = "https://net77.cc/verify2";
        delete h["X-Requested-With"];
        try {
            const r = await withTimeout(
                http_post(MAIN + "/verify.php", h, "g-recaptcha-response=" + uuid()), 15000);
            const c = readHash(r && r.headers);
            if (c) {
                COOKIE = c;
                try { setPreference("nm_cookie", c); } catch (e) {}
            }
        } catch (e) {}
        return COOKIE;
    }

    // ─────────────────────── player API base ───────────────────────

    let API_BASE = "";

    async function apiBase() {
        if (API_BASE) return API_BASE;
        try {
            const saved = getPreference("nm_api");
            if (saved && String(saved).indexOf("http") === 0) {
                API_BASE = String(saved);
                return API_BASE;
            }
        } catch (e) {}

        const h = {
            "User-Agent": UA_TV,
            "X-Requested-With": "NetmirrorNewTV v1.0",
            "Accept": "application/json, text/plain, */*",
            "Cache-Control": "no-cache, no-store, must-revalidate"
        };
        for (const d of TV_DOMAINS) {
            try {
                const r = await withTimeout(http_get(d + "/checknewtv.php", h), 9000);
                const j = jsonOf(r && r.body);
                if (j && j.token_hash) {
                    let dec = "";
                    try { dec = atob(String(j.token_hash)); } catch (e) { dec = ""; }
                    if (dec.indexOf("http") === 0) {
                        API_BASE = dec.replace(/\/+$/, "");
                        try { setPreference("nm_api", API_BASE); } catch (e) {}
                        return API_BASE;
                    }
                }
            } catch (e) { /* try the next mirror */ }
        }
        return "";
    }

    // ─────────────────────────── catalog ───────────────────────────

    function poster(id) { return IMG + "/" + id + ".jpg"; }

    function itemUrl(o) { return JSON.stringify(o); }
    function parseUrl(u) {
        try {
            const p = JSON.parse(String(u || ""));
            if (p && p.id) return p;
        } catch (e) {}
        return null;
    }

    function stripTags(s) { return String(s || "").replace(/<[^>]*>/g, "").trim(); }

    async function getHome(cb) {
        try {
            await bypass();
            if (!COOKIE) {
                return cb({ success: false, errorCode: "AUTH_ERROR",
                    message: service() + " did not issue a session cookie. Try again in a moment." });
            }
            const r = await withTimeout(
                http_get(MAIN + "/mobile/home?app=1", cookieHeader(COOKIE)), 20000);
            const html = String((r && r.body) || "");
            if (html.length < 2000) {
                return cb({ success: false, errorCode: "HOME_ERROR",
                    message: service() + " home page came back empty." });
            }

            // Split on each tray and read its title plus the ids it holds.
            const marks = [];
            const re = /<div class="tray-container">/g;
            let m;
            while ((m = re.exec(html)) !== null) marks.push(m.index);
            marks.push(html.length);

            const home = {};
            const used = {};
            for (let i = 0; i < marks.length - 1; i++) {
                const blk = html.slice(marks[i], marks[i + 1]);
                const tm = /tray-title[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(blk) ||
                           /tray-title[^>]*>([\s\S]*?)<\/h2>/.exec(blk);
                const title = stripTags(tm && tm[1]);
                if (!title) continue;
                const ids = [];
                const ire = /data-post="(\d+)"/g;
                let im;
                while ((im = ire.exec(blk)) !== null) {
                    if (!used[im[1]]) { used[im[1]] = 1; ids.push(im[1]); }
                }
                if (!ids.length) continue;
                home[title] = ids.slice(0, 24).map(function (id) {
                    return mkItem({
                        title: "",            // filled from the poster id on load
                        url: itemUrl({ id: id }),
                        posterUrl: poster(id),
                        type: "movie"
                    });
                });
            }

            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "HOME_ERROR",
                    message: service() + " returned no rows." });
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
            await bypass();
            const r = await withTimeout(http_get(
                MAIN + "/mobile/search.php?s=" + encodeURIComponent(q) + "&t=" + now(),
                cookieHeader(COOKIE)), 15000);
            const d = jsonOf(r && r.body);
            const list = (d && d.searchResult) || [];
            // status "n" means the server ignored the query and sent its
            // generic "Top Searches" row instead - not real matches.
            const hits = (d && d.status === "y") ? list : [];
            cb({ success: true, data: hits.map(function (x) {
                return mkItem({
                    title: x.t || "Unknown",
                    url: itemUrl({ id: String(x.id), title: x.t || "" }),
                    posterUrl: poster(x.id),
                    type: "movie"
                });
            }) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    /** One page of a series' episodes. */
    async function episodePage(eid, sid, page) {
        const r = await withTimeout(http_get(
            MAIN + "/mobile/episodes.php?s=" + encodeURIComponent(sid) +
            "&series=" + encodeURIComponent(eid) + "&t=" + now() + "&page=" + page,
            cookieHeader(COOKIE)), 15000);
        return jsonOf(r && r.body);
    }

    async function load(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized url" });
            await bypass();

            const r = await withTimeout(http_get(
                MAIN + "/mobile/post.php?id=" + encodeURIComponent(p.id) + "&t=" + now(),
                cookieHeader(COOKIE)), 15000);
            const d = jsonOf(r && r.body);
            if (!d || !d.title) {
                return cb({ success: false, errorCode: "NOT_FOUND", message: "Title not found" });
            }

            const isSeries = String(d.type || "") === "t";
            const base = {
                title: d.title,
                url: itemUrl({ id: String(p.id), title: d.title, type: isSeries ? "tv" : "movie" }),
                posterUrl: poster(p.id),
                bannerUrl: poster(p.id),
                type: isSeries ? "tv" : "movie",
                year: parseInt(d.year, 10) || null,
                description: d.desc || "",
                genres: String(d.genre || "").split(/[,|]/).map(function (s) { return s.trim(); }).filter(Boolean),
                actors: String(d.cast || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean),
                score: d.match ? parseFloat(String(d.match).replace(/[^\d.]/g, "")) / 10 : null
            };

            if (!isSeries) return cb({ success: true, data: mkItem(base) });

            // Series: seasons arrive as [{id, s, ep}]; walk each one's pages.
            const seasons = (d.season || []).filter(function (s) { return s && s.id; });
            const eps = [];
            const chunks = [];
            for (let i = 0; i < seasons.length; i += 5) chunks.push(seasons.slice(i, i + 5));
            for (const chunk of chunks) {
                const pages = await Promise.all(chunk.map(function (s) {
                    return episodePage(p.id, s.id, 1).catch(function () { return null; });
                }));
                for (let k = 0; k < chunk.length; k++) {
                    const s = chunk[k];
                    let pg = pages[k];
                    let guard = 0;
                    while (pg && guard++ < MAX_EPISODE_PAGES) {
                        for (const e of (pg.episodes || [])) {
                            if (!e || !e.id) continue;
                            eps.push(mkEpisode({
                                title: e.t || ("Episode " + String(e.ep || "").replace("E", "")),
                                url: itemUrl({
                                    id: String(e.id), title: e.t || "", type: "tv",
                                    s: parseInt(String(e.s || "").replace("S", ""), 10) || 0,
                                    e: parseInt(String(e.ep || "").replace("E", ""), 10) || 0
                                }),
                                posterUrl: IMG + "/150/" + e.id + ".jpg",
                                season: parseInt(String(e.s || "").replace("S", ""), 10) || 0,
                                episode: parseInt(String(e.ep || "").replace("E", ""), 10) || 0,
                                duration: parseInt(String(e.time || "").replace("m", ""), 10) || null
                            }));
                        }
                        if (!pg.nextPageShow) break;
                        pg = await episodePage(p.id, s.id, (pg.nextPage || 1) + 1).catch(function () { return null; });
                    }
                }
            }

            base.episodes = eps;
            cb({ success: true, data: mkItem(base) });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

    /** Primary path: the NewTV player API. */
    async function newTvLink(id) {
        const base = await apiBase();
        if (!base) return null;
        const r = await withTimeout(
            http_get(base + "/newtv/player.php?id=" + encodeURIComponent(id), tvHeaders()), 20000);
        const j = jsonOf(r && r.body);
        if (j && j.video_link) {
            return { url: j.video_link, referer: j.referer || base };
        }
        return null;
    }

    /** Fallback path: play.php -> playlist.php, which lists quality variants. */
    async function playlistLinks(id, title) {
        const ph = siteHeaders();
        ph["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        ph["Origin"] = "https://net77.cc";
        ph["Referer"] = "https://net77.cc/home";
        ph["Accept"] = "application/json, text/javascript, */*; q=0.01";
        ph["Cookie"] = "t_hash_t=" + COOKIE + "; ott=" + ott() + "; hd=on";
        const pr = await withTimeout(http_post(PLAY_PHP, ph, "id=" + encodeURIComponent(id)), 15000);
        const pj = jsonOf(pr && pr.body);
        const h = pj && pj.h;
        if (!h) return [];

        const u = MAIN + "/playlist.php?id=" + encodeURIComponent(id) +
            "&t=" + encodeURIComponent(title || "") + "&tm=" + now() +
            "&h=" + encodeURIComponent(h);
        const rr = await withTimeout(http_get(u, ph), 15000);
        let pl = jsonOf(rr && rr.body);
        if (Array.isArray(pl)) pl = pl[0];
        if (!pl || !pl.sources) return [];

        return pl.sources.map(function (s) {
            const file = String(s.file || "");
            return {
                url: file.indexOf("http") === 0 ? file : MAIN + file,
                label: String(s.label || ""),
                referer: "https://net77.cc/home"
            };
        }).filter(function (x) { return !!x.url; });
    }

    /** Confirm a manifest is really a playlist before offering it. */
    async function looksPlayable(u, referer) {
        try {
            const r = await withTimeout(http_get(u, {
                "User-Agent": UA_WEB, "Referer": referer || MAIN + "/"
            }), 10000);
            const b = String((r && r.body) || "").slice(0, 400);
            return b.indexOf("#EXTM3U") === 0 || /<MPD[\s>]/.test(b);
        } catch (e) { return false; }
    }

    function qualityOf(label, url) {
        const s = (label + " " + url).toLowerCase();
        if (s.indexOf("2160") >= 0 || s.indexOf("4k") >= 0) return "2160p";
        if (s.indexOf("1080") >= 0 || s.indexOf("full hd") >= 0) return "1080p";
        if (s.indexOf("720") >= 0 || s.indexOf("mid hd") >= 0) return "720p";
        if (s.indexOf("480") >= 0 || s.indexOf("low hd") >= 0) return "480p";
        if (s.indexOf("360") >= 0) return "360p";
        return "";
    }

    async function loadStreams(url, cb) {
        try {
            const p = parseUrl(url);
            if (!p) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized url" });

            // NOTE: playback does NOT need the t_hash_t cookie. The NewTV player
            // API answers on its own headers alone, so the cookie is fetched
            // opportunistically (the playlist.php fallback wants it) but its
            // absence must never block a stream.
            await bypass().catch(function () {});

            const cands = [];

            const nt = await newTvLink(p.id).catch(function () { return null; });
            if (nt && nt.url) cands.push({ url: nt.url, label: "", referer: nt.referer });

            if (!cands.length) {
                const pl = await playlistLinks(p.id, p.title).catch(function () { return []; });
                for (const x of pl) cands.push(x);
            }

            if (!cands.length) {
                return cb({ success: false, errorCode: "NO_STREAMS",
                    message: service() + " has no playable file for this title yet." });
            }

            // De-duplicate, then verify every candidate actually serves a
            // playlist rather than trusting the API blindly.
            const seen = {};
            const uniq = [];
            for (const c of cands) {
                const k = String(c.url).split("?")[0];
                if (seen[k]) continue;
                seen[k] = 1;
                uniq.push(c);
            }

            const checks = await Promise.all(uniq.slice(0, 12).map(function (c) {
                return looksPlayable(c.url, c.referer).catch(function () { return false; });
            }));

            const good = [];
            for (let i = 0; i < checks.length; i++) { if (checks[i]) good.push(uniq[i]); }
            const final = (good.length ? good : uniq).slice(0, 12);

            const streams = final.map(function (c) {
                const st = mkStream({
                    url: c.url,
                    source: service() + (c.label ? " - " + c.label : ""),
                    headers: { "User-Agent": UA_WEB, "Referer": c.referer || MAIN + "/" }
                });
                const q = qualityOf(c.label, c.url);
                if (q) st.quality = q;
                return st;
            });

            if (!streams.length) {
                return cb({ success: false, errorCode: "NO_STREAMS",
                    message: service() + " listed this title but returned no playable file." });
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
