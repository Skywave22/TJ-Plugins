// ═══════════════════════════ All-in-one layer ═══════════════════════════
// Runs every embedded plugin in its own sandbox (own manifest, own globalThis, own settings keys)
// and merges them: one home page, one search, and all working links of a title from every site
// that has it.
var REAL = globalThis;
var SUBS = __AIO_SUBS;
var BY_ID = {};
SUBS.forEach(function (s) { BY_ID[s.meta.id] = s; });

var T_HOME = 20000, T_SEARCH = 15000, T_LOAD = 18000, T_STREAMS = 30000, T_ALL_STREAMS = 60000;

// ───────────── sandbox + calls ─────────────
function initSub(s) {
    if (s.api || s.dead) return s.api;
    try {
        var shadow = Object.create(REAL);               // reads fall through to the real globals,
        var pfx = 'aio.' + s.meta.id + '.';             // writes (globalThis.getHome = ...) stay here
        s.make.call(shadow, s.manifest, shadow,
            function (k) { return getPreference(pfx + k); },
            function (k, v) { return setPreference(pfx + k, v); });
        s.api = { getHome: shadow.getHome, search: shadow.search, load: shadow.load, loadStreams: shadow.loadStreams };
    } catch (e) {
        s.dead = String((e && e.message) || e);
    }
    return s.api;
}

// calls fn of a plugin like the app does (callback or returned promise, first answer wins)
function call(s, fn, args, ms) {
    return new Promise(function (resolve) {
        var done = false;
        function fin(r) {
            if (done) return;
            done = true;
            if (!r || typeof r !== 'object') r = { success: false, message: 'empty answer' };
            if (r.success === undefined && Array.isArray(r)) r = { success: true, data: r };
            resolve(r);
        }
        var api = initSub(s);
        if (!api || typeof api[fn] !== 'function') return fin({ success: false, message: s.meta.name + ' could not start: ' + s.dead });
        setTimeout(function () { fin({ success: false, errorCode: 'TIMEOUT', message: s.meta.name + ' took too long' }); }, ms);
        try {
            var ret = api[fn].apply(null, args.concat([fin]));
            if (ret && typeof ret.then === 'function') ret.then(function (v) { if (v !== undefined) fin(v); }, function (e) { fin({ success: false, message: String((e && e.message) || e) }); });
        } catch (e) {
            fin({ success: false, message: String((e && e.message) || e) });
        }
    });
}

// promise cache: concurrent and repeated calls share one request; failures are not kept
var MEMO = {};
function memo(key, ttl, fn) {
    var m = MEMO[key];
    if (m && Date.now() - m.t < ttl) return m.p;
    var p = fn();
    MEMO[key] = { t: Date.now(), p: p };
    p.then(function (r) { if (!r || r.success === false) delete MEMO[key]; });
    return p;
}
function subSearch(s, q) { return memo('s|' + s.meta.id + '|' + q.toLowerCase(), 20 * 60000, function () { return call(s, 'search', [q], T_SEARCH); }); }
function subLoad(s, url) { return memo('l|' + s.meta.id + '|' + url, 20 * 60000, function () { return call(s, 'load', [url], T_LOAD); }); }

// waits for all promises, or until `ms`; returns what finished (null for the rest)
function settleAll(promises, ms, earlyFrac, earlyMs) {
    return new Promise(function (resolve) {
        var res = promises.map(function () { return null; }), left = promises.length, t0 = Date.now(), over = false;
        function done() { if (!over) { over = true; resolve(res); } }
        function check() {
            if (left === 0) return done();
            if (earlyFrac && (promises.length - left) >= promises.length * earlyFrac && Date.now() - t0 >= earlyMs) done();
        }
        if (!left) return done();
        promises.forEach(function (p, i) {
            p.then(function (v) { res[i] = v; }, function () {}).then(function () { left--; check(); });
        });
        if (earlyFrac) setTimeout(check, earlyMs + 50);
        setTimeout(done, ms);
    });
}

// ───────────── titles ─────────────
var ENT = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };
function decode(s) {
    return String(s || '').replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
        .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
        .replace(/&([a-z]+);/gi, function (m, n) { return ENT[n.toLowerCase()] || m; });
}
var TAG_RE = /\b(hindi|english|tamil|telugu|malayalam|kannada|bengali|punjabi|urdu|korean|japanese|chinese|dubbed|dub|dual[\s-]*audio|multi[\s-]*audio|org|hq|hd|full\s+movie|web[\s-]*dl|web[\s-]*rip|hdrip|hdtc|hdts|bluray|brrip|dvdrip|camrip|pre[\s-]*dvd|x264|x265|hevc|10bit|esubs?|msubs?|subbed|uncensored|amzn|nf|dsnp|hmax|atvp|jhs|zee5|480p|720p|1080p|2160p|4k|uhd|complete|all\s+episodes?|web\s+series|tv\s+series|series|turkish\s+movie|korean\s+movie)\b/gi;
var ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

