// ===========================================================================
//  ALLMOVIELAND — SkyStream provider  v1
//  https://allmovieland.io — multi-language movies & TV.
//  TMDB catalog (trending / search / seasons & episodes) + the site's own
//  stream resolver (search -> detail -> player domain -> p3 token ->
//  POST file tree -> POST playlist.txt -> m3u8).
//  Ported from the Hindi-Nuvio scraper (D3adlyRocket/Hindi-Nuvio).
// ===========================================================================
(function () {
    "use strict";

    var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
    var TMDB_BASE = "https://api.themoviedb.org/3";
    var IMG = "https://image.tmdb.org/t/p/";

    var MAIN_URL = String(
        (typeof manifest !== "undefined" && manifest && manifest.baseUrl) || "https://allmovieland.io"
    ).replace(/\/+$/, "");

    var HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
    };

    // ------------------------------------------------------------------
    //  Tiny helpers
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

    function fetchJson(url) {
        return fetch(url, { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } })
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
                return r.json();
            });
    }

    function tmdbJson(path) {
        var sep = path.indexOf("?") >= 0 ? "&" : "?";
        return fetchJson(TMDB_BASE + path + sep + "api_key=" + TMDB_API_KEY + "&language=en-US&include_adult=false");
    }

    function img(path, size) {
        return path ? IMG + (size || "w500") + path : "";
    }

    function parseInternal(url) {
        var params = {};
        var m = String(url).match(/^aml:\/\/watch\?([^#]+)/);
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
            url: "aml://watch?type=" + mediaType + "&id=" + m.id,
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
    //  getHome — TMDB dashboard categories
    // ------------------------------------------------------------------

    async function getHome(cb) {
        try {
            var home = {};
            var sections = [
                { title: "Trending Movies", path: "/trending/movie/week" },
                { title: "Trending TV Shows", path: "/trending/tv/week" },
                { title: "Now Playing", path: "/movie/now_playing" },
                { title: "Top Rated Movies", path: "/movie/top_rated" }
            ];
            for (var i = 0; i < sections.length; i++) {
                try {
                    var json = await tmdbJson(sections[i].path);
                    var items = (json.results || []).map(function (m) {
                        return makeItem(m, sections[i].path.indexOf("/tv") >= 0 ? "tv" : "movie");
                    });
                    if (items.length) home[sections[i].title] = items;
                } catch (e) { /* skip broken section */ }
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: "getHome failed: " + (e.message || e) });
        }
    }

    // ------------------------------------------------------------------
    //  search — TMDB multi search (movies + tv)
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
    //  load — TMDB details + episodes + trailers + recommendations
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

            // trailers (YouTube)
            try {
                var vid = await tmdbJson("/" + (mediaType === "tv" ? "tv" : "movie") + "/" + id + "/videos");
                var trailers = [];
                (vid.results || []).forEach(function (v) {
                    if (v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")) {
                        if (typeof Trailer === "function") {
                            trailers.push(new Trailer({ url: "https://www.youtube.com/watch?v=" + v.key, name: v.name }));
                        }
                    }
                });
                if (trailers.length) item.trailers = trailers;
            } catch (e) { /* optional */ }

            // recommendations
            try {
                var rec = await tmdbJson("/" + (mediaType === "tv" ? "tv" : "movie") + "/" + id + "/recommendations");
                var recs = (rec.results || []).slice(0, 10).map(function (m) { return makeItem(m, mediaType); });
                if (recs.length) item.recommendations = recs;
            } catch (e) { /* optional */ }

            if (mediaType === "movie") {
                item.episodes = [
                    new Episode({
                        name: "Full Movie",
                        url: "aml://watch?type=movie&id=" + id,
                        season: 1,
                        episode: 1,
                        posterUrl: item.posterUrl,
                        rating: item.score,
                        runtime: item.duration,
                        airDate: json.release_date || undefined
                    })
                ];
            } else {
                // TV — build the episode list across seasons
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
                                url: "aml://watch?type=tv&id=" + id + "&s=" + sn + "&e=" + ep.episode_number,
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
    //  loadStreams — ported AllMovieLand resolver (from Hindi-Nuvio)
    // ------------------------------------------------------------------

    function getTMDBDetails(tmdbId, mediaType) {
        var endpoint = mediaType === "tv" ? "tv" : "movie";
        return tmdbJson("/" + endpoint + "/" + tmdbId + "?append_to_response=external_ids")
            .then(function (data) {
                var title = mediaType === "tv" ? data.name : data.title;
                var releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
                var year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
                return { title: title, year: year, imdbId: (data.external_ids && data.external_ids.imdb_id) || null, data: data };
            });
    }

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
        var extraWordsCount = words2.filter(function (w) { return !set1.has(w); }).length;
        var score = jaccard - extraWordsCount * 0.05;
        if (words1.every(function (w) { return set2.has(w); })) score += 0.2;
        return score;
    }

    function findBestTitleMatch(mediaInfo, searchResults) {
        if (!searchResults || !searchResults.length) return null;
        var bestMatch = null, bestScore = 0;
        for (var i = 0; i < searchResults.length; i++) {
            var result = searchResults[i];
            var score = calculateTitleSimilarity(mediaInfo.title, result.title);
            if (mediaInfo.year && result.year) {
                var yearDiff = Math.abs(mediaInfo.year - result.year);
                if (yearDiff === 0) score += 0.2;
                else if (yearDiff <= 1) score += 0.1;
                else if (yearDiff > 5) score -= 0.3;
            }
            if (score > bestScore && score > 0.3) { bestScore = score; bestMatch = result; }
        }
        return bestMatch;
    }

    // Parse `article.short-mid` blocks: title + href (+ year from title).
    function parseSearchResults(html) {
        var results = [];
        var artRe = /<article[^>]*class="[^"]*short-mid[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
        var m;
        while ((m = artRe.exec(html)) !== null) {
            var block = m[1];
            var href = (block.match(/<a[^>]*href="([^"]+)"/i) || [])[1];
            var title = ((block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || "")
                .replace(/<[^>]+>/g, "").trim();
            if (!href || !title) continue;
            var yearMatch = title.match(/\((\d{4})\)/);
            results.push({ title: title, href: href, year: yearMatch ? parseInt(yearMatch[1]) : null });
        }
        return results;
    }

    // Extract script text inside div.tabs__content
    function getTabsScript(html) {
        var divRe = /<div[^>]*class="[^"]*tabs__content[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
        var dm = html.match(divRe);
        if (dm) {
            var sm = dm[1].match(/<script[^>]*>([\s\S]*?)<\/script>/i);
            if (sm) return sm[1];
        }
        return "";
    }

    // Last <script> body containing a `p3` assignment
    function getLastScriptWithP3(html) {
        var scripts = [];
        var re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        var m;
        while ((m = re.exec(html)) !== null) scripts.push(m[1]);
        for (var i = scripts.length - 1; i >= 0; i--) {
            if (scripts[i].indexOf("p3") >= 0) return scripts[i];
        }
        return "";
    }

    function postText(url, headers) {
        return fetchText(url, { method: "POST", headers: headers });
    }

    async function loadStreams(url, cb) {
        try {
            var p = parseInternal(url);
            var mediaType = p.type === "tv" ? "tv" : "movie";
            var tmdbId = p.id;
            var season = parseInt(p.s, 10) || null;
            var episode = parseInt(p.e, 10) || null;
            if (!tmdbId) return cb({ success: false, errorCode: "NOT_FOUND", message: "Bad url: " + url });

            var mediaInfo = await getTMDBDetails(tmdbId, mediaType);
            var query = mediaInfo.title;
            var searchUrl = MAIN_URL + "/index.php?story=" + encodeURIComponent(query) + "&do=search&subaction=search";
            var html = await fetchText(searchUrl, { headers: HEADERS });

            var searchResults = parseSearchResults(html);
            if (!searchResults.length) {
                return cb({ success: true, data: [] });
            }

            var bestMatch = findBestTitleMatch(mediaInfo, searchResults);
            if (!bestMatch) {
                return cb({ success: true, data: [] });
            }
            var selectedMedia = bestMatch;

            // Detail page -> player domain + player id
            var docHtml = await fetchText(selectedMedia.href, { headers: HEADERS });
            var tabsContent = getTabsScript(docHtml);
            var playerDomain = (tabsContent.match(/const\s+AwsIndStreamDomain\s*=\s*'([^']+)'/i) || docHtml.match(/const\s+AwsIndStreamDomain\s*=\s*'([^']+)'/i) || [])[1];
            var playerId = (tabsContent.match(/src:\s*'([^']+)'/i) || docHtml.match(/src:\s*'([^']+)'/i) || [])[1];
            if (!playerDomain || !playerId) {
                return cb({ success: false, errorCode: "PARSE_ERROR", message: "Could not find player domain or ID." });
            }
            playerDomain = playerDomain.replace(/\/$/, "");
            var embedLink = playerDomain + "/play/" + playerId;

            // Embed -> p3 config (file endpoint + csrf key)
            var embedHeaders = Object.assign({}, HEADERS, { "Referer": selectedMedia.href });
            var embedHtml = await fetchText(embedLink, { headers: embedHeaders });
            var lastScript = getLastScriptWithP3(embedHtml);
            var p3Match = lastScript.match(/let\s+p3\s*=\s*(\{[\s\S]*\});/);
            if (!p3Match) {
                return cb({ success: false, errorCode: "PARSE_ERROR", message: "No p3 JSON found in embed." });
            }
            var json = JSON.parse(p3Match[1]);

            var fileUrl = json.file.replace(/\\\//g, "/");
            if (fileUrl.indexOf("http") !== 0) fileUrl = playerDomain + fileUrl;

            var fileHeaders = Object.assign({}, HEADERS, { "X-CSRF-TOKEN": json.key, "Referer": embedLink });
            var fileText = await postText(fileUrl, fileHeaders);
            var parsedData = JSON.parse(fileText.replace(/,\]/g, "]"));

            var targetFiles = [];
            if (mediaType === "movie") {
                targetFiles = parsedData.filter(function (s) { return s && s.file; });
            } else {
                var seasonData = parsedData.find(function (s) {
                    var sTitle = s.title || "";
                    var sNumMatch = sTitle.match(/Season\s*(\d+)/i) || sTitle.match(/(\d+)\s*Season/i);
                    var sNum = sNumMatch ? parseInt(sNumMatch[1]) : null;
                    return sNum === season || s.id == season;
                });
                if (seasonData && seasonData.folder) {
                    var episodeData = seasonData.folder.find(function (e) {
                        var eTitle = e.title || "";
                        var eNumMatch = eTitle.match(/Episode\s*(\d+)/i) || eTitle.match(/(\d+)\s*Episode/i);
                        var eNum = eNumMatch ? parseInt(eNumMatch[1]) : null;
                        return eNum === episode || e.episode == episode;
                    });
                    if (episodeData && episodeData.folder) {
                        targetFiles = episodeData.folder.filter(function (s) { return s && s.file; });
                    }
                }
            }
            if (!targetFiles.length) {
                return cb({ success: true, data: [] });
            }

            var streams = [];
            await Promise.all(targetFiles.map(function (fileObj) {
                return (async function () {
                    try {
                        var playlistFile = fileObj.file.replace(/^~/, "");
                        var playlistUrl = playerDomain + "/playlist/" + playlistFile + ".txt";
                        var postRes = await postText(playlistUrl, fileHeaders);
                        var m3u8Url = (postRes || "").trim();
                        if (m3u8Url && m3u8Url.indexOf("http") === 0) {
                            streams.push(new StreamResult({
                                url: m3u8Url,
                                quality: fileObj.title || "Unknown",
                                headers: {
                                    "Referer": playerDomain + "/",
                                    "Origin": playerDomain,
                                    "User-Agent": HEADERS["User-Agent"]
                                }
                            }));
                        }
                    } catch (e) { /* skip broken file */ }
                })();
            }));

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
