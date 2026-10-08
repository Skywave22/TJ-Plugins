/*
 * RareAnimes (Rare Toons India) — SkyStream plugin
 * Site:   https://www.rareanimes.mov   (WordPress, "herald" theme, REST API disabled)
 * Source: Hindi / Tamil / Telugu / Malayalam dubbed anime, cartoons and animated movies
 *
 * Flow:
 *   catalog : HTML — /home/page/N/ (latest), /hindi/category/<slug>/page/N/, /?s=<q>
 *   post    : "Episode NN – name" headings, each followed by one line per audio variant
 *             ("Hindi – [WatchMultiQuality] [HubCloud] [WatchNow] [DLBeta]",
 *              "Episode 01 – Untouched NF (Hindi) – [HubCloud] [WatchNow]", …).
 *             Every link is wrapped in codedew.com/zipper/?url=<enc>.
 *   streams : WatchNow -> zipper 302 -> codedew.com/streambeta/?url=<hubcloudId>
 *             The StreamBeta page embeds `playerSources` (V1 "fsl", V2 "10gbps"):
 *             Cloudflare-worker URLs serving the MKV directly with Range support.
 *             It also lists every audio version of the episode (data-fid) and the
 *             whole series map (window.relatedData), each playable at ?v=<fid>.
 *             HubCloud -> zipper &ad_done=1 -> hubcloud.ist/drive/<id>; the same <id>
 *             opens on StreamBeta, so HubCloud-only episodes play the same way.
 *   dead    : WatchMultiQuality (argon.razorshell.space JW Player) — the HLS stream
 *             is gated by a signed "ping" that rejects non-browser clients (403).
 *
 * Exports: getHome / search / load / loadStreams
 */

