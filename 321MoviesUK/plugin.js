// SkyStream provider for 321movies.co.uk. Written against the site's current
// TMDB-backed catalogue and its /api/player/vixsrc-playlist endpoint.
(function () {
    "use strict";

    const SITE = String((typeof manifest !== "undefined" && manifest.baseUrl) || "https://321movies.co.uk").replace(/\/+$/, "");
    const TMDB = "https://api.themoviedb.org/3";
    const IMAGE = "https://image.tmdb.org/t/p/";
    // Public read token shipped in the website's browser bundle (not a user credential).
    const READ_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiYmYxODFkOTRiMzk2MTg1ZDBhYmQ5NzA5M2ZkNDhlMCIsIm5iZiI6MTY5MjUzNzk2MS45MTgwMDAyLCJzdWIiOiI2NGUyMTQ2OTM3MTA5NzAxMWM1NDk3YjgiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.t4GsujVl9LceOrnPmx-WDdncTSAx60QBLAoaiuTCvXI";
    // Public URL-obfuscation key used by the site's player; it is not DRM.
    const PLAYER_KEY = "j7wYkYhVgQn5x2L6k2M8hVQfD4zN3bP1aR7uT0cXyE6dZX4sWAd87JKMN8HHGG654GVCFRLMNBOPUY7LK";
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    const BASE_HEADERS = { "User-Agent": UA, "Accept-Encoding": "identity" };
    const PLAY_HEADERS = { "User-Agent": UA, "Referer": SITE + "/" };
    const PROBE_HEADERS = { "User-Agent": UA, "Accept-Encoding": "identity", "Range": "bytes=0-4095" };

    async function request(url, headers, timeoutMs) {
        let timer;
        try {
            const response = await Promise.race([
                http_get(url, headers || BASE_HEADERS),
                new Promise(function (_, reject) {
                    timer = setTimeout(function () { reject(new Error("Request timed out")); }, timeoutMs || 12000);
                })
            ]);
            return { status: Number(response && (response.status || response.statusCode)) || 0,
                body: String((response && response.body) || ""), headers: (response && response.headers) || {} };
        } catch (_) {
            return { status: 0, body: "", headers: {} };
        } finally {
            clearTimeout(timer);
        }
    }

    function json(body) { try { return JSON.parse(body); } catch (_) { return null; } }

    async function metadata(path) {
        const sep = path.indexOf("?") < 0 ? "?" : "&";
        const response = await request(TMDB + path + sep + "language=en-US", {
            "Authorization": "Bearer " + READ_TOKEN,
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "User-Agent": UA
        }, 12000);
        return response.status === 200 ? json(response.body) : null;
    }

    function picture(path, width) {
        return path && typeof path === "string" ? IMAGE + width + path : "";
    }

    function item(record, forcedType) {
        if (!record || !record.id) return null;
        const type = forcedType || record.media_type || (record.first_air_date ? "tv" : "movie");
        if (type !== "tv" && type !== "movie") return null;
        const title = record.title || record.name;
        if (!title || record.adult) return null;
        const poster = picture(record.poster_path || record.backdrop_path, "w500");
        const out = {
            title: String(title),
            url: SITE + "/" + type + "/" + record.id,
            posterUrl: poster,
            bannerUrl: picture(record.backdrop_path, "original") || poster,
            type: type === "tv" ? "series" : "movie"
        };
        const date = record.release_date || record.first_air_date || "";
        if (/^\d{4}/.test(date)) out.year = Number(date.slice(0, 4));
        if (record.overview) out.description = String(record.overview);
        if (Number(record.vote_average) > 0) out.score = Number(record.vote_average);
        return new MultimediaItem(out);
    }

    function items(records, type) {
        return (Array.isArray(records) ? records : []).map(function (r) { return item(r, type); }).filter(Boolean);
    }

    function reference(value) {
        const str = String(value || "");
        const match = /\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/.exec(str);
        if (match) return { type: match[1], id: match[2], season: Number(match[3]) || 1, episode: Number(match[4]) || 1 };
        return null;
    }

    function fail(cb, code, message) { cb({ success: false, errorCode: code, message: message }); }

    async function getHome(cb) {
        const sections = [
            ["Trending", "/trending/movie/day", "movie"],
            ["Popular Movies", "/movie/popular", "movie"],
            ["Popular TV", "/tv/popular", "tv"],
            ["Trending TV", "/trending/tv/week", "tv"],
            ["Top Rated Movies", "/movie/top_rated", "movie"]
        ];
        try {
            const results = await Promise.all(sections.map(function (section) { return metadata(section[1] + "?page=1"); }));
            const home = {};
            for (let i = 0; i < sections.length; i++) {
                const row = items(results[i] && results[i].results, sections[i][2]);
                if (row.length) home[sections[i][0]] = row;
            }
            if (!Object.keys(home).length) return fail(cb, "CATALOG_OFFLINE", "321Movies UK catalogue could not be reached.");
            cb({ success: true, data: home });
        } catch (error) { fail(cb, "HOME_ERROR", String(error)); }
    }

    async function search(query, cb) {
        const text = String(query || "").trim();
        if (!text) return cb({ success: true, data: [] });
        try {
            const result = await metadata("/search/multi?query=" + encodeURIComponent(text) + "&include_adult=false&page=1");
            if (!result) return fail(cb, "SEARCH_OFFLINE", "Could not search the 321Movies UK catalogue.");
            cb({ success: true, data: items(result.results) });
        } catch (error) { fail(cb, "SEARCH_ERROR", String(error)); }
    }

    async function load(url, cb) {
        const ref = reference(url);
        if (!ref) return fail(cb, "BAD_URL", "Unknown 321Movies UK title.");
        try {
            const details = await metadata("/" + ref.type + "/" + ref.id);
            if (!details || !details.id) return fail(cb, "DETAIL_OFFLINE", "Title details are unavailable.");
            const media = item(details, ref.type);
            if (!media) return fail(cb, "DETAIL_ERROR", "Title details are incomplete.");
            const episodes = [];
            if (ref.type === "movie") {
                episodes.push(new Episode({ name: "Full Movie", url: media.url, season: 1, episode: 1 }));
                if (Number(details.runtime) > 0) media.duration = Number(details.runtime);
            } else {
                const seasons = (details.seasons || []).filter(function (s) { return s.season_number > 0 && s.episode_count > 0; });
                // Small concurrent groups avoid exhausting the app's HTTP bridge.
                for (let start = 0; start < seasons.length; start += 4) {
                    const batch = seasons.slice(start, start + 4);
                    const pages = await Promise.all(batch.map(function (s) {
                        return metadata("/tv/" + ref.id + "/season/" + s.season_number);
                    }));
                    for (let i = 0; i < batch.length; i++) {
                        for (const ep of ((pages[i] && pages[i].episodes) || [])) {
                            if (!ep.episode_number) continue;
                            episodes.push(new Episode({
                                name: "S" + batch[i].season_number + "E" + String(ep.episode_number).padStart(2, "0") + " · " + (ep.name || "Episode"),
                                url: SITE + "/tv/" + ref.id + "/" + batch[i].season_number + "/" + ep.episode_number,
                                season: batch[i].season_number,
                                episode: ep.episode_number,
                                posterUrl: picture(ep.still_path, "w500") || media.posterUrl,
                                airDate: ep.air_date || undefined
                            }));
                        }
                    }
                }
            }
            media.episodes = episodes;
            media.syncData = { tmdb: ref.id };
            cb({ success: true, data: media });
        } catch (error) { fail(cb, "DETAIL_ERROR", String(error)); }
    }

    function decodeFile(file) {
        if (typeof file !== "string") return "";
        if (file.slice(0, 4) !== "enc:") return file;
        try {
            let encoded = file.slice(4).replace(/-/g, "+").replace(/_/g, "/");
            while (encoded.length % 4) encoded += "=";
            const bytes = atob(encoded);
            if (bytes.length < 9) return "";
            let url = "";
            for (let i = 8; i < bytes.length; i++) {
                const salt = bytes.charCodeAt((i - 8) % 8);
                url += String.fromCharCode(bytes.charCodeAt(i) ^ PLAYER_KEY.charCodeAt((i - 8 + salt) % PLAYER_KEY.length));
            }
            return url;
        } catch (_) { return ""; }
    }

    function classify(response) {
        if (response.status !== 200 && response.status !== 206) return null;
        const body = response.body || "";
        if (!body) return null;
        const head = body.replace(/^\uFEFF/, "").trimStart();
        if (/^[\[{<]/.test(head) || /^\s*(?:forbidden|expired|unauthorized|error)/i.test(head)) return null;
        if (head.slice(0, 7) === "#EXTM3U") return { kind: "hls", body: head };
        const contentType = String(response.headers["content-type"] || response.headers["Content-Type"] || "").toLowerCase();
        if (body.slice(4, 8) === "ftyp" || contentType.indexOf("video/") === 0) return { kind: "video", body: "" };
        // The Flutter HTTP bridge decodes binary as text, so signed MKV/MP4
        // files may lose their magic bytes. An unrecognised binary 206 is okay.
        if (response.status === 206 && !/^[\x20-\x7e\r\n\t]+$/.test(body.slice(0, 80))) return { kind: "video", body: "" };
        return null;
    }

    function quality(manifestBody) {
        let height = 0;
        const pattern = /RESOLUTION=\d+x(\d{3,4})|NAME="(\d{3,4})p"/g;
        let match;
        while ((match = pattern.exec(manifestBody)) !== null) {
            height = Math.max(height, Number(match[1] || match[2]));
        }
        return height >= 2000 ? "4K" : height >= 1400 ? "1440p" : height >= 1000 ? "1080p" : height >= 700 ? "720p" : height >= 450 ? "480p" : "Auto";
    }

    function candidates(playlists) {
        const all = [];
        const seen = new Set();
        const familyIndex = {};
        const ranks = { "sourcepack-vuflix": 0, "sourcepack-streamaggregator": 1, "sourcepack-movy": 2, "sourcepack-vidgod": 3 };
        for (const group of (Array.isArray(playlists) ? playlists : [])) {
            for (const source of ((group && group.sources) || [])) {
                const url = decodeFile(source.file);
                if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
                seen.add(url);
                const family = String(source.provider || "Other");
                const nth = familyIndex[family] || 0;
                familyIndex[family] = nth + 1;
                all.push({ url: url, family: family, nth: nth,
                    rank: Object.prototype.hasOwnProperty.call(ranks, family) ? ranks[family] : 9,
                    label: String(source.label || "") });
            }
        }
        all.sort(function (a, b) { return (a.rank === 9) - (b.rank === 9) || a.nth - b.nth || a.rank - b.rank; });
        return all;
    }

    async function loadStreams(url, cb) {
        const ref = reference(url);
        if (!ref) return fail(cb, "BAD_URL", "Unknown 321Movies UK episode.");
        try {
            let query = "type=" + ref.type + "&id=" + ref.id;
            if (ref.type === "tv") query += "&season=" + ref.season + "&episode=" + ref.episode;
            const response = await request(SITE + "/api/player/vixsrc-playlist?" + query,
                { "User-Agent": UA, "Accept-Encoding": "identity", "Accept": "application/json", "Referer": SITE + "/" }, 18000);
            if (response.status !== 200) return fail(cb, "PLAYER_OFFLINE", "321Movies UK player API returned HTTP " + response.status + ".");
            const payload = json(response.body);
            if (!payload || !Array.isArray(payload.playlist)) return fail(cb, "PLAYER_ERROR", "321Movies UK returned an invalid player response.");
            const options = candidates(payload.playlist).slice(0, 30);
            if (!options.length) return fail(cb, "NO_STREAMS", "This title currently has no direct sources on 321Movies UK.");
            const verified = [];
            const uncertain = [];
            for (let start = 0; start < options.length; start += 6) {
                const batch = options.slice(start, start + 6);
                const checks = await Promise.all(batch.map(function (candidate) { return request(candidate.url, PROBE_HEADERS, 6500); }));
                for (let i = 0; i < batch.length; i++) {
                    const result = classify(checks[i]);
                    if (result) {
                        const name = batch[i].family.replace(/^sourcepack-/, "");
                        const q = result.kind === "hls" ? quality(result.body) : "Auto";
                        verified.push(new StreamResult({
                            url: batch[i].url, source: name + " · " + q,
                            quality: q, headers: PLAY_HEADERS
                        }));
                    } else if (!checks[i].status && uncertain.length < 3) {
                        uncertain.push(new StreamResult({
                            url: batch[i].url,
                            source: batch[i].family.replace(/^sourcepack-/, "") + " · unverified",
                            headers: PLAY_HEADERS
                        }));
                    }
                }
                if (verified.length >= 3 || (start >= 6 && verified.length === 0 && uncertain.length >= 3)) break;
            }
            const streams = verified.slice(0, 10);
            if (streams.length < 3) streams.push.apply(streams, uncertain.slice(0, 3 - streams.length));
            if (!streams.length) return fail(cb, "NO_STREAMS", "321Movies UK supplied sources, but none were reachable on this connection.");
            cb({ success: true, data: streams });
        } catch (error) { fail(cb, "STREAM_ERROR", String(error)); }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
