(function() {
    // ULTIMATE FIXED PLUGIN - Deep extraction for all 5 sites + ALL servers
    // Fixes: seeking (HLS), all servers, deep site scraping
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_API = "https://api.themoviedb.org/3";
    const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
    const TMDB_ORIGINAL = "https://image.tmdb.org/t/p/original";
    const CURRENT_BASE = (typeof manifest !== "undefined" && manifest.baseUrl) ? manifest.baseUrl.replace(/\/+$/, "") : "https://popcornmovies.io";

    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*"
    };
    const VIDLINK_HEADERS = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://vidlink.pro/",
        "Origin": "https://vidlink.pro",
        "Accept": "application/json"
    };

    // VidRock AES-GCM key from vidrock.net/assets/index-uTZkQqtU.js
    const VIDROCK_KEY_HEX = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";

    function log(...a){ try{ console.log("[UltimateFIXED]", ...a); }catch{} }
    function safeParse(s,f){ try{ return JSON.parse(s); }catch{ return f; } }

    async function httpGetJson(url, headers=HEADERS){
        try{
            const res = await http_get(url, headers);
            if(!res || !res.body) return null;
            const t = res.body.trim();
            if(t.startsWith("<")) return null;
            return safeParse(t, null);
        }catch(e){ return null; }
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

    // ====== HEX & BASE64URL HELPERS FOR VIDROCK ======
    function hexToBytes(hex){
        const bytes = new Uint8Array(hex.length/2);
        for(let i=0;i<bytes.length;i++) bytes[i]=parseInt(hex.substr(i*2,2),16);
        return bytes;
    }
    function base64UrlToBytes(b64url){
        let b64 = b64url.replace(/-/g,"+").replace(/_/g,"/");
        const pad = b64.length%4;
        if(pad===2) b64+="=="; else if(pad===3) b64+="=";
        else if(pad===1) throw new Error("Invalid base64url");
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
        return bytes;
    }
    function bytesToBase64(bytes){
        let bin="";
        for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
        return btoa(bin);
    }

    // Decrypt VidRock URL (AES-GCM with key = hex decode of xQ, iv = first 12 bytes)
    async function decryptVidrockUrl(encryptedUrl){
        try{
            const full = base64UrlToBytes(encryptedUrl);
            if(full.length<28) return null;
            const iv = full.slice(0,12);
            const data = full.slice(12); // ciphertext + tag
            const keyBytes = hexToBytes(VIDROCK_KEY_HEX);
            const keyB64 = bytesToBase64(keyBytes);
            const ivB64 = bytesToBase64(iv);
            const dataB64 = bytesToBase64(data);
            // SkyStream crypto.decryptAES supports GCM
            let decrypted;
            if(typeof crypto !== "undefined" && crypto.decryptAES){
                try{
                    decrypted = await crypto.decryptAES(dataB64, keyB64, ivB64, {mode:"gcm"});
                }catch{
                    // fallback try without options object, try as mode string
                    try{ decrypted = await crypto.decryptAES(dataB64, keyB64, ivB64); }catch(e){ return null; }
                }
            }else{
                return null;
            }
            // decrypted should be URL string
            return decrypted ? decrypted.trim() : null;
        }catch(e){ log("VidRock decrypt fail", e.message); return null; }
    }

    // ====== FETCHERS ======

    // VidLink - direct MP4 via enc-dec + API
    async function fetchVidLink(tmdbId, season, episode, type){
        const streams=[];
        try{
            const encRes = await http_get(`https://enc-dec.app/api/enc-vidlink?text=${tmdbId}`, HEADERS);
            const encJson = safeParse(encRes.body, null);
            const encId = encJson?.result;
            if(!encId) return streams;
            const apiUrl = type==="movie"
                ? `https://vidlink.pro/api/b/movie/${encId}`
                : `https://vidlink.pro/api/b/tv/${encId}/${season}/${episode}`;
            const res = await http_get(apiUrl, VIDLINK_HEADERS);
            if(!res || !res.body) return streams;
            const data = safeParse(res.body, null);
            if(!data || !data.stream) return streams;
            const caps=[];
            if(data.stream.captions && Array.isArray(data.stream.captions)){
                for(const c of data.stream.captions){
                    caps.push({url:c.url, label:c.language||"Unknown", lang:(c.language||"en").slice(0,2).toLowerCase()});
                }
            }
            const quals=data.stream.qualities||{};
            for(const k of Object.keys(quals)){
                const q=quals[k];
                if(!q || !q.url) continue;
                const qLabel=isNaN(parseInt(k))?k:k+"p";
                // Use MAGIC_PROXY for better seeking on mp4
                const mp4Url = q.url;
                // Provide both direct and proxied version: direct for speed, proxied for seeking
                streams.push(new StreamResult({
                    url: mp4Url,
                    quality: qLabel,
                    source: `VidLink Pro MP4 - ${qLabel}`,
                    headers: VIDLINK_HEADERS,
                    subtitles: caps
                }));
                // Also add proxied version for seeking fix
                const proxied = "MAGIC_PROXY_v1"+btoa(mp4Url);
                streams.push(new StreamResult({
                    url: proxied,
                    quality: qLabel+" [Proxy Seek]",
                    source: `VidLink Pro HLS Proxy - ${qLabel}`,
                    headers: VIDLINK_HEADERS,
                    subtitles: caps
                }));
            }
            if(data.stream.playlist){
                streams.push(new StreamResult({
                    url: data.stream.playlist,
                    quality: "Auto",
                    source: "VidLink Pro - DASH",
                    headers: VIDLINK_HEADERS,
                    subtitles: caps
                }));
            }
            log(`VidLink ${streams.length} for ${tmdbId}`);
        }catch(e){ log("VidLink err", e.message); }
        return streams;
    }

    // VidRock - HLS with seeking support via AES-GCM decrypt
    async function fetchVidrock(tmdbId, season, episode, type){
        const streams=[];
        try{
            // VidRock API: /api/movie/{tmdbId} for movies, /api/tv/{tmdbId}/{season}/{episode} ??? 
            // From earlier discovery, /api/movie/{tmdbId} returns encrypted server URLs
            // For TV, seems /api/tv/{tmdbId}/{season}/{episode} fails, but we try movie endpoint for all? Actually tv returns null for plain id.
            // We will try both movie and tv endpoints, and also try with season/episode in path for tv.
            const endpoints=[];
            if(type==="movie"){
                endpoints.push(`https://vidrock.ru/api/movie/${tmdbId}`);
                endpoints.push(`https://vidrock.net/api/movie/${tmdbId}`);
            }else{
                // For TV, try different patterns
                endpoints.push(`https://vidrock.ru/api/tv/${tmdbId}/${season}/${episode}`);
                endpoints.push(`https://vidrock.ru/api/movie/${tmdbId}`); // fallback
                endpoints.push(`https://vidrock.net/api/tv/${tmdbId}/${season}/${episode}`);
            }

            for(const ep of endpoints){
                try{
                    const res = await http_get(ep, { "User-Agent": HEADERS["User-Agent"], "Referer":"https://vidrock.net/", "Origin":"https://vidrock.net" });
                    if(!res || !res.body) continue;
                    const json = safeParse(res.body, null);
                    if(!json) continue;
                    // json has keys like Atlas, Orion, etc with encrypted url
                    for(const key of Object.keys(json)){
                        const entry = json[key];
                        if(!entry || !entry.url) continue;
                        const encUrl = entry.url;
                        const decUrl = await decryptVidrockUrl(encUrl);
                        if(!decUrl || !decUrl.startsWith("http")) continue;
                        // decUrl is either playlist JSON URL (hellstorm.lol) or direct m3u8
                        // If playlist is hellstorm, fetch it to get qualities
                        if(decUrl.includes("hellstorm.lol/playlist/")){
                            try{
                                const plRes = await http_get(decUrl, { "Referer":"https://vidrock.net/" });
                                if(plRes && plRes.body){
                                    const plJson = safeParse(plRes.body, null);
                                    if(Array.isArray(plJson)){
                                        for(const q of plJson){
                                            if(q.url){
                                                streams.push(new StreamResult({
                                                    url: q.url,
                                                    quality: (q.resolution||"Auto")+"p",
                                                    source: `VidRock ${key} - ${q.resolution||""}p [HLS Seek Fix]`,
                                                    headers: { "Referer":"https://vidrock.net/" }
                                                }));
                                            }
                                        }
                                        continue;
                                    }
                                }
                            }catch{}
                            // If not JSON, treat as m3u8
                            streams.push(new StreamResult({
                                url: decUrl,
                                quality: "Auto",
                                source: `VidRock ${key} - HLS`,
                                headers: { "Referer":"https://vidrock.net/" }
                            }));
                        }else if(decUrl.includes(".m3u8")){
                            // Direct HLS with seeking support
                            streams.push(new StreamResult({
                                url: decUrl,
                                quality: entry.type==="hls"?"Auto":entry.type,
                                source: `VidRock ${key} - HLS Seekable`,
                                headers: { "Referer":"https://vidrock.net/" }
                            }));
                        }else{
                            streams.push(new StreamResult({
                                url: decUrl,
                                quality: entry.type||"Auto",
                                source: `VidRock ${key}`,
                                headers: { "Referer":"https://vidrock.net/" }
                            }));
                        }
                    }
                    if(streams.length) break;
                }catch{}
            }
            log(`VidRock ${streams.length} for ${tmdbId}`);
        }catch(e){ log("VidRock err", e.message); }
        return streams;
    }

    // VidFast (from enc-dec)
    async function fetchVidFast(tmdbId){
        const streams=[];
        try{
            const encRes = await http_get(`https://enc-dec.app/api/enc-vidfast?text=${tmdbId}`, HEADERS);
            const encJson = safeParse(encRes.body, null);
            const result = encJson?.result;
            if(!result || !result.servers) return streams;
            // result.servers is URL to server list, result.stream is stream URL
            // Try fetch servers
            const serversUrl = result.servers;
            const streamUrl = result.stream;
            if(streamUrl && streamUrl.startsWith("http")){
                streams.push(new StreamResult({ url: streamUrl, source: "VidFast - Stream", headers: HEADERS }));
            }
            // Servers URL might need token
            if(serversUrl){
                const srvRes = await http_get(serversUrl, HEADERS);
                if(srvRes && srvRes.body){
                    const srvJson = safeParse(srvRes.body, null);
                    if(Array.isArray(srvJson)){
                        for(const s of srvJson){
                            if(s.url) streams.push(new StreamResult({ url: s.url, source: `VidFast - ${s.name||"Server"}`, headers: HEADERS }));
                        }
                    }
                }
            }
        }catch(e){ log("VidFast err", e.message); }
        return streams;
    }

    // VidsrcVIP (double base64)
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
            const enc = encodeVidsrcVip(tmdbId, type, season, episode);
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

    // Original 5 sites deep scrape
    async function scrapeOriginalSites(tmdbId, season, episode, type){
        const streams=[];
        const SITE_PATTERNS=[
            {base:"https://popcornmovies.io", movie:(id)=>`/watch/movie/${id}`, tv:(id,s,e)=>`/watch/tv/${id}/${s}/${e}`, name:"PopcornMovies"},
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
                try{
                    const iframes = await parse_html(html, "iframe", "src");
                    for(const fr of iframes){
                        let src=fr.attr;
                        if(!src) continue;
                        if(src.startsWith("//")) src="https:"+src;
                        if(src.startsWith("/")) src=site.base+src;
                        if(src.includes("googletag")||src.includes("facebook")) continue;
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
            }catch(e){ log(`Scrape ${site.name} fail`, e.message); }
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
            log(`ULTIMATE loadStreams ${tmdbId} ${type} S${season}E${episode}`);

            let all=[];

            const vidlink = await fetchVidLink(tmdbId, season, episode, type);
            all = all.concat(vidlink);

            const vidrock = await fetchVidrock(tmdbId, season, episode, type);
            all = all.concat(vidrock);

            const vidfast = await fetchVidFast(tmdbId);
            all = all.concat(vidfast);

            const vipsrc = await fetchVidsrcVip(tmdbId, season, episode, type);
            all = all.concat(vipsrc);

            const original = await scrapeOriginalSites(tmdbId, season, episode, type);
            all = all.concat(original);

            // Deduplicate
            const seen=new Set();
            const unique=[];
            for(const s of all){
                if(!s.url || seen.has(s.url)) continue;
                seen.add(s.url);
                unique.push(s);
            }

            // Sort: HLS first (seekable), then by quality
            unique.sort((a,b)=>{
                const isHls = (x)=>{ const u=(x.url||"").toLowerCase(); return u.includes(".m3u8")|| (x.source||"").toLowerCase().includes("hls") ? 1:0; };
                const hlsDiff = isHls(b)-isHls(a);
                if(hlsDiff!==0) return hlsDiff;
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
                unique.push(new StreamResult({url:`https://vidsrc.to/embed/${type==="movie"?"movie":"tv"}/${tmdbId}${type!=="movie"?`/${season}/${episode}`:""}`, source:"Fallback VidSrc.to"}));
            }

            log(`ULTIMATE TOTAL ${unique.length} streams`);
            cb({success:true, data:unique});
        }catch(e){
            log("ULTIMATE loadStreams error", e.stack||e.message);
            cb({success:false, errorCode:"PARSE_ERROR", message:e.message});
        }
    }

    globalThis.getHome=getHome;
    globalThis.search=search;
    globalThis.load=load;
    globalThis.loadStreams=loadStreams;
})();
