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
| **321Movies UK** | 321movies.co.uk | Movie, TvSeries | en, hi | — |
| **CineFreak** | cinefreak.net | Movie, TvSeries | hi, en, mal | — |
| **CineHD** | cinehd.vc | Movie, TvSeries | en | — |
| **CineJoy** | cinejoy.pk | Movie, TvSeries | en | — |
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

**Mirrors** ✅ = the plugin declares a `domains` list, so you can switch to a working
mirror from the plugin's settings gear if the primary domain is blocked.
Every other plugin reads the host from `manifest.baseUrl` (so a mirror picker would be
honoured if one is added) but ships with its primary host only.

All 14 plugins pass `skystream validate` (manifest schema + exported functions).

## 🛠 Fixes — 2026-10-05

Every plugin is now published under the **TJ Plugins** author (versions bumped so the
app offers the update). What was actually broken and repaired:

| Plugin | Problem | Fix |
|---|---|---|
| **NetMirror** | The plugin **crashed on install** with `ReferenceError: Cannot access 'GEO_BYPASS_HEADERS' before initialization` — a top-level header constant called the geo helper before the constants it reads existed. Nothing loaded, so the whole provider was dead. | The header is now built after the constants. Verified with `skystream test -f getHome` and an app-accurate runtime harness (dashboard, search, details and streams all resolve). |
| **Vidbox** | A leftover copy of RiveStream's `loadStreams` was still in the file (referencing undefined `riveServers`/`RIVE_PROVIDERS`). Episode items used `title`/`date`, which the app ignores (episodes rendered with blank names), and genres were filed under `genres` instead of `tags`. | Dead duplicate removed; episodes now use `name`/`airDate`; genres map to `tags`. |
| **Hindi Dubbed** | When YouTube returned nothing for all 20 channels, the dashboard loaded **empty with no explanation**. | It now reports an error so the app can show a message. |
| **CineFreak, CineHD, KDMaza, NetMirror, FMoviess, HiCine, KatMovieHD, SSR Movies** | The site host was hardcoded, so the domain/mirror picker in the plugin settings had no effect. | All read `manifest.baseUrl` with the old host as fallback. |
| **SubDubAnime** | The API embeds a TMDB snapshot; its genre list fed straight into the app's tag parser, which rejects non-strings — a single malformed value would have failed the entire dashboard. | description/genre/score values are normalised before they are emitted. |
| **All plugins** | Author field was mixed (`Skywave22`, `Arena Agent`, `Happy`, …); `dist/codes/*` shortcode lists were stale (missing CineJoy, still listing removed plugins). | Author set to **TJ Plugins**, versions bumped, `dist/` rebuilt, stale bundles (`com.netflixmirror.plugin`, `com.tamilblasters.skystream`) deleted, shortcode lists regenerated. |

## ✅ Verification status

Verified on **2026-09-22** with `skystream test`: the dashboard (`getHome`) had to load, then
`loadStreams` had to return at least one playable link.

| Plugin | Dashboard | Streams | Notes |
|---|---|---|---|
| **RiveStream** | ✅ | ✅ | **Hindi audio by default** — Hindi-dubbed tracks ranked first, then English, Tamil, Telugu, Urdu, Malayalam, Bengali |
| **Vidbox** | ✅ | ✅ | **Hindi audio by default**; catalog is TMDB (same ids vidbox.vc uses), streams resolve through Nxsha; every HLS/DASH manifest is probed before it is offered |
| **CineHD** | ✅ | ✅ | Most streams per title. Netflix/Prime/Hotstar catalog paths verified end to end; catalog endpoints need a `t_hash_t` cookie from `verify.php` (Cloudflare-challenged in the Node harness, solved by the app) |
| **CineFreak** | ✅ | ✅ | |
| **FMoviess** | ✅ | ✅ | |
| **HiCine** | ✅ | ✅ | |
| **Hindi Dubbed** | ✅ | ✅ | |
| **KatMovieHD** | ✅ | ✅ | |
| **NetMirror** | ✅ | ✅ | **Repaired 2026-10-05** — install-time crash fixed; playback path re-validated in the runtime harness |
| **SubDubAnime** | ✅ | ✅ | |
| **SSR Movies** | ✅ | ✅ | **Fixed 2026-09-22** — moved to `ssrmovies.blue`; resolves HubCloud, GDFlix and Watch-Online mirrors |
| **KDramaMaza** | ✅ | ✅ | **Fixed 2026-09-22** — hoster hosts updated. Episodes typically resolve one 720p file |
| **321Movies UK** | ✅ (CLI) | ✅ (CLI) | CLI tested; blocked sources may appear as unverified, on-device playback not yet verified |
| **CineJoy** | ✅ | ✅ | |

### Known upstream limitations

- **Some titles have no working hoster at all.** Long-running anime (One Piece, Naruto
  Shippuden) returned no playable file for the episode tested; the plugin says so rather
  than showing an empty list.
- **An episode or post whose HubCloud and GDFlix links are both expired returns nothing**;
  picking another episode usually works.
- **`new4.gdflix.io` sits behind a Cloudflare rule that rejects HTTP/1.1.** GDFlix links
  therefore can't be exercised from the Node test harness, but they work in the SkyStream
  app, which speaks HTTP/2. HubCloud (plain GET) works everywhere.
- **`watch-online.mom` only serves a real player on some of its links.** The rest are ad
  interstitials. The plugin tries each one and keeps whatever resolves.
**MovieBlast** and **SkyFlixer** were removed at the maintainer's request.
