(function () {
    // =====================================================================
    //  Yenime â€” SkyStream anime provider (v2)
    //
    //  Home / Search  : AniList GraphQL (https://graphql.anilist.co)
    //                   â€” the same backend yenime.net itself uses for search
    //  Details        : Flikhub (https://api.flikhub.net/anime?mal={id})
    //  Episode list   : Jikan (api.jikan.moe/v4) â€” paginated
    //  Streams        : Flikhub /megaplay?mal=&ep=&type=sub|dub
    //
    //  Stream notes:
    //   * StreamResult uses a `source` field (label) â€” NOT `quality`.
    //   * The video CDN requires a `Referer` header on EVERY request
    //     (playlist + segments), so the direct m3u8 is routed through the
    //     app's "MAGIC_PROXY_v1" local proxy which injects headers into
    //     every segment request. A direct link is also offered as fallback.
    // =====================================================================

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

    const BASE = (typeof manifest !== "undefined" && manifest && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, "")
        : "https://yenime.net";

    const ANILIST = "https://graphql.anilist.co";
    const JIKAN   = "https://api.jikan.moe/v4";
    const FLIKHUB = "https://api.flikhub.net";
    const REFERER = "https://megaplay.buzz/";
    const SUB_PROXY = "https://api.yenime.net/api/subtitle-proxy?url=";

    // The subtitle CDN (1oe.lostproject.club) returns 403 without a Referer
    // header. SkyStream fetches subtitle URLs directly (no headers), so we
    // route them through yenime's own subtitle proxy which fetches server-side
    // with the correct referer and serves plain VTT.
    function proxySubtitle(url) {
        return SUB_PROXY + encodeURIComponent(url);
    }

    function subLang(label) {
        const s = String(label || "").toLowerCase();
        if (s.indexOf("portug") !== -1) return "pt";
        if (s.indexOf("span") !== -1) return "es";
        if (s.indexOf("french") !== -1) return "fr";
        if (s.indexOf("german") !== -1) return "de";
        if (s.indexOf("arab") !== -1) return "ar";
        if (s.indexOf("russ") !== -1) return "ru";
        if (s.indexOf("japan") !== -1) return "ja";
        return "en";
    }

    const AL_FIELDS = "id idMal title{english romaji native} coverImage{extraLarge large} format status episodes seasonYear averageScore bannerImage description";

    // ------------------------------------------------------------------
    //  HTTP helpers (engine bridge first, plain fetch fallback for tests)
    // ------------------------------------------------------------------
    function sleep(ms) {
        return new Promise(function (resolve) {
            if (typeof setTimeout === "function") { setTimeout(resolve, ms); }
            else { resolve(); }
        });
    }

    async function httpGetText(url, headers) {
        headers = headers || {};
        if (!headers["User-Agent"]) headers["User-Agent"] = UA;
        if (typeof http_get === "function") {
            try {
                const res = await http_get(url, headers);
                if (res && typeof res === "object" && res.body) return String(res.body);
                if (typeof res === "string") return res;
            } catch (e) { /* fall through */ }
        }
        if (typeof fetch === "function") {
            try {
                const r = await fetch(url, { headers: headers });
                if (r && typeof r.text === "function") {
                    const text = await r.text();
                    if (text) return text;
                }
            } catch (e) { /* ignore */ }
        }
        return "";
    }

    async function httpPostText(url, headers, body) {
        headers = headers || {};
        if (!headers["User-Agent"]) headers["User-Agent"] = UA;
        if (typeof http_post === "function") {
            try {
                const res = await http_post(url, headers, body);
                if (res && typeof res === "object" && res.body) return String(res.body);
                if (typeof res === "string") return res;
            } catch (e) { /* fall through */ }
        }
        if (typeof fetch === "function") {
            try {
                const r = await fetch(url, { method: "POST", headers: headers, body: body });
                if (r && typeof r.text === "function") return await r.text();
            } catch (e) { /* ignore */ }
        }
        return "";
    }

    async function httpJson(url, retries) {
        retries = retries || 0;
        let lastErr = "empty response";
        for (let i = 0; i <= retries; i++) {
            try {
                const text = await httpGetText(url, null);
                if (text) return JSON.parse(text);
                lastErr = "empty response";
            } catch (e) {
                lastErr = (e && e.message) ? e.message : String(e);
            }
            if (i < retries) await sleep(800 * (i + 1));
        }
        throw new Error(lastErr || ("fetch failed: " + url));
    }

    async function postJson(url, payload) {
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": UA
        };
        const text = await httpPostText(url, headers, JSON.stringify(payload));
        if (!text) throw new Error("empty response from " + url);
        return JSON.parse(text);
    }

    // Jikan returns error JSON like {"status":504,...} â€” treat as failure.
    async function jikanGet(path, retries) {
        const json = await httpJson(JIKAN + path, retries);
        if (json && json.status && json.data === undefined) {
            throw new Error((json.message || "Jikan error") + " (status " + json.status + ")");
        }
        return json;
    }

    // ------------------------------------------------------------------
    //  Mapping helpers
    // ------------------------------------------------------------------
    function stripTags(s) {
        return String(s || "")
            .replace(/<br\s*\/?>/gi, " ")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#039;/gi, "'")
            .replace(/\s+/g, " ")
            .trim();
    }

    function mapStatus(s) {
        s = String(s || "").toLowerCase();
        if (s.indexOf("not yet") !== -1) return "upcoming";
        if (s.indexOf("finished") !== -1 || s.indexOf("completed") !== -1) return "completed";
        if (s.indexOf("airing") !== -1) return "ongoing";
        return "completed";
    }

    function alStatus(s) {
        s = String(s || "").toUpperCase();
        if (s === "RELEASING") return "ongoing";
        if (s === "NOT_YET_RELEASED") return "upcoming";
        return "completed";
    }

    function extractMalId(url) {
        const m = String(url || "").match(/anime\/(\d+)/);
        return m ? m[1] : null;
    }

    function alToItem(m) {
        if (!m || !m.idMal) return null;
        const t = m.title || {};
        const cover = m.coverImage || {};
        return new MultimediaItem({
            url: BASE + "/anime/" + m.idMal,
            title: (t.english || t.romaji || t.native || "Unknown").trim(),
            posterUrl: cover.extraLarge || cover.large || "",
            bannerUrl: m.bannerImage || "",
            type: (m.format === "MOVIE") ? "movie" : "anime",
            year: m.seasonYear || 0,
            score: m.averageScore ? Math.round(m.averageScore) / 10 : 0,
            status: alStatus(m.status),
            description: stripTags(m.description).slice(0, 800)
        });
    }

    function jikanToItem(a) {
        if (!a || !a.mal_id) return null;
        let poster = "";
        if (a.images && a.images.jpg) poster = a.images.jpg.large_image_url || a.images.jpg.image_url || "";
        return new MultimediaItem({
            url: BASE + "/anime/" + a.mal_id,
            title: (a.title_english || a.title || "Unknown").trim(),
            posterUrl: poster,
            type: (a.type === "Movie") ? "movie" : "anime",
            year: a.year || 0,
            score: a.score || 0,
            status: mapStatus(a.status),
            description: a.synopsis || ""
        });
    }

    // ------------------------------------------------------------------
    //  1. getHome â€” dashboard rows (Trending = hero carousel)
    // ------------------------------------------------------------------
    async function getHome(cb) {
        const home = {};

        // Primary: AniList GraphQL (single request, no rate-limit pain)
        try {
            const q = "query{" +
                "trending:Page(page:1,perPage:25){media(type:ANIME,sort:TRENDING_DESC,isAdult:false){" + AL_FIELDS + "}}" +
                "airing:Page(page:1,perPage:25){media(type:ANIME,status:RELEASING,sort:POPULARITY_DESC,isAdult:false){" + AL_FIELDS + "}}" +
                "upcoming:Page(page:1,perPage:25){media(type:ANIME,status:NOT_YET_RELEASED,sort:POPULARITY_DESC,isAdult:false){" + AL_FIELDS + "}}" +
                "popular:Page(page:1,perPage:25){media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){" + AL_FIELDS + "}}" +
                "movies:Page(page:1,perPage:25){media(type:ANIME,format:MOVIE,sort:POPULARITY_DESC,isAdult:false){" + AL_FIELDS + "}}}";

            const data = await postJson(ANILIST, { query: q });
            const d = (data && data.data) ? data.data : {};
            const rows = [
                ["Trending", d.trending],
                ["Airing This Season", d.airing],
                ["Popular", d.popular],
                ["Upcoming", d.upcoming],
                ["Popular Movies", d.movies]
            ];
            for (const r of rows) {
                const items = ((r[1] && r[1].media) || []).map(alToItem).filter(Boolean);
                if (items.length) home[r[0]] = items;
            }
        } catch (e) {
            // Fallback: Jikan (sequential to respect rate limits)
            try {
                const t = await jikanGet("/top/anime?limit=25", 1);
                const items = ((t && t.data) || []).map(jikanToItem).filter(Boolean);
                if (items.length) home["Trending"] = items;
            } catch (e2) { /* ignore */ }
            await sleep(400);
            try {
                const n = await jikanGet("/seasons/now?limit=25", 1);
                const items = ((n && n.data) || []).map(jikanToItem).filter(Boolean);
                if (items.length) home["Airing This Season"] = items;
            } catch (e2) { /* ignore */ }
        }

        cb({ success: true, data: home });
    }

    // ------------------------------------------------------------------
    //  2. search
    // ------------------------------------------------------------------
    async function search(query, cb) {
        if (!query) return cb({ success: true, data: [] });

        // Primary: AniList GraphQL search
        try {
            const payload = {
                query: "query($search:String){Page(page:1,perPage:25){media(type:ANIME,search:$search,isAdult:false,sort:SEARCH_MATCH){" + AL_FIELDS + "}}}",
                variables: { search: query }
            };
            const data = await postJson(ANILIST, payload);
            const media = ((data && data.data && data.data.Page && data.data.Page.media) || []);
            const items = media.map(alToItem).filter(Boolean);
            return cb({ success: true, data: items });
        } catch (e) {
            // Fallback: Jikan search
            try {
                const json = await jikanGet("/anime?q=" + encodeURIComponent(query) + "&sfw=true&order_by=members&sort=desc&limit=25", 2);
                const items = ((json && json.data) || []).map(jikanToItem).filter(Boolean);
                return cb({ success: true, data: items });
            } catch (e2) {
                return cb({
                    success: false,
                    errorCode: "SITE_OFFLINE",
                    message: "Search failed: " + (e.message || e2.message)
                });
            }
        }
    }

    // ------------------------------------------------------------------
    //  3. load â€” details + episode list
    // ------------------------------------------------------------------
    async function load(url, cb) {
        const malId = extractMalId(url);
        if (!malId) {
            return cb({ success: false, errorCode: "NOT_FOUND", message: "Invalid anime URL" });
        }

        let title = "", poster = "", synopsis = "", year = 0, score = 0, status = "";
        let totalEpisodes = 0;
        let hasSub = true, hasDub = false;

        // 3a. Flikhub: metadata + sub/dub availability
        try {
            const fh = await httpJson(FLIKHUB + "/anime?mal=" + malId, 1);
            const meta = (fh && fh.mal) ? fh.mal : {};
            title = meta.titleEnglish || meta.title || "";
            poster = meta.image || "";
            synopsis = meta.synopsis || "";
            year = meta.year || 0;
            score = meta.score || 0;
            status = meta.status || "";
            totalEpisodes = meta.episodes || 0;

            const ep1 = (fh && Array.isArray(fh.episodes) && fh.episodes[0]) ? fh.episodes[0] : null;
            const types = (fh && fh.firstEpisodeSources && Array.isArray(fh.firstEpisodeSources.types))
                ? fh.firstEpisodeSources.types : [];
            hasDub = types.indexOf("dub") !== -1 || (ep1 && ep1.hasDub);
            hasSub = types.some(function (t) { return t.indexOf("sub") !== -1; }) || (ep1 && ep1.hasSub);
        } catch (e) { /* Jikan fallback below */ }

        // 3b. Jikan fallback for missing metadata
        if (!title || !poster || !synopsis || !totalEpisodes) {
            try {
                const jk = await jikanGet("/anime/" + malId, 1);
                const d = (jk && jk.data) ? jk.data : {};
                if (!title) title = d.title_english || d.title || "Anime";
                if (!poster && d.images && d.images.jpg) poster = d.images.jpg.large_image_url || d.images.jpg.image_url || "";
                if (!synopsis) synopsis = d.synopsis || "";
                if (!year) year = d.year || 0;
                if (!score) score = d.score || 0;
                if (!status) status = d.status || "";
                if (!totalEpisodes) totalEpisodes = d.episodes || 0;
            } catch (e) { /* ignore */ }
        }

        if (!title) {
            return cb({ success: false, errorCode: "NOT_FOUND", message: "Anime not found (id " + malId + ")" });
        }

        const flags = ((hasSub ? "s" : "") + (hasDub ? "d" : "")) || "s";
        const eps = [];
        let page = 1, guard = 0;
        while (guard < 10) {
            guard++;
            let data = null, hasNext = false;
            try {
                const je = await jikanGet("/anime/" + malId + "/episodes?page=" + page, 1);
                data = (je && je.data) || [];
                hasNext = !!(je && je.pagination && je.pagination.has_next_page);
            } catch (e) {
                data = null;
            }
            if (data === null) break;
            for (const ep of data) {
                const n = ep.episode || ep.mal_id || eps.length + 1;
                eps.push(new Episode({
                    name: "Episode " + n + (ep.title ? " â€” " + ep.title : ""),
                    url: malId + "|" + n + "|" + flags,
                    season: 1,
                    episode: n,
                    dubStatus: (hasDub ? "dubbed" : "subbed")
                }));
            }
            if (!hasNext) break;
            page++;
        }

        // 3c. Episode fallbacks (Jikan throttled, or movies/specials)
        if (!eps.length && totalEpisodes > 1) {
            for (let n = 1; n <= totalEpisodes && n <= 1000; n++) {
                eps.push(new Episode({
                    name: "Episode " + n,
                    url: malId + "|" + n + "|" + flags,
                    season: 1,
                    episode: n,
                    dubStatus: (hasDub ? "dubbed" : "subbed")
                }));
            }
        }
        if (!eps.length) {
            eps.push(new Episode({
                name: "Full Movie",
                url: malId + "|1|" + flags,
                season: 1,
                episode: 1,
                dubStatus: (hasDub ? "dubbed" : "subbed")
            }));
        }

        const item = new MultimediaItem({
            url: url,
            title: title,
            posterUrl: poster,
            type: "anime",
            description: synopsis,
            year: year,
            score: score,
            status: mapStatus(status),
            syncData: { mal: String(malId) }
        });
        item.episodes = eps;

        cb({ success: true, data: item });
    }

    // ------------------------------------------------------------------
    //  4. loadStreams â€” playable HLS links (SUB / DUB) with proper labels
    // ------------------------------------------------------------------
    async function loadStreams(url, cb) {
        let malId = "", ep = 1, flags = "s";

        const m = String(url || "").match(/(\d+)\|(\d+)(?:\|([sd]*))?/);
        if (m) {
            malId = m[1];
            ep = parseInt(m[2], 10) || 1;
            flags = m[3] || "s";
        } else {
            const mid = extractMalId(url);
            if (mid) { malId = mid; ep = 1; flags = "s"; }
            else { return cb({ success: true, data: [] }); }
        }

        const types = [];
        if (flags.indexOf("d") !== -1) types.push("dub");
        if (flags.indexOf("s") !== -1) types.push("sub");
        if (!types.length) types.push("sub");

        const streams = [];
        for (const t of types) {
            try {
                const r = await httpJson(
                    FLIKHUB + "/megaplay?mal=" + malId + "&ep=" + ep + "&type=" + t,
                    1
                );
                if (!r) continue;

                const isSub = t === "sub";
                const label = isSub ? "SUB â€” Japanese" : "DUB â€” English";
                const subs = (r.tracks || []).map(function (tr) {
                    return {
                        url: proxySubtitle(tr.file),
                        label: tr.label || "",
                        lang: subLang(tr.label)
                    };
                });
                const headers = {
                    "Referer": REFERER,
                    "Origin": "https://megaplay.buzz",
                    "User-Agent": UA
                };

                if (r.m3u8) {
                    // Primary: route through the app's local proxy so the
                    // Referer is injected into every playlist/segment request
                    // (the CDN returns a Cloudflare challenge otherwise).
                    streams.push(new StreamResult({
                        url: "MAGIC_PROXY_v1" + btoa(r.m3u8),
                        source: label,
                        headers: headers,
                        subtitles: subs
                    }));
                    // Fallback: direct link (works when the player sends headers)
                    streams.push(new StreamResult({
                        url: r.m3u8,
                        source: label + " (Direct)",
                        headers: headers,
                        subtitles: subs
                    }));
                }
            } catch (e) { /* skip this type */ }
        }

        cb({ success: true, data: streams });
    }

    // ------------------------------------------------------------------
    //  Export to SkyStream
    // ------------------------------------------------------------------
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
