(function () {
    "use strict";

    // ═══════════════════════════════════════════════════════════════════════
    //  321Movies (321movies.xyz) — SkyStream plugin
    //
    //  CATALOG: Next.js TMDB front-end. Metadata/search come straight from
    //  TMDB using the site's public v4 read token.
    //
    //  PLAYBACK: the site's own player API
    //    GET {baseUrl}/api/player/vixsrc-playlist
    //        ?type=movie&id=<tmdbId>
    //        ?type=tv&id=<tmdbId>&season=<S>&episode=<E>
    //      -> { playlist: [ { sources: [ { type, file, label, provider,
    //                                        default } ] } ] }
    //
    //  `file` is either a plain URL or "enc:<base64url>" XOR-obfuscated.
    //  Decoder (recovered from their bundle):
    //    raw  = base64url_decode(file.slice(4))
    //    salt = raw[0..8]; body = raw[8..]
    //    out[i] = body[i] ^ KEY[(i + salt[i % 8]) % KEY.length]
    //
    //  ─────────────────────────────────────────────────────────────────────
    //  WHY THIS PLUGIN PROBES SOURCES BEFORE RETURNING THEM
    //  ─────────────────────────────────────────────────────────────────────
    //  The API returns 37–69 "sources" per title, but measurement across
    //  Fight Club / Breaking Bad / Jawan / RRR / Interstellar / Stranger
    //  Things showed only 3–8 are actually reachable, and which ones work
    //  changes per title and per session:
    //
    //    streamaggregator  14/18 live      movy   13/88      vuflix  9/29
    //    vidgod             3/17           rivestream 0/92   frame  0/18
    //    bcine/cinesrc/peestream/pstream   0/24  (all dead)
    //
    //  The dead families are all `*.piracya.workers.dev` proxies or CDNs
    //  behind Cloudflare / IP allow-lists / expiring signed links. Passing
    //  their embedded upstream headers does NOT rescue them (verified).
    //
    //  So: fire a cheap parallel Range probe at every candidate, keep only
    //  the ones that answer 200/206 with a real manifest or video body, and
    //  rank those by the resolution actually advertised in the manifest.
    //  Labels carry no quality info for the reliable providers, so reading
    //  RESOLUTION= from the master playlist is the only accurate source
    //  (e.g. "Vuflix 7" is 2160p while "Cascade 4K HDR" is dead).
    // ═══════════════════════════════════════════════════════════════════════

    // ── config ─────────────────────────────────────────────────────────────
    // manifest.baseUrl lets the user switch mirrors from plugin settings.
    const SITE = String((typeof manifest !== "undefined" && manifest && manifest.baseUrl) || "https://321movies.xyz")
        .replace(/\/+$/, "");
    const PAPI = SITE + "/api/player/vixsrc-playlist";

    const TMDB = "https://api.themoviedb.org/3";
    const IMG_W500 = "https://image.tmdb.org/t/p/w500";
    const IMG_W300 = "https://image.tmdb.org/t/p/w300";
    const IMG_ORIG = "https://image.tmdb.org/t/p/original";

    const TMDB_TOKEN = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiYmYxODFkOTRiMzk2MTg1ZDBhYmQ5NzA5M2ZkNDhlMCIsIm5iZiI6MTY5MjUzNzk2MS45MTgwMDAyLCJzdWIiOiI2NGUyMTQ2OTM3MTA5NzAxMWM1NDk3YjgiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.t4GsujVl9LceOrnPmx-WDdncTSAx60QBLAoaiuTCvXI";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // `Accept-Encoding: identity` is required on every text/JSON request.
    // Without it 321movies.xyz answers with gzip, and the bridge hands JS a
    // lossily-decoded string, so JSON.parse fails and the plugin wrongly
    // reports "no sources" for titles that do have them.
    const TMDB_HEADERS = {
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "Authorization": TMDB_TOKEN,
        "User-Agent": UA
    };

    // Probe headers. `Range` matters: some live sources are 130 MB–800 MB
    // progressive files, and an unbounded GET would pull the whole thing.
    // Servers that support ranges answer 206, servers that don't answer 200
    // with the small manifest anyway — both are treated as live.
    // 8 KB is enough to contain every RESOLUTION=/NAME="720p" variant line.
    const PROBE_HEADERS = {
        "User-Agent": UA,
        "Range": "bytes=0-8191",
        "Accept": "*/*",
        "Accept-Encoding": "identity"
    };

    // The app's HTTP bridge caps response bodies and its http_parallel waits
    // for every request. One slow/Cloudflare source can stall a whole batch;
    // probe a bounded, interleaved sample with independent deadlines instead.
    const MAX_PROBE = 48;
    const MAX_STREAMS = 12; // cap what we hand the player
    const PROBE_MS = 7000; // independent deadline per candidate
    const MIN_GOOD_STREAMS = 3;
    const REQ_MS = 20000;

    // Providers that were never reachable in testing. Still probed, but
    // tried last so the cap above keeps the families that actually work.
    const WEAK_PROVIDERS = {
        "sourcepack-rivestream": 1, "sourcepack-frame": 1, "sourcepack-bcine": 1,
        "sourcepack-cinesrc": 1, "sourcepack-peestream": 1, "sourcepack-pstream": 1
    };

    // ── generic helpers ────────────────────────────────────────────────────

    function mkItem(o) { try { return new MultimediaItem(o); } catch (e) { return o; } }
    function mkEpisode(o) { try { return new Episode(o); } catch (e) { return o; } }
    function mkStream(o) { try { return new StreamResult(o); } catch (e) { return o; } }

    function withTimeout(promise, ms) {
        let timer;
        return Promise.race([
            Promise.resolve(promise),
            new Promise(function (_, rej) {
                timer = setTimeout(function () { rej(new Error("timeout")); }, ms);
            })
        ]).then(function (value) {
            clearTimeout(timer);
            return value;
        }, function (error) {
            clearTimeout(timer);
            throw error;
        });
    }

    // http_get resolves rather than rejects on 4xx/5xx in some runtimes and
    // rejects in others; normalise to a {status, body} object either way.
    async function safeGet(url, headers, ms) {
        try {
            const r = await withTimeout(http_get(url, headers), ms || REQ_MS);
            return { status: (r && (r.status || r.statusCode)) || 0, body: (r && r.body) || "" };
        } catch (e) {
            return { status: 0, body: "" };
        }
    }

    function parseJson(text) {
        try { return JSON.parse(text || "") || {}; } catch (e) { return {}; }
    }

    async function tmdb(path) {
        const r = await safeGet(TMDB + path, TMDB_HEADERS);
        return parseJson(r.body);
    }

    // ── enc: url decoder ───────────────────────────────────────────────────

    const CODEC_KEY = "j7wYkYhVgQn5x2L6k2M8hVQfD4zN3bP1aR7uT0cXyE6dZX4sWAd87JKMN8HHGG654GVCFRLMNBOPUY7LK";

    function b64urlToBytes(s) {
        let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
        while (t.length % 4) t += "=";
        try {
            const bin = atob(t);
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
            return out;
        } catch (e) {
            return null;
        }
    }

    // Rebuild UTF-8 from raw bytes by hand. The old implementation used
    // `decodeURIComponent(escape(s))`, but `escape` is a legacy Annex-B
    // function that is not guaranteed to exist in the QuickJS runtime.
    function bytesToUtf8(bytes) {
        let s = "";
        let i = 0;
        while (i < bytes.length) {
            const b = bytes[i++];
            let cp;
            if (b < 0x80) { cp = b; }
            else if (b >= 0xc0 && b < 0xe0 && i < bytes.length) { cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f); }
            else if (b >= 0xe0 && b < 0xf0 && i + 1 < bytes.length) { cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f); }
            else if (b >= 0xf0 && i + 2 < bytes.length) { cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f); }
            else { cp = 0xfffd; }
            if (cp < 0x10000) { s += String.fromCharCode(cp); }
            else {
                cp -= 0x10000;
                s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
            }
        }
        return s;
    }

    function decodeStreamUrl(v) {
        const raw0 = String(v || "");
        if (raw0.indexOf("enc:") !== 0) return raw0;
        const raw = b64urlToBytes(raw0.slice(4));
        if (!raw || raw.length <= 8) return "";
        const salt = raw.slice(0, 8);
        const body = raw.slice(8);
        const key = new Uint8Array(CODEC_KEY.length);
        for (let i = 0; i < CODEC_KEY.length; i++) key[i] = CODEC_KEY.charCodeAt(i) & 255;
        const out = new Uint8Array(body.length);
        for (let i = 0; i < body.length; i++) {
            out[i] = body[i] ^ key[(i + salt[i % salt.length]) % key.length];
        }
        return bytesToUtf8(out);
    }

    // ── url payload ────────────────────────────────────────────────────────
    //
    // SkyStream passes one opaque string between search -> load -> loadStreams.
    //   {"mt":"movie","id":"550"}
    //   {"mt":"tv","id":"1396","s":1,"e":1}
    //
    function encodeUrl(o) {
        try { return JSON.stringify(o); } catch (e) { return ""; }
    }

    function decodeUrl(url) {
        if (!url) return null;
        // Tolerate a real site URL too, in case one leaks in from elsewhere.
        let p = null;
        try { p = JSON.parse(url); } catch (e) { p = null; }
        if (p && p.id && p.mt) {
            return { isTv: p.mt === "tv", id: String(p.id), s: parseInt(p.s, 10) || 1, e: parseInt(p.e, 10) || 1 };
        }
        const m = String(url).match(/(?:type|mt)=(tv|movie)[^0-9]*(\d+)/);
        if (m) {
            const sm = String(url).match(/season=(\d+)/);
            const em = String(url).match(/episode=(\d+)/);
            return {
                isTv: m[1] === "tv", id: m[2],
                s: sm ? parseInt(sm[1], 10) : 1,
                e: em ? parseInt(em[1], 10) : 1
            };
        }
        return null;
    }

    // ── TMDB -> MultimediaItem ─────────────────────────────────────────────
    //
    // `type` must be one of movie|series|anime|livestream|other.
    // The previous build emitted "tv", which is not a valid MultimediaType.

    function yearOf(r) {
        const d = (r && (r.release_date || r.first_air_date)) || "";
        const y = parseInt(String(d).slice(0, 4), 10);
        return y > 1800 ? y : undefined;
    }

    function num(v) {
        const n = parseFloat(v);
        return isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : undefined;
    }

    function toItem(r) {
        if (!r || !r.id) return null;
        const isTv = (r.media_type || (r.first_air_date ? "tv" : "movie")) === "tv";
        const name = r.title || r.name || "";
        if (!name) return null;
        const poster = r.poster_path ? IMG_W500 + r.poster_path
            : (r.backdrop_path ? IMG_W500 + r.backdrop_path : "");
        const o = {
            title: String(name).trim(),
            url: encodeUrl({ mt: isTv ? "tv" : "movie", id: String(r.id) }),
            posterUrl: poster,
            bannerUrl: r.backdrop_path ? IMG_ORIG + r.backdrop_path : poster,
            type: isTv ? "series" : "movie"
        };
        const y = yearOf(r); if (y) o.year = y;
        const s = num(r.vote_average); if (s) o.score = s;
        return mkItem(o);
    }

    function mapResults(list) {
        const out = [];
        const src = list || [];
        for (let i = 0; i < src.length; i++) {
            const it = toItem(src[i]);
            if (it) out.push(it);
        }
        return out;
    }

    // ── getHome ────────────────────────────────────────────────────────────

    async function getHome(cb) {
        try {
            const rows = [
                { name: "Trending", p: "/trending/all/day" },
                { name: "Popular Movies", p: "/movie/popular" },
                { name: "Popular TV", p: "/tv/popular" },
                { name: "Top Rated Movies", p: "/movie/top_rated" },
                { name: "Top Rated TV", p: "/tv/top_rated" },
                { name: "Now Playing", p: "/movie/now_playing" },
                { name: "On The Air", p: "/tv/on_the_air" }
            ];
            const settled = [];
            for (let i = 0; i < rows.length; i++) settled.push(null);
            await Promise.all(rows.map(function (row, i) {
                return tmdb(row.p + "?page=1").then(function (j) { settled[i] = j; }).catch(function () { settled[i] = {}; });
            }));

            const home = {};
            let total = 0;
            for (let i = 0; i < rows.length; i++) {
                const items = mapResults(settled[i] && settled[i].results);
                if (items.length) { home[rows[i].name] = items; total += items.length; }
            }
            if (!total) {
                return cb({
                    success: false,
                    errorCode: "API_ERROR",
                    message: "Could not reach the 321Movies catalog (TMDB). Check your connection and try again."
                });
            }
            return cb({ success: true, data: home });
        } catch (e) {
            return cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ── search ─────────────────────────────────────────────────────────────

    async function search(query, cb) {
        try {
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });
            const j = await tmdb("/search/multi?query=" + encodeURIComponent(q) + "&include_adult=false&page=1");
            const items = mapResults(j && j.results);
            if (!items.length) {
                return cb({ success: false, errorCode: "NO_RESULTS", message: "No results for \"" + q + "\"" });
            }
            return cb({ success: true, data: items });
        } catch (e) {
            return cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ── load ───────────────────────────────────────────────────────────────

    async function load(url, cb) {
        try {
            const p = decodeUrl(url);
            if (!p) {
                return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized 321Movies url" });
            }
            const d = await tmdb("/" + (p.isTv ? "tv" : "movie") + "/" + encodeURIComponent(p.id));
            if (!d || !d.id) {
                return cb({ success: false, errorCode: "DETAIL_ERROR", message: "Title not found on 321Movies" });
            }

            const title = String(d.title || d.name || "Title").trim();
            const poster = d.poster_path ? IMG_W500 + d.poster_path
                : (d.backdrop_path ? IMG_W500 + d.backdrop_path : "");
            const banner = d.backdrop_path ? IMG_ORIG + d.backdrop_path : poster;
            const episodes = [];

            if (!p.isTv) {
                episodes.push(mkEpisode({
                    name: "Full Movie",
                    url: encodeUrl({ mt: "movie", id: String(p.id) }),
                    season: 1,
                    episode: 1,
                    posterUrl: banner || poster,
                    description: String(d.overview || title).slice(0, 300)
                }));
            } else {
                const seasons = [];
                const raw = d.seasons || [];
                for (let i = 0; i < raw.length; i++) {
                    const s = raw[i] || {};
                    if (parseInt(s.season_number, 10) > 0 && parseInt(s.episode_count, 10) > 0) seasons.push(s);
                }
                const perSeason = [];
                await Promise.all(seasons.map(function (s, i) {
                    return tmdb("/tv/" + encodeURIComponent(p.id) + "/season/" + s.season_number)
                        .then(function (j) { perSeason[i] = j; })
                        .catch(function () { perSeason[i] = {}; });
                }));
                for (let si = 0; si < seasons.length; si++) {
                    const sn = parseInt(seasons[si].season_number, 10) || (si + 1);
                    const eps = (perSeason[si] && perSeason[si].episodes) || [];
                    for (let ei = 0; ei < eps.length; ei++) {
                        const e = eps[ei] || {};
                        const en = parseInt(e.episode_number, 10) || (ei + 1);
                        const eName = String(e.name || ("Episode " + en)).trim();
                        const eo = {
                            name: "S" + sn + "E" + (en < 10 ? "0" + en : en) + " · " + eName,
                            url: encodeUrl({ mt: "tv", id: String(p.id), s: sn, e: en }),
                            season: sn,
                            episode: en,
                            posterUrl: e.still_path ? IMG_W300 + e.still_path : poster
                        };
                        const ov = String(e.overview || "").slice(0, 300);
                        if (ov) eo.description = ov;
                        const rt = parseInt(e.runtime, 10);
                        if (rt > 0) eo.runtime = rt;
                        if (e.air_date) eo.airDate = String(e.air_date).slice(0, 10);
                        episodes.push(mkEpisode(eo));
                    }
                }
                if (!episodes.length) {
                    episodes.push(mkEpisode({
                        name: "S01E01",
                        url: encodeUrl({ mt: "tv", id: String(p.id), s: 1, e: 1 }),
                        season: 1,
                        episode: 1,
                        posterUrl: poster,
                        description: title
                    }));
                }
            }

            const o = {
                title: title,
                url: encodeUrl({ mt: p.isTv ? "tv" : "movie", id: String(p.id) }),
                posterUrl: poster,
                bannerUrl: banner,
                type: p.isTv ? "series" : "movie",
                episodes: episodes
            };
            const y = yearOf(d); if (y) o.year = y;
            const desc = String(d.overview || "").slice(0, 700); if (desc) o.description = desc;
            const sc = num(d.vote_average); if (sc) o.score = sc;
            if (!p.isTv) {
                const rt = parseInt(d.runtime, 10);
                if (rt > 0) o.duration = rt;
            } else if (d.status) {
                const st = String(d.status).toLowerCase();
                o.status = (st === "ended" || st === "canceled") ? "completed"
                    : (st === "returning series" ? "ongoing" : "upcoming");
            }
            const tags = [];
            const genres = d.genres || [];
            for (let i = 0; i < genres.length && tags.length < 5; i++) {
                if (genres[i] && genres[i].name) tags.push(genres[i].name);
            }
            if (tags.length) o.tags = tags;
            if (d.id) o.syncData = { tmdb: String(d.id) };

            return cb({ success: true, data: mkItem(o) });
        } catch (e) {
            return cb({ success: false, errorCode: "DETAIL_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ── loadStreams ────────────────────────────────────────────────────────

    function isLive(status) { return status === 200 || status === 206; }

    // Classify a probe response.
    //
    // Accept only things that are positively identifiable as media. Text bodies
    // are trustworthy, but binary bodies are not: the bridge hands JS a
    // *string*, so raw bytes arrive lossily decoded. That matters for the two
    // signatures below. A 206 can be a partial JSON/HTML error, so reject
    // text responses before accepting an unidentified partial video body.
    // Everything else on a 200 must match a known manifest/magic signature.
    // A permissive "not markup => media" fallback was tried and it let through
    // gzip-compressed JSON error bodies (e.g. {"error":"Missing playback
    // token."} from vuflix.co / chillflix.lol), which decode to mojibake that
    // starts with neither < nor { and so looked like media.
    function classify(body, status) {
        if (!isLive(status)) return { live: false };
        const b = String(body || "");
        if (!b) return { live: false };

        // gzip/deflate payload we failed to suppress -> unreadable, and in
        // practice always an error body (e.g. {"error":"Missing playback
        // token."} from the vuflix.co / chillflix.lol token APIs).
        const c0 = b.charCodeAt(0), c1 = b.charCodeAt(1);
        if (c0 === 0x1f && (c1 === 0x8b || c1 === 0x9e)) return { live: false };

        // Reject any JSON or markup, including errors served with status 206.
        // Some hosts use keys other than "error" (e.g. "detail") and even
        // honour Range requests against their error pages.
        const lead = b.replace(/^\uFEFF/, "").trimStart();
        if (/^[\[{<]/.test(lead)) return { live: false };

        // HLS playlist (even if preceded by whitespace or a UTF-8 BOM).
        if (lead.indexOf("#EXTM3U") === 0) return { live: true, kind: "hls" };

        // ISO-BMFF (mp4/m4s): 4-byte size then "ftyp".
        if (b.length > 8 && b.substr(4, 4) === "ftyp") return { live: true, kind: "mp4" };
        // EBML / Matroska / WebM magic 0x1A45DFA3.
        if (c0 === 0x1a && b.charCodeAt(1) === 0x45 &&
            b.charCodeAt(2) === 0xdf && b.charCodeAt(3) === 0xa3) return { live: true, kind: "video" };
        // Raw MPEG-TS segment: 0x47 sync byte every 188 bytes.
        if (c0 === 0x47 && b.length > 188 && b.charCodeAt(188) === 0x47) return { live: true, kind: "video" };

        // Some hosts return a partial plain-text error ("expired", "forbidden")
        // instead of JSON. Text without a recognized playlist signature is not video.
        if (/^[\x20-\x7e\r\n\t]+$/.test(b.slice(0, 96))) return { live: false };

        // Accept remaining non-text partial content as a byte-serving file.
        if (status === 206) return { live: true, kind: "video" };

        return { live: false };
    }

    function maxResolution(body) {
        const b = String(body || "");
        let best = 0;
        let m;
        // Standard variant attribute: RESOLUTION=1920x800
        const re1 = /RESOLUTION=\d+x(\d+)/g;
        while ((m = re1.exec(b)) !== null) {
            const h = parseInt(m[1], 10);
            if (h > best) best = h;
        }
        // Some hosts declare it as a variant NAME instead, e.g.
        //   #EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=3500000,NAME="720p"
        const re2 = /NAME="(\d{3,4})p"/g;
        while ((m = re2.exec(b)) !== null) {
            const h = parseInt(m[1], 10);
            if (h > best) best = h;
        }
        // Deliberately no URL-based fallback: paths like /08/00013/ carry
        // plain ids that masquerade as resolutions and mislabel the source.
        // Never trust an absurd value.
        return (best > 0 && best <= 4320) ? best : 0;
    }

    function labelQuality(label) {
        const m = /(\d{3,4})\s*p/i.exec(String(label || ""));
        return m ? parseInt(m[1], 10) : 0;
    }

    function audioLanguages(body) {
        const b = String(body || "");
        const out = [];
        const re = /TYPE=AUDIO[^>]*?NAME="([^"]+)"/g;
        let m;
        while ((m = re.exec(b)) !== null && out.length < 6) {
            const n = String(m[1]).trim();
            if (n && !/^track\s*\d+$/i.test(n)) out.push(n);
        }
        return out;
    }

    function qualityLabel(h, kind) {
        if (h >= 2000) return "4K";
        if (h >= 1400) return "1440p";
        if (h >= 1000) return "1080p";
        if (h >= 700) return "720p";
        if (h >= 450) return "480p";
        if (h >= 330) return "360p";
        if (h >= 220) return "240p";
        if (h > 0) return h + "p";
        return kind === "mp4" ? "MP4" : "Auto";
    }

    // Round-robin across provider families: if the first 16 Movy links are
    // dead, we still try Vuflix/Streamaggregator in the very first batch.
    function providerRank(prov) {
        const ranks = {
            "sourcepack-vuflix": 0,
            "sourcepack-streamaggregator": 1,
            "sourcepack-movy": 2,
            "sourcepack-vidgod": 3
        };
        return Object.prototype.hasOwnProperty.call(ranks, prov) ? ranks[prov] : 4;
    }

    const PROBE_BATCH = 8;

    async function probeAll(cands) {
        const all = [];
        let working = 0;
        for (let start = 0; start < cands.length; start += PROBE_BATCH) {
            const slice = cands.slice(start, start + PROBE_BATCH);
            // Unlike http_parallel, a slow/challenged host cannot hold up the
            // other responses or force a re-probe of the entire batch.
            const got = await Promise.all(slice.map(function (c) {
                return safeGet(c.url, PROBE_HEADERS, PROBE_MS);
            }));
            for (let i = 0; i < got.length; i++) {
                all.push(got[i]);
                if (classify(got[i].body, got[i].status).live) working++;
            }
            // Two batches give each strong family multiple opportunities.
            if (start >= PROBE_BATCH && working >= MIN_GOOD_STREAMS) break;
        }
        return all;
    }

    async function loadStreams(url, cb) {
        try {
            const p = decodeUrl(url);
            if (!p) {
                return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized episode url" });
            }

            const qs = p.isTv
                ? "type=tv&id=" + encodeURIComponent(p.id) +
                  "&season=" + encodeURIComponent(p.s) + "&episode=" + encodeURIComponent(p.e)
                : "type=movie&id=" + encodeURIComponent(p.id);

            const r = await safeGet(PAPI + "?" + qs, {
                "Accept": "application/json",
                "Accept-Encoding": "identity",
                "User-Agent": UA,
                "Referer": SITE + "/"
            });
            const j = parseJson(r.body);
            const playlists = (j && j.playlist) || [];
            let sources = [];
            for (let i = 0; i < playlists.length; i++) {
                const s = (playlists[i] && playlists[i].sources) || [];
                for (let k = 0; k < s.length; k++) sources.push(s[k]);
            }
            if (!sources.length) {
                return cb({
                    success: false,
                    errorCode: "NO_STREAMS",
                    message: p.isTv
                        ? "321Movies has no player sources for this episode yet."
                        : "321Movies has no player sources for this title yet."
                });
            }

            // Decode + de-duplicate; track each family's position so a single
            // provider cannot crowd out all the alternatives.
            const seen = {};
            const familyCounts = {};
            const all = [];
            for (let i = 0; i < sources.length; i++) {
                const s = sources[i] || {};
                const u = decodeStreamUrl(s.file);
                if (!u || u.indexOf("http") !== 0) continue;
                if (seen[u]) continue;
                seen[u] = 1;
                const family = String(s.provider || "");
                const familyIndex = familyCounts[family] || 0;
                familyCounts[family] = familyIndex + 1;
                all.push({
                    url: u,
                    label: String(s.label || "Source"),
                    provider: family,
                    type: String(s.type || ""),
                    isDefault: !!s["default"],
                    order: i,
                    familyIndex: familyIndex,
                    rank: providerRank(family),
                    weak: WEAK_PROVIDERS[family] ? 1 : 0
                });
            }
            if (!all.length) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "All 321Movies sources were unreadable." });
            }

            // Interleave strong families before less reliable ones.
            all.sort(function (a, b) {
                return (a.weak - b.weak) || (a.familyIndex - b.familyIndex) ||
                    (a.rank - b.rank) || (a.order - b.order);
            });
            const cands = all.slice(0, MAX_PROBE);

            const responses = await probeAll(cands);

            const live = [];
            for (let i = 0; i < responses.length; i++) {
                const res = responses[i] || {};
                const status = res.status || res.statusCode || 0;
                const body = res.body || "";
                const verdict = classify(body, status);
                if (!verdict.live) continue;
                const c = cands[i];
                const isHls = verdict.kind === "hls";
                const h = isHls ? maxResolution(body) : 0;
                const langs = isHls ? audioLanguages(body) : [];
                live.push({
                    url: c.url,
                    label: c.label,
                    provider: c.provider,
                    isDefault: c.isDefault,
                    order: c.order,
                    kind: isHls ? "hls" : (verdict.kind === "mp4" ? "mp4" : "video"),
                    height: h || labelQuality(c.label),
                    langs: langs
                });
            }

            if (!live.length) {
                return cb({
                    success: false,
                    errorCode: "NO_STREAMS",
                    message: "Every 321Movies source for this title is offline right now. They rotate often — try again shortly or pick another title."
                });
            }

            // Best quality first. HLS master playlists beat progressive files
            // at the same height because they can adapt downward. Ties broken
            // by the site's own default flag, then original order.
            live.sort(function (a, b) {
                if (b.height !== a.height) return b.height - a.height;
                if (a.kind === "hls" && b.kind !== "hls") return -1;
                if (b.kind === "hls" && a.kind !== "hls") return 1;
                if (!!b.isDefault !== !!a.isDefault) return b.isDefault ? 1 : -1;
                return a.order - b.order;
            });

            const streams = [];
            const usedNames = {};
            for (let i = 0; i < live.length && streams.length < MAX_STREAMS; i++) {
                const l = live[i];
                const fam = (l.provider || "source").replace(/^sourcepack-/, "");
                const nice = fam.charAt(0).toUpperCase() + fam.slice(1);
                const q = qualityLabel(l.height, l.kind);

                // Labels repeat a lot ("Horizon Auto" x18). Disambiguate so the
                // picker is not a wall of identical rows.
                let name = nice + " · " + q;
                if (l.langs.length) name += " · " + l.langs.slice(0, 2).join("/");
                if (usedNames[name]) { usedNames[name]++; name += " #" + usedNames[name]; }
                else usedNames[name] = 1;

                const so = {
                    url: l.url,
                    source: name,
                    quality: q,
                    headers: { "User-Agent": UA }
                };
                streams.push(mkStream(so));
            }

            return cb({ success: true, data: streams });
        } catch (e) {
            return cb({ success: false, errorCode: "STREAM_ERROR", message: String((e && e.message) || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
