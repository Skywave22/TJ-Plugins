# 🌌 TJ-Plugins — SkyStream Plugin Repository

Plugins for [SkyStream](https://github.com/akashdh11/skystream): movies, TV series, anime and dramas.

## 📲 Installation

1. Open **SkyStream**
2. Go to **Extensions** → **Add Source** (or Settings → Manage Extensions → Add Repository)
3. Enter this URL:

```
https://raw.githubusercontent.com/Skywave22/TJ-Plugins/main/repo.json
```

4. Tap **Add**, wait for the list to populate, and **install** the plugins you want.
5. On the Home screen, switch the **Provider** (bottom-right button) to your new plugins.

Already installed? Open Extensions and tap **Update**: every plugin got a new version in this rebuild,
and four new plugins were added (see below).

## 📦 Plugins

| Plugin | Version | Author | Source | Categories | Languages | Mirrors |
|---|---|---|---|---|---|---|
| **321Movies UK** | v3 | TJ-Plugins | 321movies.co.uk | Movie, TvSeries | en, hi | — |
| **CineFreak** | v6 | TJ-Plugins | cinefreak.net | Movie, TvSeries | hi, en, mal | — |
| **CineHD** | v9 | TJ-Plugins | cinehd.vc | Movie, TvSeries | en | — |
| **CineJoy** | v4 | TJ-Plugins | cinejoy.pk | Movie, TvSeries | en | — |
| **DesiDubAnime** | v1 | TJ-Plugins | desidubanime.me | Anime, Movie, TvSeries | hi, ta, te | — |
| **DesiSerialOnline** | v1 | TJ-Plugins | desiserialonline.su | TvSeries | hi | — |
| **DesiSerials** | v1 | TJ-Plugins | desi-serials.to | TvSeries | hi | — |
| **FMoviess** | v5 | TJ-Plugins | fmoviess.tv | Movies, Series, Anime | en | ✅ |
| **HiCine** | v8 | TJ-Plugins | api.hicine.sbs | Movies, Series, Anime | hi, en | ✅ |
| **Hindi Dubbed** | v3 | TJ-Plugins | youtube.com | Movie, TvSeries | hi, en | — |
| **KatMovieHD** | v11 | TJ-Plugins | new.katmoviehd.top | Movies, Series, Anime | hi, en | ✅ |
| **KDramaMaza** | v6 | TJ-Plugins | kdramasmaza.net | TvSeries | en, hi, ur | — |
| **NetMirror** | v7 | TJ-Plugins | netmirror.center | Movie, TvSeries | en, hi | — |
| **RareAnimes** | v1 | TJ-Plugins | rareanimes.mov | Anime, TvSeries, Movie | hi, ta, te, ml | — |
| **RiveStream** | v4 | TJ-Plugins | rivestream.ru | Movie, TvSeries | hi, en, ta, te, ur, mal, bn | — |
| **SSR Movies** | v6 | TJ-Plugins | ssrmovies.name | Movies, Series | hi, en | ✅ |
| **SubDubAnime** | v4 | TJ-Plugins | subdubanime.site | TvSeries, Movie | en, hi | — |
| **Vidbox** | v3 | TJ-Plugins | vidbox.vc | Movie, TvSeries | hi, en, ta, te, ur, mal, bn | — |

**Mirrors** ✅ = the plugin declares a `domains` list, so you can switch to a working mirror
from the plugin's settings gear if the primary domain is blocked.

## 🆕 New plugins — 2026-10-06

Built from scratch for this repo with the same test process (harness + `skystream-cli`, every link checked):

| Plugin | Site | What you get | Players |
|---|---|---|---|
| **RareAnimes** | rareanimes.mov | Hindi / Tamil / Telugu dubbed anime series and movies, by season | StreamBeta |
| **DesiDubAnime** | desidubanime.me | Hindi / Tamil / Telugu dubbed anime, with the site's own search | p2pplay HLS, VidMoly |
| **DesiSerialOnline** | desiserialonline.su | Daily Hindi serials and reality shows, full episode history by air date | VKSpeed MP4, Blogger 720p/360p (multi-part episodes) |
| **DesiSerials** | desi-serials.to | Daily Hindi serials by channel (Star Plus, Colors, Zee, Sony, Sab, Star Bharat, & TV) plus hundreds of completed shows; search understands short names like `kbc`, `yrkkh`, `tmkoc` | TVLogy HLS 480p, VKSpeed / VkPrime MP4 |

**DesiSerials** was requested as `desiserials.us`, but that domain is now only a page saying
*"DesiSerials is now Desi-Serials.to!"*, so the plugin uses **desi-serials.to**.

## 🔧 Rebuild — 2026-10-06

Every plugin was checked against its live site, rebuilt, tested with `skystream-cli` and an
app-accurate runtime harness (`tools/app-harness.mjs`, which mirrors the SkyStream app's JS
runtime: 15 s HTTP timeout, 8 MB body cap, the same helper classes), and only pushed once it
passed. Changes that apply to all plugins:

- **Author is `TJ-Plugins`** on every plugin.
- **Spoofed "geo bypass" headers removed.** Fake `X-Forwarded-For` / `CF-Connecting-IP` /
  `CF-IPCountry` headers don't change where a request comes from. Cloudflare answers them with
  **HTTP 403**, which silently broke catalogs and players across the repo, and in KDMaza,
  KatMovieHD and NetMirror a leftover reference crashed the plugin outright.
- **Every link is checked before it is shown** (`tools/snippets/verify-streams.js`): working links
  first, links that answer 401/403/426/429 or time out are kept but marked *(may not play)*
  (often a region block that works on your network), dead ones (404, HTML pages) are removed.

| Plugin | What was broken | Fix |
|---|---|---|
| **321Movies UK** | Spoof headers made the player API fail, so the plugin fell back to iframe embed pages no player can play | Real HLS sources; slow first API call retried; movies get a playable episode |
| **CineFreak** | Cloudflare 403 on every page (dashboard/search dead); site changed its `dataset` format, so playback failed | Parser updated; new stream-prepare handshake like the web player |
| **CineHD** | nxsha.space rotated its key: every MhPly/AwsPly/Nitro/HDHub server decoded to nothing | New key; dead links filtered |
| **CineJoy** | Same nxsha key change; a host filter threw away every non-HubCloud server | New key; HubCloud › StreamWish › StreamTape first, other verified servers follow; subtitles fixed |
| **FMoviess** | About half of popular titles (Inception, Breaking Bad…) returned nothing; the "CF" server 404s for everything | vidlove backup server with subtitles; dead server removed |
| **HiCine** | PixelDrain links opened an HTML page; no plot or rating | Resolved to the direct file; plot/score/backdrop from TMDB |
| **Hindi Dubbed** | First option (YouTube "1080p fMP4") 403s every time; search returned songs/trailers | Playable HLS/MP4 first; search biased to full Hindi-dubbed movies; much faster |
| **KDramaMaza** | Every drama crashed on open (`GEO_BYPASS_HEADERS is not defined`); messy titles | Fixed; clean titles + plot |
| **KatMovieHD** | Search found nothing for multi-word queries; series showed 1 episode and no streams; GDFlix returned a Drive page | Search, per-episode links (all qualities via HubCloud/GDFlix/StreamTape) and GDFlix fixed; plot + IMDb score |
| **NetMirror** | Every API call 403'd (catalog dead); "Hub" files had no CDN referer (429); "1080p" label was really 360p | Catalog back; Hub files send the referer NetMirror's own extension uses; labels fixed; subtitles added |
| **RiveStream** | nxsha key change: every title failed with "no servers" | New key; source headers; expired cached links dropped |
| **SSR Movies** | Daily shows (Bigg Boss…) showed as one episode; newest episodes (Direct-Cloud links) couldn't play; off-by-one episode mapping; site moved | Episodes from the post headings with dates; Direct-Cloud resolved to the direct file; now on `ssrmovies.name` |
| **SubDubAnime** | Always played 480p | Every available rendition offered, up to 1080p |
| **Vidbox** | nxsha key change; **movies had no episode, so Play crashed in the app** | New key; movies playable; faster |

### Known limitations

- **StreamWish was dropped** (KatMovieHD): its player is obfuscated and only hands back an HTML
  page, so it can't be played.
- **NetMirror "NM Hub" files** come from the MovieBox CDN, which refuses cloud/datacenter IPs.
  They were configured exactly like NetMirror's own extension but could only be tested up to
  the CDN from the test server; on a home/mobile connection they should play. "NM Direct" files
  were verified end to end.
- **GDFlix** (KDramaMaza, KatMovieHD, SSR Movies) is behind a Cloudflare rule that challenges
  Node.js clients. In `skystream test` only the other hosters appear for those titles; the app
  and curl get through, and the harness tests it with `--curl gdflix`.
- **nxsha.space** (CineHD, CineJoy, RiveStream, Vidbox) rotates its key from time to time. When
  those four lose their servers at the same moment, the key needs updating again.
- **RareAnimes:** some older posts only have Mega links, which can't be streamed, so those show no players.
- **DesiDubAnime:** the Mirrordub and Abyss servers can't be played; a few shows only have VidMoly.
- **DesiSerialOnline:** VKSpeed is at most 360p (Blogger parts give 720p where the site has them);
  shows with only a single "guide" post are hidden because they have no video.
- **DesiSerials:** each show lists its **latest 180 episodes** (about six months of a daily show).
  The video hosts delete old files after roughly a year, so episodes of shows that ended before
  2025 usually won't play; the plugin says so instead of showing an empty list.
- Some titles simply have no working hoster at the moment; the plugin says so instead of
  showing an empty list.

**MovieBlast** and **SkyFlixer** were removed at the maintainer's request.
