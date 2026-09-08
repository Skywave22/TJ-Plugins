(function() {
    "use strict";

    // ═══════════════════════════════════════════════════════════
    //  MovieBox (movie-box.co) — SkyStream plugin
    //
    //  Nuxt/SSR catalog (Netflix rows, Nollywood, anime, series,
    //  movies) over the wefeed H5 BFF:
    //
    //    api : https://h5-api.aoneroom.com/wefeed-h5api-bff
    //      GET  /home?host=movie-box.co          (platformList + operatingList rows)
    //      GET  /subject/trending?page=&perPage=18
    //      GET  /detail?subjectId=&subjectType=  (subject + resource.seasons)
    //      GET  /subject/detail-rec?subjectId=&page=1&perPage=12
    //      POST /subject/search {keyword,page,perPage}   (needs Bearer guest JWT)
    //      GET  /subject/play?subjectId=&detailPath=&streamSignType=1
    //           &supportCodecs[h264]=1[&se=&ep=]          (needs Referer!)
    //
    //  Auth: every request carries authorization:"" + x-vip-restrict:1
    //    + x-no-high-risk-restrict:0 + x-source:"" + x-request-lang:en.
    //    Search additionally requires `Authorization: Bearer <guestJWT>`.
    //    Guest JWTs are minted by their web app (90-day exp, HS256,
    //    server-verified) — three baked in below, rotated on failure.
    //    Play/detail/home are TOKENLESS but the play call REQUIRES a
    //    Referer header containing the detailPath
    //    (https://movie-box.co/movies/<detailPath>).
    //
    //  Play semantics: TV  -> se=<S>&ep=<E> (S from resource.seasons)
    //                  film -> se/ep OMITTED entirely (resource maxEp=0)
    //    response: streams[] = MP4 (h264, "resolutions" field),
    //              dash[]    = HEVC DASH (skipped — engine plays MP4).
    //    File links are signed (~10min TTL) and resolve at Play time.
    //
    //  subjectType: 1 = movie, 2 = series. dubs[] on a subject lists
    //    alternate-language versions as separate subjectId+detailPath
    //    — when a Hindi dub exists its streams are appended.
    // ═══════════════════════════════════════════════════════════

    const API  = "https://h5-api.aoneroom.com/wefeed-h5api-bff";
    const SITE = "https://movie-box.co";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const GUEST_JWTS = [
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjg2OTg5NjUzNTM0ODcxMjU2MDAsImF0cCI6MywiZXh0IjoiMTc4ODg5MTUxNiIsImV4cCI6MTc5NjY2NzUxNiwiaWF0IjoxNzg4ODkxMjE2fQ.MqzgibhxR_t6GkjoK4nw73YCSgnKZ10JWkK3GvU56Wg",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjY5NzI5NjA3OTYyOTc4MTM5NjAsImF0cCI6MywiZXh0IjoiMTc4ODg5MTUyMyIsImV4cCI6MTc5NjY2NzUyMywiaWF0IjoxNzg4ODkxMjIzfQ.8ojkG29XKliyAPSbUxN0oe-v9HRdaKS467yaomncds0",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjIyMzk2Nzc1ODc5MzI5OTA1NDQsImF0cCI6MywiZXh0IjoiMTc4ODg5MTUzMSIsImV4cCI6MTc5NjY2NzUzMSwiaWF0IjoxNzg4ODkxMjMxfQ.FuC7LLrbhZU-LxphlyEB9DU6Ch3L50paEe14FOsXxpI",
    ];

    // search rotation state: index of the JWT to try first
    let jwtIndex = 0;

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

    function normItemUrl(sid, st) { return JSON.stringify({ sid: String(sid), st: parseInt(st, 10) === 1 ? 1 : 2 }); }

    // local title index — everything we ever see (home rows, trending,
    // search results, related) lands here so search keeps working even
    // after the guest JWTs expire (tokenless fallback).
    const titleIndex = {};
    function indexItems(list) {
        const arr = Array.isArray(list) ? list : [];
        for (let i = 0; i < arr.length; i++) {
            const it = arr[i];
            if (it && it.subjectId && it.title) {
                titleIndex[String(it.title).toLowerCase().trim()] = {
                    sid: String(it.subjectId),
                    st: parseInt(it.subjectType, 10) === 1 ? 1 : 2
                };
            }
        }
    }

    function toItem(r) {
        if (!r || !r.subjectId || !r.title) return null;
        const st = parseInt(r.subjectType, 10) === 1 ? 1 : 2;
        let hindi = false;
        const dubs = r.dubs || [];
        for (let i = 0; i < dubs.length; i++) {
            if (dubs[i] && dubs[i].lanCode === "hi") { hindi = true; break; }
        }
        return mkItem({
            title: String(r.title).trim() + (hindi ? "  [Hindi Dub]" : ""),
            url: normItemUrl(r.subjectId, st),
            posterUrl: (r.cover && r.cover.url) || "",
            bannerUrl: (r.cover && r.cover.url) || "",
            type: st === 1 ? "movie" : "tv",
            year: parseInt(String(r.releaseDate || "").slice(0, 4), 10) || null,
            score: r.imdbRatingValue ? parseFloat(r.imdbRatingValue) : null
        });
    }

    // ─────────────────────────── home ──────────────────────────────

    let homeCache = null;

    async function getHome(cb) {
        try {
            if (homeCache) return cb({ success: true, data: homeCache });
            const home = {};
            const results = await Promise.all([
                httpGet(API + "/home?host=movie-box.co").catch(function () { return {}; }),
                httpGet(API + "/subject/trending?page=0&perPage=18").catch(function () { return {}; })
            ]);
            const ops = ((results[0].data || {}).operatingList) || [];
            const trending = ((results[1].data || {}).subjectList) || [];
            indexItems(trending);

            const trendItems = trending.map(toItem).filter(function (x) { return !!x; });
            if (trendItems.length) home["Trending Now"] = trendItems;

            let rowCount = 0;
            for (let i = 0; i < ops.length && rowCount < 8; i++) {
                const row = ops[i];
                if (!row || row.type !== "SUBJECTS_MOVIE") continue;
                const subs = row.subjects || [];
                indexItems(subs);
                const items = subs.map(toItem).filter(function (x) { return !!x; });
                if (items.length) {
                    home[String(row.title || "More").trim() || "More"] = items;
                    rowCount++;
                }
            }

            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "API_ERROR", message: "MovieBox catalog unavailable" });
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

            // 1) real search with baked guest JWTs (rotate on auth failure)
            for (let attempt = 0; attempt < GUEST_JWTS.length; attempt++) {
                const idx = (jwtIndex + attempt) % GUEST_JWTS.length;
                const headers = { "authorization": "Bearer " + GUEST_JWTS[idx], "referer": SITE + "/search?keyword=" + encodeURIComponent(q) };
                const j = await httpPost(API + "/subject/search", { keyword: q, page: 1, perPage: 24 }, headers).catch(function () { return {}; });
                if (j && j.code === 0) {
                    jwtIndex = idx;
                    const items = (j.data && (j.data.items || j.data.subjectList)) || [];
                    indexItems(items);
                    const mapped = items.map(toItem).filter(function (x) { return !!x; });
                    return cb({ success: true, data: mapped });
                }
                if (j && j.HTTP && j.HTTP !== 400 && j.HTTP !== 401) break; // non-auth hard error: stop rotating
            }

            // 2) tokenless fallback: match against everything cached this session
            const needle = q.toLowerCase();
            const out = [];
            for (const t in titleIndex) {
                if (t.indexOf(needle) >= 0 || needle.indexOf(t) >= 0) {
                    const v = titleIndex[t];
                    out.push(mkItem({
                        title: t.replace(/\b\w/g, function (c) { return c.toUpperCase(); }),
                        url: normItemUrl(v.sid, v.st),
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
        const j = await httpGet(API + "/detail?subjectId=" + sid + "&subjectType=" + (st || 2)).catch(function () { return {}; });
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
            if (!p || !p.sid) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized MovieBox url" });

            const d = await getDetail(p.sid, p.st);
            const subj = (d && d.subject) || {};
            const title = String(subj.title || "Title").trim();
            const poster = (subj.cover && subj.cover.url) || "";
            const resource = (d && d.resource) || {};
            const seasons = (resource.seasons || []).filter(function (s) { return s && typeof s.se !== "undefined"; });

            // hindi dub companion subject (same show, different audio track)
            let hindiDub = null;
            const dubs = subj.dubs || [];
            for (let i = 0; i < dubs.length; i++) {
                if (dubs[i] && dubs[i].lanCode === "hi" && dubs[i].subjectId) {
                    hindiDub = { sid: String(dubs[i].subjectId), dp: String(dubs[i].detailPath || "") };
                    break;
                }
            }

            const episodes = [];
            function epUrl(se, ep) {
                return JSON.stringify({ sid: String(p.sid), st: p.st, dp: String(subj.detailPath || ""), se: se, ep: ep, dub: hindiDub });
            }

            const isMovie = !seasons.length || (seasons.length === 1 && parseInt(seasons[0].maxEp, 10) === 0);
            if (isMovie) {
                episodes.push(mkEpisode({
                    name: "Full Movie",
                    url: epUrl(null, null),
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

    // One play call per variant (main / hindi dub), top-3 resolutions each.
    // Their file CDN (bcdnxw.hakunaymatata.com) rate-limits per IP —
    // fewer listed links = fewer player probes = fewer 429 windows.
    async function playCall(sid, dp, se, ep) {
        if (!sid || !dp) return [];
        let qs = "subjectId=" + encodeURIComponent(sid) +
            "&detailPath=" + encodeURIComponent(dp) +
            "&streamSignType=1&supportCodecs%5Bh264%5D=1";
        if (se != null && ep != null) qs += "&se=" + encodeURIComponent(se) + "&ep=" + encodeURIComponent(ep);
        const headers = { "referer": SITE + "/movies/" + dp };
        const j = await httpGet(API + "/subject/play?" + qs, headers).catch(function () { return {}; });
        const streams = ((j && j.data && j.data.streams) || []).filter(function (s) {
            return s && s.url && !s.vipLocked;
        });
        streams.sort(function (a, b) { return qRank(b.resolutions) - qRank(a.resolutions); });
        return streams.slice(0, 3);
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
            if (!dp) return cb({ success: false, errorCode: "NO_STREAMS", message: "MovieBox source is not responding right now — please try again in a moment." });

            const hasSeEp = (p.se != null && p.ep != null && !(parseInt(p.se, 10) === 0 && parseInt(p.ep, 10) === 0));
            const se = hasSeEp ? p.se : null;
            const ep = hasSeEp ? p.ep : null;

            const main = playCall(p.sid, dp, se, ep).catch(function () { return []; });
            const dub = (p.dub && p.dub.sid)
                ? playCall(p.dub.sid, p.dub.dp || dp, se, ep).catch(function () { return []; })
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
                    source: "MovieBox - " + (s.resolutions ? s.resolutions + "p" : "Stream"),
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
                    source: "MovieBox Hindi Dub - " + (s.resolutions ? s.resolutions + "p" : "Stream"),
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
