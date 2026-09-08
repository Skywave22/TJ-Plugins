(function() {
    "use strict";

    // ═══════════════════════════════════════════════════════════
    //  MovieBoxHD (movieboxhd.net) — SkyStream plugin
    //
    //  Official MovieBox web build (mbOfficial). Catalog + playback
    //  via the wefeed H5 BFF; the site's own player lives on a
    //  separate origin it resolves at runtime:
    //
    //    GET /wefeed-h5api-bff/media-player/get-domain -> "https://mzfi.me/"
    //    player page: <domain>/spa/videoPlayPage/movies/<detailPath>
    //
    //  Flows (mirrors the site exactly):
    //    home     GET /home?host=movieboxhd.net  (operatingList rows)
    //    trending GET /subject/trending?tabId=ONEROOM_MOVIE&page=1&perPage=18
    //    detail   GET /detail?subjectId=&subjectType=   (subject + resource)
    //    search   POST /subject/search {keyword,page,perPage}
    //             -> requires Authorization: Bearer <guestJWT>; three
    //                90-day browser-minted tokens baked in (rotated on
    //                auth failure); after expiry a tokenless local index
    //                (titles seen this session) keeps search alive
    //    play     GET /subject/play?subjectId=&se=&ep=&detailPath=
    //             &streamSignType=1&supportCodecs[h264]=1
    //             with Referer: <domain>/spa/videoPlayPage/movies/<detailPath>
    //             films use se=0&ep=0 (site default), series use the
    //             season/episode numbers from resource.seasons
    //
    //  play response: streams[] = h264 MP4 (signed ~10-min links,
    //  "resolutions" holds the quality), dash[] = HEVC (skipped,
    //  engine plays MP4), hls[] unused. vipLocked / empty-url entries
    //  are dropped. Best link only per audio track — their file CDN
    //  (bcdnxw.hakunaymatata.com) rate-limits per IP, and listing
    //  many links makes players probe themselves into a lockout.
    //
    //  subjectType: 1 = movie, 2 = series. dubs[] on a subject lists
    //  alternate audio versions (separate subjectId+detailPath); Hindi
    //  dubs are appended as extra streams when present.
    // ═══════════════════════════════════════════════════════════

    const API   = "https://h5-api.aoneroom.com/wefeed-h5api-bff";
    const SITE  = "https://movieboxhd.net";
    const TAB   = "ONEROOM_MOVIE";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const GUEST_TOKENS = [
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjM2NTA2NjIxNjgxNTg2OTEyNzIsImF0cCI6MywiZXh0IjoiMTc4ODg5NTYwMiIsImV4cCI6MTc5NjY3MTYwMiwiaWF0IjoxNzg4ODk1MzAyfQ.6SWRdJ_HxEtqiL6B92gze3zN3P8t1NZYBth3-jh86j0",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjcwOTgxMTYxMTQ4NjM3NTAwOCwiYXRwIjozLCJleHQiOiIxNzg4ODk1NjEwIiwiZXhwIjoxNzk2NjcxNjEwLCJpYXQiOjE3ODg4OTUzMTB9.0sgxiZSSc0EHB9qnXxgjPeu3d4X-qy1cpVfZKSGW8rA",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjg5MDA3MzM0MzM3NjU0MTY2MDAsImF0cCI6MywiZXh0IjoiMTc4ODg5NTYxOCIsImV4cCI6MTc5NjY3MTYxOCwiaWF0IjoxNzg4ODk1MzE4fQ._sm7FmjzcM4W9wyaUv7kR4eR2_WdZOGEOOfJx9FZheQ",
    ];

    let tokenIndex = 0;
    let playOrigin = "https://mzfi.me";   // refreshed from media-player/get-domain

    const BASE_HEADERS = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": UA,
        "authorization": "",
        "x-client-info": JSON.stringify({ timezone: "Asia/Karachi" }),
        "x-request-lang": "en",
        "x-vip-restrict": "1",
        "x-no-high-risk-restrict": "0",
        "x-source": ""
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

    async function httpGet(url, extra) {
        const headers = Object.assign({}, BASE_HEADERS, extra || {});
        const r = await withTimeout(http_get(url, headers), 25000);
        let j = {};
        try { j = JSON.parse((r && r.body) || "{}"); } catch (e) { j = {}; }
        return j;
    }

    async function httpPost(url, body, extra) {
        const headers = Object.assign({}, BASE_HEADERS, extra || {});
        const r = await withTimeout(http_post(url, headers, JSON.stringify(body || {})), 25000);
        let j = {};
        try { j = JSON.parse((r && r.body) || "{}"); } catch (e) { j = {}; }
        return j;
    }

    function itemUrl(sid, st) { return JSON.stringify({ sid: String(sid), st: parseInt(st, 10) === 1 ? 1 : 2 }); }

    // local title index — home rows / trending / search results land here
    // so search keeps working after the guest tokens expire
    const titleIndex = {};
    function indexItems(list) {
        const arr = Array.isArray(list) ? list : [];
        for (let i = 0; i < arr.length; i++) {
            const it = arr[i];
            if (it && it.subjectId && it.title) {
                titleIndex[String(it.title).toLowerCase().trim()] = {
                    sid: String(it.subjectId),
                    st: parseInt(it.subjectType, 10) === 1 ? 1 : 2,
                    dp: String(it.detailPath || ""),
                    t: String(it.title).trim()
                };
            }
        }
    }

    function toItem(r) {
        if (!r || !r.subjectId || !r.title) return null;
        const st = parseInt(r.subjectType, 10) === 1 ? 1 : 2;
        let hindi = false;
        const dubs = r.dubs || [];
        let hiDub = null;
        for (let i = 0; i < dubs.length; i++) {
            if (dubs[i] && dubs[i].lanCode === "hi") {
                hindi = true;
                if (dubs[i].subjectId) hiDub = { sid: String(dubs[i].subjectId), dp: String(dubs[i].detailPath || "") };
                break;
            }
        }
        // carry what list results already know (title + detailPath) so
        // playback still works if the detail call 404s later (stale
        // search entries for removed titles exist in their index)
        return mkItem({
            title: String(r.title).trim() + (hindi ? "  [Hindi Dub]" : ""),
            url: JSON.stringify({ sid: String(r.subjectId), st: st, dp: String(r.detailPath || ""), t: String(r.title).trim(), dub: hiDub }),
            posterUrl: (r.cover && r.cover.url) || "",
            bannerUrl: (r.cover && r.cover.url) || "",
            type: st === 1 ? "movie" : "tv",
            year: parseInt(String(r.releaseDate || "").slice(0, 4), 10) || null,
            score: r.imdbRatingValue ? parseFloat(r.imdbRatingValue) : null
        });
    }

    // player origin (the site resolves this at runtime too)
    async function refreshPlayOrigin() {
        try {
            const j = await httpGet(API + "/media-player/get-domain");
            if (j && j.data && typeof j.data === "string") {
                playOrigin = j.data.replace(/\/+$/, "");
            }
        } catch (e) {}
        return playOrigin;
    }

    // ─────────────────────────── home ──────────────────────────────

    let homeCache = null;

    async function getHome(cb) {
        try {
            if (homeCache) return cb({ success: true, data: homeCache });
            const home = {};
            const results = await Promise.all([
                httpGet(API + "/home?host=movieboxhd.net").catch(function () { return {}; }),
                httpGet(API + "/subject/trending?tabId=" + TAB + "&page=1&perPage=18").catch(function () { return {}; })
            ]);
            const rows = ((results[0].data || {}).operatingList) || [];
            const trending = ((results[1].data || {}).subjectList) || [];
            indexItems(trending);

            const trendItems = trending.map(toItem).filter(function (x) { return !!x; });
            if (trendItems.length) home["Trending Now"] = trendItems;

            let added = 0;
            for (let i = 0; i < rows.length && added < 8; i++) {
                const row = rows[i];
                if (!row || row.type !== "SUBJECTS_MOVIE") continue;
                const subs = row.subjects || [];
                indexItems(subs);
                const items = subs.map(toItem).filter(function (x) { return !!x; });
                if (items.length) {
                    home[String(row.title || "More").trim() || "More"] = items;
                    added++;
                }
            }

            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "API_ERROR", message: "MovieBoxHD catalog unavailable" });
            }
            homeCache = home;
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

            for (let attempt = 0; attempt < GUEST_TOKENS.length; attempt++) {
                const idx = (tokenIndex + attempt) % GUEST_TOKENS.length;
                const headers = {
                    "authorization": "Bearer " + GUEST_TOKENS[idx],
                    "referer": SITE + "/search?keyword=" + encodeURIComponent(q)
                };
                const j = await httpPost(API + "/subject/search", { keyword: q, page: 1, perPage: 24 }, headers)
                    .catch(function () { return {}; });
                if (j && j.code === 0) {
                    tokenIndex = idx;
                    const items = (j.data && (j.data.items || j.data.subjectList)) || [];
                    indexItems(items);
                    return cb({ success: true, data: items.map(toItem).filter(function (x) { return !!x; }) });
                }
                if (j && j.HTTP && j.HTTP !== 400 && j.HTTP !== 401) break;
            }

            // tokenless fallback: session index only
            const needle = q.toLowerCase();
            const out = [];
            for (const t in titleIndex) {
                if (t.indexOf(needle) >= 0 || needle.indexOf(t) >= 0) {
                    const v = titleIndex[t];
                    out.push(mkItem({
                        title: v.t || t.replace(/\b\w/g, function (c) { return c.toUpperCase(); }),
                        url: JSON.stringify({ sid: v.sid, st: v.st, dp: v.dp || "", t: v.t || t, dub: null }),
                        type: v.st === 1 ? "movie" : "tv"
                    }));
                    if (out.length >= 24) break;
                }
            }
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────── detail + episodes ─────────────────────

    const detailCache = {};

    async function getDetail(sid, st) {
        if (detailCache[sid]) return detailCache[sid];
        const j = await httpGet(API + "/detail?subjectId=" + sid + "&subjectType=" + (st || 2))
            .catch(function () { return {}; });
        const d = (j && j.data) || null;
        if (d && d.subject && d.subject.subjectId) {
            detailCache[sid] = d;
            return d;
        }
        return null;
    }

    async function load(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.sid) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized MovieBoxHD url" });

            const d = await getDetail(p.sid, p.st);
            const subj = (d && d.subject) || {};
            const title = String(subj.title || p.t || "Title").trim();
            const poster = (subj.cover && subj.cover.url) || "";
            const resource = (d && d.resource) || {};
            const seasons = (resource.seasons || []).filter(function (s) { return s && typeof s.se !== "undefined"; });

            let hindiDub = p.dub || null;
            if (!hindiDub) {
                const dubs = subj.dubs || [];
                for (let i = 0; i < dubs.length; i++) {
                    if (dubs[i] && dubs[i].lanCode === "hi" && dubs[i].subjectId) {
                        hindiDub = { sid: String(dubs[i].subjectId), dp: String(dubs[i].detailPath || "") };
                        break;
                    }
                }
            }
            // detail 404 (e.g. stale entry): still light up with what we carry
            const dp = String(subj.detailPath || p.dp || "");

            const episodes = [];
            function epUrl(se, ep) {
                return JSON.stringify({ sid: String(p.sid), st: p.st, dp: dp, se: se, ep: ep, dub: hindiDub });
            }

            const isMovie = !seasons.length || (seasons.length === 1 && parseInt(seasons[0].maxEp, 10) === 0);
            if (isMovie) {
                // the site plays films with se=0&ep=0 — keep that exact shape
                episodes.push(mkEpisode({
                    name: "Full Movie",
                    url: epUrl(0, 0),
                    season: 1,
                    episode: 1,
                    posterUrl: poster,
                    description: title + (resource.source ? "  ·  source: " + resource.source : "")
                }));
            } else {
                for (let si = 0; si < seasons.length; si++) {
                    const se = parseInt(seasons[si].se, 10) || (si + 1);
                    let eps = [];
                    const allEp = String(seasons[si].allEp || "").trim();
                    if (allEp) {
                        eps = allEp.split(",").map(function (n) { return parseInt(n, 10); }).filter(function (n) { return n > 0; });
                    } else {
                        const total = parseInt(seasons[si].maxEp, 10) || 0;
                        for (let e = 1; e <= total; e++) eps.push(e);
                    }
                    for (let ei = 0; ei < eps.length; ei++) {
                        const e = eps[ei];
                        episodes.push(mkEpisode({
                            name: "S" + se + " E" + (e < 10 ? "0" + e : e),
                            url: epUrl(se, e),
                            season: se,
                            episode: e,
                            posterUrl: poster,
                            description: title + " — Season " + se + ", Episode " + e + (hindiDub ? "  ·  Hindi dub available" : "")
                        }));
                    }
                }
                if (!episodes.length) {
                    episodes.push(mkEpisode({
                        name: "S1 E01",
                        url: epUrl(1, 1),
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
                    type: (parseInt(p.st, 10) === 1 || isMovie) ? "movie" : "tv",
                    year: parseInt(String(subj.releaseDate || "").slice(0, 4), 10) || null,
                    description: String(subj.description || "").slice(0, 700),
                    score: subj.imdbRatingValue ? parseFloat(subj.imdbRatingValue) : null,
                    duration: parseInt(subj.duration, 10) || null,
                    tags: String(subj.genre || "").split(",").map(function (g) { return g.trim(); }).filter(function (g) { return g; }).slice(0, 4),
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "DETAIL_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────────── streams ───────────────────────────

    function qRank(s) { const m = String(s || "").match(/(\d{3,4})/); return m ? parseInt(m[1], 10) : 0; }

    // One play call per audio track (main + hindi dub when present),
    // best link only each. Referer = the site's real player page on the
    // media-player domain (this is what their own player sends).
    async function playCall(sid, dp, se, ep) {
        if (!sid || !dp) return [];
        const origin = await refreshPlayOrigin();
        let qs = "subjectId=" + encodeURIComponent(sid) +
            "&se=" + encodeURIComponent(se == null ? 0 : se) +
            "&ep=" + encodeURIComponent(ep == null ? 0 : ep) +
            "&detailPath=" + encodeURIComponent(dp) +
            "&streamSignType=1&supportCodecs%5Bh264%5D=1";
        const headers = { "referer": origin + "/spa/videoPlayPage/movies/" + dp + "?lang=en&type=/movie/detail" };
        const j = await httpGet(API + "/subject/play?" + qs, headers).catch(function () { return {}; });
        const streams = ((j && j.data && j.data.streams) || []).filter(function (s) {
            return s && s.url && !s.vipLocked;
        });
        streams.sort(function (a, b) { return qRank(b.resolutions) - qRank(a.resolutions); });
        return streams.slice(0, 1);
    }

    async function loadStreams(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            if (!p || !p.sid) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized episode url" });

            let dp = p.dp;
            if (!dp) {
                const d = await getDetail(p.sid, p.st);
                dp = (d && d.subject && d.subject.detailPath) || "";
            }
            if (!dp) return cb({ success: false, errorCode: "NO_STREAMS", message: "MovieBoxHD source is not responding right now — please try again in a moment." });

            const main = playCall(p.sid, dp, p.se, p.ep).catch(function () { return []; });
            const dub = (p.dub && p.dub.sid)
                ? playCall(p.dub.sid, p.dub.dp || dp, p.se, p.ep).catch(function () { return []; })
                : Promise.resolve([]);
            const both = await Promise.all([main, dub]);

            const streams = [];
            const seen = {};
            for (let i = 0; i < both[0].length; i++) {
                const s = both[0][i];
                if (seen[s.url]) continue;
                seen[s.url] = 1;
                streams.push(mkStream({
                    url: s.url,
                    source: "MovieBoxHD - " + (s.resolutions ? s.resolutions + "p" : "Stream"),
                    headers: { "User-Agent": UA },
                    isDirect: true
                }));
            }
            for (let i = 0; i < both[1].length; i++) {
                const s = both[1][i];
                if (seen[s.url]) continue;
                seen[s.url] = 1;
                streams.push(mkStream({
                    url: s.url,
                    source: "MovieBoxHD Hindi Dub - " + (s.resolutions ? s.resolutions + "p" : "Stream"),
                    headers: { "User-Agent": UA },
                    isDirect: true
                }));
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
