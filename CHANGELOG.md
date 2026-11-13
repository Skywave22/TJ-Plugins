# Changelog

Release notes for TJ-Plugins, newest first. The plugin list and install steps are in the [README](README.md).

### 🔧 Fixed — 2026-11-13

| Plugin | Change |
|---|---|
| **CineFreak** v11 | **No more check before a video, and dead files are no longer offered as playable** — CineCloud's unlock stopped enforcing its Turnstile, so the plugin now opens it with no sheet at all (the check is only asked if the site starts refusing again). It also copies the page's own retries (asks again for a nonce after 600 ms, resends after a `renonce`), ignores the hidden decoy buttons on the file page, and tests each file before showing it: every CineFreak title currently redirects to the same R2 bucket, which answers **403 "This bucket cannot be viewed"**, so those links used to appear and then fail with 403. When the files are down it now falls back to CineFreak's own player (`wp-json/cf/v1/pl`), which needs one Turnstile — SkyStream v2.9.0+ passes it, older versions get a clear "update SkyStream" message. |
| **All-in-one** v26 | Rebuilt with CineFreak v11. |

### 🔧 Fixed — 2026-11-12 (3)

| Plugin | Change |
|---|---|
| **ScreenScape** v3, **RiveStream** v7, **Vidbox** v6, **Cinezo** v3, **HiStream** v2, **CineHD** v12, **CineJoy** v7 | **Links are back** - their shared server (nxsha) changed its secret key, so every title said "server did not answer" / "no server carries this title". Updated, and the plugins now **find a new key by themselves** if it changes again (tested: started with the old key, Inception still gave 18 links). Breaking Bad S1E1: 11-20 links each. |
| **ZXCStream** v4 | **Plays again, faster, with more servers** - vidstuck.cc renamed its API and added a signed request. Now uses all its current servers: **Orion** (MP4 up to 1080p + Hindi dub), **Berkas** (1080p HLS), **Milky Way**, **Atlas**, Andromeda as backup. El Camino: 2 links in 26 s → 6 links in 3 s. |
| **FMoviess** v8 | **Series play again** - the site dropped its vidlove server (domain is gone). Added nxsha's servers (Nitro, Mahalala, Citadel, CastVid…, Hindi and English, up to 4K) next to MoviesAPI and vixsrc. Breaking Bad S1E1: 0 → 14 links. |
| **Movies4u** v3 | **Works again** - the site moved to **new7.movies4u.garden** (old addresses now redirect to a search page, which the plugin took for the site). It now only accepts the real site, so the automatic domain switch works next time. Jailer 2: 14 links, Rings of Power S1E1: 3. |
| **All-in-one** v25 | Rebuilt with all of the above (Breaking Bad S1E1: 73 links). |

### 🔧 Fixed — 2026-11-12 (2)