(function () {

    'use strict';

    var SITE = (typeof manifest !== 'undefined' && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, '')
        : 'https://www.rareanimes.mov';

    var SB = 'https://codedew.com/streambeta/';
    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    var ROWS = [
        { name: 'Trending',         path: '/home/' },
        { name: 'Hindi Anime',      path: '/hindi/category/crunchyroll/' },
        { name: 'Hindi Dubbed',     path: '/hindi/category/hindi-dub/' },
        { name: 'Animated Movies',  path: '/hindi/category/movies/' },
        { name: 'Netflix',          path: '/hindi/category/netflix/' },
        { name: 'Cartoon Network',  path: '/hindi/category/cartoon-network/' },
        { name: 'Disney / XD',      path: '/hindi/category/disney-xd/' },
        { name: 'Tamil',            path: '/hindi/category/tamil/' },
        { name: 'Telugu',           path: '/hindi/category/telugu/' },
        { name: 'Hindi Subbed',     path: '/hindi/category/hindi-sub/' },
        { name: 'Completed Series', path: '/hindi/category/completed/' }
    ];

    var LANG_NAMES = {
        'हिंदी': 'Hindi', 'हिन्दी': 'Hindi', 'தமிழ்': 'Tamil', 'తెలుగు': 'Telugu', 'മലയാളം': 'Malayalam',
        'বাংলা': 'Bengali', 'ಕನ್ನಡ': 'Kannada', 'मराठी': 'Marathi', '日本語': 'Japanese', 'English': 'English'
    };

    // ─────────────────────────── helpers ───────────────────────────

    function decodeEntities(s) {
        return String(s == null ? '' : s)
            .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
            .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
            .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
    }

    function stripTags(html) {
        return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    }

    function absUrl(u, base) {
        u = String(u || '');
        if (/^https?:\/\//i.test(u)) return u;
        if (u.indexOf('//') === 0) return 'https:' + u;
        var m = String(base).match(/^(https?:\/\/[^\/]+)/);
        return (m ? m[1] : SITE) + (u.charAt(0) === '/' ? '' : '/') + u;
    }

    async function get(url, referer) {
        var res = await http_get(url, {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
            'Referer': referer || SITE + '/'
        });
        if (!res || typeof res !== 'object') res = { status: 200, body: String(res || '') };
        return { status: Number(res.status || res.statusCode || 0), body: String(res.body || ''), finalUrl: res.finalUrl || url };
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }

    function mkItem(o)    { try { return new MultimediaItem(o); } catch (_) { return o; } }
    function mkEpisode(o) { try { return new Episode(o); }        catch (_) { return o; } }
    function mkStream(o) {
        var s;
        try { s = new StreamResult({ url: o.url, source: o.source, headers: o.headers }); s.quality = o.quality; }
        catch (_) { s = o; }
        return s;
    }

    function cleanTitle(t) {
        t = decodeEntities(t).replace(/\s+/g, ' ').trim();
        var cut = t.search(/\s*[-–|]?\s*\b(?:Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|Dual Audio|Multi Audio|All Episodes|Episodes?|Download|Complete|Watch Online)\b/i);
        if (cut > 2) t = t.slice(0, cut);
        t = t.replace(/[\s\-–|:,(]+$/, '').replace(/\s+(?:Full\s+)?Movie$/i, '').trim();
        return t || 'Untitled';
    }

    function guessType(title, classes) {
        var t = String(title || '');
        if (/\bseason\b|\bepisodes?\b|\bseries\b/i.test(t)) return 'series';
        if (/\bmovie|film\b/i.test(t) || /category-movies/.test(classes || '')) return 'movie';
        return 'series';
    }

    // ───────────────────────── catalog ─────────────────────────

    function parseListing(html) {
        var out = [], seen = {};
        var re = /<article\b([^>]*)>([\s\S]*?)<\/article>/g, m;
        while ((m = re.exec(html))) {
            var cls = (m[1].match(/class="([^"]*)"/) || [])[1] || '';
            if (!/\bpost-\d+/.test(cls)) continue;
            var body = m[2];
            var a = body.match(/<a\s+href="(https?:\/\/[^"]+)"[^>]*?title="([^"]*)"/) || body.match(/<a\s+href="(https?:\/\/[^"]+)"[^>]*>/);
            if (!a || seen[a[1]]) continue;
            var rawTitle = a[2] || stripTags((body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || '');
            if (!rawTitle) continue;
            // index posts ("All Anime & Cartoon Movies List") are link directories, not playable titles
            if (/^\s*all\b[\s\S]*\blist\s*$/i.test(decodeEntities(stripTags(rawTitle)))) continue;
            var img = body.match(/<img[^>]+src="([^"]+)"/);
            seen[a[1]] = 1;
            out.push(mkItem({
                title: cleanTitle(rawTitle),
                url: a[1],
                posterUrl: img ? img[1] : '',
                type: guessType(rawTitle, cls),
                description: decodeEntities(rawTitle)
            }));
        }
        return out;
    }

    async function fetchListing(path, page) {
        var url = SITE + path + (page > 1 ? 'page/' + page + '/' : '');
        var r = await get(url);
        if (r.status >= 400) throw new Error('HTTP ' + r.status + ' for ' + path);
        return parseListing(r.body);
    }

    async function getHome(cb) {
        try {
            var settled = await Promise.all(ROWS.map(function (row) {
                var pages = row.path === '/home/' ? [1, 2] : [1, 2];
                return Promise.all(pages.map(function (p) {
                    return withTimeout(fetchListing(row.path, p), 14000).catch(function () { return []; });
                })).then(function (lists) {
                    var seen = {}, items = [];
                    lists.forEach(function (l) { l.forEach(function (it) { if (!seen[it.url]) { seen[it.url] = 1; items.push(it); } }); });
                    return items;
                });
            }));
            var data = {};
            ROWS.forEach(function (row, i) { if (settled[i] && settled[i].length) data[row.name] = settled[i]; });
            if (!Object.keys(data).length) return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'RareAnimes returned no content (' + SITE + ')' });
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String((e && e.message) || e) });
        }
    }

    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var enc = encodeURIComponent(q).replace(/%20/g, '+');
            var pages = await Promise.all([1, 2].map(function (p) {
                var u = SITE + (p > 1 ? '/page/' + p + '/' : '/') + '?s=' + enc;
                return get(u).then(function (r) { return r.status < 400 ? parseListing(r.body) : []; }).catch(function () { return []; });
            }));
            var seen = {}, out = [];
            pages.forEach(function (l) { l.forEach(function (it) { if (!seen[it.url]) { seen[it.url] = 1; out.push(it); } }); });
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: 'SEARCH_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────────────────────── post parsing ─────────────────────────

    // Turns the post body into lines; zipper anchors become {label,url} tokens.
    function postLines(content) {
        var c = content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
        var links = [];
        c = c.replace(/<a\s[^>]*href="(https?:\/\/codedew\.com\/zipper\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, function (_, u, t) {
            links.push({ url: decodeEntities(u), label: stripTags(t) });
            return ' \u0001' + (links.length - 1) + '\u0002 ';
        });
        c = c.replace(/<(?:p|h\d|hr|br|div|li|tr)\b[^>]*>/gi, '\n');
        var lines = [];
        stripTagsKeepNewlines(c).split('\n').forEach(function (ln) {
            ln = ln.replace(/[ \t\u00a0]+/g, ' ').trim();
            if (!ln) return;
            var toks = [];
            var text = ln.replace(/\u0001(\d+)\u0002/g, function (_, i) { toks.push(links[+i]); return ''; });
            lines.push({ text: text.replace(/\[\s*\]/g, ' ').replace(/\s+/g, ' ').trim(), links: toks });
        });
        return lines;
    }

    function stripTagsKeepNewlines(html) {
        return decodeEntities(String(html).replace(/<[^>]*>/g, ' '));
    }

    function linkKind(label) {
        var l = String(label || '').toLowerCase().replace(/[^a-z]/g, '');
        if (l === 'watchnow' || l === 'watch') return 'w';
        if (l === 'hubcloud') return 'h';
        return '';
    }

    function variantLabel(text) {
        var t = String(text || '').replace(/^\s*episode\s*\d+\s*[-–:]\s*/i, '');
        t = t.split(/\s[-–]\s|[-–]\s*$/)[0] || t;
        t = t.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
        if (!t || /download|watch/i.test(t)) return '';
        if (/^untouched\b/i.test(t)) return t.slice(0, 40);
        // "The Seven Knights … Hindi" / "Hindi Uncut" -> start at the language name
        var lm = t.match(/\b(Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|English|Japanese)\b[\s\S]*$/i);
        if (lm) return lm[0].slice(0, 40);
        return t.length > 40 ? '' : t;
    }

    // Episodes keyed by number: [{ n, name, v:[{l,w,h}] }] + loose variants (movies / season links)
    function parseEpisodes(lines) {
        var eps = {}, order = [], cur = null, loose = [];
        function ep(n, name) {
            if (!eps[n]) { eps[n] = { n: n, name: name || '', v: [] }; order.push(n); }
            else if (name && !eps[n].name) eps[n].name = name;
            return eps[n];
        }
        lines.forEach(function (ln) {
            var head = ln.text.match(/^(?:episode|ep\.?)\s*0*(\d{1,4})\b\s*(?:[-–:]\s*(.*))?$/i);
            if (!ln.links.length) {
                if (head) cur = ep(+head[1], (head[2] || '').trim());
                else if (/^(?:season|watch\/download|winding up|thanks for)/i.test(ln.text)) cur = null;
                return;
            }
            var v = { l: '', w: '', h: '' };
            ln.links.forEach(function (k) { var kind = linkKind(k.label); if (kind && !v[kind]) v[kind] = k.url; });
            if (!v.w && !v.h) return;
            var target = cur;
            if (head) target = ep(+head[1], '');
            v.l = variantLabel(ln.text) || 'Hindi';
            if (target) target.v.push(v); else loose.push(v);
        });
        var list = order.map(function (n) { return eps[n]; }).filter(function (e) { return e.v.length; });
        list.sort(function (a, b) { return a.n - b.n; });
        return { episodes: list, loose: loose };
    }

    function infoField(text, names) {
        for (var i = 0; i < names.length; i++) {
            var re = new RegExp(names[i] + '\\s*:?\\s*([^\\n]{1,300})', 'i');
            var m = text.match(re);
            if (m) return m[1].trim();
        }
        return '';
    }

    // ───────────────────────── StreamBeta ─────────────────────────

    function langName(native) {
        native = String(native || '').trim();
        return LANG_NAMES[native] || native;
    }

    function parseStreamBeta(html) {
        var out = { sources: [], fid: '', lang: '', langs: [], size: '', title: '', related: null, season: 0 };
        var m = html.match(/playerSources\s*=\s*(\[[\s\S]*?\]);/);
        if (m) { try { out.sources = JSON.parse(m[1]) || []; } catch (_) { out.sources = []; } }
        out.fid = (html.match(/maskedFileId\s*=\s*"([^"]+)"/) || [])[1] || '';
        out.lang = langName((html.match(/currentLangNative\s*=\s*"([^"]+)"/) || [])[1] || '');
        out.size = stripTags((html.match(/id="file-size-text"[^>]*>([^<]*)</) || [])[1] || '');
        out.title = stripTags((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
        out.season = +((html.match(/\blet\s+season\s*=\s*"?(\d+)/) || [])[1] || 0);
        var re = /class="lang-btn[^"]*"[^>]*data-fid="(sb_[^"]+)"\s+data-lang="([^"]+)"/g, x;
        while ((x = re.exec(html))) out.langs.push({ fid: x[1], lang: langName(x[2]) });
        var rm = html.match(/window\.relatedData\s*=\s*(\{[\s\S]*?\});\s*(?:\n|<\/script>)/);
        if (rm) { try { out.related = JSON.parse(rm[1]); } catch (_) { out.related = null; } }
        return out;
    }

    async function fetchStreamBeta(url) {
        var r = await withTimeout(get(url, SITE + '/'), 15000);
        if (r.status >= 400 || r.body.indexOf('playerSources') < 0) throw new Error('StreamBeta HTTP ' + r.status);
        return parseStreamBeta(r.body);
    }

    // HubCloud zipper link -> hubcloud drive id -> StreamBeta page URL
    async function hubToStreamBeta(zipperUrl) {
        var u = zipperUrl + (zipperUrl.indexOf('ad_done=') < 0 ? '&ad_done=1' : '');
        var r = await withTimeout(get(u, SITE + '/'), 12000);
        var href = (r.body.match(/data-href="([^"]+)"/) || [])[1] || '';
        href = decodeEntities(href);
        var id = (href.match(/hubcloud\.[a-z]+\/drive\/([A-Za-z0-9]+)/i) || [])[1];
        if (!id && /\/zipper\//.test(href)) {
            var r2 = await withTimeout(get(absUrl(href, 'https://codedew.com/'), u), 12000);
            id = ((decodeEntities((r2.body.match(/data-href="([^"]+)"/) || [])[1] || '')).match(/hubcloud\.[a-z]+\/drive\/([A-Za-z0-9]+)/i) || [])[1];
        }
        if (!id) throw new Error('HubCloud id not found');
        return SB + '?url=' + id;
    }

    // ───────────────────────── load ─────────────────────────

    async function load(url, cb) {
        try {
            var r = await get(url);
            if (r.status >= 400) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'RareAnimes returned HTTP ' + r.status });
            var html = r.body;
            var rawTitle = stripTags((html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '')
                || stripTags((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '').replace(/\s*-\s*Rare Toons India\s*$/i, '');
            var a = html.indexOf('<div class="entry-content'), b = html.indexOf('</article>', a);
            var content = a >= 0 ? html.slice(a, b > a ? b : undefined) : html;
            var text = stripTagsKeepNewlines(content.replace(/<(?:p|h\d|br|div|li)\b[^>]*>/gi, '\n'));

            var poster = '';
            var imgRe = /<img[^>]+src="([^"]+)"[^>]*>/g, im;
            while ((im = imgRe.exec(content))) {
                var tag = im[0], w = +((tag.match(/width="(\d+)"/) || [])[1] || 0), h = +((tag.match(/height="(\d+)"/) || [])[1] || 0);
                if (/wp-content\/uploads/.test(im[1]) && h > w) { poster = im[1].replace(/-\d+x\d+(\.\w+)$/, '$1'); break; }
            }
            var og = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || '';
            if (!poster) poster = og;

            var synopsis = infoField(text, ['Synopsis', 'Storyline', 'Plot']);
            var yearM = (infoField(text, ['Release Year', 'Year']) + ' ' + rawTitle).match(/\b(19[5-9]\d|20[0-4]\d)\b/);
            var genres = infoField(text, ['Genre']).split(/,|&|\band\b/).map(function (g) { return g.trim(); }).filter(function (g) { return g && g.length < 30; });
            var seasonNo = +((rawTitle.match(/\bseason\s*0*(\d+)/i) || [])[1] || (infoField(text, ['Season']).match(/^\s*0*(\d+)/) || [])[1] || 1);
            var type = guessType(rawTitle, '');

            var parsed = parseEpisodes(postLines(content));
            var episodes = [];

            if (parsed.episodes.length) {
                type = 'series';
                parsed.episodes.forEach(function (e) {
                    episodes.push(mkEpisode({
                        name: e.name ? ('Episode ' + e.n + ' – ' + e.name) : ('Episode ' + e.n),
                        url: JSON.stringify({ v: e.v, t: rawTitle }),
                        season: seasonNo, episode: e.n, posterUrl: poster,
                        description: e.v.map(function (v) { return v.l; }).join(' • ')
                    }));
                });
            } else if (parsed.loose.length && type === 'series' && parsed.loose.some(function (v) { return v.w; })) {
                // Season-level WatchNow link: StreamBeta knows every episode of the season.
                var first = parsed.loose.filter(function (v) { return v.w; })[0];
                var sb = null;
                try { sb = await fetchStreamBeta(first.w); } catch (_) { sb = null; }
                var group = null;
                if (sb && sb.related) {
                    var keys = Object.keys(sb.related);
                    keys.forEach(function (k) {
                        var g = sb.related[k];
                        if (!group && g && g.episodes && g.episodes.some(function (x) { return x.id === sb.fid; })) group = g;
                    });
                    if (!group) keys.forEach(function (k) { var g = sb.related[k]; if (!group && g && +g.season_no === seasonNo) group = g; });
                }
                if (group && group.episodes && group.episodes.length > 1) {
                    group.episodes.slice().sort(function (x, y) { return (x.e || 0) - (y.e || 0); }).forEach(function (x) {
                        episodes.push(mkEpisode({
                            name: x.ep_name && !/^episode \d+$/i.test(x.ep_name) ? ('Episode ' + x.e + ' – ' + x.ep_name) : ('Episode ' + x.e),
                            url: JSON.stringify({ f: x.id, t: rawTitle }),
                            season: +(x.s || group.season_no || seasonNo), episode: +(x.e || 0),
                            posterUrl: x.img || poster, description: x.overview || ''
                        }));
                    });
                } else {
                    episodes.push(mkEpisode({ name: 'Episode 1', url: JSON.stringify({ v: parsed.loose, t: rawTitle }), season: seasonNo, episode: 1, posterUrl: poster }));
                }
            } else if (parsed.loose.length) {
                episodes.push(mkEpisode({ name: cleanTitle(rawTitle), url: JSON.stringify({ v: parsed.loose, t: rawTitle }), season: 1, episode: 1, posterUrl: poster }));
            } else {
                // Only WatchMultiQuality / ZIP / Mega links: nothing the app can play.
                episodes.push(mkEpisode({ name: cleanTitle(rawTitle), url: JSON.stringify({ none: 1, t: rawTitle }), season: 1, episode: 1, posterUrl: poster }));
            }

            cb({
                success: true,
                data: mkItem({
                    title: cleanTitle(rawTitle),
                    url: url,
                    posterUrl: poster,
                    bannerUrl: og || poster,
                    type: type,
                    year: yearM ? +yearM[1] : undefined,
                    description: synopsis || decodeEntities(rawTitle),
                    tags: genres,
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: 'LOAD_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────────────────────── streams ─────────────────────────

    function qualityOf(title, size) {
        var m = String(title || '').match(/\b(2160|1440|1080|720|480|360)p\b/i);
        if (m) return m[1] + 'p';
        var mb = parseFloat(size) * (/GB/i.test(size) ? 1024 : 1);
        return mb >= 900 ? '1080p' : (mb > 0 ? 'HD' : 'Auto');
    }

    async function loadStreams(data, cb) {
        try {
            var d;
            try { d = JSON.parse(data); } catch (_) { d = { v: [{ l: 'Hindi', w: String(data), h: '' }] }; }
            if (d.none) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'This post only has WatchMultiQuality / ZIP links, which cannot be played in the app.' });

            // 1) one StreamBeta page per audio variant (WatchNow, or HubCloud as a fallback)
            var jobs = [];
            if (d.f) jobs.push({ label: '', task: function () { return fetchStreamBeta(SB + '?v=' + encodeURIComponent(d.f)); } });
            (d.v || []).forEach(function (v) {
                if (v.w) jobs.push({ label: v.l, task: function () { return fetchStreamBeta(v.w).catch(function (e) { if (v.h) return hubToStreamBeta(v.h).then(fetchStreamBeta); throw e; }); } });
                else if (v.h) jobs.push({ label: v.l, task: function () { return hubToStreamBeta(v.h).then(fetchStreamBeta); } });
            });
            var pages = await Promise.all(jobs.map(function (j) {
                return j.task().then(function (p) { p.label = j.label; return p; }).catch(function () { return null; });
            }));
            pages = pages.filter(Boolean);

            // 2) audio versions the post didn't link (e.g. Tamil/Telugu of a fid-only episode)
            var have = {};
            pages.forEach(function (p) { if (p.fid) have[p.fid] = 1; });
            var extra = [];
            pages.forEach(function (p) { p.langs.forEach(function (l) { if (!have[l.fid] && extra.length < 4) { have[l.fid] = 1; extra.push(l); } }); });
            if (extra.length) {
                var more = await Promise.all(extra.map(function (l) {
                    return fetchStreamBeta(SB + '?v=' + encodeURIComponent(l.fid)).then(function (p) { p.label = l.lang; return p; }).catch(function () { return null; });
                }));
                pages = pages.concat(more.filter(Boolean));
            }

            // 3) streams
            var list = [], seen = {}, seenFid = {};
            pages.forEach(function (p) {
                if (p.fid && seenFid[p.fid]) return;
                if (p.fid) seenFid[p.fid] = 1;
                var lang = p.lang || p.label || 'Hindi';
                var label = (p.label && /untouched|uncut/i.test(p.label)) ? p.label : lang;
                p.sources.forEach(function (s) {
                    var u = s.stream_url || s.url;
                    if (!u || seen[u] || /pixeldrain/i.test(s.type || '') || !/^https?:\/\//.test(u)) return;
                    seen[u] = 1;
                    var server = s.name || s.type || 'Server';
                    list.push(mkStream({
                        url: u,
                        source: label + ' • ' + server + (p.size ? ' • ' + p.size : ''),
                        quality: qualityOf(p.title, p.size),
                        headers: { 'User-Agent': UA }
                    }));
                });
            });
            if (!list.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No playable StreamBeta source for this episode.' });

            var verified = await verifyStreams(list, 2);
            if (!verified.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'All servers for this episode are down right now.' });
            cb({ success: true, data: verified });
        } catch (e) {
            cb({ success: false, errorCode: 'STREAM_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ── stream verification (TJ-Plugins shared helper) ─────────────────────────
    // Each candidate is requested once, with the exact headers the player will send.
    //   ok      -> HLS playlist / DASH manifest / media bytes  -> listed first
    //   unknown -> 401/403/426/429/timeout (often an IP/region block that works on a phone)
    //              -> kept after the verified ones, labelled "(may not play)"
    //   dead    -> 404/410/451/5xx, DNS failure, HTML error page -> dropped
    function __tjDeadline(promise, ms) {
        return new Promise(function (resolve) {
            const t = setTimeout(function () { resolve(null); }, ms);
            Promise.resolve(promise).then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(null); });
        });
    }
    async function __tjProbe(s) {
        const u = String((s && s.url) || "");
        if (!/^https?:\/\//i.test(u)) return "ok";
        if (/^https:\/\/video-downloads\.googleusercontent\.com\//i.test(u)) return "ok";
        const h = Object.assign({}, s.headers || {}, { "Range": "bytes=0-2047" });
        const r = await __tjDeadline(http_get(u, h), 9000);
        if (!r) return "unknown";
        const st = Number(r.status || r.statusCode || 0);
        const body = String(r.body || "").replace(/^\uFEFF/, "").replace(/^\s+/, "").slice(0, 600);
        if (st === 200 || st === 206) {
            if (/^#EXTM3U/.test(body) || /<MPD[\s>]/i.test(body)) return "ok";
            if (/^<(!doctype|html|head|body)/i.test(body)) return "dead";
            if (/^PK\u0003\u0004|^Rar!\u001a|^7z\u00bc\u00af/.test(body)) return "dead"; // ZIP/RAR/7z archive, not a video
            if (/^\{\s*"success"\s*:\s*false/.test(body)) return "dead";
            return "ok";
        }
        if (st === 0) {
            const err = String(r.error || "");
            if (/too ?large|exceed/i.test(err)) return "ok";
            return /host lookup|ENOTFOUND|getaddrinfo|No address/i.test(err) ? "dead" : "unknown";
        }
        if (st === 401 || st === 403 || st === 426 || st === 429) return "unknown";
        return "dead";
    }
    async function verifyStreams(list, maxUnverified) {
        const verdicts = await Promise.all(list.map(__tjProbe));
        const ok = [], unknown = [];
        list.forEach(function (s, i) {
            if (verdicts[i] === "ok") ok.push(s);
            else if (verdicts[i] === "unknown") unknown.push(s);
        });
        const keep = unknown.slice(0, Math.max(0, (maxUnverified == null ? 4 : maxUnverified) - Math.min(ok.length, 2)));
        keep.forEach(function (s) { s.source = String(s.source || "Stream") + " (may not play)"; });
        const out = ok.concat(keep), count = {}, idx = {};
        out.forEach(function (s) { const k = String(s.source || "Stream"); count[k] = (count[k] || 0) + 1; });
        out.forEach(function (s) {
            const k = String(s.source || "Stream");
            if (count[k] > 1) { idx[k] = (idx[k] || 0) + 1; s.source = k + " #" + idx[k]; }
        });
        return out;
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
