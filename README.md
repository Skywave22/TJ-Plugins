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

| Plugin | Categories | Languages | Description |
|---|---|---|---|
| **AllMovieLand** | Movies, TV Series | en, hi, ta, te | Multi-language provider. TMDB catalog + on-site stream resolver. Ported from Hindi-Nuvio. |
| **Goated** | Movies, TV Series | en | Free movies & TV (up to 4K) from goated.cx with on-device stream resolver. |
| **HDMoviesHub** | Movies, TV Series | — | HDMoviesHub provider. |
| **Hindi Dubbed** | Movies, TV Series | hi | Hindi dubbed movies & shows. |
| **MovieBlast** | Movies, TV Series | en, hi, ta, te | Hindi/Tamil/Telugu/English streams via MovieBlast API (HMAC-signed CDN links). Ported from Hindi-Nuvio. |
| **Pakistani Dramas** | Series | ur | Pakistani drama series. |
| **Yenime** | Anime | — | Anime provider. |

## 🛠 For Developers

Every push to `main` triggers a GitHub Action that runs `skystream deploy` and republishes
`dist/plugins.json` + the `.sky` bundles automatically.

- Plugin folders follow the SkyStream layout: `<Name>/plugin.json` + `<Name>/plugin.js`
- Always build URLs from `manifest.baseUrl`
- Use the helper classes: `MultimediaItem`, `Episode`, `StreamResult`

See the [SkyStream Plugin Development Guide](https://github.com/akashdh11/skystream-tools/blob/main/DEVELOPER.md)
for the full API reference.
