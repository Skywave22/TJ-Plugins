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

Already installed? Open Extensions and tap **Update**: every plugin got a new version on 2026-10-08
(see the update notes below).

## 🛡️ Works only with a VPN?

Many internet providers block streaming sites. Usually they give a fake DNS answer for the site
name, and some also cut the connection. That's why a plugin can work with a VPN and fail without one.
It happens in many countries, so try these in order:

1. **Private DNS (Android, recommended):** phone **Settings → Network & internet → Private DNS →
   Private DNS provider hostname → `dns.google`** (or `one.one.one.one`). This covers the whole
   phone, including the video player. On iPhone, install a DNS profile such as Cloudflare's 1.1.1.1 app.
2. **SkyStream's own DNS:** **Settings → Accounts, Network & Downloads → DNS over HTTPS → On**
   (Cloudflare or Google).
3. **Another domain:** if a plugin has a ⚙️ gear in Extensions, pick another domain there.
4. **VPN:** if the provider blocks the site completely (by its name, not only by DNS), only a VPN
   or a mirror domain helps.

Every plugin also handles this itself (network guard, since 2026-10-08):
- **Detects blocks:** DNS failures, cut connections, HTTP 451, provider block pages, and
  **Cloudflare country/VPN bans or challenges the app could not solve**. These used to show up as
  *"… returned no content"* or *"catalog unavailable"*.
- **Mirror failover:** it retries on the site's other known domains (and TMDB's official alias
  `api.tmdb.org`), then remembers the one that works.
- **🌍 Geo-pass relay:** if the site is still blocked, the plugin fetches that page through the
  TJ-Plugins relay, a free Cloudflare Worker that providers almost never block. Blocked sites
  are remembered, so later requests go straight to the relay. This makes the catalog, search and
  links work **in any country without a VPN**. Videos still play directly. Setup (one time,
  5 minutes): **[relay/README.md](relay/README.md)**. Relays are listed in
  [`relay.json`](relay.json), and installed plugins pick up changes without an update.
- **Clear messages:** if nothing gets through, you see *"… is blocked on your network"* with
  the steps above, instead of an empty list. A site that is merely slow or down gets a different
  message ("not responding, try again").

## 📦 Plugins

| Plugin | Version | Author | Source | Categories | Languages | Mirrors |
|---|---|---|---|---|---|---|
| **321Movies UK** | v5 | TJ-Plugins | 321movies.co.uk | Movie, TvSeries | en, hi | — |
| **CineFreak** | v9 | TJ-Plugins | cinefreak.ch | Movie, TvSeries | hi, en, mal | — |
| **CineHD** | v11 | TJ-Plugins | cinehd.vc | Movie, TvSeries | en | — |
| **CineJoy** | v6 | TJ-Plugins | cinejoy.pk | Movie, TvSeries | en | — |
| **DesiDubAnime** | v3 | TJ-Plugins | desidubanime.me | Anime, Movie, TvSeries | hi, ta, te | — |
| **DesiSerialOnline** | v3 | TJ-Plugins | desiserialonline.su | TvSeries | hi | — |
| **DesiSerials** | v3 | TJ-Plugins | desi-serials.to | TvSeries | hi | — |
| **FMoviess** | v7 | TJ-Plugins | fmoviess.tv | Movies, Series, Anime | en | ✅ |
| **HiCine** | v11 | TJ-Plugins | api.hicine.sbs | Movies, Series, Anime | hi, en | ✅ |
| **Hindi Dubbed** | v5 | TJ-Plugins | youtube.com | Movie, TvSeries | hi, en | — |
| **KatDrama** | v2 | TJ-Plugins | new.katdrama.my | Series, Movies | hi, en, ko, zh | ✅ |
| **KatMovieHD** | v13 | TJ-Plugins | new.katmoviehd.top | Movies, Series, Anime | hi, en | ✅ |
| **KDramaMaza** | v9 | TJ-Plugins | kdramasmaza.net | TvSeries | en, hi, ur | — |
| **MoviesHubHD** | v1 | TJ-Plugins | movieshubhd.com | Movie, TvSeries | hi, en | — |
| **NetMirror** | v10 | TJ-Plugins | netmirror.center | Movie, TvSeries | en, hi | — |
| **PikaHD** | v4 | TJ-Plugins | new.pikahd.co | Anime, Movies, Series | hi, en, ja | ✅ |
| **RareAnimes** | v4 | TJ-Plugins | rareanimes.mov | Anime, TvSeries, Movie | hi, ta, te, ml | — |
| **RiveStream** | v6 | TJ-Plugins | rivestream.ru | Movie, TvSeries | hi, en, ta, te, ur, mal, bn | — |
| **ScreenScape** | v1 | TJ-Plugins | screenscape.me (via nxsha.space) | Movie, TvSeries, Anime | hi, en, ta, te, ko, ja | — |
| **SSR Movies** | v8 | TJ-Plugins | ssrmovies.games | Movies, Series | hi, en | ✅ |
| **SubDubAnime** | v6 | TJ-Plugins | subdubanime.site | TvSeries, Movie | en, hi | — |
| **Vidbox** | v5 | TJ-Plugins | vidbox.vc | Movie, TvSeries | hi, en, ta, te, ur, mal, bn | — |