// → { clean: display title, norm: matching key, year, sh: season number in the title or null }
function parseTitle(raw) {
    var t = decode(raw).replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
    var year = null, sh = null, m;
    t = t.replace(/^\s*\[\s*18\+\s*\]\s*/, '').replace(/^\s*\(\s*18\+\s*\)\s*/, '').replace(/^(download|watch)\s+/i, '');
    // season: "Season 2", "(Season 1-4)", "S02", "2nd Season", "Second Season"
    var multi = /\bS\d{1,2}\s*[-–]\s*S?\d{1,2}\b|\bseasons?\s*\d{1,2}\s*[-–&,]\s*\d/i.test(t);   // packs: no single season
    if (multi) sh = null;
    else if ((m = t.match(/\bseasons?\s*0*(\d{1,2})(?!\s*[-–&,]\s*\d)/i))) sh = +m[1];
    else if ((m = t.match(/\bS0*(\d{1,2})(?:\s*E\d+)?\b(?!\s*[-–]\s*S?\d)/))) sh = +m[1];
    else if ((m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i))) sh = +m[1];
    else if ((m = t.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/i))) sh = ORD[m[1].toLowerCase()];
    if ((m = t.match(/[(\[]\s*((?:19|20)\d{2})\s*[)\]]/))) year = +m[1];
    else if ((m = t.match(/\s((?:19|20)\d{2})\b(?!\s*[-–:])/)) && m.index > 2) year = +m[1];
    var c = t;
    c = c.split(/\s[|•]\s|\s–\s(?=(?:episode|anime|korean|chinese|turkish|japanese|all\s|complete|movie|season)\b)/i)[0];
    c = c.replace(/\s+aka\s+.*$/i, '');
    var yp = c.search(/[(\[]\s*(19|20)\d{2}\s*[)\]]/);
    if (yp > 2) c = c.slice(0, yp);                      // "Name (2024) Season 2 Hindi ..." -> "Name"
    c = c.replace(/[(\[{][^)\]}]*[)\]}]/g, function (x) { return /\d|season|dub|audio|hindi|english|sub|hd|added|complete|org|movie|series|\bep/i.test(x) ? ' ' : x; });
    c = c.replace(/\b(seasons?\s*\d{1,2}(\s*[-–&,]\s*\d{1,2})*|S\d{1,2}(\s*[-–]\s*S?\d{1,2})*|\d{1,2}(st|nd|rd|th)\s+season|(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season)\b.*$/i, ' ');
    if (year) c = c.replace(new RegExp('\\s' + year + '\\b.*$'), ' ');
    c = c.replace(/\s+\d{1,2}(st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b.*$/i, ' ');
    c = c.replace(/(^|[^e]\s)movie\s*$/i, '$1');           // "Maa Tujhhe Salaam Movie", but keep "... The Movie"
    var clean = c.replace(TAG_RE, function (x, w, off) { return off > 0 ? ' ' : x; })
        .replace(/[(\[{]\s*[)\]}]/g, ' ').replace(/[(\[{][^)\]}]*$/, ' ').replace(/[\s:–—,-]+$/, '').replace(/\s+/g, ' ').trim();
    if (clean.length < 2) clean = decode(raw).trim();
    var norm = clean.normalize ? clean.normalize('NFKD').replace(/[\u0300-\u036f]/g, '') : clean;
    norm = norm.toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9\u0900-\u097f\u0600-\u06ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+/g, ' ').trim();
    norm = norm.replace(/^the\s+/, '').replace(/\s+the\s+movie$/, '');
    return { clean: clean, norm: norm, year: year, sh: sh };
}

// spelling-tolerant key: "Anupamaa" = "Anupama", "Shippuuden" = "Shippuden"
function loose(norm) { return String(norm).replace(/(.)\1+/g, '$1'); }

function isSeries(type) { return /series|tv|anime|drama|show/i.test(String(type || '')); }

