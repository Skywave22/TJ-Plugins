(function () {
    "use strict";

    // ═══════════════════════════════════════════════════════════
    // TamilBlasters (1tamilblasters.tech) — SkyStream plugin
    // WordPress site:
    //   /wp-json/wp/v2/posts?per_page=24
    //   /wp-json/wp/v2/posts?search=q
    //   /wp-json/wp/v2/posts?slug=slug
    // Each post content contains:
    //   - <img> poster
    //   - <iframe src="https://morencius.com/embed/..."> (VidHide)
    //   - <iframe src="https://lulust.com/e/..."> (LuluStream)
    //   - <button class="downloadBtn" data-file="..."> -> 
    //     https://quantumneuralvertexnimbuscloudinfrastructuresystemnetworkai.top/xzmzz_o5j8k1l3l8p1r5t7f2h6.php?file=DATAFILE
    //     -> HubCloud / GDFlix page -> direct file
    // Resolvers:
    //   VidHide/LuluStream: eval packer unpack -> m3u8
    //   HubCloud: id=download href -> hubcloud.php -> r2.cloudflarestorage
    //   GDFlix: POST action=direct/instant -> drive.google -> usercontent
    // Geo bypass: public DNS IPs, no personal IP
    // ═══════════════════════════════════════════════════════════

    const SITE = "https://www.1tamilblasters.tech";
    const API = SITE + "/wp-json/wp/v2";
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    const HUBCLOUD_HOST = "hubcloud.ist";
    const GDFLIX_HOST = "new4.gdflix.io";
    const GD_KEY = "acbe2066696a1d44345698deb3d9ebf9ae9bbdfd";
    const REDIRECTOR = "https://quantumneuralvertexnimbuscloudinfrastructuresystemnetworkai.top/xzmzz_o5j8k1l3l8p1r5t7f2h6.php?file=";

    // ── Universal Geo Bypass (no personal IP, public DNS) ──
    const GEO_BYPASS_IP = "8.8.8.8";
    const GEO_BYPASS_IP2 = "1.1.1.1";
    const GEO_BYPASS_COUNTRY = "US";
    const GEO_BYPASS_HEADERS = {
        "X-Forwarded-For": GEO_BYPASS_IP,
        "X-Real-IP": GEO_BYPASS_IP,
        "X-Client-IP": GEO_BYPASS_IP,
        "True-Client-IP": GEO_BYPASS_IP,
        "CF-IPCountry": GEO_BYPASS_COUNTRY,
        "X-Country": GEO_BYPASS_COUNTRY,
        "cf-ipcountry": GEO_BYPASS_COUNTRY,
        "X-CF-IPCountry": GEO_BYPASS_COUNTRY,
        "X-Forwarded-Country": GEO_BYPASS_COUNTRY,
        "X-Forwarded-Proto": "https",
        "Accept-Language": "en-US,en;q=0.9,en-IN;q=0.8,ta;q=0.7,te;q=0.6,hi;q=0.5"
    };
    const PK_GEO_IP = "39.33.116.25";
    const PK_GEO_HEADERS = {
        "X-Forwarded-For": PK_GEO_IP,
        "X-Real-IP": PK_GEO_IP,
        "X-Client-IP": PK_GEO_IP,
        "CF-IPCountry": "PK",
        "X-Country": "PK",
        "cf-ipcountry": "PK",
        "X-CF-IPCountry": "PK",
        "X-Forwarded-Country": "PK",
        "Accept-Language": "en-PK,en;q=0.9,ur-PK;q=0.8,en-US;q=0.7"
    };
    function mergeGeoHeaders(base, isPK) {
        const geo = isPK ? PK_GEO_HEADERS : GEO_BYPASS_HEADERS;
        const out = Object.assign({}, base || {});
        for (const k in geo) { if (!(k in out)) out[k] = geo[k]; }
        if (!out["X-Forwarded-For"]) out["X-Forwarded-For"] = geo["X-Forwarded-For"];
        if (!out["CF-IPCountry"]) out["CF-IPCountry"] = geo["CF-IPCountry"];
        return out;
    }

    // ── helpers ──
    function mkItem(obj) { try { return new MultimediaItem(obj); } catch (_) { return obj; } }
    function buildVlcUrl(url, headers) {
        try {
            var parts = [];
            if (headers) {
                if (headers["User-Agent"]) parts.push("User-Agent=" + encodeURIComponent(headers["User-Agent"]));
                if (headers["Referer"]) parts.push("Referer=" + encodeURIComponent(headers["Referer"]));
                if (headers["Origin"]) parts.push("Origin=" + encodeURIComponent(headers["Origin"]));
                if (headers["Cookie"]) parts.push("Cookie=" + encodeURIComponent(headers["Cookie"]));
            }
            if (parts.length) return url + "|" + parts.join("&");
        } catch (e) {}
        return url;
    }
    function mkEpisode(obj) { try { return new Episode(obj); } catch (_) { return obj; } }
    function mkStream(obj) {
        var s;
        try {
            s = new StreamResult({ url: obj.url, source: obj.source || obj.quality, headers: obj.headers });
            s.quality = obj.quality;
        } catch (_) { s = obj; }
        return s;
    }
    function decodeEntities(s) {
        return String(s == null ? '' : s)
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, '-').replace(/&#8212;|&mdash;/g, '-')
            .replace(/&#8217;|&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/&#(\d+);/g, function (_, n) { try { return String.fromCharCode(parseInt(n, 10)); } catch (e) { return ''; } });
    }
    function stripTags(s) {
        return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    }
    function withTimeout(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    async function getText(url, extraHeaders) {
        var h = Object.assign({}, GEO_BYPASS_HEADERS, { "User-Agent": UA, "Accept": "text/html,application/json,*/*;q=0.8", "Referer": SITE + "/" });
        if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { h[k] = extraHeaders[k]; });
        var res = await withTimeout(http_get(url, h), 20000);
        var body = (res && typeof res === 'object') ? res.body : res;
        return typeof body === 'string' ? body : '';
    }
    async function getJson(url, extraHeaders) {
        var txt = await getText(url, extraHeaders);
        try { return JSON.parse(txt); } catch (e) { return null; }
    }
    function qualityFromText(t) {
        var s = String(t || '').toLowerCase();
        var m = s.match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/) || s.match(/\b4k\b/);
        if (m) return m[0] === '4k' ? '2160p' : m[1] || m[0];
        // also parse from like "1080P" in button
        var m2 = s.match(/(\d{3,4})p/);
        return m2 ? m2[0] : '';
    }
    function sizeFromText(t) {
        var m = String(t || '').match(/([\d.]+)\s*(GB|MB)/i);
        return m ? (m[1] + m[2].toUpperCase()) : '';
    }
    function yearFromTitle(t) {
        var m = String(t || '').match(/\b(19\d{2}|20\d{2})\b/);
        return m ? parseInt(m[1], 10) : null;
    }
    function cleanTitle(t) {
        var s = stripTags(t);
        // remove trailing language/year junk? keep as is for display, but for base name cut
        return s.replace(/\s+/g, ' ').trim();
    }
    function extractImgFromContent(content) {
        var m = String(content || '').match(/<img[^>]+src=["']([^"']+)["']/i);
        return m ? m[1] : '';
    }
    function extractOgImageFromYoast(p) {
        try {
            if (p.yoast_head_json && p.yoast_head_json.og_image && p.yoast_head_json.og_image.length) {
                return p.yoast_head_json.og_image[0].url || '';
            }
            if (p.yoast_head_json && p.yoast_head_json.og_image) {
                // sometimes object
            }
            var yh = p.yoast_head || '';
            var m = yh.match(/<meta property="og:image" content="([^"]+)"/i);
            if (m) return m[1];
        } catch (e) {}
        return '';
    }

    // ── WP API ──
    async function wpPosts(qs) {
        try {
            var url = API + "/posts?" + qs;
            var txt = await getText(url, { "Accept": "application/json" });
            var j = JSON.parse(txt || "[]");
            return Array.isArray(j) ? j : [];
        } catch (e) { return []; }
    }
    function wpToItem(p) {
        if (!p || !p.link) return null;
        var title = cleanTitle(p.title && p.title.rendered);
        if (!title) return null;
        var poster = extractOgImageFromYoast(p) || extractImgFromContent(p.content && p.content.rendered) || (p.jetpack_featured_media_url || "");
        var desc = stripTags(p.excerpt && p.excerpt.rendered).slice(0, 400) || stripTags(p.content && p.content.rendered).slice(0, 400);
        var year = yearFromTitle(title);
        // type detection: if title contains EP or Bigg Boss or Season, treat as tv
        var isTv = /S\d{2}E\d+|EP\d+|BIGG BOSS|Season/i.test(title);
        return mkItem({
            title: title,
            url: JSON.stringify({ slug: p.slug, link: p.link, title: title }),
            posterUrl: poster,
            bannerUrl: poster,
            type: isTv ? "tv" : "movie",
            year: year || undefined,
            description: desc
        });
    }

    // ── Packer unpacker for VidHide / LuluStream ──
    function unpackPacker(p, a, c, k) {
        try {
            for (var i = c - 1; i >= 0; i--) {
                if (k[i]) {
                    var re = new RegExp('\\b' + i.toString(a) + '\\b', 'g');
                    p = p.replace(re, k[i]);
                }
            }
        } catch (e) {}
        return p;
    }
    function unpackAll(html) {
        var out = String(html || '');
        try {
            // regex handles escaped single quotes inside p and k
            var re = /eval\(function\(p,a,c,k,e,d\)\{[^}]+\}\('((?:\\'|[^'])*)',\s*(\d+),\s*(\d+),\s*'((?:\\'|[^'])*)'\.split\('\|'\)\)\)/g;
            var m;
            while ((m = re.exec(html)) !== null) {
                try {
                    var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
                    var a = parseInt(m[2], 10);
                    var c = parseInt(m[3], 10);
                    var kstr = m[4].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
                    var k = kstr.split('|');
                    var unpacked = unpackPacker(p, a, c, k);
                    out += "\n" + unpacked;
                } catch (e) {}
            }
        } catch (e) {}
        return out;
    }
    function extractM3U8(html, baseOrigin) {
        var unpacked = unpackAll(html);
        var urls = [];
        var seen = {};
        // absolute m3u8
        var reAbs = /https?:\/\/[^"'\\\s<>]+\.m3u8[^"'\\\s<>]*/gi;
        var m;
        while ((m = reAbs.exec(unpacked)) !== null) {
            var u = m[0].replace(/\\\/\//g, '//').replace(/\\\//g, '/').replace(/\\"/g, '').replace(/\\'/g, "'");
            // trim trailing punctuation
            u = u.replace(/["']$/, '').replace(/\\$/, '');
            if (!seen[u]) { seen[u] = 1; urls.push(u); }
        }
        // relative /stream/.../master.m3u8 or /hls2/...
        var reRel = /["'](\/(?:stream|hls\d?|hls2)\/[^"']+\.m3u8[^"']*)["']/gi;
        while ((m = reRel.exec(unpacked)) !== null) {
            var rel = m[1];
            var abs = rel;
            if (baseOrigin) {
                if (rel.indexOf('http') !== 0) abs = baseOrigin.replace(/\/$/, '') + rel;
            }
            if (!seen[abs]) { seen[abs] = 1; urls.push(abs); }
        }
        // also look for file:"https://...mp4"
        var reMp4 = /https?:\/\/[^"'\\\s<>]+\.(?:mp4|mkv)[^"'\\\s<>]*/gi;
        while ((m = reMp4.exec(unpacked)) !== null) {
            var u2 = m[0];
            if (!seen[u2]) { seen[u2] = 1; urls.push(u2); }
        }
        return urls;
    }

    // ── Embed resolver ──
    async function resolveEmbed(embedUrl) {
        var streams = [];
        try {
            var origin = (embedUrl.match(/^(https?:\/\/[^\/]+)/) || [])[1] || '';
            var html = await getText(embedUrl, { "Referer": SITE + "/", "Accept": "text/html" });
            // Extract cookies set via JS: file_id, aff, ref_url
            var fileId = (html.match(/\$\.cookie\('file_id',\s*'([^']+)'/) || html.match(/file_id['"]?,\s*['"]([^'"]+)['"]/) || [])[1] || "";
            var aff = (html.match(/\$\.cookie\('aff',\s*'([^']+)'/) || [])[1] || "";
            var refUrl = (html.match(/\$\.cookie\('ref_url',\s*'([^']+)'/) || [])[1] || "";
            var cookieParts = [];
            if (fileId) cookieParts.push("file_id=" + fileId);
            if (aff) cookieParts.push("aff=" + aff);
            if (refUrl) cookieParts.push("ref_url=" + refUrl);
            var cookieHeader = cookieParts.join("; ");

            var m3u8s = extractM3U8(html, origin);
            for (var i = 0; i < m3u8s.length; i++) {
                var u = m3u8s[i];
                if (/\.jpg|\.png|_xt\.m3u8/i.test(u) && !/master\.m3u8/i.test(u)) continue;
                var q = qualityFromText(u) || "1080p";
                if (/720p/i.test(html) && !/1080p/i.test(u)) q = "720p";
                var headers = { "User-Agent": UA, "Referer": embedUrl, "Origin": origin };
                if (cookieHeader) headers["Cookie"] = cookieHeader;
                var isStreamProxy = /\/stream\//.test(u);
                var qualityLabel = /lulust|tnmr/.test(embedUrl) ? "LuluStream • " + q : /morencius|vidhide|acek|dramiyos/.test(embedUrl) ? "VidHide • " + q : "Embed • " + q;
                if (isStreamProxy) qualityLabel = qualityLabel + " [Proxy]";
                // For VLC player, also provide URL with |User-Agent| syntax as fallback (some VLC builds ignore headers object)
                var vlcUrl = buildVlcUrl(u, headers);
                streams.push({ url: u, vlcUrl: vlcUrl, quality: q, qualityLabel: qualityLabel, headers: headers, isProxy: isStreamProxy });
            }
            // Sort to put proxy URLs first (more reliable)
            streams.sort(function(a,b){ return (b.isProxy?1:0) - (a.isProxy?1:0); });

            // Also return the embed URL itself as fallback for SkyStream's built-in extractor
            // This allows the app to try its own VidHide/LuluStream resolver if our HLS fails
            if (streams.length) {
                // Add embed URL as additional stream with lower priority
                streams.push({ url: embedUrl, quality: "Embed • 1080p (via Extractor)", headers: { "User-Agent": UA, "Referer": SITE + "/" } });
            } else {
                // If no HLS found, return embed URL directly
                streams.push({ url: embedUrl, quality: "Embed • 1080p", headers: { "User-Agent": UA, "Referer": SITE + "/" } });
            }
        } catch (e) {
            // On error, return embed URL as fallback
            try {
                streams.push({ url: embedUrl, quality: "Embed • 1080p", headers: { "User-Agent": UA, "Referer": SITE + "/" } });
            } catch (e2) {}
        }
        return streams;
    }

    // ── HubCloud resolver (from KDMaza) ──
    async function resolveHubcloud(pageUrl) {
        var out = [];
        try {
            var html = await getText(pageUrl, { "Referer": "https://" + HUBCLOUD_HOST + "/" });
            var dl = (html.match(/id=["']download["'][^>]*href=["']([^"']+)["']/) ||
                      html.match(/href=["']([^"']*hubcloud\.php[^"']+)["']/) || [])[1];
            if (!dl) {
                // sometimes direct r2 link already in page
                var direct = (html.match(/https:\/\/[^"'\s<>]*r2\.cloudflarestorage\.com[^"'\s<>]+/) || [])[0];
                if (direct) out.push(direct);
                var pd = (html.match(/https:\/\/pixeldrain\.(?:com|dev)\/u\/[A-Za-z0-9]+/) || [])[0];
                if (pd) out.push(pd + "?download");
                return out;
            }
            dl = dl.replace(/&amp;/g, "&");
            if (/hubcloud\.php|gamerxyt/.test(dl)) {
                var d2 = await getText(dl, { "Referer": pageUrl });
                var r2 = (d2.match(/https:\/\/[^"'\s<>]*r2\.cloudflarestorage\.com[^"'\s<>]+/) || [])[0];
                if (r2) out.push(r2);
                if (!out.length) {
                    var mm = (d2.match(/https:\/\/pixeldrain\.(?:com|dev)\/u\/([A-Za-z0-9]+)/) || [])[1];
                    if (mm) {
                        // try direct API
                        var pdUrl = "https://pixeldrain.com/api/file/" + mm + "?download";
                        out.push(pdUrl);
                    }
                    var pd2 = (d2.match(/https:\/\/pixeldrain\.(?:com|dev)\/u\/[A-Za-z0-9]+/) || [])[0];
                    if (pd2) out.push(pd2 + "?download");
                }
            } else if (/r2\.cloudflarestorage\.com|pixeldrain/.test(dl)) {
                out.push(dl);
            }
        } catch (e) {}
        return out;
    }

    // ── GDFlix resolver ──
    async function resolveGdflix(pageUrl) {
        var fid = (String(pageUrl).match(/\/file\/([A-Za-z0-9]+)/) || [])[1];
        if (!fid) return { urls: [], instant: [] };
        var postUrl = "https://" + GDFLIX_HOST + "/file/" + fid;
        try { await getText(postUrl, { "Referer": SITE + "/" }); } catch (e) {}
        async function post(action, pathBase) {
            try {
                var r = await withTimeout(http_post("https://" + GDFLIX_HOST + "/" + pathBase + "/" + fid, {
                    "User-Agent": UA,
                    "Referer": postUrl,
                    "x-token": GDFLIX_HOST,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Forwarded-For": GEO_BYPASS_IP,
                    "CF-IPCountry": GEO_BYPASS_COUNTRY
                }, "action=" + action + "&key=" + GD_KEY + "&action_token="), 15000);
                var body = (r && r.body) || "{}";
                try { return JSON.parse(body); } catch (e) { return {}; }
            } catch (e) { return {}; }
        }
        var inst = {}, dir = {};
        try {
            var results = await Promise.all([
                post("instant", "mfile").catch(function () { return {}; }),
                post("direct", "file").catch(function () { return {}; })
            ]);
            inst = results[0] || {};
            dir = results[1] || {};
        } catch (e) {}
        var instant = [];
        var iu = String(inst.url || "").replace(/&amp;/g, "&");
        if (!inst.error && iu.indexOf("http") === 0) instant.push(iu);
        var direct = [];
        var u = String(dir.url || "").replace(/&amp;/g, "&");
        if (!dir.error && u.indexOf("http") === 0) {
            var gid = (u.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || [])[1];
            if (/drive\.google\.com/.test(u) && gid) {
                try {
                    var chtml = await getText("https://drive.usercontent.google.com/download?id=" + gid + "&export=download", { "Referer": "https://drive.google.com/" });
                    var action = (chtml.match(/action="([^"]+)"/) || [])[1] || "";
                    if (action) {
                        var fields = [];
                        var fr = /name="([^"]+)"\s+value="([^"]*)"/g;
                        var fm;
                        while ((fm = fr.exec(chtml))) fields.push(fm[1] + "=" + encodeURIComponent(fm[2]).replace(/%20/g, "+"));
                        if (fields.length) direct.push(action + "?" + fields.join("&"));
                    }
                } catch (e) {}
                if (!direct.length) direct.push("https://drive.google.com/uc?export=download&id=" + gid);
            } else {
                direct.push(u);
            }
        }
        return { urls: direct, instant: instant };
    }

    // ── TamilBlasters download redirector resolver ──
    async function resolveTamilDownload(downloadUrl, referer) {
        var streams = [];
        try {
            var html = "";
            try {
                html = await withTimeout(getText(downloadUrl, { "Referer": referer || SITE + "/" }), 10000);
            } catch (e) {
                return [];
            }
            // Try to find hubcloud links
            var hubLinks = (html.match(/https?:\/\/[^"'\s<>]*hubcloud\.[a-z]+\/[^"'\s<>]+/gi) || []);
            // also hubcloud.ist/drive/...
            var hubLinks2 = (html.match(/https?:\/\/[^"'\s<>]*hubcloud[^"'\s<>]*\/drive\/[A-Za-z0-9]+/gi) || []);
            var allHub = [];
            var seenHub = {};
            hubLinks.concat(hubLinks2).forEach(function (u) {
                u = u.replace(/&amp;/g, "&");
                if (!seenHub[u]) { seenHub[u] = 1; allHub.push(u); }
            });
            for (var i = 0; i < allHub.length; i++) {
                try {
                    var hres = await resolveHubcloud(allHub[i]);
                    for (var j = 0; j < hres.length; j++) {
                        streams.push({ url: hres[j], quality: "HubCloud • 1080p", headers: { "User-Agent": UA, "Referer": allHub[i] } });
                    }
                } catch (e) {}
            }
            // GDFlix
            var gdflixRe = /https?:\/\/(?:[^"'\s<>]*gdflix\.[^"'\s<>]+\/file\/[A-Za-z0-9]+|new\d*\.gdflix\.io\/file\/[A-Za-z0-9]+)/gi;
            var gLinks = (html.match(gdflixRe) || []);
            var seenG = {};
            var uniqG = [];
            gLinks.forEach(function (u) {
                if (!seenG[u]) { seenG[u] = 1; uniqG.push(u); }
            });
            for (var gi = 0; gi < uniqG.length; gi++) {
                try {
                    var gres = await resolveGdflix(uniqG[gi]);
                    var combined = (gres.urls || []).concat(gres.instant || []);
                    for (var gj = 0; gj < combined.length; gj++) {
                        streams.push({ url: combined[gj], quality: "GDFlix • 1080p", headers: { "User-Agent": UA, "Referer": uniqG[gi] } });
                    }
                } catch (e) {}
            }
            // Direct mkv/mp4
            var directRe = /https?:\/\/[^"'\s<>]+\.(?:mkv|mp4)(?:\?[^"'\s<>]*)?/gi;
            var directLinks = (html.match(directRe) || []);
            var seenD = {};
            directLinks.forEach(function (u) {
                if (!seenD[u]) {
                    seenD[u] = 1;
                    streams.push({ url: u, quality: "Direct • " + (qualityFromText(u) || "1080p"), headers: { "User-Agent": UA } });
                }
            });
            // If page is actually a redirect via JS window.location.href = "..."
            var jsRedir = (html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/) || [])[1];
            if (jsRedir && streams.length === 0) {
                // recursively resolve
                var more = await resolveTamilDownload(jsRedir, downloadUrl);
                streams = streams.concat(more);
            }
            // If still nothing, maybe the downloadUrl itself redirects to direct file (check if html is small and contains no html tags but is url)
            // Also try to extract from meta refresh
            var metaRefresh = (html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/i) || [])[1];
            if (metaRefresh && streams.length === 0) {
                var more2 = await resolveTamilDownload(metaRefresh, downloadUrl);
                streams = streams.concat(more2);
            }
        } catch (e) {}
        return streams;
    }

    // ── catalog: home ──
    async function getHome(cb) {
        try {
            var sections = [
                { title: "Latest Movies", qs: "per_page=24&orderby=date" },
                { title: "Tamil Movies", qs: "per_page=20&search=Tamil" },
                { title: "Telugu Movies", qs: "per_page=20&search=Telugu" },
                { title: "Hindi Movies", qs: "per_page=20&search=Hindi" },
                { title: "Malayalam Movies", qs: "per_page=20&search=Malayalam" },
                { title: "Kannada Movies", qs: "per_page=20&search=Kannada" },
                { title: "Web Series", qs: "per_page=20&search=Season" }
            ];
            var settled = await Promise.all(sections.map(function (s) {
                return wpPosts(s.qs).then(function (v) { return v; }, function () { return []; });
            }));
            var home = {};
            for (var i = 0; i < sections.length; i++) {
                var items = (settled[i] || []).map(wpToItem).filter(function (x) { return !!x; });
                if (items.length) home[sections[i].title] = items;
            }
            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "API_ERROR", message: "TamilBlasters catalog unavailable" });
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ── catalog: search ──
    async function search(query, cb) {
        try {
            if (!query || !String(query).trim()) return cb({ success: true, data: [] });
            var posts = await wpPosts("per_page=24&search=" + encodeURIComponent(String(query).trim()));
            cb({ success: true, data: posts.map(wpToItem).filter(function (x) { return !!x; }) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ── load ──
    async function load(url, cb) {
        try {
            var parsed;
            try { parsed = JSON.parse(url); } catch (e) { parsed = { link: url, slug: (url.match(/\/([^\/]+)\/?$/) || [])[1] || "" }; }
            var slug = parsed.slug || "";
            var link = parsed.link || SITE + "/" + slug + "/";
            var titleHint = parsed.title || "";

            var postData = null;
            if (slug) {
                var posts = await wpPosts("slug=" + encodeURIComponent(slug));
                if (posts && posts.length) postData = posts[0];
            }
            var contentHtml = "";
            var poster = parsed.posterUrl || "";
            var description = "";
            var pageTitle = titleHint;
            if (postData) {
                contentHtml = (postData.content && postData.content.rendered) || "";
                poster = poster || extractOgImageFromYoast(postData) || extractImgFromContent(contentHtml) || "";
                description = stripTags(postData.excerpt && postData.excerpt.rendered).slice(0, 600) || stripTags(contentHtml).slice(0, 600);
                pageTitle = cleanTitle(postData.title && postData.title.rendered) || pageTitle;
            } else {
                // fallback fetch HTML
                try {
                    var html = await getText(link, { "Referer": SITE + "/" });
                    contentHtml = html;
                    if (!poster) {
                        var mImg = html.match(/<meta property="og:image" content="([^"]+)"/i) || html.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
                        if (mImg) poster = mImg[1];
                    }
                    if (!pageTitle) {
                        var mTitle = html.match(/<title>([^<]+)<\/title>/i);
                        if (mTitle) pageTitle = decodeEntities(mTitle[1]).replace(/ Movie Download.*$/i, '').trim();
                    }
                    description = stripTags(html).slice(0, 600);
                } catch (e) {}
            }

            // Extract iframes
            var iframes = [];
            var iframeRe = /<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi;
            var mIframe;
            while ((mIframe = iframeRe.exec(contentHtml)) !== null) {
                var src = mIframe[1];
                if (/morencius\.com|vidhide|lulust\.com|lulu\.|streamtape|hglink|dood|filemoon/i.test(src) || src.indexOf('/embed/') >= 0 || src.indexOf('/e/') >= 0) {
                    iframes.push(src);
                }
            }
            // Also check for iframe in yoast? content already has

            // Extract downloadBtns
            var downloadFiles = [];
            var btnRe = /<button[^>]*class=["'][^"']*downloadBtn[^"']*["'][^>]*data-file=["']([^"']+)["'][^>]*>([\s\S]*?)<\/button>/gi;
            var mBtn;
            while ((mBtn = btnRe.exec(contentHtml)) !== null) {
                var dataFile = mBtn[1].trim();
                var labelRaw = stripTags(mBtn[2]).trim();
                var q = qualityFromText(labelRaw) || qualityFromText(dataFile) || "1080p";
                var sz = sizeFromText(labelRaw) || sizeFromText(dataFile) || "";
                var downloadUrl = REDIRECTOR + encodeURIComponent(dataFile);
                downloadFiles.push({ file: dataFile, label: labelRaw, quality: q, size: sz, downloadUrl: downloadUrl });
            }
            // If no button found, try alternative pattern data-file
            if (!downloadFiles.length) {
                var altRe = /data-file=["']([^"']+)["']/gi;
                var mAlt;
                while ((mAlt = altRe.exec(contentHtml)) !== null) {
                    var df = mAlt[1].trim();
                    var q2 = qualityFromText(df) || "1080p";
                    var sz2 = sizeFromText(df) || "";
                    downloadFiles.push({ file: df, label: df.replace(/\./g, ' ').replace(/_/g, ' ').slice(0, 80), quality: q2, size: sz2, downloadUrl: REDIRECTOR + encodeURIComponent(df) });
                }
            }

            // Build episodes: single movie episode
            var episodeTitle = pageTitle || titleHint || "Movie";
            var epUrl = JSON.stringify({
                slug: slug,
                link: link,
                title: episodeTitle,
                iframes: iframes,
                downloadFiles: downloadFiles
            });

            var episodes = [
                mkEpisode({
                    title: episodeTitle,
                    url: epUrl,
                    season: 1,
                    episode: 1,
                    posterUrl: poster,
                    description: description
                })
            ];

            // If title suggests series with multiple qualities, we could create separate episodes per quality, but keep single for now
            // For Bigg Boss etc, each post is separate episode, so single is fine

            var result = {
                title: pageTitle || titleHint || "TamilBlasters",
                posterUrl: poster,
                bannerUrl: poster,
                description: description,
                type: /S\d+|EP|BIGG BOSS|Season/i.test(pageTitle) ? "tv" : "movie",
                episodes: episodes
            };
            cb({ success: true, data: result });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ── loadStreams ──
    async function loadStreams(url, cb) {
        try {
            var parsed;
            try { parsed = JSON.parse(url); } catch (e) { parsed = { link: url, iframes: [], downloadFiles: [] }; }
            var iframes = parsed.iframes || [];
            var downloadFiles = parsed.downloadFiles || [];
            var referer = parsed.link || SITE + "/";
            var allStreams = [];

            // 1) Resolve iframe embeds (VidHide, LuluStream)
            for (var i = 0; i < iframes.length; i++) {
                var emb = iframes[i];
                try {
                    var embStreams = await resolveEmbed(emb);
                    for (var es = 0; es < embStreams.length; es++) {
                        var s = embStreams[es];
                        var label = s.qualityLabel || s.quality || "1080p";
                        if (/^\d+p$/i.test(label) || label === "1080p" || label === "720p") {
                            var q = label;
                            label = /lulust|tnmr/.test(emb) ? "LuluStream • " + q : /morencius|vidhide|acek|dramiyos/.test(emb) ? "VidHide • " + q : "Embed • " + q;
                        }
                        if (s.url === emb) {
                            label = s.quality || "Embed • 1080p (via Extractor)";
                        }
                        // Try to use vlcUrl with | headers for VLC internal player if available, but also keep original for extractor
                        var finalUrl = s.vlcUrl || s.url;
                        // For LuluStream, VLC blocks direct CDN, so we MUST use proxy URL if available, and ensure Mozilla UA
                        // Return both: original HLS and VLC-formatted URL as separate streams
                        allStreams.push(mkStream({ url: s.url, quality: label, headers: s.headers || { "User-Agent": UA, "Referer": emb } }));
                        if (s.vlcUrl && s.vlcUrl !== s.url) {
                            allStreams.push(mkStream({ url: s.vlcUrl, quality: label + " (VLC Headers)", headers: s.headers || { "User-Agent": UA, "Referer": emb } }));
                        }
                    }
                } catch (e) {}
            }

            // 2) Resolve download buttons via quantum redirector -> HubCloud/GDFlix (with timeout, datacenter may block)
            // If we already have embed streams, only try first download file with short timeout to avoid long waits
            var hasEmbed = allStreams.length > 0;
            var maxDl = hasEmbed ? Math.min(downloadFiles.length, 2) : Math.min(downloadFiles.length, 3);
            var dlTimeout = hasEmbed ? 8000 : 12000;
            for (var di = 0; di < maxDl; di++) {
                var df = downloadFiles[di];
                var dUrl = df.downloadUrl;
                var qLabel = df.quality || "1080p";
                var szLabel = df.size ? " • " + df.size : "";
                try {
                    var resolved = [];
                    try {
                        resolved = await withTimeout(resolveTamilDownload(dUrl, referer), dlTimeout);
                    } catch (e) { resolved = []; }
                    if (resolved && resolved.length) {
                        for (var ri = 0; ri < resolved.length; ri++) {
                            var r = resolved[ri];
                            // r may be string or object
                            var rUrl = typeof r === 'string' ? r : r.url;
                            var rQ = (typeof r === 'object' && r.quality) ? r.quality : ("Download • " + qLabel + szLabel);
                            var rHeaders = (typeof r === 'object' && r.headers) ? r.headers : { "User-Agent": UA, "Referer": referer };
                            allStreams.push(mkStream({ url: rUrl, quality: rQ, headers: rHeaders }));
                        }
                    } else {
                        // Fallback: try to return the redirector itself as stream with note, or try to resolve hubcloud/gdflix via direct attempt
                        // Attempt hubcloud/gdflix direct extraction again with more time
                        // If still nothing, push the redirector URL as last resort (may need browser)
                        // We push with quality label so user sees it
                        // But we avoid pushing HTML page as stream if it's definitely HTML
                        // Instead push as download link with browser handling
                        // allStreams.push(mkStream({ url: dUrl, quality: "Download • " + qLabel + szLabel + " (Redirector)", headers: { "User-Agent": UA, "Referer": referer } }));
                    }
                } catch (e) {}
            }

            // Deduplicate by URL
            var seen = {};
            var uniq = [];
            for (var ui = 0; ui < allStreams.length; ui++) {
                var u = allStreams[ui].url || allStreams[ui].url;
                if (!u) continue;
                if (seen[u]) continue;
                seen[u] = 1;
                uniq.push(allStreams[ui]);
            }

            // Sort: HLS embeds first, then HubCloud, then GDFlix, then direct
            uniq.sort(function (a, b) {
                var qa = String(a.quality || '').toLowerCase();
                var qb = String(b.quality || '').toLowerCase();
                var score = function (q) {
                    if (/vidhide|lulustream|embed/i.test(q)) return 0;
                    if (/hubcloud/i.test(q)) return 1;
                    if (/gdflix/i.test(q)) return 2;
                    return 3;
                };
                return score(qa) - score(qb);
            });

            if (!uniq.length) {
                // As last resort, if we have iframes but failed to resolve, return iframe URLs themselves as streams (let SkyStream's extractors handle)
                for (var fi = 0; fi < iframes.length; fi++) {
                    uniq.push(mkStream({ url: iframes[fi], quality: "Embed • 1080p", headers: { "User-Agent": UA, "Referer": referer } }));
                }
            }
            // Always add download redirector URLs as additional options (for download manager / external browser)
            // Even if we have embed streams, user may want direct download
            if (downloadFiles.length && uniq.length < 10) {
                for (var dj = 0; dj < downloadFiles.length; dj++) {
                    var df2 = downloadFiles[dj];
                    // Avoid duplicate if already resolved to HubCloud/GDFlix
                    var already = uniq.some(function(s){ return s.url && s.url.indexOf(df2.file) >=0; });
                    if (already) continue;
                    // Only add if not already present
                    var exists = uniq.some(function(s){ return s.url === df2.downloadUrl; });
                    if (!exists) {
                        uniq.push(mkStream({ url: df2.downloadUrl, quality: "Download • " + (df2.quality || "1080p") + (df2.size ? " • " + df2.size : "") + " (Redirector)", headers: { "User-Agent": UA, "Referer": referer } }));
                    }
                }
            }

            if (!uniq.length) {
                // If we have download files, return them as streams pointing to redirector (user can open in external browser)
                for (var dj = 0; dj < downloadFiles.length; dj++) {
                    var df2 = downloadFiles[dj];
                    uniq.push(mkStream({ url: df2.downloadUrl, quality: "Download • " + (df2.quality || "1080p") + (df2.size ? " • " + df2.size : ""), headers: { "User-Agent": UA, "Referer": referer } }));
                }
            }

            cb({ success: true, data: uniq });
        } catch (e) {
            cb({ success: false, errorCode: "STREAMS_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ── exports ──
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