**Mirrors** ✅ = the plugin declares a `domains` list, so you can switch to a working mirror
from the plugin's settings gear if the primary domain is blocked.

## 🆕 New plugin — 2026-10-10

- **MoviesHubHD** (movieshubhd.com):
  - Same rows as the site's home page: Latest Releases, Trending, Hindi Movies, Top Rated Movies & TV,
    plus genres.
  - Search covers movies and TV shows, and every TV episode is listed.
  - Most of the site's 15 player servers are web-page embeds that SkyStream can't play, or are dead or
    locked. The plugin uses the player network behind the site's NontonGo server, which serves direct
    video links.
  - That gives 4-6 servers per title: Hindi and English audio tracks (Hindi first), multi-audio,
    up to 1080p/4K, plus subtitles where available.
  - Every link is checked before it is shown.

## 🔄 Update — 2026-10-09

- **KatDrama v2:**
  - Shows whose episodes are listed on the newer "Single Episodes" pack pages showed as 1 episode
    (e.g. City of Romance). They now list every episode (City of Romance: 22).
  - GDFlix "Instant" links had started pointing at a download web page instead of the video. They are
    unwrapped to the direct file again, so most episodes now have 4-7 working servers instead of 2-4.
  - The GDFlix server moved to a new domain; the plugin now follows it automatically.
  - Posts that only have whole-season ZIP archives (can't be streamed) open the same season's other
    language version when it has episodes (e.g. Four Hands, Two Sonatas), and say so clearly when no
    version has episodes yet.
  - Show names on the details page now come from the post's real title.
- **PikaHD v4:** same GDFlix fixes and real post titles.

## 🔄 Update — 2026-10-08 (4)

- **CineFreak v9:** the site moved to **cinefreak.ch**. The plugin now finds the current domain
  automatically, and cinefreak.net is kept as a backup. Home and search now come from the site's own search
  index (search.yagaverse.net), which is on a different server from the site. The dashboard and search keep
  working even where cinefreak's domain is blocked. Once a title is opened, playback never touches the site
  again. New home rows: Latest Uploads, South Indian, Bangla, Anime & Animation.
- **PikaHD v3:** titles were cut off on the details page (e.g. "Tokyo Revengers … (English"). They now use
  the post's real title. Films the site tags as both "movie" and "series" (e.g. Doraemon movies) now
  open as movies. Merged-season pages are named after the show ("Grand Blue Dreaming", not "… S3").

## 🔄 Update — 2026-10-08 (3)

- **New: ScreenScape** (screenscape.me). The site's own pages and API sit behind a Cloudflare
  "Verify you are human" checkbox that an app plugin can't tick, so the plugin rebuilds the site from
  its sources. It has the same home rows (Trending, Top 10, Netflix, Prime Video, JioHotstar, Hindi,
  K-Drama, Anime, Marvel, DC, genres) from TMDB, plus the site's **"Scape" server panel** (the nxsha
  backend): 30+ servers per title, Hindi dubs first, and every link is checked before it is shown.

## 🔄 Update — 2026-10-08 (2)

- **New: PikaHD** (new.pikahd.co): anime in Hindi dubbed, dual audio and English subbed.
- **New: KatDrama** (new.katdrama.my): Korean and Chinese dramas in Hindi, dual audio and English dubbed.
  Both use the KatMovieHD engine (same site platform and file hosts).
- **Geo-pass relay + Cloudflare block detection** in every plugin (see *Works only with a VPN?*
  above). This fixes the "Site Not Reachable … returned no content" errors for SSR Movies,
  RareAnimes, CineFreak and KatMovieHD on blocked networks, once the relay is set up.
- **KatMovieHD / PikaHD:** episode lists written as "E01:", "E02:" were collapsed into a single
  episode; they are now split into proper episodes.
- **RareAnimes:** the site itself is currently down. Its domain is disconnected from its own server
  (it fails with a VPN too). The plugin now says so clearly instead of showing an empty list, falls back to the
  cached catalog when only search is broken, and finds posts that were renamed.
- KatMovie4K (katmovie4k.mov) could not be added: the domain currently has no server
  (no DNS address), and its older domains are parked.

## 🔄 Update — 2026-10-08

Every plugin was re-tested and given the network guard described above
(see **Works only with a VPN?** above). Fixes:

- **HiCine:** search for multi-word titles ("spider man") returned nothing; it now also tries the
  hyphenated and single-word forms.
- **KDramaMaza:** when the site's server is overloaded, the home screen falls back to the site's
  cached front page, and search matches against it instead of showing "no results".
- **NetMirror:** "NM Hub" files failed for everyone (the file CDN started rejecting the referer the
  plugin sent, HTTP 426). It now sends the player page's own address.
- **RareAnimes:** the site's "All … List" index posts are no longer shown as titles.
- **SSR Movies:** now uses **ssrmovies.games** (where .name and .com redirect); .blue was dropped.
- **KatMovieHD:** removed domains that were dead, parked, or a different site.
- **All plugins:** ZIP/RAR archives are no longer listed as playable streams.

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
- **NetMirror "NM Hub" files** come from the MovieBox CDN, which rate-limits cloud/datacenter
  IPs (HTTP 429), so they could only be tested up to the CDN from the test server. On a home or
  mobile connection they should play. Many titles only have NM Hub files; "NM Direct" (R2) files
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