// ───────────── merging items of many sites into cards ─────────────
function Merger() { this.byNorm = {}; this.list = []; }
Merger.prototype.add = function (sub, it) {
    if (!it || !it.url || !it.title) return null;
    var p = parseTitle(it.title);
    if (!p.norm) return null;
    var year = it.year ? +String(it.year).slice(0, 4) || p.year : p.year;
    var sh = p.sh && p.sh >= 2 ? p.sh : null;
    var nk = loose(p.norm);
    var groups = this.byNorm[nk] || (this.byNorm[nk] = []);
    var g = null;
    for (var i = 0; i < groups.length && !g; i++) {
        var c = groups[i];
        if (c.sh !== sh) continue;
        if (c.year && year && Math.abs(c.year - year) > 1 && !(sh || isSeries(c.type) || isSeries(it.type))) continue;
        if (c.year && year && Math.abs(c.year - year) > 1 && !sh && c.tmdb && sub.meta.tmdb) continue;
        if (c.tmdb && sub.meta.tmdb && isSeries(c.type) !== isSeries(it.type)) continue;
        g = c;
    }
    if (!g) {
        g = { norm: p.norm, sh: sh, year: year, type: sh && !isSeries(it.type) ? 'series' : it.type, title: p.clean, poster: it.posterUrl, item: it, tmdb: false, src: [], subs: {} };
        groups.push(g);
        this.list.push(g);
    }
    if (!g.subs[sub.meta.id]) {
        g.subs[sub.meta.id] = 1;
        g.src.push([sub.meta.id, it.url, p.sh || 0]);
    }
    if (sub.meta.tmdb && !g.tmdb) {           // TMDB catalogs have the cleanest title/poster/type
        g.tmdb = true; g.title = decode(it.title).trim() || g.title; g.type = it.type || g.type; g.item = it;
        if (it.posterUrl) g.poster = it.posterUrl;
        if (year) g.year = year;
    }
    if (!g.poster && it.posterUrl) g.poster = it.posterUrl;
    if (!g.year && year) g.year = year;
    return g;
};

// card links carry at most 6 sources (TMDB ones first: they open fastest); the full list stays in
// memory for this session, and any other site is searched when Play is pressed anyway
var FULLSRC = {};
function cardKey(t, y, h) { return loose(parseTitle(t).norm) + '|' + (h || 0) + '|' + (y || 0); }
function cardUrl(g) {
    var src = g.src.slice().sort(function (a, b) { return ((BY_ID[b[0]].meta.tmdb ? 1 : 0) - (BY_ID[a[0]].meta.tmdb ? 1 : 0)); });
    var key = cardKey(g.title, g.year, g.sh), prev = FULLSRC[key] || [];
    prev.forEach(function (x) { if (!src.some(function (y) { return y[0] === x[0]; })) src.push(x); });
    FULLSRC[key] = src;
    var tm = src.filter(function (x) { return BY_ID[x[0]].meta.tmdb; }).slice(0, 2);
    var rest = src.filter(function (x) { return tm.indexOf(x) < 0; })      // then other kinds of sites first
        .sort(function (a, b) { return (BY_ID[a[0]].meta.tmdb ? 1 : 0) - (BY_ID[b[0]].meta.tmdb ? 1 : 0); });
    var o = { t: g.title, y: g.year || 0, k: isSeries(g.type) ? 's' : 'm', h: g.sh || 0, s: tm.concat(rest).slice(0, 6) };
    return 'aio:' + JSON.stringify(o);
}
function allSources(a) {
    var full = FULLSRC[cardKey(a.t, a.y, a.h)] || [];
    var out = (a.s || []).slice();
    full.forEach(function (x) { if (!out.some(function (y) { return y[0] === x[0]; })) out.push(x); });
    return out;
}
function toCard(g) {
    var it = g.item || {};
    var o = {};
    ['description', 'bannerUrl', 'logoUrl', 'score', 'rating', 'status', 'contentRating', 'isAdult', 'genres', 'tags'].forEach(function (k) { if (it[k] !== undefined && it[k] !== null) o[k] = it[k]; });
    o.title = g.title + (g.sh ? ' (Season ' + g.sh + ')' : '');
    o.url = cardUrl(g);
    o.posterUrl = g.poster || it.posterUrl || '';
    o.type = g.type || it.type || 'movie';
    if (g.year) o.year = g.year;
    return new MultimediaItem(o);
}

