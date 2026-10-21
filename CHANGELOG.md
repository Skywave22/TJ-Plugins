# Changelog

Release notes for TJ-Plugins, newest first. The plugin list and install steps are in the [README](README.md).

### 🔧 Fixed — 2026-10-21

All 24 plugins were tested again (home, search, details and playback). These four had problems and are fixed:

| Plugin | Change |
|---|---|
| **KDramaMaza** v10 | Videos play again. Its file host GDFlix moved to a new address, so the plugin couldn't get any link ("Could not resolve a direct file"). It now always follows GDFlix to its current address and reads the direct link straight from the file page. |
| **MoviesHubHD** v2 | Videos play again. Its video servers added a new security step in October, so every server answered "no server has this movie". The plugin now does that step itself. The server list now matches the website: Delta, Zeta, Alfa, Beta, Prime, Gama, Lamda and the new Catflix and Filxer. |
| **RareAnimes** v5 | The home page shows all 11 rows again (Hindi Anime, Hindi Dubbed, Animated Movies, Netflix, Cartoon Network, Disney, Tamil, Telugu…). The site moved its category pages, so only "Trending" was left. |
| **All-in-one** v7 | Includes the three fixes above. TV episodes now also get the 4K / HDHub links from the movie sites: these servers used to send the wrong episode and were all hidden, but they now send the right one. A link is only left out if its file name shows a different episode or a whole-season pack. |

### 🔧 Fixed — 2026-10-20

| Plugin | Change |
|---|---|
| **CineFreak** v10 | Videos play again. On 11–12 Oct CineFreak put a Cloudflare "verify you are human" check in front of its player and its download host (CineCloud). SkyStream 2.9.0 and newer pass that check by themselves, so the plugin now uses the app's check solver, opens the CineCloud file and returns the direct 480p / 720p / 1080p / 4K links (Fast Cloud, Stream, Resumable, Instant). If the check doesn't pass on its own, SkyStream shows it to you once to tick. **Update SkyStream to v2.9.0 or newer**: older versions show a message asking you to. Also fixed: search (the old search index went empty, so search found nothing), episode lists (new page layout, packs like "Episodes 01-12" included) and a fuller home page with a "Latest Uploads" row. |
| **All-in-one** v3 | Includes CineFreak v10 again. Inside All-in-one, CineFreak never shows a check: if the check doesn't pass by itself, the other sites' links are used. |

### 🗑️ Removed — 2026-10-20

| Plugin | Change |
|---|---|
| **Hindi Dubbed** (YouTube) | Removed from the repository at the maintainer's request. If you installed it, it stays on your phone until you uninstall it, but it gets no more updates. |
| **All-in-one** v2 | No longer includes Hindi Dubbed (YouTube): 23 plugins built in, and the "Hindi Dubbed on YouTube" home row is gone. |

### ⭐ New plugin: All-in-one, 2026-10-20

| Plugin | What's new |
|---|---|
| **All-in-one** v1 | 24 TJ-Plugins in one plugin (all except ReelFren). One home page with merged rows (the same title from different sites is one card), one search across all sites, and when you press Play, every working link for that movie or episode from every site that has it. Seasons are matched carefully: per-season posts are mapped to the right season, Hindi serials are matched by air date, and links that some servers return for the wrong episode are left out. |
| **SSR Movies** v9 | The site moved to `ssrmovies.surf` (`ssrmovies.cz` is only its landing page). Home and search were empty before this fix. |
| **Movies4u** v2 | The site moved to `new2.movies4u.garden`. Home and search were empty before this fix. |

### 🆕 New plugin — 2026-10-19

| Plugin | What's new |
|---|---|
| **ReelFren** v1 | Free short dramas (vertical reels) from 30+ apps: ReelShort, DramaBox, ShortMax, NetShort, DramaWave, StoryReel, Melolo, FlareFlow and more, plus WeTV/iQIYI dramas and anime. A row per app, fast search across all of them, every episode, up to 1080p, subtitles in up to 31 languages (English first). |

**Fixed:** Cinezo and ScreenScape showed a changelog line instead of their description in Extensions.

### 🆕 New plugin — 2026-10-10 (4)

- **Movies4u** (new1.movies4u.garden):
  - Rows: Latest Uploads, Bollywood, Hollywood, Hindi Dubbed, South Hindi, Web Series, TV Shows,
    K-Drama, Anime, Punjabi, Action, Horror, Comedy. Search uses the site's own search.
  - Movies: the site's **Movies4u Player** (multi-audio HLS with subtitles) comes first, then HubCloud
    and GDFlix files for every quality (480p to 4K).
  - Series and TV shows (incl. daily shows like KBC / Bigg Boss): every season and episode is listed,
    each with HubCloud and GDFlix files per quality.
  - If the site moves to a new domain, the plugin picks up the current one automatically.

