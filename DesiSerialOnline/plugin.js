/*
 * DesiSerialOnline (Yo Desi Serial) — SkyStream plugin
 * Site:   https://desiserialonline.su   (WordPress, "sahifa" theme, REST API open)
 * Source: daily Hindi TV serials and reality shows
 *
 * Model:
 *   show    = WP category (/category/<slug>/)  -> MultimediaItem (series)
 *   episode = WP post in that category        -> Episode (chronological, airDate = post date)
 *   poster  = the posts' featured image (the site uses the show artwork for every episode)
 *
 * Flow:
 *   catalog : /wp-json/wp/v2/posts (latest), /categories, /media?include=  (posters in one call)
 *   search  : /categories?search=  +  /posts?search=  (mapped back to their shows)
 *   streams : post page -> .single-post-video iframes ("HD Player – P1", "P2", … = parts)
 *             - vkspeed.com/embed-<id>.html : P.A.C.K.E.R. JW Player -> direct MP4 (360p/192p)
 *             - vidup.site/play?cd=…        : wraps blogger.com/video.g?token=…  ->
 *               BloggerVideoPlayerUi batchexecute (rpc WcwnYd) -> googlevideo MP4 (itag 22/18)
 *
 * Exports: getHome / search / load / loadStreams
 */

(function () {

    'use strict';

    var SITE = (typeof manifest !== 'undefined' && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, '')
        : 'https://desiserialonline.su';
    var API = SITE + '/wp-json/wp/v2';
    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    // generic site categories that are not shows
    var NOT_SHOW = { 'uncategorized': 1, 'desi-serial': 1 };
    var REALITY = /bigg boss|idol|dancer|khatron|crorepati|kapil|laughter|shark tank|masterchef|splitsvilla|lock ?upp|rise and fall|wheel of fortune|game show|playground|hustle|latent|full house|top 1|roadies|super star|superstar|singer|dance|got talent|chefs|alliance|the 50|ideabaaz/i;
    var ITAG = { 37: '1080p', 22: '720p', 59: '480p', 18: '360p', 43: '360p', 36: '240p', 17: '144p' };

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

    function originOf(u) {
        var m = String(u || '').match(/^(https?:\/\/[^\/?#]+)/i);
        return m ? m[1] : SITE;
    }

    function absUrl(u, base) {
        u = decodeEntities(String(u || '').trim());
        if (/^https?:\/\//i.test(u)) return u;
        if (u.indexOf('//') === 0) return 'https:' + u;
        return originOf(base) + (u.charAt(0) === '/' ? '' : '/') + u;
    }

    async function get(url, referer, extra) {
        var h = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8', 'Referer': referer || SITE + '/' };
        if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        var res = await http_get(url, h);
        if (!res || typeof res !== 'object') res = { status: 200, body: String(res || '') };
        return { status: Number(res.status || res.statusCode || 0), body: String(res.body || ''), finalUrl: res.finalUrl || url };
    }

    async function post(url, body, headers) {
        var h = { 'User-Agent': UA };
        Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
        var res = await http_post(url, h, body);
        if (!res || typeof res !== 'object') res = { status: 200, body: String(res || '') };
        return { status: Number(res.status || res.statusCode || 0), body: String(res.body || '') };
    }

    async function api(path) {
        var r = await get(API + path, SITE + '/', { 'Accept': 'application/json' });
        if (r.status >= 400) throw new Error('HTTP ' + r.status + ' for ' + path.split('?')[0]);
        return JSON.parse(r.body);
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

    function daysAgo(dateStr) {
        var t = Date.parse(String(dateStr || '').replace(' ', 'T'));
        return isFinite(t) ? (Date.now() - t) / 86400000 : 9999;
    }

    function isShow(cat) { return cat && cat.count > 0 && !NOT_SHOW[cat.slug]; }

    // first show category of a post
    function showOf(p, catsById) {
        var ids = p.categories || [];
        for (var i = 0; i < ids.length; i++) { var c = catsById[ids[i]]; if (c && isShow(c)) return c; }
        return null;
    }

    async function allCategories() {
        var first = await api('/categories?per_page=100&page=1&orderby=count&order=desc&_fields=id,name,slug,count,link');
        var cats = Array.isArray(first) ? first : [];
        if (cats.length === 100) {
            try { var more = await api('/categories?per_page=100&page=2&orderby=count&order=desc&_fields=id,name,slug,count,link'); if (Array.isArray(more)) cats = cats.concat(more); } catch (_) {}
        }
        return cats.map(function (c) { c.name = decodeEntities(c.name); return c; });
    }

    async function mediaUrls(ids) {
        var map = {}, uniq = [];
        ids.forEach(function (id) { if (id && uniq.indexOf(id) < 0) uniq.push(id); });
        var chunks = [];
        for (var i = 0; i < uniq.length; i += 100) chunks.push(uniq.slice(i, i + 100));
        await Promise.all(chunks.map(function (ch) {
            return api('/media?per_page=100&include=' + ch.join(',') + '&_fields=id,source_url')
                .then(function (arr) {
                    (arr || []).forEach(function (m) {
                        var u = m.source_url;
                        if (!u) { try { var sz = m.media_details.sizes; u = (sz.full || sz.medium_large || sz['tie-large'] || {}).source_url; } catch (_) {} }
                        if (u) map[m.id] = u;
                    });
                }).catch(function () {});
        }));
        return map;
    }

    // Builds show items; posters come from the newest post of each show.
    async function showItems(cats, posts, catsById) {
        var latest = {};   // catId -> newest post (with artwork when possible)
        var wanted = {};
        cats.forEach(function (c) { wanted[c.id] = 1; });
        function take(p) {
            (p.categories || []).forEach(function (cid) {
                if (!wanted[cid]) return;
                var cur = latest[cid];
                if (!cur) latest[cid] = p;
                else if (!cur.featured_media && p.featured_media) { latest[cid] = { id: p.id, date: cur.date, categories: p.categories, featured_media: p.featured_media }; }
            });
        }
        (posts || []).forEach(take);
        function missingIds() { return cats.filter(function (c) { return !latest[c.id] || !latest[c.id].featured_media; }).map(function (c) { return c.id; }); }
        var missing = missingIds();
        for (var round = 0; round < 4 && missing.length > 3; round++) {
            try {
                var extra = await api('/posts?per_page=100&categories=' + missing.slice(0, 60).join(',') + '&_fields=id,date,categories,featured_media');
                (extra || []).forEach(take);
            } catch (_) { break; }
            var before = missing.length;
            missing = missingIds();
            if (missing.length === before) break;
        }
        if (missing.length) {
            await Promise.all(missing.slice(0, 25).map(function (cid) {
                return withTimeout(api('/posts?per_page=3&categories=' + cid + '&_fields=id,date,categories,featured_media'), 9000)
                    .then(function (arr) { (arr || []).forEach(take); }).catch(function () {});
            }));
        }
        var media = await mediaUrls(cats.map(function (c) { return latest[c.id] && latest[c.id].featured_media; }));
        return cats.map(function (c) {
            var lp = latest[c.id];
            return mkItem({
                title: c.name,
                url: c.link,
                posterUrl: (lp && media[lp.featured_media]) || '',
                type: 'series',
                description: c.count + ' episodes' + (lp ? ' • last updated ' + String(lp.date).slice(0, 10) : ''),
                _last: lp ? lp.date : ''
            });
        });
    }

    function clean(it) { delete it._last; return it; }

    // ───────────────────────── catalog ─────────────────────────

    async function getHome(cb) {
        try {
            var res = await Promise.all([
                allCategories(),
                api('/posts?per_page=100&page=1&_fields=id,link,title,date,categories,featured_media'),
                api('/posts?per_page=100&page=2&_fields=id,link,title,date,categories,featured_media').catch(function () { return []; })
            ]);
            var cats = res[0].filter(function (c) { return isShow(c) && c.count > 1; }), posts = (res[1] || []).concat(res[2] || []);
            var byId = {};
            res[0].forEach(function (c) { byId[c.id] = c; });

            var shows = await showItems(cats, posts, byId);
            var showByUrl = {};
            shows.forEach(function (s) { showByUrl[s.url] = s; });

            // latest episodes (open the show)
            var seenEp = {}, latestEps = [];
            posts.forEach(function (p) {
                var c = showOf(p, byId);
                if (!c || seenEp[p.link] || latestEps.length >= 30) return;
                seenEp[p.link] = 1;
                var sh = showByUrl[c.link];
                latestEps.push(mkItem({
                    title: decodeEntities(p.title && p.title.rendered),
                    url: p.link,
                    posterUrl: sh ? sh.posterUrl : '',
                    type: 'series',
                    description: c.name + ' • ' + String(p.date).slice(0, 10)
                }));
            });

            var updated = shows.filter(function (s) { return s._last && daysAgo(s._last) < 10; })
                .sort(function (a, b) { return String(b._last).localeCompare(String(a._last)); });
            var popular = shows.filter(function (s) { return !REALITY.test(s.title); });
            var reality = shows.filter(function (s) { return REALITY.test(s.title); });
            var ended = shows.filter(function (s) { return !s._last || daysAgo(s._last) >= 10; });

            var data = {};
            if (updated.length) data['Trending'] = updated.slice(0, 30).map(clean);
            if (latestEps.length) data['Latest Episodes'] = latestEps;
            if (popular.length) data['Popular Serials'] = popular.slice(0, 40).map(clean);
            if (reality.length) data['Reality & Game Shows'] = reality.map(clean);
            var az = shows.slice().sort(function (a, b) { return a.title.localeCompare(b.title); });
            if (az.length) data['All Shows (A-Z)'] = az.map(clean);
            if (ended.length) data['Ended / Off Air'] = ended.map(clean);
            if (!Object.keys(data).length) return cb({ success: false, errorCode: 'UNAVAILABLE', message: 'DesiSerialOnline returned no content (' + SITE + ')' });
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String((e && e.message) || e) });
        }
    }

    async function search(query, cb) {
        try {
            var q = String(query || '').trim();
            if (!q) return cb({ success: true, data: [] });
            var enc = encodeURIComponent(q);
            var res = await Promise.all([
                allCategories(),
                api('/categories?per_page=30&search=' + enc + '&_fields=id').catch(function () { return []; }),
                api('/posts?per_page=50&search=' + enc + '&_fields=id,date,categories,featured_media').catch(function () { return []; })
            ]);
            var byId = {};
            res[0].forEach(function (c) { byId[c.id] = c; });
            var picked = [], seen = {};
            (res[1] || []).forEach(function (c) { var cc = byId[c.id]; if (isShow(cc) && !seen[cc.id]) { seen[cc.id] = 1; picked.push(cc); } });
            (res[2] || []).forEach(function (p) { var cc = showOf(p, byId); if (cc && !seen[cc.id]) { seen[cc.id] = 1; picked.push(cc); } });
            if (!picked.length) {
                // loose match on show names ("yrkkh", "kumkum", partial words)
                var words = q.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 2; });
                res[0].filter(isShow).forEach(function (c) {
                    var n = c.name.toLowerCase();
                    if (words.length && words.every(function (w) { return n.indexOf(w) >= 0; }) && !seen[c.id]) { seen[c.id] = 1; picked.push(c); }
                });
            }
            var items = await showItems(picked, res[2] || [], byId);
            cb({ success: true, data: items.map(clean) });
        } catch (e) {
            cb({ success: false, errorCode: 'SEARCH_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────────────────────── details ─────────────────────────

    function episodeLabel(title, showName) {
        var t = decodeEntities(title).replace(/\s+/g, ' ').trim();
        var n = showName.replace(/\s+(?:TV\s+)?Serial$/i, '');
        [showName, n].forEach(function (pre) {
            if (pre && t.toLowerCase().indexOf(pre.toLowerCase()) === 0) t = t.slice(pre.length);
        });
        t = t.replace(/^[\s\-–:|]+/, '');
        var epNo = (t.match(/\bEpisode\s*(\d+)\b/i) || [])[1];
        var date = (t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*,?\s*((?:19|20)\d{2})?/) || []);
        var out = date[0] ? (date[1] + ' ' + date[2].slice(0, 3) + (date[3] ? ' ' + date[3] : '')) : t.replace(/\b(?:Full|Video|Episode|Online|Watch|HD)\b/gi, '').replace(/\s+/g, ' ').trim();
        if (epNo) out += (out ? ' • ' : '') + 'Ep ' + epNo;
        return out || t || 'Episode';
    }

    async function load(url, cb) {
        try {
            var u = String(url || '').trim();
            var cat = null;
            var catSlug = (u.match(/\/category\/([^\/?#]+)/) || [])[1];
            if (catSlug) {
                var cs = await api('/categories?slug=' + encodeURIComponent(catSlug) + '&_fields=id,name,slug,count,link,description');
                cat = cs && cs[0];
            } else {
                var slug = (u.replace(/[?#].*$/, '').match(/\/([^\/]+)\/?$/) || [])[1];
                if (!slug) return cb({ success: false, errorCode: 'BAD_URL', message: 'Unrecognised URL: ' + u });
                var res = await Promise.all([
                    api('/posts?slug=' + encodeURIComponent(slug) + '&_fields=id,categories'),
                    allCategories()
                ]);
                var p = res[0] && res[0][0];
                if (p) {
                    var byId = {};
                    res[1].forEach(function (c) { byId[c.id] = c; });
                    var sc = showOf(p, byId);
                    if (sc) {
                        var full = await api('/categories/' + sc.id + '?_fields=id,name,slug,count,link,description');
                        cat = full;
                    }
                }
            }
            if (!cat || !cat.id) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'Show not found for ' + u });
            var name = decodeEntities(cat.name);

            // episodes: newest first from the API, up to 1000
            var pages = Math.min(10, Math.max(1, Math.ceil((cat.count || 1) / 100)));
            var lists = await Promise.all(Array.apply(null, Array(pages)).map(function (_, i) {
                return api('/posts?per_page=100&page=' + (i + 1) + '&categories=' + cat.id + '&_fields=id,link,title,date,featured_media')
                    .catch(function () { return []; });
            }));
            var posts = [], seen = {};
            lists.forEach(function (l) { (l || []).forEach(function (p) { if (!seen[p.id]) { seen[p.id] = 1; posts.push(p); } }); });
            // drop articles ("<Show> Cast, Story & Watching Guide") — episodes carry an air date or "Episode"
            var isEp = function (p) {
                var t = decodeEntities(p.title && p.title.rendered);
                if (/\b(?:cast|story|guide|review|synopsis|all episodes list)\b/i.test(t) && !/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t)) return false;
                return true;
            };
            if (posts.some(isEp)) posts = posts.filter(isEp);
            posts.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });

            var poster = '';
            var fm = posts.length ? posts[posts.length - 1].featured_media : 0;
            if (fm) { try { poster = (await mediaUrls([fm]))[fm] || ''; } catch (_) {} }

            var episodes = posts.map(function (p, i) {
                return mkEpisode({
                    name: episodeLabel(p.title && p.title.rendered, name),
                    url: p.link,
                    season: 1,
                    episode: i + 1,
                    airDate: String(p.date || '').slice(0, 10),
                    posterUrl: poster,
                    description: decodeEntities(p.title && p.title.rendered)
                });
            });
            if (!episodes.length) episodes = [mkEpisode({ name: 'No episodes yet', url: cat.link, season: 1, episode: 1, posterUrl: poster })];

            var last = posts.length ? posts[posts.length - 1].date : '';
            var first = posts.length ? posts[0].date : '';
            var desc = stripTags(cat.description || '');
            var extra = (cat.count || posts.length) + ' episodes' + (first ? ' • ' + String(first).slice(0, 10) + ' → ' + String(last).slice(0, 10) : '');
            var item = {
                title: name,
                url: cat.link,
                posterUrl: poster,
                bannerUrl: poster,
                type: 'series',
                description: (desc ? desc + '\n\n' : '') + extra,
                status: daysAgo(last) < 10 ? 'ongoing' : 'completed',
                tags: [REALITY.test(name) ? 'Reality Show' : 'Drama', 'Hindi'],
                episodes: episodes
            };
            var y = parseInt(String(first).slice(0, 4), 10);
            if (y) item.year = y;
            cb({ success: true, data: mkItem(item) });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String((e && e.message) || e) });
        }
    }

    // ───────────────────────── extractors ─────────────────────────

    // Dean Edwards P.A.C.K.E.R. unpacker
    function unpackPacked(src) {
        var m = String(src).match(/}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!m) return '';
        var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'), a = parseInt(m[2], 10), c = parseInt(m[3], 10), k = m[4].split('|');
        var ALPHA = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        function dec(w) {
            if (a <= 36) return parseInt(w, a);
            var n = 0;
            for (var i = 0; i < w.length; i++) n = n * a + ALPHA.indexOf(w.charAt(i));
            return n;
        }
        return p.replace(/\b\w+\b/g, function (w) {
            var i = dec(w);
            return (i < c && k[i]) ? k[i] : w;
        });
    }

    async function extractVkSpeed(embedUrl) {
        var r = await get(embedUrl, SITE + '/');
        if (r.status >= 400) throw new Error('vkspeed ' + r.status);
        var js = r.body;
        if (/eval\(function\(p,a,c,k,e,[rd]\)/.test(js)) {
            var un = unpackPacked(js);
            if (!un && typeof getAndUnpack === 'function') { try { un = String(await getAndUnpack(js)); } catch (_) {} }
            js = un || js;
        }
        var srcBlock = (js.match(/sources\s*:\s*\[([\s\S]*?)\]/) || [])[1] || js;
        var out = [], re = /file\s*:\s*"([^"]+)"(?:\s*,\s*label\s*:\s*"([^"]*)")?/g, m;
        while ((m = re.exec(srcBlock))) {
            if (/\.(?:jpg|png|vtt|srt)(?:\?|$)/i.test(m[1])) continue;
            out.push({ url: absUrl(m[1], embedUrl), quality: m[2] || 'Auto' });
        }
        var origin = originOf(r.finalUrl || embedUrl);
        return out.map(function (s) { s.headers = { 'User-Agent': UA, 'Referer': origin + '/' }; s.host = 'VKSpeed'; return s; });
    }

    async function bloggerStreams(token) {
        var freq = JSON.stringify([[['WcwnYd', JSON.stringify([token, '', 0]), null, 'generic']]]);
        var r = await post('https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute?rpcids=WcwnYd&source-path=%2Fvideo.g&hl=en-US&rt=c',
            'f.req=' + encodeURIComponent(freq),
            { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'Origin': 'https://www.blogger.com', 'Referer': 'https://www.blogger.com/video.g?token=' + token });
        if (r.status >= 400) throw new Error('blogger ' + r.status);
        var out = [];
        r.body.split('\n').forEach(function (line) {
            if (line.indexOf('"wrb.fr"') < 0) return;
            try {
                var arr = JSON.parse(line);
                arr.forEach(function (e) {
                    if (e[0] !== 'wrb.fr' || typeof e[2] !== 'string') return;
                    var inner = JSON.parse(e[2]);
                    (inner[2] || []).forEach(function (s) {
                        if (!s || typeof s[0] !== 'string') return;
                        var itag = s[1] && s[1][0];
                        out.push({ url: s[0], quality: ITAG[itag] || 'Auto', itag: itag, headers: { 'User-Agent': UA }, host: 'Blogger' });
                    });
                });
            } catch (_) {}
        });
        out.sort(function (a, b) { return (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0); });
        return out;
    }

    async function extractVidUp(playUrl) {
        var tok = (playUrl.match(/blogger\.com\/video\.g\?token=([^&"']+)/) || [])[1];
        if (!tok) {
            var r = await get(playUrl, SITE + '/');
            if (r.status >= 400) throw new Error('vidup ' + r.status);
            tok = (r.body.match(/blogger\.com\/video\.g\?token=([^&"'\s]+)/) || [])[1];
        }
        if (!tok) throw new Error('vidup: no blogger token');
        return bloggerStreams(decodeEntities(tok));
    }

    function playerIframes(html) {
        var i = html.indexOf('single-post-video');
        var block = i >= 0 ? html.slice(i, html.indexOf('post-inner', i) > 0 ? html.indexOf('post-inner', i) : i + 20000) : '';
        if (!block || !/<iframe/i.test(block)) {
            var e = html.indexOf('entry'), end = html.indexOf('post-tag', e);
            block = html.slice(Math.max(0, e), end > e ? end : e + 40000);
        }
        var out = [], seen = {}, re = /<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi, m;
        while ((m = re.exec(block))) {
            var u = absUrl(m[1], SITE);
            if (seen[u] || /facebook|twitter|youtube\.com\/embed\/videoseries|histats|google\.com\/maps/i.test(u)) continue;
            seen[u] = 1;
            var before = block.slice(Math.max(0, m.index - 300), m.index);
            var lab = (before.match(/(?:P|Part)\s*[-–]?\s*(\d+)\s*<\/[^>]+>\s*$/i) || [])[1];
            out.push({ url: u, part: lab ? parseInt(lab, 10) : 0 });
        }
        out.forEach(function (f, idx) { if (!f.part) f.part = idx + 1; });
        return out;
    }

    async function loadStreams(data, cb) {
        try {
            var url = String(data || '').trim();
            if (/\/category\//.test(url)) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'This show has no episodes yet.' });
            var r = await get(url);
            if (r.status >= 400) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'HTTP ' + r.status + ' for ' + url });
            var frames = playerIframes(r.body);
            if (!frames.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No video player on this episode page.' });

            var parts = frames.length;
            var results = await Promise.all(frames.map(function (f) {
                var job;
                if (/vkspeed\.|\/embed-[a-z0-9]+\.html/i.test(f.url)) job = extractVkSpeed(f.url);
                else if (/vidup\.|blogger\.com\/video\.g/i.test(f.url)) job = extractVidUp(f.url);
                else return Promise.resolve([]);
                return withTimeout(job, 15000).then(function (list) {
                    return list.map(function (s) { s.part = f.part; return s; });
                }).catch(function () { return []; });
            }));

            // best quality of every part first (Part 1, Part 2, …), then the lower qualities
            var best = [], rest = [];
            results.forEach(function (list) { list.forEach(function (s, i) { (i === 0 ? best : rest).push(s); }); });
            var byPart = function (a, b) { return a.part - b.part; };
            best.sort(byPart); rest.sort(byPart);
            var seen = {}, list = [];
            best.concat(rest).forEach(function (s) {
                if (seen[s.url]) return;
                seen[s.url] = 1;
                var label = (parts > 1 ? 'Part ' + s.part + '/' + parts + ' • ' : '') + s.host + ' • ' + s.quality;
                list.push(mkStream({ url: s.url, source: label, quality: s.quality, headers: s.headers }));
            });
            if (!list.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'The video host for this episode is not supported or is down.' });

            var verified = await verifyStreams(list, 2);
            if (!verified.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'All players for this episode are down right now.' });
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
        if (!/^https?:\/\//i.test(u)) return "ok"; // magnet:, magic_m3u8:, MAGIC_PROXY… resolved by the app
        // Freshly minted Google download links ignore Range and stream the whole
        // file; probing them only burns data (and crashes the CLI, which buffers it).
        if (/^https:\/\/video-downloads\.googleusercontent\.com\//i.test(u)) return "ok";
        const h = Object.assign({}, s.headers || {}, { "Range": "bytes=0-2047" });
        const r = await __tjDeadline(http_get(u, h), 9000);
        if (!r) return "unknown";
        const st = Number(r.status || r.statusCode || 0);
        const body = String(r.body || "").replace(/^\uFEFF/, "").replace(/^\s+/, "").slice(0, 600);
        if (st === 200 || st === 206) {
            if (/^#EXTM3U/.test(body) || /<MPD[\s>]/i.test(body)) return "ok";
            if (/^<(!doctype|html|head|body)/i.test(body)) return "dead";
            return "ok";
        }
        if (st === 0) {
            const err = String(r.error || "");
            // The app refuses bodies over 8 MB (it hangs up on the Content-Length):
            // a server that ignores Range and sends a huge body is serving the file.
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