// ───────────── home ─────────────
// [row name, row-name pattern, groups it may come from (null = all), item filter]
var ROWS = [
    ['Trending', /^(trending( now| movies| series| tv shows| tv series)?|hot today|top 10 (movies|shows))$/i, ['movies', 'hindi'], null, 36],
    ['Latest Movies', /latest (releases|movies|uploads)|in theaters|now playing|new releases|recently added|hollywood eng|^hollywood$/i, ['movies', 'hindi'], 'm', 40],
    ['Latest Series', /latest (tv|uploads|updated)|trending (series|tv)|on (the )?air|airing today|web series|tv series|hollywood series/i, ['movies', 'hindi'], 's', 40],
    ['Hindi Movies', /hindi movies|bollywood movies|^bollywood$|trending in cinema/i, ['movies', 'hindi'], 'm', 40],
    ['Hindi Dubbed & Dual Audio', /hindi dubbed|dual audio|south hindi|tv series dubbed/i, ['movies', 'hindi'], null, 40],
    ['Netflix', /netflix/i, null, null, 40],
    ['Prime Video', /prime|amazon/i, null, null, 40],
    ['Disney+ & JioHotstar', /disney|hotstar/i, null, null, 30],
    ['HBO & Apple TV+', /hbo|apple/i, null, null, 30],
    ['Popular Movies', /popular movies/i, null, null, 30],
    ['Popular Series', /popular (series|tv)/i, null, null, 30],
    ['Top Rated', /top rated/i, null, null, 30],
    ['Bollywood Series & Shows', /bollywood series|reality|game shows|^tv shows$/i, ['movies', 'hindi'], 's', 30],
    ['Hindi TV Serials', /^(trending|popular serials)$/i, ['serial'], null, 40],
    ['K-Drama & C-Drama', /drama|korean|chinese|turkish/i, null, null, 40],
    ['Anime', /anime|latest (uploads|updated|anime)|newly added|ongoing|^trending$|completed|dual audio/i, ['anime'], 's', 40],
    ['Anime (more sites)', /anime/i, ['movies', 'hindi'], null, 30],
    ['Anime Movies', /anime movies|animated movies/i, null, 'm', 30],
    ['Animation', /^animation$/i, null, null, 30],
    ['Action', /^action( movies)?$/i, ['movies'], null, 30],
    ['Comedy', /^comedy$/i, ['movies'], null, 30],
    ['Horror', /^horror( movies)?$/i, ['movies'], null, 30],
    ['Sci-Fi', /^sci(-| )?fi|science fiction/i, ['movies'], null, 30],
    ['Marvel & DC', /marvel|dc universe/i, null, null, 30],
    ['WWE', /wwe/i, null, null, 20],
];
function groupOf(s) { return s.meta.group; }

var HOME = null;
async function buildHome() {
    var results = await settleAll(SUBS.map(function (s) { return call(s, 'getHome', [], T_HOME); }), T_HOME + 2000);
    var merger = new Merger();
    var rowsOf = [];                                   // per plugin: [{name, groups[]}]
    results.forEach(function (r, i) {
        var s = SUBS[i];
        if (!r || r.success === false || !r.data || typeof r.data !== 'object') return;
        Object.keys(r.data).forEach(function (name) {
            var items = Array.isArray(r.data[name]) ? r.data[name] : [];
            var gs = [];
            items.forEach(function (it) {
                if (/^new (show|anime) updated on/i.test(String(it && it.title))) return;   // site banners, not titles
                var g = merger.add(s, it);
                if (g && gs.indexOf(g) < 0) gs.push(g);
            });
            if (gs.length) rowsOf.push({ sub: s, name: name, groups: gs });
        });
    });
    if (!rowsOf.length) return null;
    var data = {}, used = {};
    ROWS.forEach(function (R) {
        var lanes = rowsOf.filter(function (x) {
            if (R[2] && R[2].indexOf(groupOf(x.sub)) < 0) return false;
            return R[1].test(x.name);
        }).map(function (x) {
            return x.groups.filter(function (g) {
                if (R[3] === 'm') return !isSeries(g.type) && !g.sh;
                if (R[3] === 's') return isSeries(g.type) || !!g.sh;
                return true;
            });
        });
        // round-robin across the sites so every site shows up near the front
        var out = [], seen = {}, idx = 0, more = true;
        while (out.length < R[4] && more) {
            more = false;
            for (var l = 0; l < lanes.length && out.length < R[4]; l++) {
                var g = lanes[l][idx];
                if (g) { more = true; var k = g.norm + '|' + g.sh + '|' + g.year; if (!seen[k]) { seen[k] = 1; out.push(g); } }
            }
            idx++;
        }
        if (out.length >= 4) { data[R[0]] = out; used[R[0]] = 1; }
    });
    if (data['Anime (more sites)']) {                  // fold into Anime when that row exists
        if (data['Anime']) {
            var seenA = {};
            data['Anime'].forEach(function (g) { seenA[g.norm] = 1; });
            data['Anime'] = data['Anime'].concat(data['Anime (more sites)'].filter(function (g) { return !seenA[g.norm]; })).slice(0, 50);
            delete data['Anime (more sites)'];
        } else { data['Anime'] = data['Anime (more sites)']; delete data['Anime (more sites)']; }
    }
    var out = {};
    Object.keys(data).forEach(function (k) { out[k] = data[k].map(toCard); });
    return out;
}