| Plugin | Change |
|---|---|
| **Net77** v4 | **Prime Video and JioHotstar play again** - net77.cc removed their playlists ("404"), so they now play through the NetMirror app's checked session like Netflix (The Boys S1E1: 10 links in Hindi, English, Tamil, Telugu, Malayalam; Special Ops S2E1 on JioHotstar: Hindi, Tamil, Telugu…). The checked session is only accepted for ~5 minutes, not 15 hours as assumed, so it is no longer kept for 12 h: opening any title starts a fresh check in the background, so Play no longer gets the 10-minute promo clip first and then waits another 40 seconds. |
| **All-in-one** v24 | Rebuilt with Net77 v4. Titles that a site only has as "Extended Cut" / "Director's Cut" are matched to the film (Jawan now also gets Net77's Netflix link); language-only cuts ("Tamil Extended Cut") are not. |

### 🆕 New — 2026-11-12

| Plugin | What it is |
|---|---|
| **KMMovies** v1 | [kmmovies.beer](https://kmmovies.beer) (new home of Khatrimaza) - Bollywood, Hollywood, South, Hindi dubbed, dual-audio, K-drama, anime and 4K posts with the site's rows (Latest Uploads, Trending, Bollywood, Hollywood, Dual Audio, Hindi Dubbed, South, TV Series, K-Drama, Anime, 4K) and search. Full details from the post: description, poster, backdrop, genres, cast, trailer. Each KMCLOUD file plays directly from two servers: **KMCloud** (R2 file, starts instantly) and **KMCloud Drive** (Google Drive copy), 480p / 720p / 1080p. Series: each season is one file with all its episodes. Not available: single episodes and WEB-DL / 4K files that are only on magiclinks.lol (Cloudflare check that a plugin can't pass). Many older posts only have those links. In tests: Allen 6 links, Never Surrender 6, The Body S1 6, Black Doves S2 4. |
| **All-in-one** v23 | **KMMovies joins All-in-one** (now 28 sites) - for movies; its season files are not offered as episodes. |

### 🔧 Fixed — 2026-11-04 (8)

| Plugin | Change |
|---|---|
| **PikaHD** v5 | Older posts with per-episode GDFlix links now list their episodes (Jujutsu Kaisen Season 1 showed only Seasons 2-3, and Season 2 was missing 5 episodes). |
| **PikaHD** v5, **KatDrama** v3 | "GDFlix Instant" links play again - they were opening an ad page instead of the file (e.g. Squid Game S3E1 on KatDrama: 1 link → 6). |
| **All-in-one** v22 | Rebuilt with PikaHD v5 and KatDrama v3. |

### 🔧 Fixed — 2026-11-04 (7)

| Plugin | Change |
|---|---|
| **ReelFren** v3 | Home and search work again: www.reelfren.com now answers "404" and api.reelfren.com "503", so the API is read from proxy.reelfren.com. RaptDrama removed (ReelFren has no video for any of its titles). |

### 🔧 Fixed — 2026-11-04 (6)

| Plugin | Change |
|---|---|
| **NetMirror** v11 | NM Hub links were refused by the video server ("429") because the wrong Referer was sent since October; the accepted one is back. |
| **All-in-one** v21 | Rebuilt with NetMirror v11. |

### 🔧 Fixed — 2026-11-04 (5)

| Plugin | Change |
|---|---|
| **HiCine** v12 | Shows the real release year (Breaking Bad showed 2023, the re-upload year, instead of 2008). |
| **All-in-one** v20 | Rebuilt with HiCine v12. |

### 🔧 Fixed — 2026-11-04 (4)

| Plugin | Change |
|---|---|
| **KDramaMaza** v11 | Cards no longer show the upload date as the release year (e.g. "100 Days My Prince" showed 2026 instead of 2018). |
| **All-in-one** v19 | Rebuilt with KDramaMaza v11. |

### ✨ Updated — 2026-11-04 (3)

| Plugin | Change |
|---|---|
| **SubDubAnime** v7 | Can now collect every language version of a title in one go (Hindi Dubbed, Hindi Fan Dubbed, English Dubbed…), each link labelled with its language. Used by the new Nuvio version; nothing changes in SkyStream. |
| **All-in-one** v18 | Rebuilt with SubDubAnime v7. |

### 🔧 Fixed — 2026-11-04 (2)

| Plugin | Change |
|---|---|
| **RareAnimes** v9 | **Correct audio language on older posts.** Posts that link a "WatchMultiQuality" list page (Naruto, One Piece, Doraemon and other older series) could show a Hindi dub as "Japanese": the language was read from text that happened to include a poster's file name ("…-English-Japanese.webp"). It is now taken from the heading right above the link. |
| **All-in-one** v17 | Rebuilt with RareAnimes v9. |

### 🆕 New — 2026-11-04

| Plugin | What it is |
|---|---|
| **AniHype** v1 | [anihype.sbs](https://anihype.sbs/index.php) - anime with the site's own rows (Trending, Airing now, Latest releases, Most popular, Highest rated, Top rated this year, Coming soon, Movies, Action, Fantasy, Romance, Comedy, Sci-Fi, All-time favourites), search and episode titles + thumbnails. Every one of its six servers is turned into a direct link: **TryEmbed** (Japanese with English subtitles and English Dub, 1080p), **Katana** (English Sub, 1080p), **Uqload** (one stream with Japanese and English audio), **Orion** (Japanese, English, Hindi, Tamil, Telugu, Malayalam, Kannada, French; HEVC, so it needs a phone/TV that plays HEVC) and **Mikaza** (Hindi Dub). Usually 5-13 links per episode; every link is checked before it is shown. |
| **All-in-one** v16 | **AniHype joins All-in-one** (now 27 sites) - anime episodes get AniHype's Sub, Dub and Hindi links next to the other sites. |

### 🔧 Fixed — 2026-11-03 (2)

Every plugin was re-checked in the app harness (home, search, details, streams, links probed). These were broken and are fixed:

| Plugin | Change |
|---|---|
| **Net77** v3 | **Netflix plays again.** NetMirror stopped playing Netflix titles for normal sessions (every Netflix link came back empty). Net77 now opens the same verified session the NetMirror app uses. The first Netflix play after installing (or every 12 hours) takes about 40 seconds while the session is checked; after that Netflix links start at once. Opening any Netflix title starts the check in the background, so it is usually ready before you press Play. Prime Video and JioHotstar are unchanged. Tested: Jawan (Extended Cut) 1080p/720p/480p, The Great Indian Kapil Show S1E1. |
| **MoviesHubHD** v3 | **Streams are back.** VidNest changed its secret key, so every title said "No MoviesHubHD server has this right now". Updated - Resident Evil 14 links, Dead-End Job S1E1 10 links. |
| **ReelFren** v2 | **Home and search work again.** ReelFren's API address (api.reelfren.com) now asks for a Cloudflare check; the plugin now uses the website's own copy of the API (with the proxy as backup) and switches automatically if one stops answering. Also hides the apps' internal "test" entries that never play. |
| **ZXCStream** v3 | **Streams are back.** Its video source (vidstuck) renamed its API and every field name; updated. Resident Evil 3 links, The Gilded Age S1E1 3 links. |
| **All-in-one** | Rebuilt with the fixed Net77, MoviesHubHD and ZXCStream. |

**Still not working (site-side, nothing to fix in the plugin):** DesiSerialOnline (desiserialonline.su is overloaded and not answering), CineFreak (needs SkyStream v2.9.0+ for its Cloudflare check), 321MoviesUK (site offline), Movies4u (domain retired). NetMirror's "NM Hub" links may be rate-limited by its server; "NM Direct" links play.

### 🆕 New — 2026-11-03

| Plugin | What it is |
|---|---|
| **Bingr** v1 | [bingr.one](https://bingr.one/home) - movies, TV shows and anime with the site's home rows (Trending, Popular Movies, Popular TV Shows, Blockbuster Action, Top Rated Movies / TV / Anime, Hindi Movies, Horror, Crime & Thriller, Sci-Fi & Fantasy, Action Anime, Romance, Comedy) and search. Full details from TMDB: description, cast, trailer, every season and episode with thumbnails, recommendations. Streams from **all** of the site's servers: **Prism** (multi-audio - Hindi, Original, Telugu, Tamil, French, Russian, Portuguese… up to 1080p), **Edge** (1080p), **Nimbus** and **Citadel** (Hindi, Tamil, Telugu, Kannada and English dubs in 720p / 480p). Hindi links first; subtitles in up to 20 languages; every link (and its first quality level) is checked before it is shown. In tests: Inception 14 links, Breaking Bad S1E1 10, Jawan 9, Demon Slayer S1E1 9 (Hindi dub + Japanese). Also inside All-in-one. |
| **All-in-one** | **Bingr joins All-in-one** (now 26 sites). |

### ✨ Updated — 2026-10-28 (4)

| Plugin | Change |
|---|---|
| **Net77** v2 | **Prime Video added.** Home now starts with one row from each service - 1st Netflix (New on Netflix), 2nd Prime Video (Latest Movies), 3rd JioHotstar (Latest Releases) - followed by the rest of the Netflix rows, then the 15 other Prime Video rows, then the other Hotstar rows. Search covers all three. **Links from all three:** when you press Play, Net77 also finds the same movie or episode on the other two services (same name, same year, same season/episode) and adds their links, labelled "Netflix · Hindi [1080p]", "Prime · English [720p]", "Hotstar · Tamil [1080p]". Videos on NetMirror servers that changed their names or now sit behind the site's relays are found automatically (fixes "server did not answer" on some titles such as Black Clover and Awarapan 2). |
| **All-in-one** | **Net77 joins All-in-one** (now 25 sites): its Netflix, Prime Video and JioHotstar titles fill those rows, and its links are added when you press Play. |

### 🆕 New — 2026-10-28 (3)

| Plugin | What it is |
|---|---|
| **Net77** v1 | [net77.cc](https://net77.cc), the original NetMirror (net79.cc was a different site). Both catalogs of the site: the 16 Netflix rows (New on Netflix, Top Searches, Bollywood Movies, US TV Shows Dubbed in Hindi, South Indian Cinema, Asian Movies & TV…) and 5 JioHotstar rows, plus search across both. Full details: description, cast, genres, runtime, every season and episode with thumbnails, "More like this". Plays the site's own HLS in 1080p / 720p / 480p. Titles with several audio languages get one link per language (Hindi first, then English, Tamil, Telugu, Malayalam, Kannada, Korean, Japanese…), each labelled like "Net77 · Hindi [1080p]"; English subtitles where the site has them. Every play opens a fresh NetMirror session (the site only allows a few minutes per session), and the video server is found automatically - including servers the site hides behind its relays. In tests 44 of 44 sampled titles from the home rows played at full length. Not inside All-in-one yet: it joins once playback is confirmed on phones. |

**Removed:** **Net79** - net79.cc is not the original NetMirror and its links mostly failed. Uninstall Net79 and install Net77.

### 🔧 Fixed — 2026-10-28 (2)

| Plugin | Change |
|---|---|
| **Net79** v2 | **"No links found":** about 1 title in 5 in net79's rows (TMDB lists) is not on its servers yet. The home rows now hide those titles: each one is checked with the site's mapping API, and the answers are remembered on the phone, so the rows get cleaner and faster with every visit. Search now also finds titles the site marks "Coming Soon" that already play (Verity, Forgotten Island…) and hides the ones it doesn't have. When the server has no answer it is asked once more, as the site's player does. **"All links failed":** before listing links, the plugin now asks the video server (MovieBox CDN) for 2 bytes of the file from your phone: directly (with and without a Referer) and through net79's own proxy. Only the kind that answers is listed (with the Referer that worked). If the server refuses both, you get a message with the exact answers (e.g. "direct: HTTP 429, proxy: HTTP 429") instead of a list of links that all fail. |

### 🆕 New — 2026-10-28 (2)

| Plugin | What it is |
|---|---|
| **Net79** v1 | [net79.cc](https://net79.cc), the NetMirror web site (backup domains net27.cc, netmirrors.vip, net77.cc). The site's catalog with the same rows: Top 10 Today, New Releases, Popular on Netflix, Netflix Series, Prime Video, Anime, Latest Movies, Latest Series, Hindi Dubbed, Korean Dramas, Action, Comedies. Plays the site's MovieBox files: MP4 in 1080p / 720p / 480p / 360p with file sizes, subtitles in many languages, and every audio language the site has for the title (Hindi, English, Original, Tamil, Telugu…). Each link is also offered through the site's own video proxy ("· Proxy"), for networks where the direct link is refused. Not in All-in-one yet: it joins once playback is confirmed on phones. |

### 🔧 Fixed — 2026-10-28

| Plugin | Change |
|---|---|
| **ZXCStream** v2 | Links play again instead of most servers failing. ZXCStream's server (vidstuck) allows only about 20 requests per 10 seconds per user. v1 used about 26 for one title, so the app's link check and the player then got "too many requests" and server after server failed. v2 needs about 9: one token per server (the Hindi dub reuses Orion's), Andromeda only when Orion has nothing (it is the same file), no double checks of vidstuck links, a 15-minute cache per episode, and it slows itself down when episodes are opened one after another. Ursa was removed (its video segments are refused at the source), as were the Tamil/Telugu dubs and the subtitle list (two more requests each; the player's own subtitle search still works). Links now open directly in the player, without the app's proxy, and the Orion links show their real quality (1080p / 480p). Daedalus (H.264) is listed right after Orion, for phones that can't play Orion's HEVC video. |
| **All-in-one** v12 | Includes the ZXCStream fix. |

### 🆕 New — 2026-10-28

| Plugin | What it is |
|---|---|
| **ZXCStream** v1 | [zxcstream.com](https://zxcstream.com): the site's catalog with the same rows (Top 10 today / movies / TV, Trending, Popular) and its provider rows: Netflix, HBO, Disney+, Apple TV+, Marvel Studios, Amazon MGM, A24, Blumhouse and Shudder. Plays from the site's ad-free **Main Server** (vidstuck) and all five of its servers: Orion (with **Hindi, Tamil and Telugu dubs** when the title has them), Andromeda, Atlas, Daedalus and Ursa. Hindi dub first, subtitles in up to 25 languages, every link checked before it is shown. |
| **All-in-one** v11 | Now includes ZXCStream (24 sites). |

### 🆕 New — 2026-10-21

| Plugin | What it is |
|---|---|
| **HiStream** v1 | [histream.lol](https://histream.lol): the site's catalog with the same rows (Trending, Popular series and movies, Bollywood, Hindi series, Anime, Top rated) and its "Browse by platform" rows: Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV, Apple TV+, MX Player, Hoichoi and Lionsgate Play, newest first. Plays from the site's own player servers: Hindi first, then English, Tamil and more, up to 4K, every link checked before it is shown. The catalog comes through HiStream's own server, so it also works where TMDB is blocked. Not added to All-in-one: its servers are already there through ScreenScape. |

### 🔧 Changed — 2026-10-21 (4)

| Plugin | Change |
|---|---|
| **RareAnimes** v8 | Old series now also list the site's **MultiQuality (1080p / 720p / 360p)** player next to the Pixeldrain file, instead of hiding it. The Pixeldrain file is the original TV quality (Doraemon S1/S2: 576p) and is now labelled SD; MultiQuality is the only 720p/1080p version on the site (most likely upscaled from the same original). It is marked "(may not play)" when it can't be checked. |
| **All-in-one** v10 | Includes the RareAnimes change. |

### 🔧 Fixed — 2026-10-21 (3)

| Plugin | Change |
|---|---|
| **RareAnimes** v7 | Doraemon Seasons 1 and 2 (and most other older series) now really play. v6 found their episodes, but the only source was the site's WatchMultiQuality player, which refuses apps, so the video failed. The plugin now uses the season's **Pixeldrain pack**: Pixeldrain serves each episode inside the pack as its own video, so every episode plays directly (Doraemon S1: 52 of 52 episodes, with Hindi, Tamil and Telugu audio in the same file). 37 of 40 packs checked are still online. Old movies with a **MediaFire** link now play from MediaFire. Episode lists that use HubCloud / WatchNow list pages are read correctly (e.g. Hotel Transylvania The Series). WatchMultiQuality is only shown when there is nothing else, still marked "(may not play)". |
| **All-in-one** v9 | Includes the RareAnimes fix. |

### 🔧 Fixed — 2026-10-21 (2)

| Plugin | Change |
|---|---|
| **RareAnimes** v6 | Older series work again, including **Doraemon Seasons 1 and 2**, Naruto, Shin-chan, Ben 10, Oggy and Tom & Jerry. About two thirds of the site's posts used to show "no playable link", because the only links that still work on them are on a separate list page and play through the WatchMultiQuality player. The plugin now opens those list pages, finds each episode and plays it in 1080p, 720p or 360p. Old movies that link HubCloud play through it (Doraemon movies in Hindi, Tamil and Telugu). "All Seasons" and "Complete Series" posts now show every season in one place (Doraemon All Seasons: 848 episodes). Search now finds every post, not just the newest 9: "Doraemon" gives 68 results with Seasons 1–22 in order. Posts that only have Mega or ZIP downloads still can't be streamed (the old DLBeta files were deleted by the host). |
| **All-in-one** v8 | Includes the RareAnimes fix. |

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
