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

14 plugins. Categories and languages below are read from each plugin's own `plugin.json`.

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
| **NetMirror** | netmirror.center | Movie, TvSeries | en, hi | — |
| **RiveStream** | rivestream.ru | Movie, TvSeries | hi, en, ta, te, ur, mal, bn | — |
| **SSR Movies** | ssrmovies.blue | Movies, Series | hi, en | ✅ |
| **SubDubAnime** | www.subdubanime.site | TvSeries, Movie | en, hi | — |
| **Vidbox** | vidbox.vc | Movie, TvSeries | hi, en, ta, te, ur, mal, bn | — |
| **NetflixMirror** | net52.cc | Movie, TvSeries | en, hi, ta, te | — |

**Mirrors** ✅ = the plugin declares a `domains` list, so you can switch to a working
mirror from the plugin's settings gear if the primary domain is blocked.

## ✅ Working Plugins

Verified on 2026-09-22 with `skystream test`: the dashboard (`getHome`) had to load, then
`loadStreams` had to return at least one playable link.

| Plugin | Dashboard | Streams | Notes |
|---|---|---|---|
| **RiveStream** | ✅ | ✅ | **Hindi audio by default** — Hindi-dubbed tracks are ranked first, then English, Tamil, Telugu, Urdu, Malayalam, Bengali |
| **Vidbox** | ✅ | ✅ | **New 2026-09-23** — **Hindi audio by default**. Catalog is TMDB (the same ids vidbox.vc uses); streams resolve through the one server in vidbox's 47-server fleet that returns a directly playable manifest. 10 of 10 titles tested resolved, 10-20 streams each, every HLS/DASH manifest verified before it is offered |
| **NetflixMirror** | ⚠️ | ✅ | **New 2026-09-23** — four OTT catalogs in one plugin (Netflix / Prime Video / Hotstar / Disney+), picked in the settings gear. Port of the GPLv3 `Sushan64/NetMirror-Extension` CloudStream extension. **Streams verified**: all three OTT channels resolve real HLS with 1080p/720p/480p variants, and segments are genuine MPEG-TS; 5 of 5 titles tested streamed. **Dashboard not yet verified** — the catalog, search and details endpoints need a `t_hash_t` session cookie, and Cloudflare challenges the Node test harness on `verify.php` (`cf-mitigated: challenge`). The app has a Cloudflare solver the harness lacks, so this is expected to work in-app; it is unconfirmed. |
| **321Movies** | ✅ | ✅ | |
| **CineFreak** | ✅ | ✅ | |
| **CineHD** | ✅ | ✅ | Most streams per title |
| **FMoviess** | ✅ | ✅ | |
| **HiCine** | ✅ | ✅ | |
| **Hindi Dubbed** | ✅ | ✅ | |
| **KatMovieHD** | ✅ | ✅ | |
| **NetMirror** | ✅ | ✅ | |
| **SubDubAnime** | ✅ | ✅ | |
| **SSR Movies** | ✅ | ✅ | **Fixed 2026-09-22** — moved to `ssrmovies.blue`; resolves HubCloud, GDFlix and Watch-Online mirrors. 6 of 6 posts tested returned streams |
| **KDramaMaza** | ✅ | ✅ | **Fixed 2026-09-22** — hoster hosts updated. 3 of 4 dramas tested resolved |

**13 fully working · 1 unverified dashboard**

All 13 established plugins resolve their dashboards and streams; NetflixMirror's stream loader is verified but its dashboard is not yet confirmed (see the table). KDramaMaza and SSR Movies were both
broken before 2026-09-22 and have been repaired:

- **KDramaMaza** — HubCloud and GDFlix both changed hosts and the plugin still had the old ones
  hardcoded, so every lookup came back empty. Now points at `hubcloud.ist` and
  `new4.gdflix.io`. Episodes typically resolve one 720p file.
- **SSR Movies** — the site moved to `ssrmovies.blue` (and `ssrmovies.land` is dead), and the
  code was waiting on a helper that doesn't exist in the plugin runtime, so no mirror was
  ever tried. Now resolves HubCloud, GDFlix and Watch-Online inline; 3–6 streams per title.
**MovieBlast** and **SkyFlixer** have both been removed at the maintainer's request.
MovieBlast's catalogue was a small subset of TMDB's, so most titles simply weren't in it.

### Known upstream limitations

- **Some titles have no working hoster at all.** Long-running anime (One Piece, Naruto
  Shippuden) returned no playable file for the episode tested; the plugin says so rather
  than showing an empty list.
- **Some titles have no working hoster.** An episode or post whose HubCloud and GDFlix links
  are both expired will return nothing; picking another episode usually works.
- **`new4.gdflix.io` sits behind a Cloudflare rule that rejects HTTP/1.1.** GDFlix links
  therefore can't be exercised from the Node test harness, but they work in the SkyStream
  app, which speaks HTTP/2. HubCloud (plain GET) works everywhere.
- **`watch-online.mom` only serves a real player on some of its links.** The rest are ad
  interstitials. The plugin tries each one and keeps whatever resolves.