async function getHome(cb) {
    try {
        if (!HOME || Date.now() - HOME.t > 15 * 60000) {
            var h = await buildHome();
            if (!h) return cb({ success: false, errorCode: 'SITE_OFFLINE', message: 'None of the sites answered. Check your connection and try again.' });
            HOME = { t: Date.now(), data: h };
        }
        cb({ success: true, data: HOME.data });
    } catch (e) {
        cb({ success: false, errorCode: 'PARSE_ERROR', message: 'All-in-one home failed: ' + ((e && e.message) || e) });
    }
}

// ───────────── search ─────────────
async function search(query, cb) {
    try {
        var q = String(query || '').trim();
        if (!q) return cb({ success: true, data: [] });
        var results = await settleAll(SUBS.map(function (s) { return subSearch(s, q); }), T_SEARCH + 1000, 0.9, 7000);
        var merger = new Merger(), rank = {};
        results.forEach(function (r, i) {
            if (!r || r.success === false || !Array.isArray(r.data)) return;
            r.data.slice(0, 40).forEach(function (it, pos) {
                var g = merger.add(SUBS[i], it);
                if (g) rank[merger.list.indexOf(g)] = Math.min(rank[merger.list.indexOf(g)] === undefined ? 1e9 : rank[merger.list.indexOf(g)], pos);
            });
        });
        var qn = parseTitle(q).norm, words = qn.split(' ').filter(Boolean);
        var scored = merger.list.map(function (g, i) {
            var score = 0;
            if (g.norm === qn) score += 100;
            else if (g.norm.indexOf(qn) === 0) score += 60;
            else if (words.every(function (w) { return (' ' + g.norm + ' ').indexOf(' ' + w) >= 0; })) score += 40;
            score += Math.min(g.src.length, 8) * 4;
            score -= Math.min(rank[i] || 0, 30);
            if (g.sh) score -= g.sh * 0.5;            // whole show / season 1 before later seasons
            return { g: g, score: score, i: i };
        }).sort(function (a, b) { return (b.score - a.score) || (a.i - b.i); });
        cb({ success: true, data: scored.slice(0, 120).map(function (x) { return toCard(x.g); }) });
    } catch (e) {
        cb({ success: false, errorCode: 'SEARCH_ERROR', message: 'All-in-one search failed: ' + ((e && e.message) || e) });
    }
}

// ───────────── details ─────────────
function parseAio(url) {
    var u = String(url || '');
    if (u.indexOf('aio:') !== 0 && u.indexOf('aioe:') !== 0) return null;
    try { return JSON.parse(u.slice(u.indexOf(':') + 1)); } catch (e) { return null; }
}
function eligible(primaryId, kind) {
    var pg = BY_ID[primaryId] ? BY_ID[primaryId].meta.group : 'movies';
    return SUBS.filter(function (s) {
        if (pg === 'serial') return s.meta.group === 'serial';
        if (s.meta.group === 'serial') return false;
        return true;
    });
}
function searchQuery(info) { return parseTitle(info.t).clean; }

