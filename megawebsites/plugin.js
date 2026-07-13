/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  MEGA INDIA AGGREGATOR — 9 Sites in One Plugin                       ║
 * ║  Sources: Movies4u | Vegamovies | HDHub4u | AnimeVilla | FilmyFly   ║
 * ║           HindMovie | MovieBox | MoviesMod | Bolly4u                ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 *  MOVIEBox SETUP: Replace __MOVIEBOX_SECRET_B64__ below with the real
 *  base64-encoded secret extracted from the MovieBox APK.
 */
(function () {
  "use strict";

  const MOVIEBOX_SECRET_B64 = "__MOVIEBOX_SECRET_B64__";
  const MOVIEBOX_HAS_SECRET = MOVIEBOX_SECRET_B64.indexOf("__") !== 0;

  /* ════════════════════════════════════════════════════════════════════
     SOURCE CONFIGURATION — 9 Sites
     ════════════════════════════════════════════════════════════════════ */

  const SOURCES = [
    /* ─── 1. Movies4u ─── */
    {
      id: "movies4u",
      name: "Movies4u",
      baseUrl: "https://new1.movies4u.clinic",
      type: "html",
      enabled: true,
      categories: ["Movie", "TvSeries"],
      searchUrls: [(q) => `https://new1.movies4u.clinic/?s=${encodeURIComponent(q)}`],
      urlMatch: (u) => /movies4u\.clinic/i.test(u),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "text/html" },
      sel: {
        homeBlock: /<article[\s\S]*?<\/article>/gi,
        homeTitle: /<h3[^>]*>\s*<a[^>]*href="[^"]+"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i,
        homeLink: /<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>\s*<\/h3>/i,
        homePoster: /<img[^>]*src="(https:\/\/image\.tmdb\.org\/t\/p\/w\d+\/[^"]+)"/i,
        searchBlock: /<article[\s\S]*?<\/article>/gi,
        detailTitle: /<h1[^>]*>([\s\S]*?)<\/h1>/i,
        detailPoster: /<h1[\s\S]*?<img[^>]*src="(https:\/\/image\.tmdb\.org\/t\/p\/w\d+\/[^"]+)"/i,
        detailDesc: /Storyline:?\s*<\/h\d>\s*<p>([\s\S]*?)<\/p>/i,
        streamLink: /<a[^>]*href="(https:\/\/(?:m4ulinks\.site|m4uplay\.store)\/[^"]+)"[^>]*>/gi,
        streamDirect: /https?:\/\/[^\s"<>]+\.(?:mp4|m3u8)/gi,
        streamMagnet: /href="(magnet:\?xt=urn:btih:[^"]+)"/gi,
      },
    },

    /* ─── 2. Vegamovies ─── */
    {
      id: "vegamovies",
      name: "Vegamovies",
      baseUrl: "https://vegamovies.navy",
      type: "html",
      enabled: true,
      categories: ["Movie", "TvSeries"],
      searchUrls: [
        (q) => `https://vegamovies.navy/search.php?q=${encodeURIComponent(q)}`,
        (q) => `https://vegamovies.navy/search.html?q=${encodeURIComponent(q)}`
      ],
      urlMatch: (u) => /vegamovies\./i.test(u),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "text/html", Referer: "https://vegamovies.navy/" },
      sel: {
        homeBlock: /<a[^>]*href="https:\/\/vegamovies\.navy\/[^"]+"[^>]*>[\s\S]{0,3000}?<div class="poster-card">[\s\S]*?<\/div>[\s\S]{0,500}?<\/a>/gi,
        homeTitle: /<p class="poster-title">([\s\S]*?)<\/p>/i,
        homeLink: /<a[^>]*href="(https:\/\/vegamovies\.navy\/[^"]+)"[^>]*>[\s\S]*?<div class="poster-card">/i,
        homePoster: /data-src="(https:\/\/(?:image\.tmdb\.org|vegamovies\.navy)[^"]+)"/i,
        searchBlock: /<a[^>]*href="https:\/\/vegamovies\.navy\/[^"]+"[^>]*>[\s\S]{0,3000}?<div class="poster-card">[\s\S]*?<\/div>[\s\S]{0,500}?<\/a>/gi,
        detailTitle: /<h1[^>]*class="[^"]*(?:entry-title|post-title)[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
        detailPoster: /<img[^>]*data-src="(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
        detailDesc: /<div[^>]*class="[^"]*(?:entry-content|description)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        streamLink: /<a[^>]*href="(https?:\/\/(?!vegamovies\.|www\.vegamovies)[^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?(?:Download|V-Cloud|G-Direct|Watch|Stream|480p|720p|1080p|2160p|nexdrive|fastdl|vcloud|filebee)(?:(?!<\/a>)[\s\S])*?<\/a>/gi,
        streamDirect: /https?:\/\/[^\s"<>]+\.(?:mp4|m3u8)/gi,
        streamIframe: /<iframe[^>]*src="([^"]+)"/gi,
      },
    },

    /* ─── 3. HDHub4u ─── */
    {
      id: "hdhub4u",
      name: "HDHub4u",
      baseUrl: "https://new3.hdhub4u.cl",
      type: "html",
      enabled: true,
      categories: ["Movie", "TvSeries"],
      searchUrls: [(q) => `https://new3.hdhub4u.cl/?s=${encodeURIComponent(q)}`],
      urlMatch: (u) => /hdhub4u\./i.test(u),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Cookie: "xla=s4t", Referer: "https://new3.hdhub4u.cl/" },
      sel: {
        homeBlock: /<li[^>]*class="[^"]*thumb[^"]*"[^>]*>[\s\S]*?<\/li>/gi,
        homeTitle: /<figcaption>[\s\S]*?<p>([\s\S]*?)<\/p>/i,
        homeLink: /<a[^>]*href="(https:\/\/new3\.hdhub4u\.cl\/[^"]+)"[^>]*>[\s\S]*?<div class="thumb-hover">/i,
        homePoster: /<img[^>]*src="([^"]+)"/i,
        searchBlock: /<li[^>]*class="[^"]*thumb[^"]*"[^>]*>[\s\S]*?<\/li>/gi,
        detailTitle: /<h1[^>]*class="[^"]*(?:entry-title|page-title)[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
        detailPoster: /<img[^>]*src="(https:\/\/image\.tmdb\.org\/[^"]+)"/i,
        detailDesc: /<div[^>]*class="[^"]*(?:entry-content|post-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        streamLink: /<a[^>]*href="(https?:\/\/(?:hubdrive\.tips|gadgetsweb\.xyz|hdstream4u\.com|hubcdn\.sbs)\/[^"]+)"[^>]*>/gi,
        streamDirect: /https?:\/\/[^\s"<>]+\.(?:mp4|m3u8)/gi,
        streamIframe: /<iframe[^>]*src="([^"]+)"/gi,
      },
    },

    /* ─── 4. AnimeVilla ─── */
    {
      id: "animevilla",
      name: "AnimeVilla",
      baseUrl: "https://animevilla.org",
      type: "html",
      enabled: true,
      categories: ["Anime"],
      searchUrls: [(q) => `https://animevilla.org/search/?s_keyword=${encodeURIComponent(q)}`],
      urlMatch: (u) => /animevilla\.org/i.test(u),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "text/html" },
      sel: {
        homeBlock: /<a[^>]*href="https:\/\/animevilla\.org\/anime\/[^"]+"[^>]*>(?:(?!<\/a>)[\s\S])*<img[^>]*data-src=['"](?:https:\/\/image\.tmdb\.org\/[^'"]+)['"][^>]*alt=['"](?:[^'"]+)['"](?:(?!<\/a>)[\s\S])*<\/a>/gi,
        homeTitle: /alt=['"]([^'"]+)['"]/i,
        homeLink: /<a[^>]*href="(https:\/\/animevilla\.org\/anime\/[^"]+)"/i,
        homePoster: /data-src=['"](https:\/\/image\.tmdb\.org\/[^'"]+)['"]/i,
        searchBlock: /<h3[^>]*>[\s\S]*?<a[^>]*href="https:\/\/animevilla\.org\/anime\/[^"]+"[^>]*>[\s\S]*?<span[^>]*data-en-title[^>]*>[\s\S]*?<\/span>[\s\S]*?<\/a>[\s\S]*?<\/h3>/gi,
        detailTitle: /<h1[^>]*>([\s\S]*?)<\/h1>/i,
        detailPoster: /<img[^>]*class="[^"]*poster[^"]*"[^>]*src="([^"]+)"/i,
        detailDesc: /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        episodeBlock: /<a[^>]*href="(https:\/\/animevilla\.org\/watch\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        streamIframe: /<iframe[^>]*src="([^"]+)"/gi,
        streamDirect: /https?:\/\/[^\s"<>]+\.(?:mp4|m3u8)/gi,
      },
    },

    /* ─── 5. FilmyFly ─── */
    {
      id: "filmyfly",
      name: "FilmyFly",
      baseUrl: "https://ww2.filmyfly.faith",
      type: "html",
      enabled: true,
      categories: ["Movie", "TvSeries"],
      searchUrls: [(q) => `https://ww2.filmyfly.faith/search?q=${encodeURIComponent(q)}`],
      urlMatch: (u) => /filmyfly\./i.test(u),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "text/html" },
      sel: {
        homeBlock: /<div class="A10"><table><tr>[\s\S]*?<\/tr><\/table><\/div>/gi,
        homeTitle: /<div class="row-title"[^>]*>([\s\S]*?)<\/div>/i,
        homeLink: /<td[^>]*width="100%"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i,
        homePoster: /<img[^>]*src="(https:\/\/webp\.iwebp\.store\/[^"]+)"/i,
        searchBlock: /<div class="A10"><table><tr>[\s\S]*?<\/tr><\/table><\/div>/gi,
        detailTitle: /<h1[^>]*>([\s\S]*?)<\/h1>/i,
        detailPoster: /<img[^>]*src="(https:\/\/webp\.iwebp\.store\/[^"]+)"/i,
        detailDesc: /<p[^>]*>([\s\S]*?)<\/p>/i,
        streamLink: /<a[^>]*href="(https:\/\/linkmake\.in\/[^"]+)"[^>]*>/gi,
        streamDirect: /https?:\/\/[^\s"<>]+\.(?:mp4|m3u8)/gi,
      },
    },

    /* ─── 6. HindMovie ─── */
    {
      id: "hindmovie",
      name: "HindMovie",
      baseUrl: "https://hindmovie.icu",
      type: "html",
      enabled: true,
      categories: ["Movie", "TvSeries"],
      searchUrls: [(q) => `https://hindmovie.icu/?s=${encodeURIComponent(q)}`],
      urlMatch: (u) => /hindmovie\./i.test(u),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "text/html" },
      sel: {
        homeBlock: /<article[\s\S]*?<\/article>/gi,
        homeTitle: /<a[^>]*class="entry-title-link"[^>]*>([\s\S]*?)<\/a>/i,
        homeLink: /<a[^>]*class="entry-title-link"[^>]*href="([^"]+)"/i,
        homePoster: /<img(?=[^>]*class="[^"]*(?:archive-thumb|wp-post-image)[^"]*")[^>]*src="([^"]+)"/i,
        searchBlock: /<article[\s\S]*?<\/article>/gi,
        detailTitle: /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
        detailPoster: /<img(?=[^>]*class="[^"]*(?:archive-thumb|wp-post-image)[^"]*")[^>]*src="([^"]+)"/i,
        detailDesc: /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        streamLink: /<a[^>]*href="(https?:\/\/disk\.yandex\.[^"]+)"[^>]*>/gi,
        streamDirect: /https?:\/\/[^\s"<>]+\.(?:mp4|m3u8)/gi,
      },
    },

    /* ─── 7. MovieBox ─── API-based with auth signing */
    {
      id: "moviebox",
      name: "MovieBox",
      baseUrl: "https://api3.aoneroom.com",
      type: "moviebox-api",
      enabled: MOVIEBOX_HAS_SECRET,
      categories: ["Movie", "TvSeries"],
      urlMatch: (u) => /aoneroom\.com/i.test(u) || (u.startsWith("{") && u.includes("subjectId")),
      headers: {},
    },

    /* ─── 8. MoviesMod ─── */
    {
      id: "moviesmod",
      name: "MoviesMod",
      baseUrl: "https://moviesmod.at",
      type: "html",
      enabled: true,
      categories: ["Movie", "TvSeries"],
      searchUrls: [(q) => `https://moviesmod.at/?s=${encodeURIComponent(q)}`],
      urlMatch: (u) => /moviesmod\./i.test(u),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "text/html" },
      sel: {
        homeBlock: /<a[^>]*href="[^"]+"[^>]*title="[^"]+"[^>]*>[\s\S]*?<img[^>]*src="[^"]+"[\s\S]*?<\/a>/gi,
        homeTitle: /title="([^"]+)"/,
        homeLink: /href="([^"]+)"/,
        homePoster: /src="(https?:\/\/moviesmod\.at\/wp-content\/uploads\/[^"]+)"/,
        searchBlock: /<a[^>]*href="[^"]+"[^>]*title="[^"]+"[^>]*>[\s\S]*?<img[^>]*src="[^"]+"[\s\S]*?<\/a>/gi,
        detailTitle: /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
        detailPoster: /<img[^>]*class="[^"]*wp-post-image[^"]*"[^>]*src="([^"]+)"/i,
        detailDesc: /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        streamLink: /<a[^>]*class="[^"]*(?:maxbutton-download-links|maxbutton-episode-links|maxbutton-g-drive|maxbutton-af-download)[^"]*"[^>]*href="([^"]+)"[^>]*>/gi,
        streamDirect: /https?:\/\/[^\s"<>]+\.(?:mp4|m3u8)/gi,
        streamIframe: /<iframe[^>]*src="([^"]+)"/gi,
      },
    },

    /* ─── 9. Bolly4u ─── DISABLED (Cloudflare block) */
    {
      id: "bolly4u",
      name: "Bolly4u",
      baseUrl: "https://bolly4u.ski",
      type: "html",
      enabled: false,
      categories: ["Movie", "TvSeries"],
      searchUrls: [(q) => `https://bolly4u.ski/?s=${encodeURIComponent(q)}`],
      urlMatch: (u) => /bolly4u\./i.test(u),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "text/html", Referer: "https://bolly4u.ski/" },
      sel: {
        homeBlock: /<p>\s*<a[^>]*href="https:\/\/bolly4u\.ski\/[^"]+"[^>]*>[\s\S]*?<img[^>]*src="https:\/\/myimg\.click\/[^"]+"[\s\S]*?<\/a>\s*<\/p>/gi,
        homeTitle: /alt="([^"]+)"/,
        homeLink: /<a[^>]*href="(https:\/\/bolly4u\.ski\/[^"]+)"[^>]*>[\s\S]*?<img[^>]*src="https:\/\/myimg\.click\/[^"]+"[\s\S]*?<\/a>/i,
        homePoster: /src="(https:\/\/myimg\.click\/[^"]+)"/,
        searchBlock: /<p>\s*<a[^>]*href="https:\/\/bolly4u\.ski\/[^"]+"[^>]*>[\s\S]*?<img[^>]*src="https:\/\/myimg\.click\/[^"]+"[\s\S]*?<\/a>\s*<\/p>/gi,
        detailTitle: /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
        detailPoster: /<img[^>]*class="[^"]*wp-post-image[^"]*"[^>]*src="([^"]+)"/i,
        detailDesc: /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        streamLink: /<a[^>]*href="([^"]+)"[^>]*>\s*(?:Download|G-Drive|Watch|480p|720p|1080p)/gi,
        streamDirect: /https?:\/\/[^\s"<>]+\.(?:mp4|m3u8)/gi,
        streamIframe: /<iframe[^>]*src="([^"]+)"/gi,
      },
    },
  ];

  /* ════════════════════════════════════════════════════════════════════
     CORE UTILITIES
     ════════════════════════════════════════════════════════════════════ */

  async function fetchHtml(url, headers) {
    try { const res = await http_get(url, headers); return res.body || ""; } catch (e) { return ""; }
  }

  function absUrl(path, base) {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    if (path.startsWith("//")) return "https:" + path;
    return base.replace(/\/+$/, "") + (path.startsWith("/") ? "" : "/") + path;
  }

  function cleanText(html) {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeTitle(title) {
    return (title || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(the|a|an)/g, "").substring(0, 30);
  }

  function extractYear(text) {
    const m = String(text || "").match(/\b(19\d{2}|20\d{2})\b/);
    return m ? parseInt(m[1]) : 0;
  }

  function dedupeItems(items) {
    const seen = new Map();
    for (const item of items) {
      const year = item.year || extractYear(item.title);
      const key = normalizeTitle(item.title) + "_" + year;
      const existing = seen.get(key);
      if (!existing) { seen.set(key, item); }
      else if (!existing.posterUrl && item.posterUrl) { seen.set(key, item); }
      else if ((item.score || 0) > (existing.score || 0)) { seen.set(key, item); }
    }
    return Array.from(seen.values());
  }

  function inferType(title, url) {
    const c = `${title || ""} ${url || ""}`.toLowerCase();
    if (/\b(anime|donghua)\b/.test(c)) return "anime";
    if (/\b(season\s*\d+|episode|all episodes|web series|s\d+\s*e\d+|complete series)\b/.test(c)) return "series";
    return "movie";
  }

  function sourceLabel(sourceName, quality) {
    const name = sourceName || "Unknown";
    const q = quality || "Auto";
    return `${q} · ${name}`;
  }

  /* ════════════════════════════════════════════════════════════════════
     STREAM RESOLVERS — Deep bypass chains to actual video files
     ════════════════════════════════════════════════════════════════════ */

  async function resolveHubcloud(hubcloudUrl) {
    /* hubcloud.cx/drive/XXX → gamerxyt.com → direct CDN / R2 / pixeldrain / buzzheavier */
    try {
      const res = await http_get(hubcloudUrl, { "User-Agent": "Mozilla/5.0", "Referer": "https://hubdrive.tips/" });
      const body = res.body || "";
      const gamerMatch = body.match(/(https?:\/\/gamerxyt\.com\/hubcloud\.php\?[^"'\s<>]+)/);
      if (!gamerMatch) return null;
      const gamerRes = await http_get(gamerMatch[1], { "User-Agent": "Mozilla/5.0", "Referer": hubcloudUrl });
      const gamerBody = gamerRes.body || "";
      const links = [];
      // Direct CDN links (cdn.fukggl.buzz etc)
      const cdnMatches = [...gamerBody.matchAll(/href="(https?:\/\/cdn\.[^"]+\.(?:mkv|mp4)[^"]*)"/g)];
      for (const m of cdnMatches) if (!links.includes(m[1])) links.push(m[1]);
      // R2 direct links
      const r2Matches = [...gamerBody.matchAll(/href="(https?:\/\/[^"]+\.r2\.cloudflarestorage\.com\/[^"]*)"/g)];
      for (const m of r2Matches) if (!links.includes(m[1])) links.push(m[1]);
      // PixelDrain
      const pxMatches = [...gamerBody.matchAll(/href="(https?:\/\/pixeldrain\.[^"]+\/u\/[^"]*)"/g)];
      for (const m of pxMatches) if (!links.includes(m[1])) links.push(m[1]);
      // BuzzHeavier
      const bzMatches = [...gamerBody.matchAll(/href="(https?:\/\/bzzhr\.co\/[^"]*)"/g)];
      for (const m of bzMatches) if (!links.includes(m[1])) links.push(m[1]);
      return links.length ? links : null;
    } catch (e) { return null; }
  }

  async function resolveHubdrive(hubdriveUrl) {
    /* HDHub4u chain: hubdrive.tips/file/XXX → hubcloud.cx/drive/XXX */
    try {
      const res = await http_get(hubdriveUrl, { "User-Agent": "Mozilla/5.0", "Referer": "https://new3.hdhub4u.cl/" });
      const body = res.body || "";
      const hubcloudMatch = body.match(/(https?:\/\/hubcloud\.cx\/drive\/[^"'\s<>]+)/);
      if (!hubcloudMatch) return null;
      return await resolveHubcloud(hubcloudMatch[1]);
    } catch (e) { return null; }
  }

  async function resolveNexdrive(nexdriveUrl) {
    /* Vegamovies chain: nexdrive.fit/... → fastdl.zip/embed.php → var reurl → Google video direct */
    try {
      const res = await http_get(nexdriveUrl, { "User-Agent": "Mozilla/5.0", "Referer": "https://vegamovies.navy/" });
      const body = res.body || "";
      const links = [];
      // fastdl.zip embed links → extract direct Google video URL
      const fastdlMatches = [...body.matchAll(/href="(https?:\/\/fastdl\.zip\/embed\.php\?[^"]*)"/g)];
      for (const m of fastdlMatches) {
        try {
          const fdRes = await http_get(m[1], { "User-Agent": "Mozilla/5.0", "Referer": nexdriveUrl });
          const fdBody = fdRes.body || "";
          const reurlMatch = fdBody.match(/var reurl\s*=\s*"([^"]+)"/);
          if (reurlMatch) {
            const reurl = reurlMatch[1];
            const googleMatch = reurl.match(/link=(https?:\/\/video-downloads\.googleusercontent\.com\/[^"'\s<>]+)/);
            if (googleMatch && !links.includes(googleMatch[1])) links.push(decodeURIComponent(googleMatch[1]));
          }
        } catch (e) { /* ignore single failure */ }
      }
      // vcloud.zip links
      const vcloudMatches = [...body.matchAll(/href="(https?:\/\/vcloud\.zip\/[^"]*)"/g)];
      for (const m of vcloudMatches) {
        try {
          const vcRes = await http_get(m[1], { "User-Agent": "Mozilla/5.0", "Referer": nexdriveUrl });
          const vcBody = vcRes.body || "";
          const directMatch = vcBody.match(/(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8|mkv))/);
          if (directMatch && !links.includes(directMatch[1])) links.push(directMatch[1]);
        } catch (e) { /* ignore */ }
      }
      // filebee.xyz links
      const filebeeMatches = [...body.matchAll(/href="(https?:\/\/filebee\.xyz\/file\/[^"]*)"/g)];
      for (const m of filebeeMatches) {
        try {
          const fbRes = await http_get(m[1], { "User-Agent": "Mozilla/5.0", "Referer": nexdriveUrl });
          const fbBody = fbRes.body || "";
          const directMatch = fbBody.match(/(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8|mkv))/);
          if (directMatch && !links.includes(directMatch[1])) links.push(directMatch[1]);
        } catch (e) { /* ignore */ }
      }
      return links.length ? links : null;
    } catch (e) { return null; }
  }

  async function resolveM4u(m4uUrl) {
    /* Movies4u chain: m4ulinks.site/number/XXX → hubcloud.cx/drive/XXX */
    try {
      const res = await http_get(m4uUrl, { "User-Agent": "Mozilla/5.0", "Referer": "https://new1.movies4u.clinic/" });
      const body = res.body || "";
      const hubcloudMatch = body.match(/(https?:\/\/hubcloud\.cx\/drive\/[^"'\s<>]+)/);
      if (hubcloudMatch) return await resolveHubcloud(hubcloudMatch[1]);
      const vcloud = body.match(/(https?:\/\/vcloud\.zip\/[^"'\s<>]+)/);
      if (vcloud) return vcloud[1];
      const m4uplay = body.match(/(https?:\/\/m4uplay\.store\/[^"'\s<>]+)/);
      if (m4uplay) return m4uplay[1];
      return null;
    } catch (e) { return null; }
  }

  async function resolveM4uplay(m4uplayUrl) {
    /* Movies4u m4uplay.store player pages */
    try {
      const res = await http_get(m4uplayUrl, { "User-Agent": "Mozilla/5.0", "Referer": "https://new1.movies4u.clinic/" });
      const body = res.body || "";
      const videoSrc = body.match(/<video[^>]*src="([^"]+)"/);
      if (videoSrc) return videoSrc[1];
      const sourceTags = [...body.matchAll(/<source[^>]*src="([^"]+)"/g)];
      if (sourceTags.length) return sourceTags[0][1];
      const pickCalls = [...body.matchAll(/pickDirect\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g)];
      if (pickCalls.length) return pickCalls[0][2];
      const direct = body.match(/(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8))/);
      if (direct) return direct[1];
      return null;
    } catch (e) { return null; }
  }

  async function resolveYandex(yandexUrl) {
    /* HindMovie chain: disk.yandex.com/i/... → Yandex API → direct MP4 */
    try {
      const apiUrl = "https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=" + encodeURIComponent(yandexUrl);
      const res = await http_get(apiUrl, { "User-Agent": "Mozilla/5.0", "Referer": "https://hindmovie.icu/" });
      const data = parseJsonSafe(res.body, {});
      if (data && data.href) return data.href;
      return null;
    } catch (e) { return null; }
  }

  async function resolveHSAstream(hsaUrl) {
    /* AnimeVilla hsastream.com — SPA fallback */
    try {
      const res = await http_get(hsaUrl, { "User-Agent": "Mozilla/5.0", "Referer": "https://animevilla.org/" });
      const body = res.body || "";
      const iframe = body.match(/<iframe[^>]*src="([^"]+)"/);
      if (iframe) return iframe[1];
      const direct = body.match(/(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8))/);
      if (direct) return direct[1];
      return null;
    } catch (e) { return null; }
  }

  async function resolveLinkmake(linkmakeUrl) {
    /* FilmyFly chain: linkmake.in/view/XXX → new1.filesdl.in/cloud/XXX or /drive/XXX */
    try {
      const res = await http_get(linkmakeUrl, { "User-Agent": "Mozilla/5.0", "Referer": "https://ww2.filmyfly.faith/" });
      const body = res.body || "";
      const filesdlMatches = [...body.matchAll(/href="(https?:\/\/[^"]*filesdl[^"]*\/(?:cloud|drive)\/[^"]*)"/g)];
      const links = [];
      for (const m of filesdlMatches) {
        if (!links.includes(m[1])) links.push(m[1]);
      }
      return links.length ? links : null;
    } catch (e) { return null; }
  }

  async function resolveDriveleech(driveUrl) {
    /* Ported from CloudStream Driveleech extractor:
       Handles: Cloud Download, Instant Download, Resume Bot, Direct Links, Resume Cloud, gofile */
    try {
      const baseUrl = driveUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "";
      const res = await http_get(driveUrl, { "User-Agent": "Mozilla/5.0", "Referer": "https://moviesmod.at/" });
      const body = res.body || "";
      const links = [];

      // Cloud Download — direct btn-success href
      const cloudMatches = [...body.matchAll(/<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href="([^"]+)"[^>]*>\s*Cloud Download\s*<\/a>/gi)];
      for (const m of cloudMatches) if (!links.includes(m[1])) links.push(m[1]);

      // Instant Download — follow redirect, extract ?url= param
      const instantMatches = [...body.matchAll(/<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href="([^"]+)"[^>]*>\s*Instant Download\s*<\/a>/gi)];
      for (const m of instantMatches) {
        try {
          const instantRes = await http_get(m[1], { "User-Agent": "Mozilla/5.0", "Referer": driveUrl });
          const loc = instantRes.headers?.["location"] || "";
          const realUrl = loc.match(/\?url=([^&]+)/);
          if (realUrl) {
            const decoded = decodeURIComponent(realUrl[1]);
            if (!links.includes(decoded)) links.push(decoded);
          }
        } catch (e) { /* ignore */ }
      }

      // Resume Worker Bot — POST with token to get JSON {url: ...}
      const resumeBotMatches = [...body.matchAll(/<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href="([^"]+)"[^>]*>\s*Resume Worker Bot\s*<\/a>/gi)];
      for (const m of resumeBotMatches) {
        try {
          const botRes = await http_get(m[1], { "User-Agent": "Mozilla/5.0", "Referer": driveUrl });
          const botBody = botRes.body || "";
          const tokenMatch = botBody.match(/formData\.append\('token', '([a-f0-9]+)'\)/);
          const pathMatch = botBody.match(/fetch\('\/download\?id=([a-zA-Z0-9/+]+)'/);
          const botBase = m[1].split("/download")[0];
          if (tokenMatch && pathMatch) {
            const postBody = "token=" + encodeURIComponent(tokenMatch[1]);
            const jsonRes = await http_post(botBase + "/download?id=" + pathMatch[1],
              { "Accept": "*/*", "Origin": botBase, "Content-Type": "application/x-www-form-urlencoded", "Referer": m[1] },
              postBody);
            const jsonData = parseJsonSafe(jsonRes.body, {});
            if (jsonData.url && !links.includes(jsonData.url)) links.push(jsonData.url);
          }
        } catch (e) { /* ignore */ }
      }

      // Direct Links — ?type=1 and ?type=2, extract a.btn-success
      const directMatches = [...body.matchAll(/<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href="([^"]+)"[^>]*>\s*Direct Links\s*<\/a>/gi)];
      for (const m of directMatches) {
        try {
          for (const t of ["1", "2"]) {
            const typeRes = await http_get(baseUrl + m[1] + "?type=" + t, { "User-Agent": "Mozilla/5.0", "Referer": driveUrl });
            const typeLinks = [...(typeRes.body || "").matchAll(/<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href="([^"]+)"/g)];
            for (const tm of typeLinks) if (!links.includes(tm[1])) links.push(tm[1]);
          }
        } catch (e) { /* ignore */ }
      }

      // Resume Cloud — follow link, extract a.btn-success
      const resumeCloudMatches = [...body.matchAll(/<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href="([^"]+)"[^>]*>\s*Resume Cloud\s*<\/a>/gi)];
      for (const m of resumeCloudMatches) {
        try {
          const cloudRes = await http_get(baseUrl + m[1], { "User-Agent": "Mozilla/5.0", "Referer": driveUrl });
          const cloudLink = cloudRes.body?.match(/<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href="([^"]+)"/)?.[1];
          if (cloudLink && !links.includes(cloudLink)) links.push(cloudLink);
        } catch (e) { /* ignore */ }
      }

      // gofile links
      const gofileMatches = [...body.matchAll(/<a[^>]*href="(https?:\/\/gofile\.io\/d\/[^"]+)"/gi)];
      for (const m of gofileMatches) if (!links.includes(m[1])) links.push(m[1]);

      return links.length ? links : null;
    } catch (e) { return null; }
  }

  async function resolveMoviesmodBypass(url) {
    /* Ported from CloudStream bypass() for unblocked links */
    try {
      const host = url.match(/^(https?:\/\/[^\/]+)/)?.[1] || "";
      let res = await http_get(url, { "User-Agent": "Mozilla/5.0", "Referer": "https://moviesmod.at/" });
      let body = res.body || "";

      // Form #landing submission chain (2 rounds)
      for (let round = 0; round < 2; round++) {
        const formAction = body.match(/<form[^>]*id="landing"[^>]*action="([^"]+)"/)?.[1] || "";
        const inputs = [...body.matchAll(/<form[^>]*id="landing"[^>]*>[\s\S]*?<\/form>/g)];
        if (!inputs.length) break;
        const formHtml = inputs[0][0];
        const formData = {};
        const inputMatches = [...formHtml.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g)];
        for (const im of inputMatches) formData[im[1]] = im[2];

        const postBody = Object.keys(formData).map(function(k) { return encodeURIComponent(k) + "=" + encodeURIComponent(formData[k]); }).join("&");
        res = await http_post(formAction || host, { "Content-Type": "application/x-www-form-urlencoded", "Referer": url }, postBody);
        body = res.body || "";
      }

      // Extract ?go= token from script
      const goMatch = body.match(/\?go=([^"'\s<>]+)/);
      if (!goMatch) return null;
      const skToken = goMatch[1];
      const wpHttp2 = body.match(/<input[^>]*name="_wp_http2"[^>]*value="([^"]*)"/)?.[1] || "";

      const goRes = await http_get(host + "?go=" + skToken, { "User-Agent": "Mozilla/5.0", "Referer": url, "Cookie": skToken + "=" + wpHttp2 });
      const goBody = goRes.body || "";
      const driveUrl = goBody.match(/<meta[^>]*http-equiv="refresh"[^>]*content="[^"]*url=([^"]+)"/)?.[1];
      if (!driveUrl) return null;

      const driveRes = await http_get(driveUrl, { "User-Agent": "Mozilla/5.0", "Referer": host + "?go=" + skToken });
      const driveBody = driveRes.body || "";
      const path = driveBody.match(/replace\("([^"]+)"\)/)?.[1];
      if (!path || path === "/404") return null;

      if (path.startsWith("http")) return path;
      return host.replace(/\/$/, "") + (path.startsWith("/") ? "" : "/") + path;
    } catch (e) { return null; }
  }

  async function resolveFilesdl(filesdlUrl) {
    /* filesdl.in/cloud/XXX or /drive/XXX → extract ALL direct download links */
    try {
      const res = await http_get(filesdlUrl, { "User-Agent": "Mozilla/5.0", "Referer": "https://linkmake.in/" });
      const body = res.body || "";
      const links = [];

      // Direct R2 links (pub-*.r2.dev)
      const r2Matches = [...body.matchAll(/href='(https?:\/\/pub-[^"'\s<>]+\.r2\.dev\/[^"'\s<>]+\.(?:mkv|mp4)[^"'\s<>]*)'/g)];
      for (const m of r2Matches) if (!links.includes(m[1])) links.push(m[1]);

      // hubcloud.cx links → resolve deeper
      const hubMatches = [...body.matchAll(/href='(https?:\/\/hubcloud\.cx\/drive\/[^"'\s<>]+)'/g)];
      for (const m of hubMatches) {
        try {
          const hubResolved = await resolveHubcloud(m[1]);
          if (hubResolved && Array.isArray(hubResolved)) {
            for (const hurl of hubResolved) if (!links.includes(hurl)) links.push(hurl);
          }
        } catch (e) { /* ignore */ }
      }

      // gofile.io links
      const gofileMatches = [...body.matchAll(/href='(https?:\/\/gofile\.io\/d\/[^"'\s<>]+)'/g)];
      for (const m of gofileMatches) if (!links.includes(m[1])) links.push(m[1]);

      // buzzheavier.com links
      const buzzMatches = [...body.matchAll(/href='(https?:\/\/buzzheavier\.com\/[^"'\s<>]+)'/g)];
      for (const m of buzzMatches) if (!links.includes(m[1])) links.push(m[1]);

      // bbbdownload.filesdl.in links
      const bbbMatches = [...body.matchAll(/href='(https?:\/\/bbbdownload\.filesdl\.in\/[^"'\s<>]+)'/g)];
      for (const m of bbbMatches) if (!links.includes(m[1])) links.push(m[1]);

      // aws_amzdlbuket.iwebp.store links (pixeldrain wrapper)
      const iwebpMatches = [...body.matchAll(/href='(https?:\/\/aws_amzdlbuket\.iwebp\.store\/[^"'\s<>]+)'/g)];
      for (const m of iwebpMatches) if (!links.includes(m[1])) links.push(m[1]);

      return links.length ? links : null;
    } catch (e) { return null; }
  }

  /* ════════════════════════════════════════════════════════════════════
     MOVIEBOX AUTH & CRYPTO
     ════════════════════════════════════════════════════════════════════ */

  const MBOX_DEVICE_ID = randomHex(32);

  function randomHex(len) {
    const chars = "0123456789abcdef";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function randomBrandModel() {
    const models = { Samsung: ["SM-S918B", "SM-A528B", "SM-M336B"], Xiaomi: ["2201117TI", "M2012K11AI", "Redmi Note 11"], OnePlus: ["LE2111", "CPH2449", "IN2023"], Google: ["Pixel 6", "Pixel 7", "Pixel 8"], Realme: ["RMX3085", "RMX3360", "RMX3551"] };
    const brands = Object.keys(models);
    const brand = brands[Math.floor(Math.random() * brands.length)];
    const model = models[brand][Math.floor(Math.random() * models[brand].length)];
    return { brand, model };
  }

  function parseJsonSafe(text, fallback) { try { return JSON.parse(text); } catch (_) { return fallback; } }

  function toRawUtf8(str) { return unescape(encodeURIComponent(str)); }

  function generateXClientToken() {
    const ts = String(Date.now());
    return ts + "," + md5Hex(ts.split("").reverse().join(""));
  }

  function canonical(method, accept, contentType, url, body, ts) {
    let path = "/"; let rawQuery = "";
    try {
      const u = new URL(url);
      path = u.pathname || "/";
      rawQuery = (u.search || "").replace(/^\?/, "");
    } catch (_) {
      const text = String(url || "");
      const schemeIdx = text.indexOf("://");
      let start = 0;
      if (schemeIdx >= 0) { const hostStart = schemeIdx + 3; const slash = text.indexOf("/", hostStart); start = slash >= 0 ? slash : text.length; }
      const pathAndQuery = text.slice(start) || "/";
      const qIdx = pathAndQuery.indexOf("?");
      if (qIdx >= 0) { path = pathAndQuery.slice(0, qIdx) || "/"; rawQuery = pathAndQuery.slice(qIdx + 1); }
      else { path = pathAndQuery || "/"; }
    }
    const paramsByKey = {};
    rawQuery.split("&").forEach(function(part) {
      if (!part) return;
      const i = part.indexOf("=");
      const k = i >= 0 ? part.slice(0, i) : part;
      const v = i >= 0 ? part.slice(i + 1) : "";
      if (!Object.prototype.hasOwnProperty.call(paramsByKey, k)) paramsByKey[k] = [];
      paramsByKey[k].push(v);
    });
    const keys = Object.keys(paramsByKey).sort();
    const query = [];
    keys.forEach(function(k) { paramsByKey[k].forEach(function(v) { query.push(k + "=" + v); }); });
    const canonicalUrl = query.length ? (path + "?" + query.join("&")) : path;
    let bodyLength = ""; let bodyHash = "";
    if (body !== null && body !== undefined) {
      const raw = toRawUtf8(String(body));
      bodyLength = String(raw.length);
      bodyHash = md5Hex(raw.length > 102400 ? raw.slice(0, 102400) : raw);
    }
    return String(method).toUpperCase() + "\n" + (accept || "") + "\n" + (contentType || "") + "\n" + bodyLength + "\n" + ts + "\n" + bodyHash + "\n" + canonicalUrl;
  }

  function generateXTrSignature(method, accept, contentType, url, body) {
    const ts = Date.now();
    const keyRaw = atob(MOVIEBOX_SECRET_B64);
    const message = toRawUtf8(canonical(method, accept, contentType, url, body, ts));
    const sigRaw = hmacMd5Raw(keyRaw, message);
    return ts + "|2|" + btoa(sigRaw);
  }

  function mboxTypeFromSubject(subjectType) {
    return Number(subjectType) === 2 || Number(subjectType) === 7 ? "series" : "movie";
  }

  function mboxCleanTitle(title) {
    return String(title || "").split("[")[0].trim();
  }

  /* ─── MD5 / HMAC-MD5 Implementation ─── */
  function md5Hex(s) { return hex(md5Raw(toRawUtf8(s))); }
  function hmacMd5Raw(key, msg) {
    let bkey = rstr2binl(key);
    if (bkey.length > 16) bkey = binlMd5(bkey, key.length * 8);
    const ipad = [], opad = [];
    for (let i = 0; i < 16; i++) { ipad[i] = (bkey[i] || 0) ^ 0x36363636; opad[i] = (bkey[i] || 0) ^ 0x5c5c5c5c; }
    const hash = binlMd5(ipad.concat(rstr2binl(msg)), 512 + msg.length * 8);
    return binl2rstr(binlMd5(opad.concat(hash), 512 + 128));
  }
  function md5Raw(s) { return binl2rstr(binlMd5(rstr2binl(s), s.length * 8)); }
  function hex(s) { const h = "0123456789abcdef"; let o = ""; for (let i = 0; i < s.length; i++) { const x = s.charCodeAt(i); o += h[(x >>> 4) & 15] + h[x & 15]; } return o; }
  function add(x, y) { const l = (x & 65535) + (y & 65535); return (((x >>> 16) + (y >>> 16) + (l >>> 16)) << 16) | (l & 65535); }
  function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
  function cmn(q, a, b, x, s, t) { return add(rol(add(add(a, q), add(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function binlMd5(x, len) {
    x[len >> 5] |= 128 << (len % 32); x[(((len + 64) >>> 9) << 4) + 14] = len;
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < x.length; i += 16) {
      const oa = a, ob = b, oc = c, od = d;
      a = ff(a, b, c, d, x[i], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586); c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426); c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417); c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101); c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
      a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632); c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i], 20, -373897302);
      a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083); c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690); c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784); c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
      a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463); c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353); c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i], 11, -358537222); c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835); c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
      a = ii(a, b, c, d, x[i], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415); c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606); c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744); c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379); c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
      a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
    }
    return [a, b, c, d];
  }
  function rstr2binl(input) { const out = []; out[(input.length >> 2) - 1] = undefined; for (let i = 0; i < out.length; i++) out[i] = 0; for (let i = 0; i < input.length * 8; i += 8) out[i >> 5] |= (input.charCodeAt(i / 8) & 255) << (i % 32); return out; }
  function binl2rstr(input) { let out = ""; for (let i = 0; i < input.length * 32; i += 8) out += String.fromCharCode((input[i >> 5] >>> (i % 32)) & 255); return out; }

  /* ════════════════════════════════════════════════════════════════════
     HTML SCRAPER ENGINE
     ════════════════════════════════════════════════════════════════════ */

  function parseHomeItems(html, source) {
    const s = source.sel;
    const blocks = html.match(s.homeBlock) || [];
    const items = [];
    for (const b of blocks.slice(0, 24)) {
      let title = "", link = "", poster = "";
      if (s.homeTitle) { const tm = b.match(s.homeTitle); title = tm ? cleanText(tm[1]) : ""; }
      if (s.homeLink) { const lm = b.match(s.homeLink); link = lm ? lm[1] : ""; }
      if (s.homePoster) { const pm = b.match(s.homePoster); poster = pm ? pm[1] : ""; }
      if (source.id === "hindmovie" && !title) {
        const textMatch = b.match(/>(Download[\s\S]{10,300}?)\.{3}\s*\[/) || b.match(/>(Download[\s\S]{10,300}?)\u2026\s*\[/);
        if (textMatch) title = cleanText(textMatch[1]);
      }
      if (source.id === "vegamovies" && !title) { const altMatch = b.match(/alt="([^"]+)"/); if (altMatch) title = cleanText(altMatch[1]); }
      if (!title || !link) continue;
      items.push(new MultimediaItem({ title, url: absUrl(link, source.baseUrl), posterUrl: poster ? absUrl(poster, source.baseUrl) : "", type: inferType(title, link), year: extractYear(title), sourceId: source.id }));
    }
    return items;
  }

  function parseSearchItems(html, source) {
    const s = source.sel;
    const blocks = html.match(s.searchBlock || s.homeBlock) || [];
    const items = [];
    for (const b of blocks.slice(0, 20)) {
      let title = "", link = "", poster = "";
      if (s.homeTitle) { const tm = b.match(s.homeTitle); title = tm ? cleanText(tm[1]) : ""; }
      if (s.homeLink) { const lm = b.match(s.homeLink); link = lm ? lm[1] : ""; }
      if (s.homePoster) { const pm = b.match(s.homePoster); poster = pm ? pm[1] : ""; }
      if (source.id === "hindmovie" && !title) { const textMatch = b.match(/>(Download[\s\S]{10,200}?)…\s*\[/); if (textMatch) title = cleanText(textMatch[1]); }
      if (source.id === "vegamovies" && !title) { const altMatch = b.match(/alt="([^"]+)"/); if (altMatch) title = cleanText(altMatch[1]); }
      if (!title || !link) continue;
      items.push(new MultimediaItem({ title, url: absUrl(link, source.baseUrl), posterUrl: poster ? absUrl(poster, source.baseUrl) : "", type: inferType(title, link), year: extractYear(title), sourceId: source.id }));
    }
    return items;
  }

  async function parseDetail(html, url, source) {
    const s = source.sel;
    const title = s.detailTitle ? cleanText(html.match(s.detailTitle)?.[1] || "Unknown") : "Unknown";
    const poster = s.detailPoster ? html.match(s.detailPoster)?.[1] || "" : "";
    const desc = s.detailDesc ? cleanText(html.match(s.detailDesc)?.[1] || "") : "";
    const year = extractYear(title);
    const isSeries = inferType(title, url) === "series" || source.categories.includes("TvSeries") || source.categories.includes("Anime");
    const item = new MultimediaItem({ title, url, posterUrl: poster ? absUrl(poster, source.baseUrl) : "", type: isSeries ? "series" : "movie", year, description: desc, sourceId: source.id });

    if (isSeries) {
      const episodes = [];
      if (s.episodeBlock) {
        const epBlocks = html.match(s.episodeBlock) || [];
        let epNum = 1;
        for (const ep of epBlocks) {
          const link = ep.match(/href="([^"]+)"/)?.[1];
          const name = ep.match(/>([^<]+)</)?.[1]?.trim();
          if (link) episodes.push(new Episode({ name: name || `E${epNum}`, url: absUrl(link, source.baseUrl), season: 1, episode: epNum++ }));
        }
      }
      if (episodes.length === 0 && source.id === "animevilla") {
        try {
          const slug = url.replace(/.*\/anime\//, "").replace(/\/$/, "");
          const animeApi = await fetchHtml(`https://animevilla.org/wp-json/wp/v2/anime?slug=${encodeURIComponent(slug)}`, source.headers);
          const animeData = parseJsonSafe(animeApi, []);
          if (animeData[0] && animeData[0].title && animeData[0].title.rendered) {
            const animeTitle = animeData[0].title.rendered;
            const shortTitle = animeTitle.split("Hindi")[0].trim().replace(/\s+/g, "+");
            const epApi = await fetchHtml(`https://animevilla.org/wp-json/wp/v2/episode?search=${encodeURIComponent(shortTitle)}&per_page=50`, source.headers);
            const epData = parseJsonSafe(epApi, []);
            let epNum = 1;
            for (const ep of epData) { if (ep && ep.link) { episodes.push(new Episode({ name: ep.title?.rendered || `E${epNum}`, url: ep.link, season: 1, episode: epNum++ })); } }
          }
        } catch (e) { /* ignore */ }
      }
      if (episodes.length === 0) {
        const seasonRegex = /<a[^>]*href="([^"]+)"[^>]*>\s*(?:Season\s*\d+|S\d+|Episode\s*\d+|E\d+|Part\s*\d+|Complete)[\s\S]*?<\/a>/gi;
        let m; let epNum = 1;
        while ((m = seasonRegex.exec(html)) !== null) { episodes.push(new Episode({ name: `Episode ${epNum}`, url: absUrl(m[1], source.baseUrl), season: 1, episode: epNum++ })); }
      }
      item.episodes = episodes.length ? episodes : [new Episode({ name: "Full Movie", url, season: 1, episode: 1 })];
    } else {
      item.episodes = [new Episode({ name: "Full Movie", url, season: 1, episode: 1, posterUrl: poster ? absUrl(poster, source.baseUrl) : "", description: desc })];
    }
    return item;
  }

  async function parseStreams(html, url, source) {
    const s = source.sel;
    const streams = [];

    /* ── HDHub4u ── */
    if (source.id === "hdhub4u") {
      const hubLinks = []; let m;
      const hubRe = /<a[^>]*href="(https?:\/\/hubdrive\.tips\/file\/[^"]+)"[^>]*>/gi;
      while ((m = hubRe.exec(html)) !== null) { if (!hubLinks.includes(m[1])) hubLinks.push(m[1]); }
      for (const hubUrl of hubLinks.slice(0, 10)) {
        const resolved = await resolveHubdrive(hubUrl);
        if (resolved && Array.isArray(resolved)) {
          for (const vidUrl of resolved) streams.push(new StreamResult({ url: vidUrl, source: sourceLabel(source.name, "Direct"), headers: { Referer: "https://hubcloud.cx/" } }));
        } else streams.push(new StreamResult({ url: hubUrl, source: sourceLabel(source.name, "HubDrive"), headers: { Referer: source.baseUrl } }));
      }
      const gadgetRe = /<a[^>]*href="(https?:\/\/gadgetsweb\.xyz\/[^"]+)"[^>]*>/gi;
      const gadgetLinks = [];
      while ((m = gadgetRe.exec(html)) !== null) { if (!gadgetLinks.includes(m[1])) gadgetLinks.push(m[1]); }
      for (const gurl of gadgetLinks.slice(0, 5)) streams.push(new StreamResult({ url: gurl, source: sourceLabel(source.name, "GadgetWeb"), headers: { Referer: source.baseUrl } }));
      const hdRe = /<a[^>]*href="(https?:\/\/hdstream4u\.com\/file\/[^"]+)"[^>]*>/gi;
      const hdLinks = [];
      while ((m = hdRe.exec(html)) !== null) { if (!hdLinks.includes(m[1])) hdLinks.push(m[1]); }
      for (const hdurl of hdLinks.slice(0, 5)) streams.push(new StreamResult({ url: hdurl, source: sourceLabel(source.name, "HDStream"), headers: { Referer: source.baseUrl } }));
    }

    /* ── Vegamovies ── */
    if (source.id === "vegamovies") {
      const nexLinks = []; let m;
      const nexRe = /<a[^>]*href="(https?:\/\/nexdrive\.fit\/[^"]+)"[^>]*>/gi;
      while ((m = nexRe.exec(html)) !== null) { if (!nexLinks.includes(m[1])) nexLinks.push(m[1]); }
      for (const nexUrl of nexLinks.slice(0, 10)) {
        const resolved = await resolveNexdrive(nexUrl);
        if (resolved && Array.isArray(resolved)) {
          for (const vidUrl of resolved) streams.push(new StreamResult({ url: vidUrl, source: sourceLabel(source.name, "Direct"), headers: { Referer: "https://fastdl.zip/" } }));
        } else streams.push(new StreamResult({ url: nexUrl, source: sourceLabel(source.name, "NexDrive"), headers: { Referer: source.baseUrl } }));
      }
      const extRe = /<a[^>]*href="(https?:\/\/(?!vegamovies\.|www\.vegamovies|nexdrive\.fit|vegamovies-apk\.com|gokuhd\.com|xprimehub\.bond|vglist\.top|vglist\.cv)[^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?(?:Download|V-Cloud|G-Direct|Watch|Stream|480p|720p|1080p|2160p)(?:(?!<\/a>)[\s\S])*?<\/a>/gi;
      const extLinks = [];
      while ((m = extRe.exec(html)) !== null) { if (!extLinks.includes(m[1])) extLinks.push(m[1]); }
      for (const extUrl of extLinks.slice(0, 10)) streams.push(new StreamResult({ url: extUrl, source: sourceLabel(source.name, "External"), headers: { Referer: source.baseUrl } }));
    }

    /* ── Movies4u ── */
    if (source.id === "movies4u") {
      const m4uLinks = []; let m;
      const m4uRe = /<a[^>]*href="(https:\/\/(?:m4ulinks\.site|m4uplay\.store)\/[^"]+)"[^>]*>/gi;
      while ((m = m4uRe.exec(html)) !== null) { if (!m4uLinks.includes(m[1])) m4uLinks.push(m[1]); }
      for (const m4uUrl of m4uLinks.slice(0, 10)) {
        if (m4uUrl.includes("m4uplay.store")) {
          const resolved = await resolveM4uplay(m4uUrl);
          if (resolved) streams.push(new StreamResult({ url: resolved, source: sourceLabel(source.name, "Direct"), headers: { Referer: "https://m4uplay.store/" } }));
          else streams.push(new StreamResult({ url: m4uUrl, source: sourceLabel(source.name, "Player"), headers: { Referer: source.baseUrl } }));
        } else {
          const resolved = await resolveM4u(m4uUrl);
          if (resolved && Array.isArray(resolved)) {
            for (const vidUrl of resolved) streams.push(new StreamResult({ url: vidUrl, source: sourceLabel(source.name, "Direct"), headers: { Referer: "https://hubcloud.cx/" } }));
          } else if (resolved && typeof resolved === "string") {
            streams.push(new StreamResult({ url: resolved, source: sourceLabel(source.name, "Resolved"), headers: { Referer: "https://m4ulinks.site/" } }));
          } else streams.push(new StreamResult({ url: m4uUrl, source: sourceLabel(source.name, "M4U"), headers: { Referer: source.baseUrl } }));
        }
      }
    }

    /* ── FilmyFly: DEEP BYPASS linkmake → filesdl → direct ── */
    if (source.id === "filmyfly") {
      const lmLinks = []; let m;
      const lmRe = /<a[^>]*href="(https:\/\/linkmake\.in\/[^"]+)"[^>]*>/gi;
      while ((m = lmRe.exec(html)) !== null) { if (!lmLinks.includes(m[1])) lmLinks.push(m[1]); }
      for (const lmUrl of lmLinks.slice(0, 10)) {
        const filesdlUrls = await resolveLinkmake(lmUrl);
        if (filesdlUrls && Array.isArray(filesdlUrls)) {
          for (const fsUrl of filesdlUrls) {
            const directLinks = await resolveFilesdl(fsUrl);
            if (directLinks && Array.isArray(directLinks)) {
              for (const durl of directLinks) {
                streams.push(new StreamResult({ url: durl, source: sourceLabel(source.name, "Direct"), headers: { Referer: "https://new1.filesdl.in/" } }));
              }
            } else {
              streams.push(new StreamResult({ url: fsUrl, source: sourceLabel(source.name, "FileSDL"), headers: { Referer: lmUrl } }));
            }
          }
        } else {
          streams.push(new StreamResult({ url: lmUrl, source: sourceLabel(source.name, "LinkMake"), headers: { Referer: source.baseUrl } }));
        }
      }
    }

    /* ── HindMovie ── */
    if (source.id === "hindmovie") {
      const yandexLinks = []; let m;
      const yandexRe = /<a[^>]*href="(https?:\/\/disk\.yandex\.[^"]+)"[^>]*>/gi;
      while ((m = yandexRe.exec(html)) !== null) { if (!yandexLinks.includes(m[1])) yandexLinks.push(m[1]); }
      for (const yandexUrl of yandexLinks.slice(0, 5)) {
        const resolved = await resolveYandex(yandexUrl);
        if (resolved) streams.push(new StreamResult({ url: resolved, source: sourceLabel(source.name, "Direct"), headers: { Referer: "https://disk.yandex.com/" } }));
        else streams.push(new StreamResult({ url: yandexUrl, source: sourceLabel(source.name, "Yandex"), headers: { Referer: source.baseUrl } }));
      }
    }

    /* ── AnimeVilla ── */
    if (source.id === "animevilla") {
      const hsaLinks = []; let m;
      const hsaRe = /<a[^>]*href="(https:\/\/hsastream\.com\/[^"]+)"[^>]*>/gi;
      while ((m = hsaRe.exec(html)) !== null) { if (!hsaLinks.includes(m[1])) hsaLinks.push(m[1]); }
      for (const hsaUrl of hsaLinks.slice(0, 5)) {
        const resolved = await resolveHSAstream(hsaUrl);
        if (resolved) streams.push(new StreamResult({ url: resolved, source: sourceLabel(source.name, "Direct"), headers: { Referer: "https://hsastream.com/" } }));
        else streams.push(new StreamResult({ url: hsaUrl, source: sourceLabel(source.name, "HSA"), headers: { Referer: source.baseUrl } }));
      }
    }

    /* ── MoviesMod: base64 decode → bypass unblocked → Driveleech/Driveseed ── */
    if (source.id === "moviesmod") {
      // Movie links: a.maxbutton-download-links
      const movieLinks = []; let m;
      const movieRe = /<a[^>]*class="[^"]*maxbutton-download-links[^"]*"[^>]*href="([^"]+)"[^>]*>/gi;
      while ((m = movieRe.exec(html)) !== null) { if (!movieLinks.includes(m[1])) movieLinks.push(m[1]); }

      // Series links: a.maxbutton-episode-links, .maxbutton-g-drive, .maxbutton-af-download
      const seriesRe = /<a[^>]*class="[^"]*(?:maxbutton-episode-links|maxbutton-g-drive|maxbutton-af-download)[^"]*"[^>]*href="([^"]+)"[^>]*>/gi;
      while ((m = seriesRe.exec(html)) !== null) { if (!movieLinks.includes(m[1])) movieLinks.push(m[1]); }

      for (const rawUrl of movieLinks.slice(0, 15)) {
        let link = rawUrl;
        // Decode base64 url= param
        if (link.includes("url=")) {
          const b64 = link.match(/url=([A-Za-z0-9+/=]+)/)?.[1];
          if (b64) {
            try { link = atob(b64); } catch (e) { /* keep original */ }
          }
        }

        if (link.includes("unblocked")) {
          const bypassed = await resolveMoviesmodBypass(link);
          if (bypassed) link = bypassed;
        }

        if (link.includes("driveseed") || link.includes("driveleech")) {
          const resolved = await resolveDriveleech(link);
          if (resolved && Array.isArray(resolved)) {
            for (const durl of resolved) {
              streams.push(new StreamResult({ url: durl, source: sourceLabel(source.name, "Direct"), headers: { Referer: link } }));
            }
          } else {
            streams.push(new StreamResult({ url: link, source: sourceLabel(source.name, "Drive"), headers: { Referer: source.baseUrl } }));
          }
        } else {
          streams.push(new StreamResult({ url: link, source: sourceLabel(source.name, "Link"), headers: { Referer: source.baseUrl } }));
        }
      }
    }

    /* ── Generic fallback ── */
    if (s.streamDirect) {
      const direct = html.match(s.streamDirect) || [];
      for (const link of [...new Set(direct)]) streams.push(new StreamResult({ url: link, source: sourceLabel(source.name, "Auto"), headers: { Referer: source.baseUrl } }));
    }
    if (s.streamMagnet) {
      const magnets = html.match(s.streamMagnet) || [];
      for (const mag of [...new Set(magnets)]) streams.push(new StreamResult({ url: mag, source: sourceLabel(source.name, "Torrent"), headers: {} }));
    }
    if (s.streamIframe) {
      const iframes = []; let match;
      while ((match = s.streamIframe.exec(html)) !== null) iframes.push(match[1]);
      for (const embed of [...new Set(iframes)]) streams.push(new StreamResult({ url: embed.startsWith("http") ? embed : absUrl(embed, source.baseUrl), source: sourceLabel(source.name, "Embed"), headers: { Referer: source.baseUrl } }));
    }
    return streams;
  }

  /* ════════════════════════════════════════════════════════════════════
     MOVIEBOX API HANDLER
     ════════════════════════════════════════════════════════════════════ */

  const MBOX_HOME_KEYS = [
    ["4516404531735022304", "Trending"],
    ["5692654647815587592", "Trending in Cinema"],
    ["414907768299210008", "Bollywood"],
    ["3859721901924910512", "South Indian"],
    ["8019599703232971616", "Hollywood"],
    ["4741626294545400336", "Top Series This Week"],
    ["8434602210994128512", "Anime"],
    ["1|1", "Movies"],
    ["1|2", "Series"],
    ["1|1;country=India", "Indian Movies"],
    ["1|2;country=India", "Indian Series"],
    ["1|1;country=Korea", "Korean Movies"],
    ["1|2;country=Korea", "Korean Series"],
  ];

  async function mboxFetchHomeSection(sectionKey, sectionName) {
    const perPage = 15;
    const isList = sectionKey.indexOf("|") >= 0;
    const endpoint = isList
      ? ("https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/list")
      : ("https://api3.aoneroom.com/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=" + encodeURIComponent(sectionKey) + "&page=1&perPage=" + perPage);
    const mainParts = sectionKey.split(";")[0].split("|");
    const options = {};
    sectionKey.split(";").slice(1).forEach(function(chunk) { const idx = chunk.indexOf("="); if (idx < 0) return; options[chunk.slice(0, idx)] = chunk.slice(idx + 1); });
    const payload = JSON.stringify({ page: Number(mainParts[0] || 1) || 1, perPage: perPage, channelId: mainParts[1] || "", classify: options.classify || "All", country: options.country || "All", year: options.year || "All", genre: options.genre || "All", sort: options.sort || "ForYou" });
    const bm = randomBrandModel();
    const baseHeaders = {
      "user-agent": "com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; " + bm.model + "; Build/BP22.250325.006; Cronet/133.0.6876.3)",
      "accept": "application/json", "content-type": "application/json", "connection": "keep-alive",
      "x-client-token": generateXClientToken(),
      "x-client-info": JSON.stringify({ package_name: "com.community.mbox.in", version_name: "3.0.03.0529.03", version_code: 50020042, os: "android", os_version: "16", device_id: MBOX_DEVICE_ID, install_store: "ps", gaid: "d7578036d13336cc", brand: bm.brand, model: bm.model, system_language: "en", net: "NETWORK_WIFI", region: "IN", timezone: "Asia/Calcutta", sp_code: "" }),
      "x-client-status": "0"
    };
    let response;
    if (isList) {
      response = await http_post(endpoint, Object.assign({}, baseHeaders, { "x-tr-signature": generateXTrSignature("POST", "application/json", "application/json; charset=utf-8", endpoint, payload), "x-play-mode": "2" }), payload);
    } else {
      response = await http_get(endpoint, Object.assign({}, baseHeaders, { "x-tr-signature": generateXTrSignature("GET", "application/json", "application/json", endpoint, null) }));
    }
    const root = parseJsonSafe(response.body, {});
    const items = (((root || {}).data || {}).items) || (((root || {}).data || {}).subjects) || [];
    return [sectionName, items.map(function(item) {
      const title = String(item.title || "").split("[")[0].trim();
      const subjectId = item.subjectId ? String(item.subjectId) : "";
      if (!title || !subjectId) return null;
      return new MultimediaItem({ title, url: JSON.stringify({ subjectId, subjectType: item.subjectType || 1 }), posterUrl: item.cover && item.cover.url ? item.cover.url : "", type: mboxTypeFromSubject(item.subjectType), score: Number(item.imdbRatingValue) || undefined });
    }).filter(Boolean)];
  }

  async function mboxGetHome(cb) {
    try {
      const sections = {};
      const sectionResults = await Promise.all(MBOX_HOME_KEYS.map(function(pair) {
        return new Promise(function(resolve) {
          const timer = setTimeout(function() { resolve([pair[1], []]); }, 4500);
          mboxFetchHomeSection(pair[0], pair[1]).then(function(res) { clearTimeout(timer); resolve(res); }).catch(function() { clearTimeout(timer); resolve([pair[1], []]); });
        });
      }));
      sectionResults.forEach(function(section) { if (section && section[1] && section[1].length) sections[section[0]] = section[1]; });
      cb({ success: true, data: sections });
    } catch (e) { cb({ success: false, errorCode: "HOME_ERROR", message: String(e && e.message ? e.message : e) }); }
  }

  async function mboxSearch(query, cb) {
    try {
      const endpoint = "https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/search/v2";
      const payload = JSON.stringify({ page: 1, perPage: 20, keyword: String(query || "") });
      const bm = randomBrandModel();
      const headers = {
        "user-agent": "com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)",
        "accept": "application/json", "content-type": "application/json", "connection": "keep-alive",
        "x-client-token": generateXClientToken(),
        "x-tr-signature": generateXTrSignature("POST", "application/json", "application/json", endpoint, payload),
        "x-client-info": JSON.stringify({ package_name: "com.community.mbox.in", version_name: "3.0.03.0529.03", version_code: 50020042, os: "android", os_version: "16", device_id: MBOX_DEVICE_ID, install_store: "ps", gaid: "d7578036d13336cc", brand: "google", model: bm.model, system_language: "en", net: "NETWORK_WIFI", region: "IN", timezone: "Asia/Calcutta", sp_code: "" }),
        "x-client-status": "0"
      };
      const res = await http_post(endpoint, headers, payload);
      const root = parseJsonSafe(res.body, {});
      const results = (((root || {}).data || {}).results) || [];
      const searchList = []; const seen = {};
      results.forEach(function(group) {
        var subjects = (group && Array.isArray(group.subjects)) ? group.subjects : [];
        subjects.forEach(function(subject) {
          if (!subject || !subject.subjectId) return;
          var sid = String(subject.subjectId);
          if (!sid || seen[sid]) return;
          seen[sid] = true;
          searchList.push(new MultimediaItem({ title: subject.title || "Unknown", url: JSON.stringify({ subjectId: sid, subjectType: subject.subjectType }), posterUrl: subject.cover && subject.cover.url ? subject.cover.url : "", type: mboxTypeFromSubject(subject.subjectType), score: Number(subject.imdbRatingValue) || undefined }));
        });
      });
      cb({ success: true, data: searchList });
    } catch (e) { cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e && e.message ? e.message : e) }); }
  }

  async function mboxGetSubject(subjectId) {
    const bm = randomBrandModel();
    const url = "https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/get?subjectId=" + encodeURIComponent(subjectId);
    const mboxClientInfo = JSON.stringify({ package_name: "com.community.mbox.in", version_name: "3.0.03.0529.03", version_code: 50020042, os: "android", os_version: "16", device_id: MBOX_DEVICE_ID, install_store: "ps", gaid: "d7578036d13336cc", brand: "google", model: "sdk_gphone64_x86_64", system_language: "en", net: "NETWORK_WIFI", region: "IN", timezone: "Asia/Calcutta", sp_code: "" });
    const headers = {
      "user-agent": "com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)",
      "accept": "application/json", "content-type": "application/json", "connection": "keep-alive",
      "x-client-token": generateXClientToken(),
      "x-tr-signature": generateXTrSignature("GET", "application/json", "application/json", url, null),
      "x-client-info": mboxClientInfo,
      "x-client-status": "0",
      "x-play-mode": "2"
    };
    return await http_get(url, headers);
  }

  async function mboxLoad(url, cb) {
    try {
      const payload = parseJsonSafe(url, {});
      const subjectId = payload.subjectId ? String(payload.subjectId) : "";
      if (!subjectId) return cb({ success: false, errorCode: "INVALID_ID", message: "Missing subject id" });
      const res = await mboxGetSubject(subjectId);
      const data = (parseJsonSafe(res.body, {}).data) || null;
      if (!data) {
        const inferredType = mboxTypeFromSubject(payload.subjectType || 1);
        const streamPayload = JSON.stringify({ subjectId, se: 0, ep: 0 });
        if (inferredType === "movie") return cb({ success: true, data: new MultimediaItem({ title: payload.title || "MovieBox", url: streamPayload, type: "movie", episodes: [new Episode({ name: "Full Movie", season: 1, episode: 1, url: streamPayload })] }) });
        return cb({ success: true, data: new MultimediaItem({ title: payload.title || "MovieBox", url, type: "series", episodes: [new Episode({ name: "Episode 1", season: 1, episode: 1, url: JSON.stringify({ subjectId, se: 1, ep: 1 }) })] }) });
      }
      const title = mboxCleanTitle(data.title || "Unknown");
      const poster = data.cover && data.cover.url ? data.cover.url : "";
      const description = data.description || "";
      const year = /^\d{4}/.test(String(data.releaseDate || "")) ? Number(String(data.releaseDate).slice(0, 4)) : undefined;
      const type = mboxTypeFromSubject(data.subjectType || 1);
      if (type === "movie") {
        const streamPayload = JSON.stringify({ subjectId, se: 0, ep: 0 });
        return cb({ success: true, data: new MultimediaItem({ title, url: streamPayload, posterUrl: poster, description, type: "movie", year, episodes: [new Episode({ name: "Full Movie", season: 1, episode: 1, url: streamPayload, posterUrl: poster })] }) });
      }
      const episodes = []; const allSubjectIds = [subjectId];
      (Array.isArray(data.dubs) ? data.dubs : []).forEach(function(dub) { if (dub && dub.subjectId) { const sid = String(dub.subjectId); if (allSubjectIds.indexOf(sid) < 0) allSubjectIds.push(sid); } });
      const seen = {};
      for (let i = 0; i < allSubjectIds.length; i++) {
        const sid = allSubjectIds[i];
        const seasonUrl = "https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/season-info?subjectId=" + encodeURIComponent(sid);
        const seasonRes = await http_get(seasonUrl, { "accept": "application/json", "content-type": "application/json", "x-client-token": generateXClientToken(), "x-tr-signature": generateXTrSignature("GET", "application/json", "application/json", seasonUrl, null) });
        const seasons = ((((parseJsonSafe(seasonRes.body, {}) || {}).data) || {}).seasons) || [];
        seasons.forEach(function(se) {
          const sn = Number(se && se.se ? se.se : 1) || 1;
          const maxEp = Number(se && se.maxEp ? se.maxEp : 1) || 1;
          for (let ep = 1; ep <= maxEp; ep++) {
            const key = sn + ":" + ep;
            if (seen[key]) continue;
            seen[key] = true;
            episodes.push(new Episode({ name: "S" + sn + "E" + ep, season: sn, episode: ep, url: JSON.stringify({ subjectId, se: sn, ep }), posterUrl: poster }));
          }
        });
      }
      if (!episodes.length) episodes.push(new Episode({ name: "Episode 1", season: 1, episode: 1, url: JSON.stringify({ subjectId, se: 1, ep: 1 }), posterUrl: poster }));
      cb({ success: true, data: new MultimediaItem({ title, url, posterUrl: poster, description, type: "series", year, episodes }) });
    } catch (e) { cb({ success: false, errorCode: "LOAD_ERROR", message: String(e && e.message ? e.message : e) }); }
  }

  function mboxQualityLabel(resolutionText) {
    const t = String(resolutionText || "");
    if (t.indexOf("2160") >= 0) return "2160p";
    if (t.indexOf("1440") >= 0) return "1440p";
    if (t.indexOf("1080") >= 0) return "1080p";
    if (t.indexOf("720") >= 0) return "720p";
    if (t.indexOf("480") >= 0) return "480p";
    return "Auto";
  }

  async function mboxLoadStreams(url, cb) {
    try {
      const payload = parseJsonSafe(url, {});
      const subjectId = payload.subjectId ? String(payload.subjectId) : "";
      const se = Number(payload.se || 0) || 0;
      const ep = Number(payload.ep || 0) || 0;
      if (!subjectId) return cb({ success: false, errorCode: "INVALID_ID", message: "Missing subject id" });
      const subjectRes = await mboxGetSubject(subjectId);
      const xUserHeader = (subjectRes.headers || {})["x-user"] || (subjectRes.headers || {})["X-User"];
      const token = xUserHeader ? (parseJsonSafe(xUserHeader, {}).token || null) : null;
      const data = parseJsonSafe(subjectRes.body, {}).data || {};
      const sources = [[subjectId, "Original"]];
      (Array.isArray(data.dubs) ? data.dubs : []).forEach(function(d) { if (!d || !d.subjectId) return; const sid = String(d.subjectId); if (sid !== subjectId) sources.push([sid, String(d.lanName || "dub")]); });
      const results = [];
      for (let i = 0; i < sources.length; i++) {
        const sid = sources[i][0];
        const lang = String(sources[i][1] || "Audio").replace(/dub/ig, "Audio");
        const playUrl = "https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/play-info?subjectId=" + encodeURIComponent(sid) + "&se=" + se + "&ep=" + ep;
        const bm = randomBrandModel();
        const headers = {
          "Authorization": token ? ("Bearer " + token) : "",
          "user-agent": "com.community.oneroom/50020088 (Linux; U; Android 13; en_US; " + bm.model + "; Build/TQ3A.230901.001; Cronet/145.0.7582.0)",
          "accept": "application/json", "content-type": "application/json", "connection": "keep-alive",
          "x-client-token": generateXClientToken(),
          "x-tr-signature": generateXTrSignature("GET", "application/json", "application/json", playUrl, null),
          "x-client-info": JSON.stringify({ package_name: "com.community.oneroom", version_name: "3.0.13.0325.03", version_code: 50020088, os: "android", os_version: "13", install_ch: "ps", device_id: MBOX_DEVICE_ID, install_store: "ps", gaid: "1b2212c1-dadf-43c3-a0c8-bd6ce48ae22d", brand: bm.model, model: bm.brand, system_language: "en", net: "NETWORK_WIFI", region: "US", timezone: "Asia/Calcutta", sp_code: "", "X-Play-Mode": "1", "X-Idle-Data": "1", "X-Family-Mode": "0", "X-Content-Mode": "0" }),
          "x-client-status": "0"
        };
        const playRes = await http_get(playUrl, headers);
        const streams = ((((parseJsonSafe(playRes.body, {}) || {}).data) || {}).streams) || [];
        streams.forEach(function(stream) {
          if (!stream || !stream.url) return;
          const streamHeaders = { "Referer": "https://api3.aoneroom.com" };
          if (stream.signCookie) streamHeaders["Cookie"] = String(stream.signCookie);
          results.push(new StreamResult({ url: String(stream.url), source: "MovieBox " + lang + " " + mboxQualityLabel(stream.resolutions), headers: streamHeaders }));
        });
      }
      cb({ success: true, data: results });
    } catch (e) { cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && e.message ? e.message : e) }); }
  }

  /* ════════════════════════════════════════════════════════════════════
     SOURCE ROUTER & MEGA ORCHESTRATORS
     ════════════════════════════════════════════════════════════════════ */

  function findSource(url) {
    return SOURCES.find((s) => s.enabled && s.urlMatch(url));
  }

  async function getHome(cb) {
    const enabled = SOURCES.filter((s) => s.enabled);
    const results = await Promise.all(
      enabled.map(async (source) => {
        try {
          if (source.type === "moviebox-api") {
            return new Promise(function(resolve) {
              mboxGetHome(function(res) { resolve({ source, items: res.success ? Object.values(res.data || {}).flat() : [] }); });
            });
          }
          const html = await fetchHtml(source.baseUrl + "/", source.headers);
          if (!html) return { source, items: [] };
          const items = parseHomeItems(html, source);
          return { source, items };
        } catch (e) {
          console.error(`Mega: ${source.name} getHome failed: ${e.message}`);
          return { source, items: [] };
        }
      })
    );
    const data = {};
    const trending = [];
    for (const { source, items } of results) {
      if (items.length) { data[source.name] = items; if (items[0]) trending.push(items[0]); }
    }
    if (trending.length) data["Trending"] = trending.slice(0, 10);
    cb({ success: true, data });
  }

  async function search(query, cb) {
    const enabled = SOURCES.filter((s) => s.enabled);
    const results = await Promise.all(
      enabled.map(async (source) => {
        try {
          if (source.type === "moviebox-api") {
            return new Promise(function(resolve) {
              mboxSearch(query, function(res) { resolve(res.success ? res.data : []); });
            });
          }
          if (source.id === "vegamovies") {
            try {
              const apiRes = await fetchHtml(`https://vegamovies.navy/search.php?q=${encodeURIComponent(query)}`, source.headers);
              const data = parseJsonSafe(apiRes, {});
              const hits = data.hits || [];
              return hits.map(function(hit) {
                const doc = hit.document || {};
                const title = doc.post_title || "";
                const permalink = doc.permalink || "";
                const thumb = doc.post_thumbnail || "";
                if (!title || !permalink) return null;
                return new MultimediaItem({ title, url: absUrl(permalink, source.baseUrl), posterUrl: thumb ? absUrl(thumb, source.baseUrl) : "", type: inferType(title, permalink), year: extractYear(title), sourceId: source.id });
              }).filter(Boolean);
            } catch (e) { console.error(`Mega: Vegamovies API search failed: ${e.message}`); }
          }
          const searchPatterns = (source.searchUrls || [(q) => `${source.baseUrl}/?s=${encodeURIComponent(q)}`]).map((fn) => fn(query));
          let html = "";
          for (const searchUrl of searchPatterns) { html = await fetchHtml(searchUrl, source.headers); if (html && html.length > 500) break; }
          if (!html) return [];
          return parseSearchItems(html, source);
        } catch (e) {
          console.error(`Mega: ${source.name} search failed: ${e.message}`);
          return [];
        }
      })
    );
    const all = results.flat();
    const deduped = dedupeItems(all);
    cb({ success: true, data: deduped });
  }

  async function load(url, cb) {
    const source = findSource(url);
    if (!source) {
      if (url.startsWith("{") && url.includes("subjectId")) return mboxLoad(url, cb);
      return cb({ success: false, errorCode: "NOT_FOUND", message: "No source handles this URL" });
    }
    if (source.type === "moviebox-api") return mboxLoad(url, cb);
    try {
      const html = await fetchHtml(url, source.headers);
      if (!html) throw new Error("Empty response");
      const item = await parseDetail(html, url, source);
      cb({ success: true, data: item });
    } catch (e) { cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack }); }
  }

  async function loadStreams(url, cb) {
    const source = findSource(url);
    if (!source) {
      if (url.startsWith("{") && url.includes("subjectId")) return mboxLoadStreams(url, cb);
      return cb({ success: false, errorCode: "NOT_FOUND", message: "No source handles this URL" });
    }
    if (source.type === "moviebox-api") return mboxLoadStreams(url, cb);
    try {
      const html = await fetchHtml(url, source.headers);
      if (!html) throw new Error("Empty response");
      const streams = await parseStreams(html, url, source);
      cb({ success: true, data: streams });
    } catch (e) { cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack }); }
  }

  /* ════════════════════════════════════════════════════════════════════
     EXPORTS
     ════════════════════════════════════════════════════════════════════ */

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
