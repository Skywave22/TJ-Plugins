(function() {
    // MEGA FIXED PLUGIN - Deep extraction for 5 sites + VidLink direct MP4 fix
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_API = "https://api.themoviedb.org/3";
    const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
    const TMDB_ORIGINAL = "https://image.tmdb.org/t/p/original";
    const CURRENT_BASE = (typeof manifest !== "undefined" && manifest.baseUrl) ? manifest.baseUrl.replace(/\/+$/, "") : "https://popcornmovies.io";

    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9"
    };
    const VIDLINK_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://vidlink.pro/",
        "Origin": "https://vidlink.pro",
        "Accept": "application/json"
    };

    function log(...a){ try{ console.log("[MegaFIXED]", ...a); }catch{} }
    function safeParse(s,f){ try{ return JSON.parse(s); }catch{ return f; } }

    async function httpGetJson(url, headers=HEADERS){
        try{
            const res = await http_get(url, headers);
            if(!res || !res.body) return null;
            const t = res.body.trim();
            if(t.startsWith("<")) return null;
            return safeParse(t, null);
        }catch(e){ log("GET json fail", url, e.message); return null; }
    }

    async function fetchTmdb(p){
        const sep = p.includes("?")?"&":"?";
        return await httpGetJson(`${TMDB_API}${p}${sep}api_key=${TMDB_API_KEY}`);
    }

    function toItem(o, forced){
        if(!o || !o.id) return null;
        const type = forced || o.media_type || (o.title?"movie":"series");
        const norm = type==="tv"?"series":(type==="movie"?"movie":type);
        const title = o.title || o.name || "Unknown";
        const poster = o.poster_path ? TMDB_IMAGE+o.poster_path : "https://via.placeholder.com/300x450";
        const banner = o.backdrop_path ? TMDB_ORIGINAL+o.backdrop_path : "";
        const year = parseInt((o.release_date||o.first_air_date||"").slice(0,4))||0;
        const score = o.vote_average? parseFloat(o.vote_average.toFixed(1)):0;
        const payload = { tmdbId:o.id, type: norm==="movie"?"movie":"tv", title, year };
        return new MultimediaItem({
            title, url: JSON.stringify(payload), posterUrl: poster, bannerUrl: banner,
            type: norm==="series"?"series":norm, year, score, description: o.overview||""
        });
    }

    async function getHome(cb){
        try{
            const reqs=[
                {url:`${TMDB_API}/trending/all/day?api_key=${TMDB_API_KEY}`, headers:HEADERS},
                {url:`${TMDB_API}/movie/popular?api_key=${TMDB_API_KEY}&page=1`, headers:HEADERS},
                {url:`${TMDB_API}/tv/popular?api_key=${TMDB_API_KEY}&page=1`, headers:HEADERS},
                {url:`${TMDB_API}/movie/top_rated?api_key=${TMDB_API_KEY}&page=1`, headers:HEADERS},
                {url:`${TMDB_API}/tv/top_rated?api_key=${TMDB_API_KEY}&page=1`, headers:HEADERS},
                {url:`${TMDB_API}/movie/now_playing?api_key=${TMDB_API_KEY}&page=1`, headers:HEADERS}
            ];
            let results;
            try{ results = await http_parallel(reqs); }catch{ results=[]; for(const r of reqs){ const j=await httpGetJson(r.url); results.push({body:JSON.stringify(j||{})}); } }
            const parseBody=i=>{ try{ return safeParse(results[i]?.body||"{}",{} ).results||[]; }catch{ return []; } };
            const home={};
            const trending=parseBody(0).map(o=>toItem(o)).filter(Boolean);
            const popMov=parseBody(1).map(o=>toItem(o,"movie")).filter(Boolean);
            const popTv=parseBody(2).map(o=>toItem(o,"tv")).filter(Boolean);
            const topMov=parseBody(3).map(o=>toItem(o,"movie")).filter(Boolean);
            const topTv=parseBody(4).map(o=>toItem(o,"tv")).filter(Boolean);
            const now=parseBody(5).map(o=>toItem(o,"movie")).filter(Boolean);
            if(trending.length) home["Trending"]=trending.slice(0,20);
            if(popMov.length) home["Popular Movies"]=popMov.slice(0,24);
            if(popTv.length) home["Popular Series"]=popTv.slice(0,24);
            if(now.length) home["Now Playing"]=now.slice(0,24);
            if(topMov.length) home["Top Rated Movies"]=topMov.slice(0,24);
            if(topTv.length) home["Top Rated Series"]=topTv.slice(0,24);
            if(!Object.keys(home).length) return cb({success:false, errorCode:"HOME_ERROR", message:"No data"});
            cb({success:true, data:home});
        }catch(e){ cb({success:false, errorCode:"SITE_OFFLINE", message:e.message}); }
    }

    async function search(query, cb){
        try{
            const q=encodeURIComponent((query||"").trim());
            if(!q) return cb({success:true, data:[]});
            const json=await httpGetJson(`${TMDB_API}/search/multi?api_key=${TMDB_API_KEY}&query=${q}&include_adult=false`);
            const res=(json?.results||[]).filter(o=>(o.media_type==="movie"||o.media_type==="tv")&&o.poster_path).map(o=>toItem(o)).filter(Boolean);
            cb({success:true, data:res.slice(0,30)});
        }catch(e){ cb({success:false, errorCode:"SEARCH_ERROR", message:e.message}); }
    }

    async function load(url, cb){
        try{
            let payload;
            try{ payload=JSON.parse(url); if(typeof payload==="string") payload=JSON.parse(payload); }catch{
                const m=url.match(/\/(\d+)(?:\/|$)/);
                payload={tmdbId: m?parseInt(m[1]):0, type:url.includes("/tv/")?"tv":"movie"};
            }
            const tmdbId=payload.tmdbId||payload.id;
            const type=payload.type==="series"?"tv":(payload.type||"movie");
            if(!tmdbId) return cb({success:false, errorCode:"NOT_FOUND"});

            if(type==="movie"){
                const movie=await fetchTmdb(`/movie/${tmdbId}?language=en-US`);
                if(!movie) return cb({success:false, errorCode:"NOT_FOUND"});
                const poster=movie.poster_path?TMDB_IMAGE+movie.poster_path:"";
                const banner=movie.backdrop_path?TMDB_ORIGINAL+movie.backdrop_path:"";
                const eps=[new Episode({name:"Full Movie", url:JSON.stringify({tmdbId, type:"movie", season:1, episode:1, title:movie.title}), season:1, episode:1, posterUrl:poster, description:movie.overview||""})];
                const item=new MultimediaItem({title:movie.title||payload.title, url, posterUrl:poster, bannerUrl:banner, type:"movie", year:movie.release_date?parseInt(movie.release_date.slice(0,4)):payload.year, score:movie.vote_average||0, description:movie.overview||"", episodes:eps, tags:(movie.genres||[]).map(g=>g.name)});
                return cb({success:true, data:item});
            }else{
                const tv=await fetchTmdb(`/tv/${tmdbId}?language=en-US`);
                if(!tv) return cb({success:false, errorCode:"NOT_FOUND"});
                const poster=tv.poster_path?TMDB_IMAGE+tv.poster_path:"";
                const banner=tv.backdrop_path?TMDB_ORIGINAL+tv.backdrop_path:"";
                const seasons=(tv.seasons||[]).filter(s=>s.season_number>0);
                const seasonFetches=seasons.slice(0,8).map(s=>({url:`${TMDB_API}/tv/${tmdbId}/season/${s.season_number}?api_key=${TMDB_API_KEY}&language=en-US`, headers:HEADERS}));
                let episodes=[];
                try{
                    const seasonResults=await http_parallel(seasonFetches);
                    for(let i=0;i<seasonResults.length;i++){
                        const body=seasonResults[i]?.body||"";
                        const sd=safeParse(body,null);
                        const eps=sd?.episodes||[];
                        const sNum=sd?.season_number||seasons[i]?.season_number||(i+1);
                        eps.forEach(ep=>{
                            episodes.push(new Episode({
                                name:`S${String(sNum).padStart(2,'0')}E${String(ep.episode_number).padStart(2,'0')} - ${ep.name||"Episode "+ep.episode_number}`,
                                url:JSON.stringify({tmdbId, type:"tv", season:sNum, episode:ep.episode_number, title:tv.name}),
                                season:sNum, episode:ep.episode_number,
                                posterUrl:ep.still_path?TMDB_IMAGE+ep.still_path:poster,
                                description:ep.overview||"", airDate:ep.air_date||"", rating:ep.vote_average||0
                            }));
                        });
                    }
                }catch{
                    const fs=await fetchTmdb(`/tv/${tmdbId}/season/1?language=en-US`);
                    (fs?.episodes||[]).forEach(ep=>{
                        episodes.push(new Episode({name:`S01E${String(ep.episode_number).padStart(2,'0')} - ${ep.name}`, url:JSON.stringify({tmdbId, type:"tv", season:1, episode:ep.episode_number, title:tv.name}), season:1, episode:ep.episode_number, posterUrl:ep.still_path?TMDB_IMAGE+ep.still_path:poster}));
                    });
                }
                if(!episodes.length){ for(let e=1;e<=10;e++) episodes.push(new Episode({name:`Episode ${e}`, url:JSON.stringify({tmdbId, type:"tv", season:1, episode:e, title:tv.name}), season:1, episode:e, posterUrl:poster})); }
                episodes.sort((a,b)=>(a.season-b.season)||(a.episode-b.episode));
                const item=new MultimediaItem({title:tv.name||payload.title, url, posterUrl:poster, bannerUrl:banner, type:"series", year:tv.first_air_date?parseInt(tv.first_air_date.slice(0,4)):payload.year, score:tv.vote_average||0, description:tv.overview||"", episodes, tags:(tv.genres||[]).map(g=>g.name)});
                return cb({success:true, data:item});
            }
        }catch(e){ cb({success:false, errorCode:"PARSE_ERROR", message:e.message}); }
    }

    // ===== DEEP EXTRACTION FIXES =====

    // 1. VidLink Pro - Direct MP4 with subtitles (most reliable, uses enc-dec)
    async function fetchVidLink(tmdbId, season, episode, type){
        const streams=[];
        try{
            // Step 1: Encrypt TMDB ID via enc-dec.app
            const encRes = await http_get(`https://enc-dec.app/api/enc-vidlink?text=${tmdbId}`, HEADERS);
            const encJson = safeParse(encRes.body, null);
            const encId = encJson?.result;
            if(!encId) { log("VidLink encrypt failed"); return streams; }

            const apiUrl = type==="movie"
                ? `https://vidlink.pro/api/b/movie/${encId}`
                : `https://vidlink.pro/api/b/tv/${encId}/${season}/${episode}`;

            const res = await http_get(apiUrl, VIDLINK_HEADERS);
            if(!res || !res.body) return streams;
            const data = safeParse(res.body, null);
            if(!data || !data.stream) return streams;

            const captions = [];
            if(data.stream.captions && Array.isArray(data.stream.captions)){
                for(const cap of data.stream.captions){
                    captions.push({ url: cap.url, label: cap.language||"Unknown", lang: (cap.language||"en").slice(0,2).toLowerCase() });
                }
            }

            const quals = data.stream.qualities || {};
            for(const qKey of Object.keys(quals)){
                const qObj = quals[qKey];
                if(!qObj || !qObj.url) continue;
                const qLabel = isNaN(parseInt(qKey)) ? qKey : qKey+"p";
                streams.push(new StreamResult({
                    url: qObj.url,
                    quality: qLabel,
                    source: `VidLink Pro - ${qLabel}`,
                    headers: { "Referer": "https://vidlink.pro/", "User-Agent": HEADERS["User-Agent"] },
                    subtitles: captions
                }));
            }
            // Also check playlist if available (dash/hls)
            if(data.stream.playlist){
                streams.push(new StreamResult({
                    url: data.stream.playlist,
                    quality: "Auto",
                    source: "VidLink Pro - HLS",
                    headers: VIDLINK_HEADERS,
                    subtitles: captions
                }));
            }
            log(`VidLink found ${streams.length} streams for ${tmdbId}`);
        }catch(e){ log("VidLink error", e.message); }
        return streams;
    }

    // 2. AutoEmbed - tries multiple domains
    async function fetchAutoEmbed(tmdbId, season, episode, type){
        const streams=[];
        const domains = [
            "https://tom.autoembed.cc",
            "https://autoembed.cc",
            "https://watch.autoembed.cc"
        ];
        for(const dom of domains){
            try{
                const id = type==="movie" ? `${tmdbId}` : `${tmdbId}/${season}/${episode}`;
                const url = `${dom}/api/getVideoSource?type=${type==="movie"?"movie":"tv"}&id=${id}`;
                const res = await http_get(url, { "Referer": dom, "User-Agent": HEADERS["User-Agent"] });
                if(!res || !res.body || res.body.trim().startsWith("<")) continue;
                const json = safeParse(res.body, null);
                if(!json || !json.videoSource) continue;
                const vs = json.videoSource;
                // videoSource could be string URL or object
                if(typeof vs === "string" && vs.startsWith("http")){
                    streams.push(new StreamResult({ url: vs, source: `AutoEmbed - ${dom.split('//')[1]}`, headers: { Referer: dom } }));
                } else if(typeof vs === "object"){
                    for(const k of Object.keys(vs)){
                        const u = vs[k];
                        if(typeof u==="string" && u.startsWith("http")){
                            streams.push(new StreamResult({ url: u, source: `AutoEmbed ${k}`, headers: { Referer: dom } }));
                        }
                    }
                }
                if(streams.length) break;
            }catch(e){ log("AutoEmbed fail", e.message); }
        }
        return streams;
    }

    // 3. Vidsrc VIP - uses double base64 encode
    function encodeVidsrcVip(tmdbId, type, season, episode){
        try{
            const map=['a','b','c','d','e','f','g','h','i','j'];
            let raw;
            if(type==="tv" && season && episode){
                raw = `${tmdbId}-${season}-${episode}`;
            }else{
                raw = String(tmdbId).split('').map(d=>map[parseInt(d)]||'a').join('');
            }
            const rev = raw.split('').reverse().join('');
            const b1 = btoa(rev);
            const b2 = btoa(b1);
            return b2;
        }catch{ return null; }
    }

    async function fetchVidsrcVip(tmdbId, season, episode, type){
        const streams=[];
        try{
            const enc = encodeVidsrcVip(tmdbId, type==="movie"?"movie":"show", season, episode);
            if(!enc) return streams;
            const apiType = type==="movie"?"movie":"tv";
            const url = `https://api2.vidsrc.vip/${apiType}/${enc}`;
            const res = await http_get(url, HEADERS);
            if(!res || !res.body) return streams;
            const json = safeParse(res.body, null);
            if(!json) return streams;
            for(let i=1; json[`source${i}`]; i++){
                const src = json[`source${i}`];
                if(src && src.url && src.url.startsWith("http")){
                    // These are often m3u8 or mp4 embeds that extractor can handle
                    if(typeof loadExtractor !== 'undefined'){
                        try{
                            const ext = await loadExtractor(src.url);
                            if(ext && ext.length){
                                ext.forEach(item=>{
                                    streams.push(new StreamResult({ url: item.url, source: `VidsrcVip S${i}`, headers: item.headers||HEADERS }));
                                });
                                continue;
                            }
                        }catch{}
                    }
                    streams.push(new StreamResult({ url: src.url, source: `VidsrcVip S${i}`, headers: HEADERS }));
                }
            }
        }catch(e){ log("VidsrcVip fail", e.message); }
        return streams;
    }

    // 4. Original 5 sites deep scrape with iframe + regex
    async function scrapeOriginalSites(tmdbId, season, episode, type){
        const streams=[];
        const SITE_PATTERNS=[
            {base:"https://popcornmovies.io", movie:(id)=>`/movie/${id}`, tv:(id,s,e)=>`/tv/${id}/${s}/${e}`, name:"Popcorn"},
            {base:"https://www.cineby.at", movie:(id)=>`/movie/${id}`, tv:(id,s,e)=>`/tv/${id}/${s}/${e}`, name:"Cineby"},
            {base:"https://zstream.mov", movie:(id)=>`/media/tmdb-movie-${id}`, tv:(id,s,e)=>`/media/tmdb-tv-${id}/${s}/${e}`, name:"ZStream"},
            {base:"https://primeshows.org", movie:(id)=>`/movie/${id}`, tv:(id,s,e)=>`/tv/${id}/season/${s}/episode/${e}`, name:"PrimeShows"},
            {base:"https://fireflix.pages.dev", movie:(id)=>`/movie/${id}`, tv:(id,s,e)=>`/tv/${id}/${s}/${e}`, name:"FireFlix"}
        ];
        for(const site of SITE_PATTERNS){
            try{
                const path = type==="movie"? site.movie(tmdbId) : site.tv(tmdbId, season, episode);
                const fullUrl = site.base+path;
                const res = await http_get(fullUrl, {"User-Agent":HEADERS["User-Agent"], "Referer":site.base+"/"});
                if(!res || !res.body) continue;
                const html=res.body;
                // parse_html for iframes
                try{
                    const iframes = await parse_html(html, "iframe", "src");
                    for(const fr of iframes){
                        let src=fr.attr;
                        if(!src) continue;
                        if(src.startsWith("//")) src="https:"+src;
                        if(src.startsWith("/")) src=site.base+src;
                        if(src.includes("googletag")||src.includes("facebook")) continue;
                        // Try extractor
                        if(typeof loadExtractor !== 'undefined'){
                            try{
                                const ext=await loadExtractor(src, fullUrl);
                                if(ext && ext.length){
                                    ext.forEach(it=>{
                                        streams.push(new StreamResult({url:it.url, source:`${site.name} - ${it.source||"Iframe"}`, headers:it.headers||{"Referer":fullUrl}}));
                                    });
                                    continue;
                                }
                            }catch{}
                        }
                        streams.push(new StreamResult({url:src, source:`${site.name} - Iframe`, headers:{"Referer":fullUrl}}));
                    }
                }catch{}
                // Regex for any embed URL
                const regexes=[/["'](https?:\/\/[^"']*vidsrc[^"']*)["']/gi, /["'](https?:\/\/[^"']*2embed[^"']*)["']/gi, /["'](https?:\/\/[^"']*vidlink[^"']*)["']/gi, /["'](https?:\/\/[^"']*smashy[^"']*)["']/gi, /["'](https?:\/\/[^"']*vidbinge[^"']*)["']/gi, /["'](https?:\/\/[^"']*autoembed[^"']*)["']/gi];
                for(const rgx of regexes){
                    let m;
                    while((m=rgx.exec(html))!==null){
                        const u=m[1];
                        if(u && u.startsWith("http") && u.length<500){
                            streams.push(new StreamResult({url:u, source:`${site.name} - Regex`, headers:{"Referer":fullUrl}}));
                        }
                    }
                }
            }catch(e){ log(`Scrape ${site.name} fail`, e.message); }
        }
        return streams;
    }

    // 5. Direct VidSrc embeds with extractor fallback (last resort)
    async function fetchDirectEmbeds(tmdbId, season, episode, type){
        const streams=[];
        const list = type==="movie" ? [
            {url:`https://vidsrc.to/embed/movie/${tmdbId}`, label:"VidSrc.to"},
            {url:`https://vidsrc.me/embed/movie?tmdb=${tmdbId}`, label:"VidSrc.me"},
            {url:`https://www.2embed.cc/embed/${tmdbId}`, label:"2Embed"},
            {url:`https://vidlink.pro/movie/${tmdbId}`, label:"VidLink Embed"},
            {url:`https://player.smashy.stream/movie/${tmdbId}`, label:"Smashy"},
            {url:`https://vidbinge.dev/embed/movie/${tmdbId}`, label:"VidBinge"},
            {url:`https://vidsrc.cc/v2/embed/movie/${tmdbId}`, label:"VidSrc.cc V2"}
        ] : [
            {url:`https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`, label:"VidSrc.to TV"},
            {url:`https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`, label:"VidSrc.me TV"},
            {url:`https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`, label:"2Embed TV"},
            {url:`https://vidlink.pro/tv/${tmdbId}/${season}/${episode}`, label:"VidLink TV"},
            {url:`https://player.smashy.stream/tv/${tmdbId}?s=${season}&e=${episode}`, label:"Smashy TV"},
            {url:`https://vidbinge.dev/embed/tv/${tmdbId}/${season}/${episode}`, label:"VidBinge TV"}
        ];
        for(const emb of list){
            try{
                if(typeof loadExtractor !== 'undefined'){
                    const ext = await loadExtractor(emb.url, CURRENT_BASE+"/");
                    if(ext && ext.length){
                        ext.forEach(it=>{
                            streams.push(new StreamResult({url:it.url, source:emb.label+" - Extractor", headers:it.headers||HEADERS}));
                        });
                        continue;
                    }
                }
                streams.push(new StreamResult({url:emb.url, source:emb.label, headers:{Referer:CURRENT_BASE+"/"}}));
            }catch(e){ streams.push(new StreamResult({url:emb.url, source:emb.label})); }
        }
        return streams;
    }

    async function loadStreams(url, cb){
        try{
            let payload;
            try{ payload=JSON.parse(url); if(typeof payload==="string") payload=JSON.parse(payload); if(Array.isArray(payload)) payload=payload[0]; }catch{ payload={tmdbId:0, type:"movie"}; }
            const tmdbId=payload.tmdbId||payload.id||0;
            const type=payload.type==="series"?"tv":(payload.type||"movie");
            const season=payload.season||1;
            const episode=payload.episode||1;
            if(!tmdbId) return cb({success:true, data:[]});
            log(`loadStreams FIXED ${tmdbId} ${type} S${season}E${episode}`);

            let allStreams=[];

            // Layer 1: VidLink Pro direct MP4 - MOST RELIABLE
            const vidlink = await fetchVidLink(tmdbId, season, episode, type);
            allStreams = allStreams.concat(vidlink);

            // Layer 2: AutoEmbed
            const autoembed = await fetchAutoEmbed(tmdbId, season, episode, type);
            allStreams = allStreams.concat(autoembed);

            // Layer 3: VidsrcVip
            const vipsrc = await fetchVidsrcVip(tmdbId, season, episode, type);
            allStreams = allStreams.concat(vipsrc);

            // Layer 4: Original 5 sites deep scrape
            const original = await scrapeOriginalSites(tmdbId, season, episode, type);
            allStreams = allStreams.concat(original);

            // Layer 5: Direct embeds fallback
            const direct = await fetchDirectEmbeds(tmdbId, season, episode, type);
            allStreams = allStreams.concat(direct);

            // Deduplicate
            const seen=new Set();
            const unique=[];
            for(const s of allStreams){
                if(!s.url || seen.has(s.url)) continue;
                seen.add(s.url);
                unique.push(s);
            }

            // Sort by quality
            unique.sort((a,b)=>{
                const score = (x)=>{
                    const str=(x.quality||x.source||"").toLowerCase();
                    if(str.includes("1080")) return 4;
                    if(str.includes("720")) return 3;
                    if(str.includes("480")) return 2;
                    if(str.includes("360")) return 1;
                    return 0;
                };
                return score(b)-score(a);
            });

            if(!unique.length){
                log("No streams found, returning fallback");
                unique.push(new StreamResult({url:`https://vidsrc.to/embed/${type==="movie"?"movie":"tv"}/${tmdbId}${type!=="movie"?`/${season}/${episode}`:""}`, source:"Fallback VidSrc.to"}));
            }

            log(`TOTAL ${unique.length} streams for ${tmdbId}`);
            cb({success:true, data:unique});
        }catch(e){
            log("loadStreams error", e.stack||e.message);
            cb({success:false, errorCode:"PARSE_ERROR", message:e.message});
        }
    }

    globalThis.getHome=getHome;
    globalThis.search=search;
    globalThis.load=load;
    globalThis.loadStreams=loadStreams;
})();