async function load(url, cb) {
    try {
        var a = parseAio(url);
        if (!a || !a.s || !a.s.length) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'This entry is from an older All-in-one version, search for it again.' });
        a.s = allSources(a);
        // details from the best catalog: a TMDB-based site if there is one; otherwise open up to three
        // sites at once and keep the one with the most episodes (a full show beats a one-file post)
        var tm = a.s.filter(function (x) { return BY_ID[x[0]] && BY_ID[x[0]].meta.tmdb; });
        var rest = a.s.filter(function (x) { return BY_ID[x[0]] && !BY_ID[x[0]].meta.tmdb; });
        var item = null, prim = null, lastMsg = '';
        function ok(r) { return r && r.success !== false && r.data && r.data.title; }
        for (var i = 0; i < tm.length && i < 3 && !item; i++) {
            var r = await subLoad(BY_ID[tm[i][0]], tm[i][1]);
            if (ok(r) && (r.data.episodes || []).length) { item = r.data; prim = tm[i]; } else lastMsg = (r && r.message) || lastMsg;
        }
        for (var start = 0; !item && start < rest.length && start < 6; start += 3) {
            var batch = rest.slice(start, start + 3);
            var rs = await Promise.all(batch.map(function (x) { return subLoad(BY_ID[x[0]], x[1]); }));
            var bestN = 0;
            rs.forEach(function (r, j) {
                var n = ok(r) ? (r.data.episodes || []).length : 0;
                if (n > bestN) { bestN = n; item = r.data; prim = batch[j]; }
                else if (!ok(r)) lastMsg = (r && r.message) || lastMsg;
            });
        }
        if (!item) return cb({ success: false, errorCode: 'NOT_FOUND', message: lastMsg || 'None of the sites could open this title right now.' });

        var kind = a.k === 's' || isSeries(item.type) || (item.episodes && item.episodes.length > 1) ? 's' : 'm';
        var others = a.s.filter(function (x) { return x[0] !== prim[0]; });
        var primSh = prim[2] || a.h || 0;
        var info = { t: a.t || item.title, y: a.y || item.year || 0, k: kind, h: a.h || 0 };

        // warm up the search on every other site, so pressing Play is faster
        var q = searchQuery(info);
        eligible(prim[0], kind).forEach(function (s) { if (s.meta.id !== prim[0] && !others.some(function (x) { return x[0] === s.meta.id; })) subSearch(s, q); });

        var eps = (item.episodes || []).map(function (ep) {
            var S = +ep.season || 0, E = +ep.episode || 0;
            if (kind === 's') {
                if (primSh >= 2 && S <= 1) S = primSh;
                if (!S) S = 1;
            }
            var o = {};
            for (var k in ep) if (Object.prototype.hasOwnProperty.call(ep, k)) o[k] = ep[k];
            var d = BY_ID[prim[0]].meta.group === 'serial' && ep.airDate ? String(ep.airDate).slice(0, 10) : undefined;   // daily serials: sites number episodes differently, dates match
            o.url = 'aioe:' + JSON.stringify({ t: info.t, y: info.y, k: kind, h: info.h, S: S, E: E, d: d, p: [prim[0], ep.url], s: others });
            return new Episode(o);
        });
        var names = [BY_ID[prim[0]].meta.name].concat(others.map(function (x) { return BY_ID[x[0]] ? BY_ID[x[0]].meta.name : x[0]; }));
        var out = {};
        for (var key in item) if (Object.prototype.hasOwnProperty.call(item, key)) out[key] = item[key];
        out.url = url;
        out.title = (a.t || item.title) + (a.h ? ' (Season ' + a.h + ')' : '');
        out.episodes = eps;
        out.description = (item.description ? item.description + '\n\n' : '') + '▶ All-in-one: links from ' + names.join(', ') + ' and every other site that has it.';
        cb({ success: true, data: new MultimediaItem(out) });
    } catch (e) {
        cb({ success: false, errorCode: 'PARSE_ERROR', message: 'All-in-one could not open this title: ' + ((e && e.message) || e) });
    }
}

// ───────────── streams ─────────────
// finds the episode of a matched item on another site; null when it can't be matched safely
async function episodeOn(s, itemUrl, candSh, info) {
    var r = await subLoad(s, itemUrl);
    if (!r || r.success === false || !r.data) return null;
    var eps = r.data.episodes || [];
    if (!eps.length) return null;
    if (info.k === 'm') {
        if (eps.length > 2 || isSeries(r.data.type) && eps.length > 1) return null;
        return eps[0].url;
    }
    if (info.d) {
        var byDate = eps.filter(function (e) { return e.airDate && String(e.airDate).slice(0, 10) === info.d; })[0];
        return byDate ? byDate.url : null;
    }
    var S = info.S || 1, E = info.E;
    if (!E) return null;
    var exact = eps.filter(function (e) { return +e.season === S && +e.episode === E; })[0];
    if (exact) return exact.url;
    var seasons = {};
    eps.forEach(function (e) { seasons[+e.season || 0] = 1; });
    var ss = Object.keys(seasons).map(Number);
    var flat = ss.every(function (x) { return x <= 1; });
    if ((flat && (candSh === S || (!candSh && S === 1))) || (ss.length === 1 && candSh === S)) {
        if (eps.length < 2 && !isSeries(r.data.type)) return null;
        var byNum = eps.filter(function (e) { return +e.episode === E; })[0];
        return byNum ? byNum.url : null;
    }
    return null;
}

