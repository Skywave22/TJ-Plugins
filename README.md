# 🌌 TJ-Plugins — SkyStream Plugin Repository

Plugins for [SkyStream](https://github.com/akashdh11/skystream) — movies, TV series, anime & dramas.

## 📲 Installation

1. Open **SkyStream**
2. Go to **Extensions** → **Add Source** (or Settings → Manage Extensions → Add Repository)
3. Enter this URL:

```
https://raw.githubusercontent.com/Skywave22/TJ-Plugins/main/repo.json
```

4. Tap **Add**, wait for the list to populate, and **install** the plugins you want.
5. On the Home screen, switch the **Provider** (bottom-right button) to your new plugins.

## 📦 Plugins

13 plugins. Categories and languages below are read from each plugin's own `plugin.json`.

| Plugin | Source | Categories | Languages | Mirrors |
|---|---|---|---|---|
| **321Movies** | 321movies.xyz | Movie, TvSeries | en, hi | — |
| **CineFreak** | cinefreak.net | Movie, TvSeries | hi, en, mal | — |
| **CineHD** | cinehd.vc | Movie, TvSeries | en | — |
| **FMoviess** | fmoviess.tv | Movies, Series, Anime | en | ✅ |
| **HiCine** | api.hicine.sbs | Movies, Series, Anime | hi, en | ✅ |
| **Hindi Dubbed** | www.youtube.com | Movie, TvSeries | hi, en | — |
| **KDramaMaza** | kdramasmaza.net | TvSeries | en, hi, ur | — |
| **KatMovieHD** | new.katmoviehd.top | Movies, Series, Anime | hi, en | ✅ |
| **MovieBlast** | app.cloud-mb.xyz | Movie, TvSeries | en, hi, ta, te | — |
| **NetMirror** | netmirror.center | Movie, TvSeries | en, hi | — |
| **RiveStream** | rivestream.ru | Movie, TvSeries | hi, en, ta, te, ur, mal, bn | — |
| **SSR Movies** | ssrmovies.blue | Movies, Series | hi, en | ✅ |
| **SubDubAnime** | www.subdubanime.site | TvSeries, Movie | en, hi | — |

**Mirrors** ✅ = the plugin declares a `domains` list, so you can switch to a working
mirror from the plugin's settings gear if the primary domain is blocked.

## ✅ Working Plugins

Verified on 2026-09-22 with `skystream test`: the dashboard (`getHome`) had to load, then
`loadStreams` had to return at least one playable link.

| Plugin | Dashboard | Streams | Notes |
|---|---|---|---|
| **RiveStream** | ✅ | ✅ | **Hindi audio by default** — Hindi-dubbed tracks are ranked first, then English, Tamil, Telugu, Urdu, Malayalam, Bengali |
| **321Movies** | ✅ | ✅ | |
| **CineFreak** | ✅ | ✅ | |
| **CineHD** | ✅ | ✅ | Most streams per title |
| **FMoviess** | ✅ | ✅ | |
| **HiCine** | ✅ | ✅ | |
| **Hindi Dubbed** | ✅ | ✅ | |
| **KatMovieHD** | ✅ | ✅ | |
| **NetMirror** | ✅ | ✅ | |
| **SubDubAnime** | ✅ | ✅ | |
| **SSRMovies** | ✅ | ✅ | **Fixed 2026-09-22** — moved to `ssrmovies.blue`; resolves HubCloud, GDFlix and Watch-Online mirrors. 6 of 6 posts tested returned streams |
| **KDMaza** | ✅ | ✅ | **Fixed 2026-09-22** — hoster hosts updated. 3 of 4 dramas tested resolved |
| **MovieBlast** | ✅ | ✅ | **Fixed 2026-09-22** — every quality variant now labelled instead of reading "Auto" |

**13 fully working · 0 partial**

All 13 dashboards and all 13 stream loaders now resolve. The three bottom rows were broken
before 2026-09-22 and have been repaired:

- **KDMaza** — HubCloud and GDFlix both changed hosts and the plugin still had the old ones
  hardcoded, so every lookup came back empty. Now points at `hubcloud.ist` and
  `new4.gdflix.io`. Episodes typically resolve one 720p file.
- **SSRMovies** — the site moved to `ssrmovies.blue` (and `ssrmovies.land` is dead), and the
  code was waiting on a helper that doesn't exist in the plugin runtime, so no mirror was
  ever tried. Now resolves HubCloud, GDFlix and Watch-Online inline; 3–6 streams per title.
- **MovieBlast** — its streams always worked, but they all displayed as "Auto" because the
  quality was dropped instead of being carried into the label. Titles absent from its
  catalogue now report that plainly rather than showing an empty list.

### Known upstream limitations

- **MovieBlast's catalogue is smaller than TMDB's.** Newly released titles and some series
  (e.g. Breaking Bad, Stranger Things) are simply not in it yet. The plugin says so instead
  of showing a blank screen.
- **Some titles have no working hoster.** An episode or post whose HubCloud and GDFlix links
  are both expired will return nothing; picking another episode usually works.
- **`new4.gdflix.io` sits behind a Cloudflare rule that rejects HTTP/1.1.** GDFlix links
  therefore can't be exercised from the Node test harness, but they work in the SkyStream
  app, which speaks HTTP/2. HubCloud (plain GET) works everywhere.
- **`watch-online.mom` only serves a real player on some of its links.** The rest are ad
  interstitials. The plugin tries each one and keeps whatever resolves.
