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
| **HiCine** | hicine.sbs | Movies, Series, Anime | hi, en | ✅ |
| **Hindi Dubbed** | invidious mirrors | Movie, TvSeries | hi, en | — |
| **KDramaMaza** | kdramasmaza.net | TvSeries | en, hi, ur | — |
| **KatMovieHD** | katmoviehd.top | Movies, Series, Anime | hi, en | ✅ |
| **MovieBlast** | cloud-mb.xyz | Movie, TvSeries | en, hi, ta, te | — |
| **NetMirror** | netmirror.center | Movie, TvSeries | en, hi | — |
| **RiveStream** | rivestream.ru | Movie, TvSeries | en, hi, ta, te | — |
| **SSR Movies** | ssrmovies.moda | Movies, Series | hi, en | ✅ |
| **SubDubAnime** | subdubanime.site | TvSeries, Movie | en, hi | — |

**Mirrors** ✅ = the plugin declares a `domains` list, so you can switch to a working
mirror from the plugin's settings gear if the primary domain is blocked.

### RiveStream

`rivestream.ru` is a Next.js front-end. Its catalog is TMDB-backed and its playback is
delegated to ~43 third-party embeds declared in the site bundle; its own `/embed/agg` page
is only an `<iframe>` wrapper around whichever embed is selected, so the site itself never
resolves a stream URL.

This plugin builds the catalog from TMDB and resolves playback against rivestream's own
**Rive** server backends directly, keyed by the same TMDB id the site uses:

| Rive backend | Label |
|---|---|
| `rive-citadel` | Citadel |
| `rive-primevids` | Prvibd |
| `rive-flowcast` | River |
| `rive-quasar` | Kutti |
| `rive-guru` | Gbru |
| `rive-hindicast` | HindiSk |

Rive sources are offered first; if a title has none, other servers are used as fallback so
playback still works. Expect multi-language and Hindi-dubbed tracks on most titles.

## 🛠 For Developers

Every push to `main` triggers a GitHub Action that runs `skystream deploy` and republishes
`dist/plugins.json` + the `.sky` bundles automatically.

```bash
npm install -g skystream-cli

skystream validate                                    # lint every plugin
skystream test -p <Plugin> -f getHome                 # dashboard categories
skystream test -p <Plugin> -f search  -q "inception"  # search
skystream test -p <Plugin> -f load    -q "<item url>" # details + episodes
skystream test -p <Plugin> -f loadStreams -q "<item url>"  # playable links
skystream deploy -u https://raw.githubusercontent.com/<you>/<repo>/main
```

- Plugin folders follow the SkyStream layout: `<Name>/plugin.json` + `<Name>/plugin.js`
- Always build URLs from `manifest.baseUrl`
- Use the helper classes: `MultimediaItem`, `Episode`, `StreamResult`

See the [SkyStream Plugin Development Guide](https://github.com/akashdh11/skystream-tools/blob/main/DEVELOPER.md)
for the full API reference.