// search hits on a site that are the same title (same name, compatible year/season), best first
function pickMatches(list, info) {
    var want = parseTitle(info.t), out = [];
    (list || []).slice(0, 30).forEach(function (it, pos) {
        if (!it || !it.title || !it.url) return;
        var p = parseTitle(it.title);
        if (loose(p.norm) !== loose(want.norm)) return;
        var y = it.year ? +String(it.year).slice(0, 4) || p.year : p.year;
        var sh = p.sh || 0;
        if (info.k === 'm') {
            if (sh || (isSeries(it.type) && !/anime/i.test(it.type))) return;
            if (info.y && y && Math.abs(info.y - y) > 1) return;
        } else {
            var S = info.S || 1;
            if (sh && sh !== S && !(sh === 1 && S === 1)) return;
            if (!sh && info.y && y && Math.abs(info.y - y) > 1 && S === 1) return;
        }
        var score = (sh && sh === (info.S || 0) ? 4 : 0) + (y && info.y && Math.abs(y - info.y) <= 1 ? 2 : 0) + (it.posterUrl ? 1 : 0) - pos * 0.01;
        out.push({ url: it.url, sh: sh, score: score });
    });
    return out.sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
}
// first matched entry that really has the episode
async function firstEpisode(s, cands, info) {
    for (var i = 0; i < cands.length; i++) {
        var ep = await episodeOn(s, cands[i].url, cands[i].sh, info);
        if (ep) return ep;
    }
    return null;
}

var Q_RE = [[/1080|fhd/i, 100], [/720/, 80], [/2160|\b4k\b|uhd/i, 70], [/1440/, 72], [/576/, 50], [/480/, 45], [/360/, 30], [/240/, 20]];
function quality(s) {
    var t = (s.source || '') + ' ' + (s.quality || '');
    var lab = t.replace(/\b4k[-\s]?(hub|bk)\b/ig, '').replace(/\bmd-4k\b/ig, '');   // server names, not qualities
    var q = 60;
    for (var i = 0; i < Q_RE.length; i++) if (Q_RE[i][0].test(lab)) { q = Q_RE[i][1]; break; }
    if (q === 60 && /\bauto\b|adaptive/i.test(lab)) q = 90;
    var gb = sizeGB(t);
    if (gb > 8) q -= 40;
    return q;
}
function sizeGB(t) {
    var m = String(t).match(/(\d+(?:\.\d+)?)\s*(GB|MB)\b/i);
    return m ? (/gb/i.test(m[2]) ? +m[1] : +m[1] / 1024) : 0;
}
// nxsha-based sites: their HDHub/4K/castle scrapers used to return a season pack or another episode
// for TV requests. They match the episode now (Oct 2026), so only drop a stream when its own name
// proves it is the wrong one: a different SxxEyy in the label/file name, or a pack with no episode tag.
var NXSHA = { CineHD: 1, CineJoy: 1, Fmovies: 1, RiveStream: 1, Vidbox: 1, ScreenScape: 1, Cinezo: 1 };
function wrongEpisode(s, x, kind, S, E) {
    if (kind !== 's' || !NXSHA[s.meta.id]) return false;
    var lab = String(x.source || x.name || '');
    var u = String(x.url || '');
    try { u = decodeURIComponent(u); } catch (e) {}
    var m = (lab + ' ' + u.split('?')[0]).match(/\bS(\d{1,2})[\s._-]?E(\d{1,4})(?!\d)/i);
    if (m) return !!(S && E) && (+m[1] !== +S || +m[2] !== +E);
    if (!/hdhub|4k[-\s]?bk|4k[-\s]?hub|castle|moviesdrive/i.test(lab)) return false;
    return sizeGB(lab) > 4 || /\b(complete|pack|zip)\b/i.test(lab);
}

