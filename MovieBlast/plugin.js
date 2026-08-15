// ===========================================================================
//  MOVIEBLAST — SkyStream provider  v1
//  https://app.cloud-mb.xyz — Hindi/Tamil/Telugu/English movies & series.
//  TMDB catalog (trending / search / seasons & episodes) + MovieBlast's
//  app API (search -> media detail / series show -> HMAC-signed CDN links).
//  Ported from the Hindi-Nuvio scraper (D3adlyRocket/Hindi-Nuvio).
// ===========================================================================
(function () {
    "use strict";

    var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
    var TMDB_BASE = "https://api.themoviedb.org/3";
    var IMG = "https://image.tmdb.org/t/p/";

    var BASE_URL = String(
        (typeof manifest !== "undefined" && manifest && manifest.baseUrl) || "https://app.cloud-mb.xyz"
    ).replace(/\/+$/, "");

    var TOKEN = "jdvhhjv255vghhghdhvfch2565656jhdcghfdf";
    var APP_ID = "com.movieblast";
    var SIGN_SECRET = "GJ8reydarI7Jqat9rvbAJKNQ9gY4DoEQF2H5nfuI1gi";

    var HEADERS = {
        "user-agent": "okhttp/5.0.0-alpha.6",
        "x-request-x": APP_ID
    };
    var SEARCH_HEADERS = {
        "user-agent": "okhttp/5.0.0-alpha.6",
        "x-request-x": APP_ID,
        "hash256": "86dc03244adddb3cbedbf0ae36074a736ee293a64774b18e82a6244eafd0df30",
        "packagename": APP_ID
    };
    var STREAM_HEADERS = {
        "User-Agent": "MovieBlast",
        "Referer": "MovieBlast",
        "x-request-x": APP_ID
    };

    // ------------------------------------------------------------------
    //  Pure-JS SHA-256 + HMAC-SHA256 + Base64  (CDN URL signing)
    // ------------------------------------------------------------------

    function sha256(bytes) {
        // bytes: array of byte values
        var K = [
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
        ];
        var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
        var len = bytes.length;
        var bitLen = len * 8;
        var msg = bytes.slice();
        msg.push(0x80);
        while (msg.length % 64 !== 56) msg.push(0);
        // 64-bit big-endian length (low 32 bits are enough for URLs)
        for (var li = 0; li < 8; li++) msg.push(0);
        var hi = Math.floor(bitLen / 0x100000000);
        var lo = bitLen >>> 0;
        msg[msg.length - 8] = (hi >>> 24) & 0xff;
        msg[msg.length - 7] = (hi >>> 16) & 0xff;
        msg[msg.length - 6] = (hi >>> 8) & 0xff;
        msg[msg.length - 5] = hi & 0xff;
        msg[msg.length - 4] = (lo >>> 24) & 0xff;
        msg[msg.length - 3] = (lo >>> 16) & 0xff;
        msg[msg.length - 2] = (lo >>> 8) & 0xff;
        msg[msg.length - 1] = lo & 0xff;

        function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
        for (var off = 0; off < msg.length; off += 64) {
            var w = new Array(64);
            for (var i = 0; i < 16; i++) {
                w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
            }
            for (i = 16; i < 64; i++) {
                var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
            }
            var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
            for (i = 0; i < 64; i++) {
                var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                var ch = (e & f) ^ (~e & g);
                var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
                var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                var maj = (a & b) ^ (a & c) ^ (b & c);
                var t2 = (S0 + maj) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0;
                d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
            H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
        }
        var out = [];
        for (i = 0; i < 8; i++) {
            out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff);
        }
        return out;
    }

    function hmacSha256(keyStr, messageStr) {
        var blockSize = 64;
        var keyBytes = [];
        for (var i = 0; i < keyStr.length; i++) keyBytes.push(keyStr.charCodeAt(i) & 0xff);
        if (keyBytes.length > blockSize) keyBytes = sha256(keyBytes);
        while (keyBytes.length < blockSize) keyBytes.push(0);
        var oPad = [], iPad = [];
        for (i = 0; i < blockSize; i++) {
            oPad.push(keyBytes[i] ^ 0x5c);
            iPad.push(keyBytes[i] ^ 0x36);
        }
        var msgBytes = [];
        for (i = 0; i < messageStr.length; i++) msgBytes.push(messageStr.charCodeAt(i) & 0xff);
        return sha256(oPad.concat(sha256(iPad.concat(msgBytes))));
    }

    function bytesToBase64(bytes) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var out = "";
        for (var i = 0; i < bytes.length; i += 3) {
            var b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
            out += chars[b0 >> 2];
            out += chars[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
            out += b1 === undefined ? "=" : chars[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
            out += b2 === undefined ? "=" : chars[b2 & 63];
        }
        return out;
    }

    function generateSignedUrl(urlStr) {
        try {
            var path = String(urlStr).split("?")[0].replace(/^https?:\/\/[^/]+/, "");
            var timestamp = Math.floor(Date.now() / 1000).toString();
            var sig = bytesToBase64(hmacSha256(SIGN_SECRET, path + timestamp));
            return urlStr + "?verify=" + timestamp + "-" + encodeURIComponent(sig);
        } catch (e) {
            return urlStr;
        }
    }

    // ------------------------------------------------------------------
    //  HTTP + TMDB helpers
    // ------------------------------------------------------------------

    function fetchText(url, options, timeoutMs) {
        var ms = timeoutMs || 20000;
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () {
                if (!settled) { settled = true; reject(new Error("timeout: " + url)); }
            }, ms);
            fetch(url, options).then(function (r) {
                if (settled) return "";
                return r.text();
            }).then(function (t) {
                if (!settled) { settled = true; clearTimeout(timer); resolve(t); }
            }).catch(function (e) {
                if (!settled) { settled = true; clearTimeout(timer); reject(e); }
            });
        });
    }

    function fetchJson(url, headers) {
        return fetch(url, { headers: headers || { "Accept": "application/json" } })
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
                return r.json();
            });
    }

    function tmdbJson(path) {
        var sep = path.indexOf("?") >= 0 ? "&" : "?";
        return fetchJson(TMDB_BASE + path + sep + "api_key=" + TMDB_API_KEY + "&language=en-US&include_adult=false",
            { "Accept": "application/json", "User-Agent": "Mozilla/5.0" });
    }

    function img(path, size) { return path ? IMG + (size || "w500") + path : ""; }

    function parseInternal(url) {
        var params = {};
        var m = String(url).match(/^mb:\/\/watch\?([^#]+)/);
        if (!m) return params;
        m[1].split("&").forEach(function (kv) {
            var p = kv.split("=");
            params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
        });
        return params;
    }

    function tmdbStatus(mediaType, status) {
        if (mediaType === "tv") {
            if (/Returning|In Production/i.test(status || "")) return "ongoing";
            if (/Ended|Canceled/i.test(status || "")) return "completed";
            return "upcoming";
        }
        return (status === "Released") ? "completed" : "upcoming";
    }

    function makeItem(m, mediaType) {
        return new MultimediaItem({
            url: "mb://watch?type=" + mediaType + "&id=" + m.id,
            title: (m.title || m.name || "Unknown").trim(),
            posterUrl: img(m.poster_path, "w500"),
            bannerUrl: img(m.backdrop_path, "w1280"),
            type: mediaType === "tv" ? "series" : "movie",
            year: parseInt(((m.release_date || m.first_air_date || "") + "").slice(0, 4)) || 0,
            score: m.vote_average || 0,
            description: m.overview || "",
            status: tmdbStatus(mediaType, ""),
            isAdult: !!m.adult
        });
    }

    // ------------------------------------------------------------------
    //  getHome
    // ------------------------------------------------------------------

    async function getHome(cb) {
        try {
            var home = {};
            var sections = [
                { title: "Trending Movies", path: "/trending/movie/week", t: "movie" },
                { title: "Trending TV Shows", path: "/trending/tv/week", t: "tv" },
                { title: "Now Playing", path: "/movie/now_playing", t: "movie" },
                { title: "Top Rated Movies", path: "/movie/top_rated", t: "movie" }
            ];
            for (var i = 0; i < sections.length; i++) {
                try {
                    var json = await tmdbJson(sections[i].path);
                    var items = (json.results || []).map(function (m) { return makeItem(m, sections[i].t); });
                    if (items.length) home[sections[i].title] = items;
                } catch (e) { /* skip broken section */ }
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: "getHome failed: " + (e.message || e) });
        }
    }

    // ------------------------------------------------------------------
    //  search
    // ------------------------------------------------------------------

    async function search(query, cb) {
        try {
            var json = await tmdbJson("/search/multi?query=" + encodeURIComponent(query));
            var results = (json.results || [])
                .filter(function (r) { return r.media_type === "movie" || r.media_type === "tv"; })
                .map(function (r) { return makeItem(r, r.media_type); });
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: "search failed: " + (e.message || e) });
        }
    }

    // ------------------------------------------------------------------
    //  load
    // ------------------------------------------------------------------

    async function load(url, cb) {
        try {
            var p = parseInternal(url);
            var mediaType = p.type === "tv" ? "tv" : "movie";
            var id = p.id;
            if (!id) return cb({ success: false, errorCode: "NOT_FOUND", message: "Bad url: " + url });

            var json = await tmdbJson("/" + (mediaType === "tv" ? "tv" : "movie") + "/" + id + "?append_to_response=external_ids");
            var item = new MultimediaItem({
                url: url,
                title: (json.title || json.name || "Unknown").trim(),
                posterUrl: img(json.poster_path, "w500"),
                bannerUrl: img(json.backdrop_path, "w1280"),
                type: mediaType === "tv" ? "series" : "movie",
                year: parseInt(((json.release_date || json.first_air_date || "") + "").slice(0, 4)) || 0,
                score: json.vote_average || 0,
                duration: (json.runtime || (json.episode_run_time && json.episode_run_time[0])) || 0,
                status: tmdbStatus(mediaType, json.status),
                description: json.overview || "",
                contentRating: json.adult ? "18+" : "PG-13",
                isAdult: !!json.adult,
                logoUrl: img(json.poster_path, "w185"),
                syncData: { tmdb: String(json.id), imdb: (json.external_ids && json.external_ids.imdb_id) || undefined }
            });

            if (mediaType === "movie") {
                item.episodes = [
                    new Episode({
                        name: "Full Movie",
                        url: "mb://watch?type=movie&id=" + id,
                        season: 1,
                        episode: 1,
                        posterUrl: item.posterUrl,
                        rating: item.score,
                        runtime: item.duration,
                        airDate: json.release_date || undefined
                    })
                ];
            } else {
                var episodes = [];
                var seasons = (json.seasons || []).filter(function (s) { return s.season_number > 0; });
                for (var i = 0; i < seasons.length; i++) {
                    var sn = seasons[i].season_number;
                    try {
                        var sj = await tmdbJson("/tv/" + id + "/season/" + sn);
                        (sj.episodes || []).forEach(function (ep) {
                            if (ep.episode_number <= 0) return;
                            episodes.push(new Episode({
                                name: "S" + String(sn).padStart(2, "0") + "E" + String(ep.episode_number).padStart(2, "0") + (ep.name ? " — " + ep.name : ""),
                                url: "mb://watch?type=tv&id=" + id + "&s=" + sn + "&e=" + ep.episode_number,
                                season: sn,
                                episode: ep.episode_number,
                                rating: ep.vote_average || 0,
                                runtime: ep.runtime || (json.episode_run_time && json.episode_run_time[0]) || 0,
                                airDate: ep.air_date || undefined,
                                posterUrl: img(ep.still_path, "w500")
                            }));
                        });
                    } catch (e) { /* skip season */ }
                }
                if (!episodes.length) {
                    return cb({ success: false, errorCode: "NOT_FOUND", message: "No episodes found for this series." });
                }
                item.episodes = episodes;
            }

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: "load failed: " + (e.message || e) });
        }
    }

    // ------------------------------------------------------------------
    //  loadStreams — MovieBlast API resolver (from Hindi-Nuvio)
    // ------------------------------------------------------------------

    function normalizeTitle(title) {
        if (!title) return "";
        return String(title).toLowerCase()
            .replace(/\b(the|a|an)\b/g, "")
            .replace(/[:\\\-_]/g, " ")
            .replace(/\s+/g, " ")
            .replace(/[^\w\s]/g, "")
            .trim();
    }

    function calculateTitleSimilarity(title1, title2) {
        var norm1 = normalizeTitle(title1);
        var norm2 = normalizeTitle(title2);
        if (norm1 === norm2) return 1;
        var words1 = norm1.split(/\s+/).filter(function (w) { return w.length > 0; });
        var words2 = norm2.split(/\s+/).filter(function (w) { return w.length > 0; });
        if (!words1.length || !words2.length) return 0;
        var set1 = new Set(words1);
        var set2 = new Set(words2);
        var intersection = words1.filter(function (w) { return set2.has(w); });
        var union = new Set(words1.concat(words2));
        var jaccard = intersection.length / union.size;
        var extra = words2.filter(function (w) { return !set1.has(w); }).length;
        var score = jaccard - extra * 0.05;
        if (words1.every(function (w) { return set2.has(w); })) score += 0.2;
        return score;
    }

    function findBestMatch(mediaInfo, searchResults) {
        if (!searchResults || !searchResults.length) return null;
        var best = null, bestScore = 0;
        for (var i = 0; i < searchResults.length; i++) {
            var r = searchResults[i];
            var score = calculateTitleSimilarity(mediaInfo.title, r.name || "");
            var rYear = r.release_date ? parseInt(String(r.release_date).slice(0, 4)) : null;
            if (mediaInfo.year && rYear) {
                var diff = Math.abs(mediaInfo.year - rYear);
                if (diff === 0) score += 0.2;
                else if (diff <= 1) score += 0.1;
                else if (diff > 5) score -= 0.3;
            }
            if (score > bestScore && score > 0.3) { bestScore = score; best = r; }
        }
        return best;
    }

    function matchQuality(server) {
        var v = String(server || "").toLowerCase();
        if (v.indexOf("2160") >= 0 || v.indexOf("4k") >= 0) return "4K";
        if (v.indexOf("1440") >= 0) return "2K";
        if (v.indexOf("1080") >= 0) return "1080p";
        if (v.indexOf("720") >= 0) return "720p";
        if (v.indexOf("480") >= 0) return "480p";
        if (v.indexOf("360") >= 0) return "360p";
        return "Unknown";
    }

    async function loadStreams(url, cb) {
        try {
            var p = parseInternal(url);
            var mediaType = p.type === "tv" ? "tv" : "movie";
            var tmdbId = p.id;
            var season = parseInt(p.s, 10) || null;
            var episode = parseInt(p.e, 10) || null;
            if (!tmdbId) return cb({ success: false, errorCode: "NOT_FOUND", message: "Bad url: " + url });

            var tjson = await tmdbJson("/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId);
            var mediaInfo = {
                title: tjson.title || tjson.name,
                year: parseInt(String(tjson.release_date || tjson.first_air_date || "").slice(0, 4)) || null
            };
            if (!mediaInfo.title) return cb({ success: true, data: [] });

            // 1) search the MovieBlast API
            var searchUrl = BASE_URL + "/api/search/" + encodeURIComponent(mediaInfo.title) + "/" + TOKEN;
            var searchData = await fetchJson(searchUrl, SEARCH_HEADERS);
            var match = findBestMatch(mediaInfo, searchData.search || []);
            if (!match) return cb({ success: true, data: [] });

            // 2) details -> videos
            var isSeries = /serie/i.test(match.type || "") || mediaType === "tv";
            var detailPath = isSeries ? "series/show" : "media/detail";
            var detailUrl = BASE_URL + "/api/" + detailPath + "/" + match.id + "/" + TOKEN;
            var detail = await fetchJson(detailUrl, HEADERS);

            var targetVideos = [];
            if (isSeries) {
                var targetSeason = (detail.seasons || []).find(function (s) { return s.season_number == season; });
                if (targetSeason) {
                    var targetEpisode = (targetSeason.episodes || []).find(function (e) { return e.episode_number == episode; });
                    if (targetEpisode) targetVideos = targetEpisode.videos || [];
                }
            } else {
                targetVideos = detail.videos || [];
            }

            var streams = targetVideos.map(function (vid) {
                var rawUrl = vid.link;
                if (!rawUrl) return null;
                var httpsUrl = rawUrl.indexOf("http") === 0 ? rawUrl : "https://" + rawUrl;
                return new StreamResult({
                    url: generateSignedUrl(httpsUrl),
                    quality: matchQuality(vid.server),
                    headers: STREAM_HEADERS
                });
            }).filter(function (s) { return s !== null; });

            // sort: highest resolution first
            streams.sort(function (a, b) {
                var pa = parseInt(String(a.quality || "").match(/\d+/) || [0]);
                var pb = parseInt(String(b.quality || "").match(/\d+/) || [0]);
                return pb - pa;
            });

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: "loadStreams failed: " + (e.message || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