### 🔧 Fix — 2026-10-10 (3)

- **Cinezo v2 / ScreenScape v2:** some shows, e.g. *Link Click*, played the same movie for every episode.
  - A few scrapers (CastVid, 4K-BK, 4K-Hub) ignore the episode number. They send back a movie with a
    similar title or a whole season pack, and that link was listed first.
  - For TV episodes, each HLS link's real length is now compared with the episode's runtime on TMDB.
    Links far longer (a movie) or far shorter than the episode are removed.
  - 4K-BK / 4K-Hub files and files over 4 GB are skipped for episodes. Movies are not affected.

### 🆕 New plugin — 2026-10-10 (2)

- **Cinezo** (cinezo.gd, formerly cinezo.net):
  - Same rows as the site's home page: Trending, Hot Today, Popular Movies/TV, In Theaters, On Air,
    Top Rated, plus network rows (Netflix, Amazon Prime, HBO, Disney+, Apple TV+), Hindi Movies and
    genres.
  - The site lists ~50 player servers, but most are web-page players SkyStream can't play. The plugin
    uses the two with direct links:
    - **VidNest:** Hindi/English audio tracks, multi-audio, subtitles.
    - **ScreenScape (nxsha):** Hindi dubs, multi-audio, 4K.
  - That gives 15-30 servers per title, with Hindi first. Every link is checked before it is shown,
    and unconfirmed ones are listed last.

### 🆕 New plugin — 2026-10-10

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

### 🔄 Update — 2026-10-09

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

### 🔄 Update — 2026-10-08 (4)

- **CineFreak v9:** the site moved to **cinefreak.ch**. The plugin now finds the current domain
  automatically, and cinefreak.net is kept as a backup. Home and search now come from the site's own search
  index (search.yagaverse.net), which is on a different server from the site. The dashboard and search keep
  working even where cinefreak's domain is blocked. Once a title is opened, playback never touches the site
  again. New home rows: Latest Uploads, South Indian, Bangla, Anime & Animation.
- **PikaHD v3:** titles were cut off on the details page (e.g. "Tokyo Revengers … (English"). They now use
  the post's real title. Films the site tags as both "movie" and "series" (e.g. Doraemon movies) now
  open as movies. Merged-season pages are named after the show ("Grand Blue Dreaming", not "… S3").

### 🔄 Update — 2026-10-08 (3)

- **New: ScreenScape** (screenscape.me). The site's own pages and API sit behind a Cloudflare
  "Verify you are human" checkbox that an app plugin can't tick, so the plugin rebuilds the site from
  its sources. It has the same home rows (Trending, Top 10, Netflix, Prime Video, JioHotstar, Hindi,
  K-Drama, Anime, Marvel, DC, genres) from TMDB, plus the site's **"Scape" server panel** (the nxsha
  backend): 30+ servers per title, Hindi dubs first, and every link is checked before it is shown.

### 🔄 Update — 2026-10-08 (2)

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

### 🔄 Update — 2026-10-08

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

### 🆕 New plugins — 2026-10-06

Built from scratch for this repo with the same test process (harness + `skystream-cli`, every link checked):

| Plugin | Site | What you get | Players |
|---|---|---|---|
| **RareAnimes** | rareanimes.mov | Hindi / Tamil / Telugu dubbed anime series and movies, by season | StreamBeta |
| **DesiDubAnime** | desidubanime.me | Hindi / Tamil / Telugu dubbed anime, with the site's own search | p2pplay HLS, VidMoly |
| **DesiSerialOnline** | desiserialonline.su | Daily Hindi serials and reality shows, full episode history by air date | VKSpeed MP4, Blogger 720p/360p (multi-part episodes) |
| **DesiSerials** | desi-serials.to | Daily Hindi serials by channel (Star Plus, Colors, Zee, Sony, Sab, Star Bharat, & TV) plus hundreds of completed shows; search understands short names like `kbc`, `yrkkh`, `tmkoc` | TVLogy HLS 480p, VKSpeed / VkPrime MP4 |

**DesiSerials** was requested as `desiserials.us`, but that domain is now only a page saying
*"DesiSerials is now Desi-Serials.to!"*, so the plugin uses **desi-serials.to**.

### 🔧 Rebuild — 2026-10-06

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
