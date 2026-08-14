(function () {
    // =========================================================================
    //  Pakistani Dramas (YouTube) — SkyStream provider  v3
    //
    //  Fully on-device (InnerTube JSON API, no server, no ffmpeg, no yt-dlp).
    //
    //  v3 changes:
    //    * Dramas are grouped into SERIES (one poster per drama, every episode
    //      under it). New episodes appear automatically (live re-fetch).
    //    * 13 official channels.
    //    * On-device 720p/1080p: builds a fragmented-MP4 HLS master in pure JS
    //      from the iOS client's adaptive formats (init + byte-range segments
    //      pointing straight at googlevideo). The player joins video+audio
    //      natively. 360p MP4 remains the guaranteed fallback.
    // =========================================================================

    const KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
    const INNERTUBE = "https://www.youtube.com/youtubei/v1/";

    const WEB_CTX = { client: { clientName: "WEB", clientVersion: "2.20260811.07.00", hl: "en", gl: "US" } };
    const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

    const AND_UA = "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip";
    const AND_CTX = { client: { clientName: "ANDROID", clientVersion: "21.02.35", androidSdkVersion: 30, userAgent: AND_UA, osName: "Android", osVersion: "11", hl: "en", gl: "US" } };

    const IOS_UA = "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";
    const IOS_CTX = { client: { clientName: "IOS", clientVersion: "21.02.3", deviceMake: "Apple", deviceModel: "iPhone16,2", userAgent: IOS_UA, osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US" } };

    // Safari UA on the WEB client -> pre-merged video+audio HLS (up to 1080p).
    const SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15";
    const SAFARI_CTX = { client: { clientName: "WEB", clientVersion: "2.20260811.07.00", userAgent: SAFARI_UA + ",gzip(gfe)", hl: "en", gl: "US" } };

    const CHANNELS = [
        { id: "UCEeEQxm6qc_qaTE7qTV5aLQ", name: "HUM TV" },
        { id: "UCe9JSDmyqNgA_l2BzGHq1Ug", name: "HAR PAL GEO" },
        { id: "UC4JCksJF76g_MdzPVBJoC3Q", name: "ARY Digital" },
        { id: "UCU1r97baEf3JJI5fY6NtMpA", name: "Express TV" },
        { id: "UCF2ltLX1dnPa6-L1paPaMzw", name: "Green TV" },
        { id: "UCTvcn2M4zQejIvjCNnzucqA", name: "Aan TV" },
        { id: "UCdmkPG3FG48A27-PrD-lC8A", name: "A Plus" },
        { id: "UCV6-CUNsfe2-STYfYkd7bBQ", name: "BOL Network" },
        { id: "UC_LdgZiGPqhvkOlSQR1H1cA", name: "Urdu 1" },
        { id: "UCEXUJUcgAw0PVX0y4sAaoCA", name: "LTN Family" },
        { id: "UCatkw-24OJitQmOVKPhQk1g", name: "TV One" },
        { id: "UCsjLeXAsJf5dN9e7TYsNS_Q", name: "Hum Sitaray" },
        { id: "UCMfwlaPLGMn44BKvHv15yzA", name: "PTV Home" }
    ];

    const VIDEOS_TAB = "EgZ2aWRlb3M%3D";
    const SPECIALS = "\u0000specials\u0000";

    // ------------------------------------------------------------------
    //  HTTP helpers
    // ------------------------------------------------------------------
    function respBody(res) {
        if (res && typeof res === "object" && res.body != null) return String(res.body);
        if (typeof res === "string") return res;
        return "";
    }

    async function httpPostJson(url, headers, body) {
        if (typeof http_post === "function") {
            const res = await http_post(url, headers, body);
            return respBody(res);
        }
        if (typeof fetch === "function") {
            const r = await fetch(url, { method: "POST", headers: headers, body: body, redirect: "follow" });
            if (r && typeof r.text === "function") return await r.text();
        }
        throw new Error("no HTTP bridge");
    }

    async function innertube(endpoint, body, ua) {
        const text = await httpPostJson(
            INNERTUBE + endpoint + "?key=" + KEY + "&prettyPrint=false",
            { "Content-Type": "application/json", "User-Agent": ua, "Accept": "*/*" },
            JSON.stringify(body)
        );
        if (!text) throw new Error("empty innertube response");
        return JSON.parse(text);
    }

    async function httpGetText(url, headers) {
        headers = headers || {};
        if (typeof http_get === "function") {
            try {
                const res = await http_get(url, headers);
                if (res && typeof res === "object" && res.body != null) return String(res.body);
                if (typeof res === "string") return res;
                return "";
            } catch (e) { /* fall through */ }
        }
        if (typeof fetch === "function") {
            const r = await fetch(url, { headers: headers, redirect: "follow" });
            if (r && typeof r.text === "function") return await r.text();
        }
        return "";
    }

    async function httpJson(url) {
        const text = await httpGetText(url);
        if (!text) throw new Error("empty response");
        return JSON.parse(text);
    }

    // ------------------------------------------------------------------
    //  Parsing
    // ------------------------------------------------------------------
    function rendererTitle(v) {
        try {
            const t = v && v.title;
            if (!t) return "";
            if (typeof t.simpleText === "string") return t.simpleText;
            if (Array.isArray(t.runs)) { let s = ""; for (const r of t.runs) if (r && r.text) s += r.text; return s; }
        } catch (e) { /* ignore */ }
        return "";
    }

    function rendererDur(v) {
        try { const l = v && v.lengthText; if (l && typeof l.simpleText === "string") return l.simpleText; } catch (e) {}
        return "";
    }

    function lockupTitle(lv) {
        try { const m = lv.metadata && lv.metadata.lockupMetadataViewModel; if (m && m.title && typeof m.title.content === "string") return m.title.content; } catch (e) {}
        return "";
    }

    function lockupDur(lv) {
        try {
            const ov = lv.contentImage && lv.contentImage.thumbnailViewModel && lv.contentImage.thumbnailViewModel.overlays;
            if (Array.isArray(ov)) {
                for (const o of ov) {
                    const b = o.thumbnailBottomOverlayViewModel;
                    if (b && Array.isArray(b.badges)) {
                        for (const x of b.badges) {
                            if (x.thumbnailBadgeViewModel && typeof x.thumbnailBadgeViewModel.text === "string") {
                                return x.thumbnailBadgeViewModel.text;
                            }
                        }
                    }
                }
            }
        } catch (e) {}
        return "";
    }

    function normKey(s) {
        return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    // "Zanjeerain Episode 01 [Eng Sub] ..." -> {name:"Zanjeerain", ep:1}
    // Skips teasers/promos/OSTs/recaps/trailers.
    function parseTitle(title) {
        const t = String(title || "");
        const m = t.match(/^(.+?)\s*[-–—|]?\s*Episode\s*(\d{1,3})\b/i);
        if (!m) return null;
        if (/\b(teaser|promo|ost|recap|trailer|title\s*song|full\s*ost)\b/i.test(t)) return null;
        const ep = parseInt(m[2], 10);
        if (isNaN(ep)) return null;
        let name = m[1]
            .replace(/\[.*?\]/g, "")
            .replace(/[-–—|:]\s*$/, "")
            .replace(/\s+/g, " ")
            .trim();
        if (name.length < 3) return null;
        return { name: name, ep: ep, norm: normKey(name) };
    }

    // Walk a response: collect videos + a continuation token (if any).
    function walkResponse(obj, out, seen, next) {
        if (obj == null || typeof obj !== "object") return;
        if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) walkResponse(obj[i], out, seen, next); return; }
        const keys = Object.keys(obj);

        if (keys.indexOf("lockupViewModel") !== -1) {
            const lv = obj.lockupViewModel;
            if (lv && lv.contentId && lv.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && !seen[lv.contentId]) {
                seen[lv.contentId] = 1;
                out.push({ id: lv.contentId, title: lockupTitle(lv), dur: lockupDur(lv) });
            }
        }
        if (keys.indexOf("videoRenderer") !== -1) {
            const v = obj.videoRenderer;
            if (v && v.videoId && !seen[v.videoId]) {
                seen[v.videoId] = 1;
                out.push({ id: v.videoId, title: rendererTitle(v), dur: rendererDur(v) });
            }
        }
        if (keys.indexOf("videoCardRenderer") !== -1) {
            const v = obj.videoCardRenderer;
            if (v && v.videoId && !seen[v.videoId]) {
                seen[v.videoId] = 1;
                out.push({ id: v.videoId, title: rendererTitle(v), dur: rendererDur(v) });
            }
        }
        if (keys.indexOf("continuationCommand") !== -1 && obj.continuationCommand && obj.continuationCommand.token && !next.t) {
            next.t = obj.continuationCommand.token;
        }
        for (let i = 0; i < keys.length; i++) walkResponse(obj[keys[i]], out, seen, next);
    }

    async function fetchChannelVideos(channelId, pages) {
        const out = [];
        const seen = {};
        let token = null;
        for (let p = 0; p < pages; p++) {
            let j;
            if (token) {
                j = await innertube("browse", { context: WEB_CTX, continuation: token }, WEB_UA);
            } else {
                j = await innertube("browse", { context: WEB_CTX, browseId: channelId, params: VIDEOS_TAB }, WEB_UA);
            }
            const next = { t: null };
            walkResponse(j, out, seen, next);
            if (!next.t) break;
            token = next.t;
        }
        return out;
    }

    function thumb(id) { return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"; }

    // ------------------------------------------------------------------
    //  Series building
    // ------------------------------------------------------------------
    function buildSeriesItems(channel, videos) {
        const groups = {};   // norm -> {name, eps:[]}
        const order = [];
        const specials = [];
        for (let i = 0; i < videos.length; i++) {
            const v = videos[i];
            const p = parseTitle(v.title);
            if (p) {
                if (!groups[p.norm]) { groups[p.norm] = { name: p.name, norm: p.norm, eps: [] }; order.push(p.norm); }
                groups[p.norm].eps.push({ ep: p.ep, id: v.id, title: v.title, dur: v.dur });
            } else {
                specials.push(v);
            }
        }
        const items = [];
        for (let i = 0; i < order.length; i++) {
            const g = groups[order[i]];
            g.eps.sort(function (a, b) { return a.ep - b.ep; });
            const seenEp = {};
            const eps = [];
            for (let e = 0; e < g.eps.length; e++) {
                const x = g.eps[e];
                if (seenEp[x.ep]) continue;
                seenEp[x.ep] = 1;
                eps.push(x);
            }
            let posterEp = eps[0];
            for (let e = 0; e < eps.length; e++) { if (eps[e].ep === 1) { posterEp = eps[e]; break; } }
            items.push(new MultimediaItem({
                url: JSON.stringify({ ch: channel.id, d: g.name, n: g.norm }),
                title: g.name,
                posterUrl: thumb(posterEp.id),
                type: "series",
                status: "ongoing",
                description: eps.length + " episodes"
            }));
        }
        if (specials.length) {
            items.push(new MultimediaItem({
                url: JSON.stringify({ ch: channel.id, d: SPECIALS }),
                title: "Promos, OSTs & Specials",
                posterUrl: thumb(specials[0].id),
                type: "series",
                status: "completed",
                description: specials.length + " videos"
            }));
        }
        return items;
    }

    function seriesEpisodes(videos, norm) {
        const eps = [];
        for (let i = 0; i < videos.length; i++) {
            const v = videos[i];
            const p = parseTitle(v.title);
            if (p && p.norm === norm) eps.push({ ep: p.ep, id: v.id, title: v.title, dur: v.dur });
        }
        eps.sort(function (a, b) { return a.ep - b.ep; });
        const seen = {};
        const out = [];
        for (let i = 0; i < eps.length; i++) {
            if (seen[eps[i].ep]) continue;
            seen[eps[i].ep] = 1;
            out.push(eps[i]);
        }
        return out;
    }

    // ------------------------------------------------------------------
    //  1. getHome — series per channel (episodes grouped, one poster)
    // ------------------------------------------------------------------
    function sleep(ms) {
        return new Promise(function (resolve) {
            if (typeof setTimeout === "function") setTimeout(resolve, ms);
            else resolve();
        });
    }

    // Run items through fn with limited concurrency (avoids YouTube rate-limits
    // that were causing transient "no stream" errors after a full parallel burst).
    async function mapLimit(arr, limit, fn) {
        const results = new Array(arr.length);
        let idx = 0;
        async function worker() {
            while (idx < arr.length) {
                const i = idx++;
                try { results[i] = await fn(arr[i], i); } catch (e) { results[i] = null; }
            }
        }
        const workers = [];
        for (let w = 0; w < Math.min(limit, arr.length); w++) workers.push(worker());
        await Promise.all(workers);
        return results;
    }

    async function getHome(cb) {
        const home = {};
        try {
            const rows = await mapLimit(CHANNELS, 3, function (ch) {
                return fetchChannelVideos(ch.id, 2).then(function (vids) {
                    return { name: ch.name, items: buildSeriesItems(ch, vids) };
                }).catch(function () {
                    return { name: ch.name, items: [] };
                });
            });
            for (let i = 0; i < rows.length; i++) {
                if (rows[i] && rows[i].items && rows[i].items.length) home[rows[i].name] = rows[i].items;
            }
        } catch (e) { /* leave home empty */ }
        cb({ success: true, data: home });
    }

    // ------------------------------------------------------------------
    //  2. search — flat videos
    // ------------------------------------------------------------------
    async function search(query, cb) {
        if (!query) return cb({ success: true, data: [] });
        try {
            const j = await innertube("search", { context: WEB_CTX, query: String(query) }, WEB_UA);
            const vids = [];
            walkResponse(j, vids, {}, { t: null });
            const items = [];
            for (let i = 0; i < vids.length && i < 40; i++) {
                const v = vids[i];
                const title = (v.title || "").trim() || ("Video " + v.id);
                items.push(new MultimediaItem({
                    url: JSON.stringify({ v: v.id, t: title }),
                    title: title,
                    posterUrl: thumb(v.id),
                    type: "movie",
                    status: "completed",
                    description: v.dur ? ("Duration: " + v.dur) : ""
                }));
            }
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: "Search failed: " + (e && e.message ? e.message : e) });
        }
    }

    // ------------------------------------------------------------------
    //  3. load — series -> episodes; single video -> one episode
    // ------------------------------------------------------------------
    async function load(url, cb) {
        let m;
        try { m = JSON.parse(String(url || "")); } catch (e) {
            return cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid URL" });
        }

        try {
            if (m.v) {
                // single video (search result)
                const title = m.t || ("Video " + m.v);
                const item = new MultimediaItem({
                    url: url, title: title, posterUrl: thumb(m.v),
                    bannerUrl: "https://i.ytimg.com/vi/" + m.v + "/maxresdefault.jpg",
                    type: "movie", status: "completed"
                });
                item.episodes = [new Episode({ name: "Full Video", url: url, season: 1, episode: 1, posterUrl: thumb(m.v) })];
                return cb({ success: true, data: item });
            }

            if (m.ch) {
                // series (drama) — re-fetch channel live so new episodes appear
                const vids = await fetchChannelVideos(m.ch, 3);
                const episodes = [];
                if (m.d === SPECIALS) {
                    for (let i = 0; i < vids.length; i++) {
                        const v = vids[i];
                        if (parseTitle(v.title)) continue;
                        episodes.push(new Episode({
                            name: (v.title || ("Video " + v.id)).slice(0, 80),
                            url: JSON.stringify({ v: v.id, t: v.title }),
                            season: 1, episode: i + 1, posterUrl: thumb(v.id)
                        }));
                    }
                } else {
                    const eps = seriesEpisodes(vids, m.n);
                    for (let i = 0; i < eps.length; i++) {
                        const e = eps[i];
                        const epTitle = "Episode " + e.ep;
                        episodes.push(new Episode({
                            name: epTitle,
                            url: JSON.stringify({ v: e.id, t: e.title }),
                            season: 1, episode: e.ep, posterUrl: thumb(e.id)
                        }));
                    }
                }
                if (!episodes.length) {
                    return cb({ success: false, errorCode: "NOT_FOUND", message: "No episodes found for this drama." });
                }
                const item = new MultimediaItem({
                    url: url, title: m.d === SPECIALS ? "Promos, OSTs & Specials" : m.d,
                    posterUrl: episodes[0].posterUrl || "",
                    type: "series", status: "ongoing"
                });
                item.episodes = episodes;
                return cb({ success: true, data: item });
            }

            return cb({ success: false, errorCode: "NOT_FOUND", message: "Unsupported item" });
        } catch (e) {
            return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Load failed: " + (e && e.message ? e.message : e) });
        }
    }

    // ------------------------------------------------------------------
    //  4. loadStreams — resolution ladder (HD HLS -> 720p -> 360p)
    // ------------------------------------------------------------------
    function playable(ps) {
        return ps && (ps.status === "OK" || ps.status === "CONTENT_CHECK_REQUIRED");
    }

    // Fetch the player response, retrying on transient ERROR/UNPLAYABLE (which
    // YouTube returns when a burst of requests just hit the same IP/key).
    // Returns null on failure, or the response on success.
    async function fetchPlayer(ctx, ua, videoId) {
        for (let attempt = 0; attempt < 3; attempt++) {
            const r = await innertube("player", { context: ctx, videoId: videoId }, ua);
            const ps = r && r.playabilityStatus;
            if (playable(ps)) return r;
            if (ps && ps.status === "LOGIN_REQUIRED") return null;
            if (attempt < 2) await sleep(700 * (attempt + 1));
        }
        return null;
    }

    // ------------------------------------------------------------------
    //  4b. On-device 720p/1080p — fragmented-MP4 HLS built in pure JS
    //
    //  YouTube serves HD only as separate DASH video+audio. For the iOS
    //  client each adaptive format is a fragmented MP4 (ftyp+moov init,
    //  sidx index, then moof/mdat fragments) and googlevideo serves it by
    //  byte-range (a plain GET without Range returns 403). We rebuild the
    //  structure as HLS: an EXT-X-MAP init segment plus contiguous
    //  equal-size byte-range segments. Because the segments are contiguous
    //  the player's MP4 demuxer sees the exact original byte stream and
    //  finds every moof box itself — no sidx parsing, no muxing, no tools.
    //  Video and audio media playlists are embedded in the master as data:
    //  URIs so a single magic_m3u8 URL carries both tracks.
    // ------------------------------------------------------------------
    function b64encode(str) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            if (c < 0x80) bytes.push(c);
            else if (c < 0x800) { bytes.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
            else if (c < 0x10000) { bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
            else { bytes.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
        }
        let out = "";
        for (let i = 0; i < bytes.length; i += 3) {
            const b0 = bytes[i];
            const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
            const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
            out += chars[b0 >> 2];
            out += chars[((b0 & 3) << 4) | (b1 >= 0 ? (b1 >> 4) : 0)];
            out += b1 >= 0 ? chars[((b1 & 15) << 2) | (b2 >= 0 ? (b2 >> 6) : 0)] : "=";
            out += b2 >= 0 ? chars[b2 & 63] : "=";
        }
        return out;
    }

    function codecOf(fmt) {
        const mt = String(fmt.mimeType || "");
        const m = mt.match(/codecs="([^"]+)"/);
        if (m) return m[1];
        return String(fmt.codecs || "");
    }

    // Build one fMP4 media playlist. chunkBytes = target byte-range size per
    // HLS segment (arbitrary cut points are fine — segments stay contiguous).
    function buildFmp4Playlist(fmt, chunkBytes, totalDurSec) {
        const url = fmt.url;
        const clen = parseInt(fmt.contentLength, 10);
        const ir = fmt.indexRange, inr = fmt.initRange;
        const segStart = parseInt(ir.end, 10) + 1;   // first moof sits right after the sidx
        const totalBytes = clen - segStart;
        const initLen = parseInt(inr.end, 10) - parseInt(inr.start, 10) + 1;
        const lines = [
            "#EXTM3U",
            "#EXT-X-VERSION:7",
            "#EXT-X-MEDIA-SEQUENCE:0",
            "#EXT-X-PLAYLIST-TYPE:VOD",
            '#EXT-X-MAP:URI="' + url + '#init.mp4",BYTERANGE="' + initLen + '@' + inr.start + '"'
        ];
        const maxDur = totalDurSec * chunkBytes / totalBytes;
        lines.push("#EXT-X-TARGETDURATION:" + (Math.ceil(maxDur) + 1));
        let pos = segStart;
        while (pos < clen) {
            const size = Math.min(chunkBytes, clen - pos);
            const dur = totalDurSec * size / totalBytes;
            lines.push("#EXTINF:" + dur.toFixed(6) + ",");
            lines.push("#EXT-X-BYTERANGE:" + size + "@" + pos);
            lines.push(url + "#seg.mp4");
            pos += size;
        }
        lines.push("#EXT-X-ENDLIST");
        return lines.join("\n") + "\n";
    }

    // Build a master playlist carrying the best available HD video + AAC
    // audio. Returns { master, height } or null when the video has no
    // usable adaptive formats.
    async function buildHlsMaster(videoId) {
        const r = await fetchPlayer(IOS_CTX, IOS_UA, videoId);
        if (!r || !r.streamingData) return null;
        const af = (r.streamingData.adaptiveFormats || []).filter(function (f) {
            return f && f.url && f.indexRange && f.initRange && f.contentLength;
        });
        const vorder = [137, 136, 135, 134, 133, 160, 298, 299, 616, 266];
        let vf = null;
        for (let i = 0; i < vorder.length; i++) {
            vf = af.find(function (f) { return f.itag === vorder[i]; });
            if (vf) break;
        }
        const au = af.find(function (f) { return f.itag === 140; }) ||
                   af.find(function (f) { return f.itag === 139; });
        if (!vf || !au) return null;
        const durSec = parseFloat((r.videoDetails && r.videoDetails.lengthSeconds) || "0") || 0;
        if (!(durSec > 0)) return null;
        const vpl = buildFmp4Playlist(vf, 16 * 1024 * 1024, durSec);
        const apl = buildFmp4Playlist(au, 4 * 1024 * 1024, durSec);
        const bw = (vf.bitrate || 0) + (au.bitrate || 0);
        const vcodec = codecOf(vf) || "avc1.640028";
        const acodec = codecOf(au) || "mp4a.40.2";
        const master =
            "#EXTM3U\n#EXT-X-VERSION:7\n" +
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="data:application/vnd.apple.mpegurl;base64,' + b64encode(apl) + '"\n' +
            '#EXT-X-STREAM-INF:BANDWIDTH=' + bw + ',RESOLUTION=' + vf.width + 'x' + vf.height + ',AUDIO="aud",CODECS="' + vcodec + ',' + acodec + '"\n' +
            'data:application/vnd.apple.mpegurl;base64,' + b64encode(vpl) + '\n';
        return { master: master, height: vf.height };
    }

    async function loadStreams(url, cb) {

        let m;
        try { m = JSON.parse(String(url || "")); } catch (e) {
            return cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid URL" });
        }
        const results = [];
        const errors = [];
        const seen = {};

        function add(u, label, rank) {
            if (!u) return;
            if (!/^(https?:|magic_m3u8:)/.test(u)) return;
            if (seen[u]) return;
            seen[u] = 1;
            results.push({ url: u, label: label, rank: rank });
        }

        // (1) On-device 720p/1080p — fMP4 HLS master built in pure JS from
        //     the iOS client's adaptive formats (video + AAC audio in one URL).
        try {
            const hd = await buildHlsMaster(m.v);
            if (hd && hd.master) {
                const p = hd.height ? (hd.height + "p") : "HD";
                add("magic_m3u8:" + b64encode(hd.master), p + " (HLS)", 0);
            } else {
                errors.push("hls:no-adaptive");
            }
        } catch (e) { errors.push("hls:" + (e && e.message ? e.message : e)); }

        // (2) Safari-WEB -> pre-merged HLS up to 1080p (residential IPs)
        try {
            const r = await fetchPlayer(SAFARI_CTX, SAFARI_UA, m.v);
            if (r) {
                const sd = r.streamingData || {};
                if (sd.hlsManifestUrl) add(sd.hlsManifestUrl, "HD (HLS)", 5);
                const fmts = sd.formats || [];
                for (let i = 0; i < fmts.length; i++) {
                    const f = fmts[i];
                    if (!f || !f.url) continue;
                    const mt = String(f.mimeType || "");
                    if (mt.indexOf("mpegURL") !== -1 || f.url.indexOf("m3u8") !== -1) {
                        const h = f.height ? (f.height + "p") : "HD";
                        add(f.url, h + " (HLS)", f.height ? 3000 - f.height : 6);
                    }
                }
            } else {
                errors.push("safari:no-hls");
            }
        } catch (e) { errors.push("safari:" + (e && e.message ? e.message : e)); }

        // (3) ANDROID -> progressive MP4 fallback (itag 22 = 720p, itag 18 = 360p)
        try {
            const r = await fetchPlayer(AND_CTX, AND_UA, m.v);
            if (r) {
                const fmts = (r.streamingData && r.streamingData.formats) || [];
                for (let i = 0; i < fmts.length; i++) {
                    const f = fmts[i];
                    if (!f || !f.url) continue;
                    if (f.itag === 22) add(f.url, "720p (MP4)", 10);
                    if (f.itag === 18) add(f.url, "360p (MP4)", 30);
                }
            } else {
                errors.push("android:no-stream");
            }
        } catch (e) { errors.push("android:" + (e && e.message ? e.message : e)); }

        if (!results.length) {
            return cb({
                success: false,
                errorCode: "NO_STREAM",
                message: "Could not resolve a playable stream" + (errors.length ? " (" + errors.join("; ") + ")" : "") +
                    ". Age-restricted, private or region-locked videos can't be played — try another episode."
            });
        }

        results.sort(function (a, b) { return a.rank - b.rank; });
        const out = [];
        for (let i = 0; i < results.length; i++) {
            out.push(new StreamResult({ url: results[i].url, source: results[i].label }));
        }
        cb({ success: true, data: out });
    }

    // ------------------------------------------------------------------
    //  Export
    // ------------------------------------------------------------------
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
