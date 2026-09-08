(function() {
    "use strict";

    // ═══════════════════════════════════════════════════════════
    //  KDramaMaza (kdramasmaza.net) — SkyStream plugin
    //
    //  Hindi/Urdu-dubbed Korean, Chinese, Turkish, Thai and
    //  Japanese dramas (+ anime). WordPress site with an open
    //  REST API for catalog/search:
    //
    //    /wp-json/wp/v2/posts?per_page=N&categories=ID
    //    /wp-json/wp/v2/posts?search=q
    //
    //  Each drama post links an episode hub on kdramasmaza.com.pk
    //  (/archives/<id>, "All Episodes Wise" button). That page has
    //  one .episode-row per episode with HubCloud + GDFlix host
    //  links, both resolvable in-plugin to direct files:
    //
    //    hubcloud.cx/drive/ID -> gamerxyt hubcloud.php -> signed
    //      *.r2.cloudflarestorage.com direct file
    //    gdflix.dev/file/ID -> POST {action:direct} -> drive.google id
    //      -> usercontent confirm form -> direct file (206 ranged)
    //
    //  Resolution happens at Play time, so links are always fresh.
    //  Verified live 2026-09 (A Shop for Killers S02E01: 1080p
    //  WEB-DL dual-audio 687MB served with video/mkv).
    // ═══════════════════════════════════════════════════════════

    const SITE = "https://kdramasmaza.net";
    const API = SITE + "/wp-json/wp/v2";
    const HUB = "kdramasmaza.com.pk";

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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

    async function getText(url, headers) {
        const r = await withTimeout(http_get(url, Object.assign({ "User-Agent": UA }, headers || {})), 20000);
        return (r && r.body) || "";
    }

    function stripTags(s) {
        return String(s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "–").replace(/&#038;|&amp;/g, "&").replace(/&#8220;|&ldquo;/g, '"').replace(/&#8221;|&rdquo;/g, '"').replace(/&#8217;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&#\d+;/g, "").trim();
    }

    function cleanTitle(t) {
        return stripTags(t).replace(/\s*[–-]\s*Complete All Episodes.*$/i, "").replace(/\s*\|\s*[^|]*$/i, "").replace(/\s*[–-]\s*KDramas Maza\s*$/i, "").trim();
    }

    function yearOf(d) {
        const m = String(d || "").match(/^(\d{4})/);
        return m ? parseInt(m[1], 10) : null;
    }

    function wpToItem(p) {
        if (!p || !p.link) return null;
        const title = cleanTitle(p.title && p.title.rendered);
        if (!title) return null;
        const thumb = p.jetpack_featured_media_url || "";
        return mkItem({
            title: title,
            url: JSON.stringify({ link: p.link }),
            posterUrl: thumb,
            bannerUrl: thumb,
            type: "tv",
            year: yearOf(p.date),
            description: stripTags(p.excerpt && p.excerpt.rendered).slice(0, 300)
        });
    }

    async function wpPosts(qs) {
        try {
            const r = await withTimeout(http_get(API + "/posts?" + qs, { "User-Agent": UA }), 20000);
            const j = JSON.parse((r && r.body) || "[]");
            return Array.isArray(j) ? j : [];
        } catch (e) { return []; }
    }

    // ─────────────────────── host resolvers ────────────────────────

    function fileNameFromUrl(u) {
        let f = (String(u).match(/\/([^\/?&]+?)(?:[?&]|$)/) || [])[1] || "";
        try { f = decodeURIComponent(f); } catch (e) {}
        return f.replace(/\.(mkv|mp4|zip)$/i, "").replace(/\./g, " ").slice(0, 58);
    }

    function qualityFromName(name) {
        const m = String(name).match(/(\d{3,4})\s*p/i);
        return m ? m[1] + "p" : "";
    }

    async function resolveHubcloud(pageUrl) {
        const out = [];
        try {
            const html = await getText(pageUrl, { "Referer": "https://hubcloud.cx/" });
            let dl = (html.match(/id=["']download["'][^>]*href=["']([^"']+)["']/) ||
                      html.match(/href=["']([^"']*hubcloud\.php[^"']+)["']/) || [])[1];
            if (!dl) return out;
            dl = dl.replace(/&amp;/g, "&");
            if (/hubcloud\.php|gamerxyt/.test(dl)) {
                const d2 = await getText(dl, { "Referer": pageUrl });
                const r2 = (d2.match(/https:\/\/[^"'\s<>]*r2\.cloudflarestorage\.com[^"'\s<>]+/) || [])[0];
                if (r2) out.push(r2);
                if (!out.length) {
                    const pd = (d2.match(/https:\/\/pixeldrain\.(?:com|dev)\/u\/[A-Za-z0-9]+/) || [])[0];
                    if (pd) out.push(pd + "?download");
                }
            } else if (/r2\.cloudflarestorage\.com|pixeldrain/.test(dl)) {
                out.push(dl);
            }
        } catch (e) {}
        return out;
    }

    // GDFlix: the file page exposes a JSON API on its own path.
    //   POST https://new3.gdflix.io/file/<ID>   (urlencoded works)
    //     x-token: new3.gdflix.io
    //     action=direct & key=<static> & action_token=
    //   -> { url: "https://drive.google.com/open?id=<GID>" }
    // The Drive id is unwrapped through the usercontent confirm form:
    //   GET drive.usercontent.google.com/download?id=<GID>&export=download
    //   -> HTML form action+fields (id/export/confirm/uuid) -> final URL
    //      that serves the file directly (206, ranged, verified).
    const GD_KEY = "acbe2066696a1d44345698deb3d9ebf9ae9bbdfd";

    async function resolveGdflix(pageUrl) {
        const fid = (String(pageUrl).match(/\/file\/([A-Za-z0-9]+)/) || [])[1];
        if (!fid) return { host: "GDFlix", urls: [], instant: [] };
        const postUrl = "https://new3.gdflix.io/file/" + fid;
        // warm the host first: primes any Cloudflare cookies the engine
        // persists per-host (node-fetch gets challenged here, the app is not)
        await getText(postUrl, { "Referer": SITE + "/" });
        async function post(action, pathBase) {
            const r = await withTimeout(http_post("https://new3.gdflix.io/" + pathBase + "/" + fid, {
                "User-Agent": UA,
                "Referer": postUrl,
                "x-token": "new3.gdflix.io",
                "Content-Type": "application/x-www-form-urlencoded"
            }, "action=" + action + "&key=" + GD_KEY + "&action_token="), 15000);
            try { return JSON.parse((r && r.body) || "{}"); } catch (e) { return {}; }
        }
        // instant (single POST -> direct googleusercontent URL) and
        // direct (drive id -> usercontent confirm form) run in parallel
        const [inst, dir] = await Promise.all([
            post("instant", "mfile").catch(function () { return {}; }),
            post("direct", "file").catch(function () { return {}; })
        ]);
        const instant = [];
        const iu = String(inst.url || "").replace(/&amp;/g, "&");
        if (!inst.error && iu.indexOf("http") === 0) instant.push(iu);
        const direct = [];
        let u = String(dir.url || "").replace(/&amp;/g, "&");
        if (!dir.error && u.indexOf("http") === 0) {
            const gid = (u.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || [])[1];
            if (/drive\.google\.com/.test(u) && gid) {
                try {
                    const chtml = await getText("https://drive.usercontent.google.com/download?id=" + gid + "&export=download", { "Referer": "https://drive.google.com/" });
                    const action = (chtml.match(/action="([^"]+)"/) || [])[1] || "";
                    if (action) {
                        const fields = [];
                        const fr = /name="([^"]+)"\s+value="([^"]*)"/g;
                        let fm;
                        while ((fm = fr.exec(chtml))) fields.push(fm[1] + "=" + encodeURIComponent(fm[2]).replace(/%20/g, "+"));
                        if (fields.length) direct.push(action + "?" + fields.join("&"));
                    }
                } catch (e) {}
                if (!direct.length) direct.push("https://drive.google.com/uc?export=download&id=" + gid);
            } else {
                direct.push(u);
            }
        }
        return { host: "GDFlix", urls: direct, instant: instant };
    }


    async function resolveHost(url) {
        try {
            if (/hubcloud\./.test(url)) return { host: "HubCloud", urls: await resolveHubcloud(url), instant: [] };
            if (/gdflix\./.test(url))  return await resolveGdflix(url);
        } catch (e) {}
        return { host: "", urls: [], instant: [] };
    }

    // ─────────────────────── catalog: home ────────────────────────

    async function getHome(cb) {
        try {
            const sections = [
                { title: "Latest Dramas",              qs: "per_page=24" },
                { title: "Korean Dramas in Hindi/Urdu", qs: "per_page=24&categories=7" },
                { title: "Chinese Dramas in Hindi/Urdu", qs: "per_page=24&categories=14" },
                { title: "Turkish Dramas in Urdu/Hindi", qs: "per_page=24&categories=11" },
                { title: "Korean Movies in Hindi",      qs: "per_page=24&categories=3149" },
                { title: "Anime in Hindi",              qs: "per_page=24&categories=37" }
            ];
            const settled = await Promise.all(sections.map(function (s) { return wpPosts(s.qs); }));
            const home = {};
            for (let i = 0; i < sections.length; i++) {
                const items = (settled[i] || []).map(wpToItem).filter(function (x) { return !!x; });
                if (items.length) home[sections[i].title] = items;
            }
            if (!Object.keys(home).length) {
                return cb({ success: false, errorCode: "API_ERROR", message: "KDramaMaza catalog unavailable" });
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────── catalog: search ───────────────────────

    async function search(query, cb) {
        try {
            if (!query || !String(query).trim()) return cb({ success: true, data: [] });
            const posts = await wpPosts("per_page=24&search=" + encodeURIComponent(String(query).trim()));
            cb({ success: true, data: posts.map(wpToItem).filter(function (x) { return !!x; }) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────── detail + episodes ─────────────────────

    // post HTML -> the "All Episodes Wise" archives url on kdramasmaza.com.pk
    function findHubUrl(postHtml) {
        // button whose text mentions episodes: <button onclick="window.location.href='URL'" ...>All Episodes Wise</button>
        let m = postHtml.match(/onclick=["']window\.location\.href='([^']+)'["'][^>]*>[^<]*Episode/i);
        if (m && m[1]) return m[1];
        // any archives link as fallback
        m = postHtml.match(/https?:\/\/[a-z.]*kdramasmaza\.[a-z.]+\/archives\/(\d+)/i);
        return m ? m[0] : null;
    }

    // archives HTML -> [{ no: 1, name: "Episode 01", links: [host urls] }]
    function parseEpisodeRows(html) {
        const rows = [];
        const re = /<div class="episode-row">([\s\S]*?)<\/div>/g;
        let m;
        while ((m = re.exec(html))) {
            const seg = m[1];
            const no = (seg.match(/ep-no[^>]*>\s*Episode\s*0*([0-9]+)/i) || [])[1];
            const links = [];
            const lr = /href=["'](https?:\/\/[^"']+)[\"']/gi;
            let lm;
            while ((lm = lr.exec(seg))) {
                const u = lm[1].replace(/&amp;/g, "&");
                if (/hubcloud\.|gdflix\./.test(u) && links.indexOf(u) < 0) links.push(u);
            }
            if (links.length) rows.push({ no: no ? parseInt(no, 10) : rows.length + 1, name: "Episode " + (no ? String(parseInt(no, 10)).padStart(2, "0") : String(rows.length + 1).padStart(2, "0")), links: links });
        }
        return rows;
    }

    async function load(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            const link = p && p.link;
            if (!link) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized KDramaMaza url" });

            const html = await getText(link, { "Referer": SITE + "/" });
            if (!html) return cb({ success: false, errorCode: "NOT_FOUND", message: "Drama page unavailable" });

            const title = cleanTitle((html.match(/<title>([^<]*)<\/title>/) || [])[1] ||
                                     (html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/) || [])[1] || "Drama");
            const poster = ((html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/) || [])[1] || "").replace(/&amp;/g, "&");
            // description: first paragraphs of entry-content before the "Title:" infobox
            let desc = "";
            const ec = html.indexOf("entry-content");
            if (ec > 0) {
                const seg = html.slice(ec, ec + 6000);
                const paras = seg.match(/<p>([\s\S]*?)<\/p>/g) || [];
                for (let i = 0; i < paras.length; i++) {
                    const t = stripTags(paras[i]);
                    if (t.length > 60) { desc = t.slice(0, 700); break; }
                }
            }

            const hubUrl = findHubUrl(html);
            if (!hubUrl) return cb({ success: false, errorCode: "NO_EPISODES", message: "No episode list found for this drama yet." });

            const archHtml = await getText(hubUrl, { "Referer": SITE + "/" });
            const rows = parseEpisodeRows(archHtml);
            if (!rows.length) return cb({ success: false, errorCode: "NO_EPISODES", message: "Episode list is empty for this drama." });

            const episodes = rows.map(function (r) {
                return mkEpisode({
                    name: r.name,
                    url: JSON.stringify({ links: r.links, ep: r.no, title: title }),
                    season: 1,
                    episode: r.no,
                    posterUrl: poster,
                    description: title + " — " + r.name
                });
            });

            const item = mkItem({
                title: title,
                url: JSON.stringify({ link: link }),
                posterUrl: poster,
                bannerUrl: poster,
                type: "tv",
                year: yearOf((html.match(/datePublished["']?\s*[:=]\s*["'](\d{4})/) || [])[1]),
                description: desc,
                episodes: episodes
            });
            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "DETAIL_ERROR", message: String((e && e.message) || e) });
        }
    }

    // ─────────────────────── streams ───────────────────────────────

    async function loadStreams(url, cb) {
        try {
            let p;
            try { p = JSON.parse(url); } catch (e) { p = null; }
            const links = (p && p.links) || [];
            if (!links.length) return cb({ success: false, errorCode: "BAD_URL", message: "No host links on this episode" });

            // Resolve every host in parallel (HubCloud + GDFlix chains at
            // once) — sequential resolution was the slow path.
            const ordered = links.slice().sort(function (a, b) {
                return (/hubcloud/.test(b) ? 1 : 0) - (/hubcloud/.test(a) ? 1 : 0);
            });
            const results = await Promise.all(ordered.map(function (u) {
                return resolveHost(u).catch(function () { return { host: "", urls: [], instant: [] }; });
            }));

            const streams = [];
            const seen = {};
            function pushStream(label, u, ref) {
                const key = String(u).split("?")[0];
                if (!u || seen[key]) return;
                seen[key] = 1;
                if (streams.length >= 8) return;
                const q = qualityFromName(u) || "";
                streams.push(mkStream({
                    url: u,
                    source: label + (q ? " - " + q : ""),
                    quality: q || "auto",
                    headers: { "User-Agent": UA },
                    isDirect: true
                }));
            }
            // order: HubCloud, GDFlix instant (fastest direct), GDFlix direct
            for (let i = 0; i < results.length; i++) {
                const res = results[i];
                if (/hubcloud/i.test(res.host || "")) {
                    for (let j = 0; j < (res.urls || []).length; j++) pushStream(res.host + (j > 0 ? " #" + (j + 1) : ""), res.urls[j]);
                }
            }
            for (let i = 0; i < results.length; i++) {
                const res = results[i];
                if (/gdflix/i.test(res.host || "")) {
                    for (let j = 0; j < (res.instant || []).length; j++) pushStream(res.host + " - Instant", res.instant[j]);
                    for (let j = 0; j < (res.urls || []).length; j++) pushStream(res.host + (j > 0 ? " #" + (j + 1) : ""), res.urls[j]);
                } else if (res.host && !/hubcloud/i.test(res.host)) {
                    for (let j = 0; j < (res.instant || []).length; j++) pushStream(res.host + " - Instant", res.instant[j]);
                    for (let j = 0; j < (res.urls || []).length; j++) pushStream(res.host + (j > 0 ? " #" + (j + 1) : ""), res.urls[j]);
                }
            }
            if (!streams.length) {
                return cb({
                    success: false,
                    errorCode: "NO_STREAMS",
                    message: "Could not resolve a direct file for this episode right now - try again or pick another episode."
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
