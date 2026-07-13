(function () {
  /**
   * VegaMovie Plugin for SkyStream Gen 2
   * Supports: Bollywood, Hollywood, Dual Audio, South Indian, Web Series, TV Shows
   * Features: Dynamic baseUrl, mirror domains, multi-quality download links
   */

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
  };

  /**
   * Get base URL from manifest (supports dynamic domain switching)
   */
  const getBaseUrl = () => {
    if (typeof manifest !== 'undefined' && manifest.baseUrl) return manifest.baseUrl;
    return "https://vegamovie.su";
  };

  /**
   * Safe JSON parse helper
   */
  function safeParse(data) {
    if (!data) return null;
    if (typeof data === 'object') return data;
    try { return JSON.parse(data); } catch (e) { return null; }
  }

  /**
   * Extract year from text
   */
  function extractYear(text) {
    if (!text) return null;
    const match = text.match(/\b(19|20)\d{2}\b/);
    return match ? parseInt(match[0]) : null;
  }

  /**
   * Convert a post element to MultimediaItem
   */
  function toMedia(element, defaultType = "movie") {
    const linkEl = element.querySelector('a[href*="/"]') ||
                   element.querySelector('.post-title a') ||
                   element.querySelector('h2 a') ||
                   element.querySelector('h3 a') ||
                   element.querySelector('a');
    if (!linkEl) return null;

    const href = linkEl.getAttribute('href');
    if (!href) return null;

    const titleEl = element.querySelector('.entry-title') ||
                    element.querySelector('.post-title') ||
                    element.querySelector('h2') ||
                    element.querySelector('h3') ||
                    element.querySelector('header h2') ||
                    linkEl;
    const title = titleEl?.textContent?.trim()?.replace(/^\d+\.\s*/, '') || "Untitled";

    const imgEl = element.querySelector('img[data-src]') ||
                  element.querySelector('img[data-lazy-src]') ||
                  element.querySelector('img[src]') ||
                  element.querySelector('figure img');
    const poster = imgEl?.getAttribute('data-src') ||
                   imgEl?.getAttribute('data-lazy-src') ||
                   imgEl?.getAttribute('src') || '';

    let type = defaultType;
    if (href.includes('/tv-shows/') || href.includes('/web-series/') || href.includes('season')) {
      type = 'series';
    } else if (href.includes('/anime/') || title.toLowerCase().includes('anime')) {
      type = 'anime';
    }

    const packedUrl = JSON.stringify({ url: href, poster });

    return new MultimediaItem({
      title,
      url: packedUrl,
      posterUrl: poster,
      type,
    });
  }

  /**
   * ==================== getHome ====================
   */
  async function getHome(cb) {
    try {
      const baseUrl = getBaseUrl();

      const categories = [
        { path: "/", name: "Latest Updates", type: "movie" },
        { path: "/bollywood-movies/", name: "Bollywood Movies", type: "movie" },
        { path: "/hollywood-movies/", name: "Hollywood Movies", type: "movie" },
        { path: "/dual-audio-hindi-english-movies/", name: "Dual Audio [Hindi-English]", type: "movie" },
        { path: "/south-indian-hindi-dubbed-movies/", name: "South Indian Hindi Dubbed", type: "movie" },
        { path: "/punjabi-movies/", name: "Punjabi Movies", type: "movie" },
        { path: "/marathi-movies/", name: "Marathi Movies", type: "movie" },
        { path: "/bengali-movies/", name: "Bengali Movies", type: "movie" },
        { path: "/tv-shows/", name: "TV Shows", type: "series" },
        { path: "/tv-shows/web-series-hindi/", name: "Web Series Hindi", type: "series" },
        { path: "/tv-shows/hindi-dubbed-tv-shows/", name: "Hindi Dubbed TV Shows", type: "series" },
        { path: "/tv-shows/english-tv-shows/", name: "English TV Shows", type: "series" },
        { path: "/tv-shows/korean-drama/", name: "Korean Drama", type: "series" },
        { path: "/tv-shows/turkish-drama/", name: "Turkish Drama", type: "series" },
        { path: "/tv-shows/chinese-drama/", name: "Chinese Drama", type: "series" },
        { path: "/action/", name: "Action", type: "movie" },
        { path: "/comedy/", name: "Comedy", type: "movie" },
        { path: "/drama/", name: "Drama", type: "movie" },
        { path: "/horror/", name: "Horror", type: "movie" },
        { path: "/thriller/", name: "Thriller", type: "movie" },
        { path: "/romance/", name: "Romance", type: "movie" },
        { path: "/sci-fi/", name: "Sci-Fi", type: "movie" },
        { path: "/fantasy/", name: "Fantasy", type: "movie" },
        { path: "/animation/", name: "Animation", type: "anime" },
        { path: "/documentary/", name: "Documentary", type: "movie" },
      ];

      const results = await Promise.all(categories.map(async (cat) => {
        try {
          const url = `${baseUrl}${cat.path}`;
          const res = await http_get(url, headers);
          if (!res?.body) {
            console.error(`Empty response for ${cat.name} from ${url}`);
            return null;
          }

          const doc = await parseHtml(res.body);

          const container = doc.querySelector('.post-lst') ||
                            doc.querySelector('.items') ||
                            doc.querySelector('.grid-container') ||
                            doc.querySelector('#main-content') ||
                            doc.querySelector('.posts-listing') ||
                            doc.querySelector('.content-area') ||
                            doc;

          const posts = container.querySelectorAll('.post, article, .post-item, .item-post');
          const items = Array.from(posts).map(el => toMedia(el, cat.type)).filter(Boolean);

          const seen = new Set();
          const uniqueItems = items.filter(item => {
            if (seen.has(item.url)) return false;
            seen.add(item.url);
            return true;
          });

          if (uniqueItems.length > 0) return { name: cat.name, items: uniqueItems };
        } catch (e) {
          console.error(`Error fetching category ${cat.name} [${cat.path}]: ${e.message}\n${e.stack}`);
        }
        return null;
      }));

      const finalResult = {};
      results.filter(Boolean).forEach(res => {
        finalResult[res.name] = res.items;
      });

      cb({ success: true, data: finalResult });
    } catch (e) {
      console.error("Critical getHome Error:", e);
      cb({ success: false, errorCode: "HTTP_ERROR", message: e.message });
    }
  }

  /**
   * ==================== search ====================
   */
  async function search(query, cb) {
    try {
      const baseUrl = getBaseUrl();
      const encodedQuery = encodeURIComponent(query);
      const url = `${baseUrl}/?s=${encodedQuery}`;

      const res = await http_get(url, headers);
      if (!res?.body) return cb({ success: true, data: [] });

      const doc = await parseHtml(res.body);

      const container = doc.querySelector('.post-lst') ||
                        doc.querySelector('.items') ||
                        doc.querySelector('.search-results') ||
                        doc.querySelector('#main-content') ||
                        doc;

      const posts = container.querySelectorAll('.post, article, .post-item');
      const items = Array.from(posts).map(el => toMedia(el)).filter(Boolean);

      cb({ success: true, data: items });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
    }
  }

  /**
   * ==================== load ====================
   */
  async function load(urlStr, cb) {
    try {
      const media = safeParse(urlStr);
      if (!media?.url) throw new Error("Invalid URL data");

      const res = await http_get(media.url, headers);
      if (!res?.body) throw new Error("Empty response");

      const doc = await parseHtml(res.body);

      // --- Extract Title ---
      let title = doc.querySelector('h1.entry-title')?.textContent?.trim()
                   || doc.querySelector('.post-title h1')?.textContent?.trim()
                   || doc.querySelector('header h1')?.textContent?.trim()
                   || doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.replace(' - Vegamovies', '')
                   || "Unknown Title";

      title = title
        .replace(/^Download\s+/i, '')
        .replace(/^Watch\s+Online\s+/i, '')
        .replace(/\s*[\[\(](WEB-DL|CAMRip|HDTC|HDRip|BluRay|DVDRip|720p|1080p|480p|2160p|4K)[\]\)]/gi, '')
        .replace(/\s*[\[\(](Hindi|English|Dual Audio|Multi Audio|Tamil|Telugu|Malayalam|Kannada)[\]\)]/gi, '')
        .trim();

      // --- Extract Poster ---
      const poster = doc.querySelector('.post-thumbnail img')?.getAttribute('data-src') ||
                     doc.querySelector('.post-thumbnail img')?.getAttribute('src') ||
                     doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
                     media.poster ||
                     '';

      // --- Extract Description ---
      const plot = doc.querySelector('.entry-content p')?.textContent?.trim() ||
                   doc.querySelector('.post-content p')?.textContent?.trim() ||
                   doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
                   doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
                   '';

      // --- Extract Year ---
      let year = null;
      const yearEl = doc.querySelector('span.year') ||
                     doc.querySelector('.movie-year') ||
                     doc.querySelector('[itemprop="datePublished"]');
      if (yearEl) year = extractYear(yearEl.textContent);
      if (!year) year = extractYear(title);

      // --- Extract Genres ---
      const genres = [];
      const genreLinks = doc.querySelectorAll('.post-cats a, .genres a, .tags a, a[rel="category tag"]');
      genreLinks.forEach(el => {
        const g = el.textContent?.trim();
        if (g && !genres.includes(g)) genres.push(g);
      });

      // --- Extract Quality/Size ---
      const qualityInfo = doc.querySelector('.quality')?.textContent?.trim() ||
                          doc.querySelector('.movie-quality')?.textContent?.trim() || '';
      const sizeInfo = doc.querySelector('.size')?.textContent?.trim() ||
                       doc.querySelector('.movie-size')?.textContent?.trim() || '';

      // --- Determine Movie vs Series ---
      const seasonList = doc.querySelector('ul.seasons-lst, .episodes-list, .season-episodes');
      const episodeLinks = doc.querySelectorAll('ul.seasons-lst li a, .episodes-list a[href], .episode-item a');

      if (seasonList && episodeLinks.length > 0) {
        // ---- SERIES ----
        const episodes = [];
        const seasonItems = doc.querySelectorAll('ul.seasons-lst li, .season-item, .episode-item');

        seasonItems.forEach((item, idx) => {
          const epLink = item.querySelector('a[href]');
          const epTitleEl = item.querySelector('h3, .title, .episode-title, .ep-name');
          const epPosterEl = item.querySelector('img');

          const epUrl = epLink?.getAttribute('href');
          const epName = epTitleEl?.textContent?.trim() || `Episode ${idx + 1}`;
          const epPoster = epPosterEl?.getAttribute('data-src') || epPosterEl?.getAttribute('src') || poster;

          if (epUrl) {
            let season = 1, episode = idx + 1;
            const seMatch = epName.match(/S(\d+)E(\d+)/i) ||
                           epName.match(/Season\s*(\d+).*Episode\s*(\d+)/i) ||
                           epName.match(/Episode\s*(\d+)/i);
            if (seMatch) {
              season = parseInt(seMatch[1]) || 1;
              episode = parseInt(seMatch[2]) || (idx + 1);
            } else if ((seMatch = epName.match(/(\d+)/))) {
              episode = parseInt(seMatch[1]) || (idx + 1);
            }

            episodes.push(new Episode({
              name: epName,
              url: JSON.stringify({ url: epUrl, poster: epPoster, mediaType: 2 }),
              season,
              episode,
              posterUrl: epPoster,
            }));
          }
        });

        const seriesItem = new MultimediaItem({
          title,
          url: JSON.stringify({ url: media.url, mediaType: 2 }),
          posterUrl: poster,
          description: plot,
          type: "series",
          year,
          genres,
        });
        seriesItem.episodes = episodes;

        cb({ success: true, data: seriesItem });
      } else {
        // ---- MOVIE ----
        const downloadLinks = extractDownloadLinks(doc);

        const movieItem = new MultimediaItem({
          title,
          url: JSON.stringify({ url: media.url, mediaType: 1, downloadLinks }),
          posterUrl: poster,
          description: plot,
          type: "movie",
          year,
          genres,
          duration: extractDuration(doc),
        });

        cb({ success: true, data: movieItem });
      }
    } catch (e) {
      console.error("load error:", e);
      cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
    }
  }

  /**
   * Extract download links from detail page
   */
  function extractDownloadLinks(doc) {
    const links = {};
    const downloadSection = doc.querySelector('.download-links, .download-section, .links-list, .post-content');
    if (!downloadSection) return links;

    const qualityHeaders = downloadSection.querySelectorAll('h3, h4, strong, b, .quality-heading');

    qualityHeaders.forEach(header => {
      const qualityText = header.textContent?.trim().toLowerCase() || '';
      const qualityMatch = qualityText.match(/(480p|720p|1080p|2160p|4k|hd|sd)/i);
      const quality = qualityMatch ? qualityMatch[1].toUpperCase() : 'UNKNOWN';

      let nextEl = header.nextElementSibling;
      const qualityLinks = [];

      while (nextEl && !['H3', 'H4', 'STRONG', 'B'].includes(nextEl.tagName)) {
        const anchors = nextEl.querySelectorAll('a[href*="nexdrive"], a[href*="fast-dl"], a[href*="vgmlinks"], a[href*="gdrive"], a[href*="drive.google"]');
        anchors.forEach(a => {
          const href = a.getAttribute('href');
          const label = a.textContent?.trim() || quality;
          if (href && !qualityLinks.some(l => l.url === href)) {
            qualityLinks.push({ label, url: href });
          }
        });
        nextEl = nextEl.nextElementSibling;
      }

      if (qualityLinks.length > 0) links[quality] = qualityLinks;
    });

    // Fallback
    if (Object.keys(links).length === 0) {
      const allLinks = downloadSection.querySelectorAll('a[href*="nexdrive"], a[href*="fast-dl"], a[href*="vgmlinks"]');
      allLinks.forEach(a => {
        const href = a.getAttribute('href');
        const context = a.closest('div, li, p, td')?.textContent?.toLowerCase() || '';
        const qualityMatch = context.match(/(480p|720p|1080p|2160p|4k)/i);
        const quality = qualityMatch ? qualityMatch[1].toUpperCase() : 'UNKNOWN';
        const label = a.textContent?.trim() || quality;

        if (!links[quality]) links[quality] = [];
        if (!links[quality].some(l => l.url === href)) {
          links[quality].push({ label, url: href });
        }
      });
    }

    return links;
  }

  /**
   * Extract duration in minutes
   */
  function extractDuration(doc) {
    const durationText = doc.querySelector('.runtime')?.textContent ||
                         doc.querySelector('[itemprop="duration"]')?.textContent ||
                         doc.querySelector('.movie-runtime')?.textContent || '';
    const match = durationText.match(/(\d+)\s*(min|mins|minutes)/i);
    return match ? parseInt(match[1]) : null;
  }

  /**
   * ==================== loadStreams ====================
   */
  async function loadStreams(urlStr, cb) {
    try {
      const media = safeParse(urlStr);
      if (!media?.url) throw new Error("Invalid URL data");

      const downloadLinks = media.downloadLinks || {};
      let linksToResolve = [];

      if (Object.keys(downloadLinks).length > 0) {
        Object.values(downloadLinks).forEach(arr => linksToResolve.push(...arr));
      } else {
        const res = await http_get(media.url, headers);
        if (res?.body) {
          const doc = await parseHtml(res.body);
          const extracted = extractDownloadLinks(doc);
          Object.values(extracted).forEach(arr => linksToResolve.push(...arr));
        }
      }

      if (linksToResolve.length === 0) {
        return cb({ success: true, data: [] });
      }

      const streams = [];

      for (const link of linksToResolve) {
        try {
          const ndRes = await http_get(link.url, { ...headers, Referer: media.url });
          if (!ndRes?.body) continue;

          const ndDoc = await parseHtml(ndRes.body);

          // G-Direct (fast-dl.one)
          const gDirectLinks = ndDoc.querySelectorAll('a[href*="fast-dl.one"], a[href*="fast-dl"]');
          for (const gLink of gDirectLinks) {
            const gUrl = gLink.getAttribute('href');
            const gLabel = gLink.textContent?.trim() || 'G-Direct';
            if (gUrl) {
              const finalUrl = await resolveRedirect(gUrl);
              streams.push(new StreamResult({
                url: finalUrl || gUrl,
                quality: link.label || gLabel,
                source: `VegaMovie [${gLabel}]`,
                headers: { Referer: 'https://fast-dl.one/' },
              }));
            }
          }

          // V-Gmlinks (vgmlinks.live)
          const vGmlinksLinks = ndDoc.querySelectorAll('a[href*="vgmlinks.live"], a[href*="vgmlinks"]');
          for (const vLink of vGmlinksLinks) {
            const vUrl = vLink.getAttribute('href');
            const vLabel = vLink.textContent?.trim() || 'V-Gmlinks';
            if (vUrl) {
              const finalUrl = await resolveRedirect(vUrl);
              streams.push(new StreamResult({
                url: finalUrl || vUrl,
                quality: link.label || vLabel,
                source: `VegaMovie [${vLabel}]`,
                headers: { Referer: 'https://vgmlinks.live/' },
              }));
            }
          }

          // Direct G-Drive
          const gDriveLinks = ndDoc.querySelectorAll('a[href*="drive.google"], a[href*="docs.google"]');
          for (const gdLink of gDriveLinks) {
            const gdUrl = gdLink.getAttribute('href');
            if (gdUrl) {
              streams.push(new StreamResult({
                url: gdUrl,
                quality: link.label || 'G-Drive',
                source: 'VegaMovie [G-Drive]',
                headers: { Referer: 'https://drive.google.com/' },
              }));
            }
          }
        } catch (e) {
          console.error(`Error resolving ${link.url}:`, e.message);
        }
      }

      // Deduplicate
      const seen = new Set();
      const uniqueStreams = streams.filter(s => {
        if (seen.has(s.url)) return false;
        seen.add(s.url);
        return true;
      });

      cb({ success: true, data: uniqueStreams });
    } catch (e) {
      console.error("loadStreams error:", e);
      cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
    }
  }

  /**
   * Follow redirect to get final URL
   */
  async function resolveRedirect(url) {
    try {
      const res = await http_get(url, { ...headers, 'Accept': '*/*' });
      return res?.url || url;
    } catch (e) {
      return url;
    }
  }

  // Export to SkyStream
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();