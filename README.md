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
| **SSR Movies** | ssrmovies.moda | Movies, Series | hi, en | ✅ |
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
| **MovieBlast** | ✅ | ⚠️ | Streams on some titles only — 1 of 8 tested resolved |
| **KDMaza** | ✅ | ❌ | Dashboard loads, no streams resolved on 8 titles tested |
| **SSRMovies** | ✅ | ❌ | Dashboard loads, no streams resolved on 8 titles tested |

**10 fully working · 1 partial · 2 catalog-only**

All 13 dashboards load. The three at the bottom still browse and search fine — they just
returned no playable file for the titles tested, which usually means the upstream host is
down or the title has no copy yet.