async function streamsFrom(s, epUrl, tag, kind, why, S, E) {
    var r = await call(s, 'loadStreams', [epUrl], T_STREAMS);
    if (!r || r.success === false || !Array.isArray(r.data)) { if (why) why[s.meta.id] = String((r && (r.errorCode || r.message)) || 'error').slice(0, 40); return []; }
    return r.data.filter(function (x) { return x && x.url && !wrongEpisode(s, x, kind, S, E); }).map(function (x, i) {
        var o = {};
        for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) o[k] = x[k];
        o.source = s.meta.name + ' · ' + (x.source || x.name || 'Server');
        var st = new StreamResult({ url: x.url, source: o.source, headers: x.headers, subtitles: x.subtitles, drmKid: x.drmKid, drmKey: x.drmKey, licenseUrl: x.licenseUrl });
        for (var k2 in o) if (st[k2] === undefined) st[k2] = o[k2];
        st.__o = { tag: tag, i: i, q: quality(x), weak: /may not play|unverified|backup|slow/i.test(String(x.source || '')), hi: /hindi|हिंदी|\bhin\b|dual|multi/i.test(String(x.source || '')) };
        return st;
    });
}

async function loadStreams(url, cb) {
    try {
        var a = parseAio(url);
        if (!a || !a.p) return cb({ success: false, errorCode: 'NOT_FOUND', message: 'This episode is from an older All-in-one version, open the title again.' });
        var info = { t: a.t, y: a.y, k: a.k, h: a.h, S: a.S, E: a.E, d: a.d };
        var tasks = [], tried = {}, why = {};
        var prim = BY_ID[a.p[0]];
        if (prim) { tried[prim.meta.id] = 1; tasks.push(streamsFrom(prim, a.p[1], 0, a.k, why, a.S, a.E)); }
        // sites already known to have the title
        (a.s || []).forEach(function (x) {
            var s = BY_ID[x[0]];
            if (!s || tried[s.meta.id]) return;
            tried[s.meta.id] = 1;
            tasks.push(episodeOn(s, x[1], x[2] || 0, info).then(function (ep) {
                if (!ep) { why[s.meta.id] = 'no-episode'; return []; }
                return streamsFrom(s, ep, 1, a.k, why, a.S, a.E);
            }));
        });
        // every other site: search, match, open, collect
        var q = searchQuery(info);
        eligible(a.p[0], a.k).forEach(function (s) {
            if (tried[s.meta.id]) return;
            tried[s.meta.id] = 1;
            tasks.push(subSearch(s, q).then(function (r) {
                var c = r && r.success !== false ? pickMatches(r.data, info) : [];
                if (!c.length) { why[s.meta.id] = 'not-found'; return null; }
                return firstEpisode(s, c, info).then(function (ep) { if (!ep) why[s.meta.id] = 'no-episode'; return ep; });
            }).then(function (ep) { return ep ? streamsFrom(s, ep, 2, a.k, why, a.S, a.E) : []; }));
        });
        var t0 = Date.now(), ids = Object.keys(tried), stat = {};
        tasks = tasks.map(function (p, i) { return p.then(function (l) { stat[ids[i]] = (l || []).length + '/' + Math.round((Date.now() - t0) / 1000) + 's'; return l; }); });
        var lists = await settleAll(tasks, T_ALL_STREAMS);
        try { console.log('[All-in-one] ' + a.t + (a.k === 's' ? ' S' + a.S + 'E' + a.E : '') + ' :: ' + ids.map(function (id) { return id + '=' + (stat[id] || 'pending') + (why[id] ? '(' + why[id] + ')' : ''); }).join(' ')); } catch (e) {}
        var all = [], seen = {};
        lists.forEach(function (l) { (l || []).forEach(function (st) { if (!seen[st.url]) { seen[st.url] = 1; all.push(st); } }); });
        if (!all.length) return cb({ success: false, errorCode: 'NO_STREAMS', message: 'No working links for this ' + (a.k === 's' ? 'episode' : 'title') + ' on any site right now. Try again later.' });
        all.sort(function (x, y) {
            var a1 = x.__o, b1 = y.__o;
            return ((a1.weak ? 1 : 0) - (b1.weak ? 1 : 0)) || (b1.q - a1.q) || ((b1.hi ? 1 : 0) - (a1.hi ? 1 : 0)) || (a1.tag - b1.tag) || (a1.i - b1.i);
        });
        all.forEach(function (st) { delete st.__o; });
        cb({ success: true, data: all });
    } catch (e) {
        cb({ success: false, errorCode: 'PARSE_ERROR', message: 'All-in-one could not collect links: ' + ((e && e.message) || e) });
    }
}

globalThis.getHome = getHome;
globalThis.search = search;
globalThis.load = load;
globalThis.loadStreams = loadStreams;
