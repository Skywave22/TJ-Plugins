(function() {
    // ULTRA V4 - Bypasses Cloudflare, AES-GCM VidRock, HLS Seeking Fix, Full Subtitles
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_API = "https://api.themoviedb.org/3";
    const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
    const TMDB_ORIGINAL = "https://image.tmdb.org/t/p/original";
    const CURRENT_BASE = (typeof manifest !== "undefined" && manifest.baseUrl) ? manifest.baseUrl.replace(/\/+$/, "") : "https://popcornmovies.io";
    const VIDROCK_KEY_HEX = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";

    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": CURRENT_BASE+"/",
        "Origin": CURRENT_BASE
    };
    const VIDLINK_HEADERS = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://vidlink.pro/",
        "Origin": "https://vidlink.pro"
    };

    function log(...a){ try{ console.log("[ULTRA-V4]", ...a); }catch{} }
    function safeParse(s,f){ try{ return JSON.parse(s); }catch{ return f; } }

    // Cloudflare bypass helper - detects CF challenge and tries solveCaptcha
    async function fetchWithCFBypass(url, headers=HEADERS){
        try{
            let res = await http_get(url, headers);
            if(!res || !res.body) return res;
            const body = res.body;
            // Detect CF challenge
            if(body.includes("Just a moment") || body.includes("cf-challenge") || body.includes("turnstile") || body.includes("Attention Required")){
                log("CF challenge detected for", url);
                try{
                    // Try extract turnstile sitekey
                    const keyMatch = body.match(/data-sitekey="([^"]+)"/) || body.match(/sitekey:\s*["']([^"']+)["']/);
                    if(keyMatch && typeof solveCaptcha !== 'undefined'){
                        const siteKey = keyMatch[1];
                        log("Trying solveCaptcha", siteKey, url);
                        const token = await solveCaptcha(siteKey, url);
                        if(token){
                            // Retry with token as header or cookie?
                            const res2 = await http_get(url, {...headers, "cf-turnstile-response": token, "x-turnstile-token": token});
                            if(res2 && res2.body && !res2.body.includes("Just a moment")) return res2;
                        }
                    }
                }catch(e){ log("CF bypass fail", e.message); }
                // Try MAGIC_PROXY as fallback for CF
                try{
                    const proxyUrl = "MAGIC_PROXY_v1"+btoa(url);
                    const resProxy = await http_get(proxyUrl, headers);
                    if(resProxy && resProxy.body && !resProxy.body.includes("Just a moment")) return resProxy;
                }catch{}
            }
            return res;
        }catch(e){ log("fetch fail", url, e.message); return {body:"", status:500}; }
    }

    async function httpGetJson(url, headers=HEADERS){
        // For TMDB, use simple UA to avoid CF block
        if(url.includes("themoviedb.org") || url.includes("orange-voice")){
            headers = {"User-Agent": "Mozilla/5.0"};
        }
        try{
            const res = await fetchWithCFBypass(url, headers);
            if(!res || !res.body) return null;
            const t = res.body.trim();
            if(t.startsWith("<!DOCTYPE") && t.includes("<html") && t.length<5000 && !t.includes("{")) return null; // HTML not JSON
            if(t.startsWith("<")) return null;
            return safeParse(t, null);
        }catch{ return null; }
    }

    const TMDB_PROXY = "https://orange-voice-abcf.phisher16.workers.dev";
    async function fetchTmdb(p){
        // log attempt
        // console.log removed

        const sep = p.includes("?")?"&":"?";
        // Try direct first, then proxy
        let data = await httpGetJson(`${TMDB_API}${p}${sep}api_key=${TMDB_API_KEY}`);
        if(data) return data;
        // Fallback to proxy
        try{
            const proxyUrl = `${TMDB_PROXY}${p}${sep}api_key=${TMDB_API_KEY}`;
            const res = await http_get(proxyUrl, HEADERS);
            if(res && res.body){
                const j = JSON.parse(res.body);
                return j;
            }
        }catch{}
        return null;
    }

    async function fetchTmdbParallel(path){
        // Try direct, fallback to proxy if fails
        const direct = `${TMDB_API}${path}${path.includes("?")?"&":"?"}api_key=${TMDB_API_KEY}`;
        const proxy = `${TMDB_PROXY}${path}${path.includes("?")?"&":"?"}api_key=${TMDB_API_KEY}`;
        let json = await httpGetJson(direct);
        if(!json || !json.results){
            json = await httpGetJson(proxy);
        }
        return json;
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
            const trending = await fetchTmdb("/trending/all/day");
            const popMov = await fetchTmdb("/movie/popular?language=en-US&page=1");
            const popTv = await fetchTmdb("/tv/popular?language=en-US&page=1");
            const topMov = await fetchTmdb("/movie/top_rated?language=en-US&page=1");
            const topTv = await fetchTmdb("/tv/top_rated?language=en-US&page=1");
            const now = await fetchTmdb("/movie/now_playing?language=en-US&page=1");
            const home={};
            if(trending && trending.results) home["Trending"] = trending.results.map(o=>toItem(o)).filter(Boolean).slice(0,20);
            if(popMov && popMov.results) home["Popular Movies"] = popMov.results.map(o=>toItem(o,"movie")).filter(Boolean).slice(0,24);
            if(popTv && popTv.results) home["Popular Series"] = popTv.results.map(o=>toItem(o,"tv")).filter(Boolean).slice(0,24);
            if(now && now.results) home["Now Playing"] = now.results.map(o=>toItem(o,"movie")).filter(Boolean).slice(0,24);
            if(topMov && topMov.results) home["Top Rated Movies"] = topMov.results.map(o=>toItem(o,"movie")).filter(Boolean).slice(0,24);
            if(topTv && topTv.results) home["Top Rated Series"] = topTv.results.map(o=>toItem(o,"tv")).filter(Boolean).slice(0,24);
            if(!Object.keys(home).length) return cb({success:false, errorCode:"HOME_ERROR"});
            return cb({success:true, data:home});
        }catch(e){ return cb({success:false, errorCode:"SITE_OFFLINE", message:e.message}); }
    }
    async function search(query, cb){
        try{
            const q=encodeURIComponent((query||"").trim());
            if(!q) return cb({success:true, data:[]});
            let json=await httpGetJson(`${TMDB_API}/search/multi?api_key=${TMDB_API_KEY}&query=${q}&include_adult=false`);
            if(!json || !json.results){
                json=await httpGetJson(`${TMDB_PROXY}/search/multi?api_key=${TMDB_API_KEY}&query=${q}&include_adult=false`);
            }
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

    // ====== HELPERS ======
    function hexToBytes(hex){
        const bytes = new Uint8Array(hex.length/2);
        for(let i=0;i<bytes.length;i++) bytes[i]=parseInt(hex.substr(i*2,2),16);
        return bytes;
    }
    function base64UrlToBytes(b64url){
        let b64 = b64url.replace(/-/g,"+").replace(/_/g,"/");
        const pad = b64.length%4;
        if(pad===2) b64+="=="; else if(pad===3) b64+="=";
        else if(pad===1) throw new Error("Invalid");
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
    async function decryptVidrockUrl(encUrl){
        try{
            const full = base64UrlToBytes(encUrl);
            if(full.length<28) return null;
            const iv = full.slice(0,12);
            const data = full.slice(12);
            const keyBytes = hexToBytes(VIDROCK_KEY_HEX);
            const keyB64 = bytesToBase64(keyBytes);
            const ivB64 = bytesToBase64(iv);
            const dataB64 = bytesToBase64(data);
            let dec;
            if(typeof crypto !== "undefined" && crypto.decryptAES){
                try{ dec = await crypto.decryptAES(dataB64, keyB64, ivB64, {mode:"gcm"}); }catch{ try{ dec = await crypto.decryptAES(dataB64, keyB64, ivB64); }catch{ return null; } }
            }else return null;
            return dec ? dec.trim() : null;
        }catch(e){ return null; }
    }

    async function fetchSubtitles(tmdbId, season, episode, type){
        const subs=[];
        try{
            const url = type==="movie"
                ? `https://sub.vdrk.site/v2/movie/${tmdbId}`
                : `https://sub.vdrk.site/v2/tv/${tmdbId}/${season}/${episode}`;
            const res = await http_get(url, {"User-Agent":"Mozilla/5.0"});
            if(res && res.body){
                const json = safeParse(res.body, null);
                if(Array.isArray(json)){
                    for(const s of json){
                        if(s.file){
                            subs.push({url:s.file, label:s.label||"Unknown", lang:(s.label||"en").slice(0,2).toLowerCase()});
                        }
                    }
                }
            }
        }catch(e){ log("Subs fetch fail", e.message); }
        return subs;
    }

    // ====== FETCHERS WITH BYPASS ======

    async function fetchVidLink(tmdbId, season, episode, type){
        const streams=[];
        try{
            const encRes = await fetchWithCFBypass(`https://enc-dec.app/api/enc-vidlink?text=${tmdbId}`, HEADERS);
            const encJson = safeParse(encRes.body, null);
            const encId = encJson?.result;
            if(!encId) return streams;
            const apiUrl = type==="movie"
                ? `https://vidlink.pro/api/b/movie/${encId}`
                : `https://vidlink.pro/api/b/tv/${encId}/${season}/${episode}`;
            const res = await fetchWithCFBypass(apiUrl, VIDLINK_HEADERS);
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
                // HLS proxy for seeking
                streams.push(new StreamResult({
                    url: q.url,
                    quality: qLabel,
                    source: `VidLink MP4 - ${qLabel} [Direct]`,
                    headers: VIDLINK_HEADERS,
                    subtitles: caps
                }));
                const proxied = "MAGIC_PROXY_v1"+btoa(q.url);
                streams.push(new StreamResult({
                    url: proxied,
                    quality: qLabel+" [HLS Proxy Seek Fix]",
                    source: `VidLink HLS Proxy - ${qLabel}`,
                    headers: VIDLINK_HEADERS,
                    subtitles: caps
                }));
            }
            if(data.stream.playlist){
                streams.push(new StreamResult({
                    url: data.stream.playlist,
                    quality: "Auto",
                    source: "VidLink DASH",
                    headers: VIDLINK_HEADERS,
                    subtitles: caps
                }));
            }
        }catch(e){ log("VidLink err", e.message); }
        return streams;
    }

    async function fetchVidrock(tmdbId, season, episode, type){
        const streams=[];
        const subs = await fetchSubtitles(tmdbId, season, episode, type);
        try{
            const endpoints = type==="movie"
                ? [`https://vidrock.ru/api/movie/${tmdbId}`, `https://vidrock.net/api/movie/${tmdbId}`]
                : [`https://vidrock.ru/api/tv/${tmdbId}/${season}/${episode}`, `https://vidrock.ru/api/movie/${tmdbId}`, `https://vidrock.net/api/tv/${tmdbId}/${season}/${episode}`];
            for(const ep of endpoints){
                try{
                    const res = await fetchWithCFBypass(ep, {"User-Agent":HEADERS["User-Agent"], "Referer":"https://vidrock.net/", "Origin":"https://vidrock.net"});
                    if(!res || !res.body) continue;
                    const json = safeParse(res.body, null);
                    if(!json) continue;
                    for(const key of Object.keys(json)){
                        const entry = json[key];
                        if(!entry || !entry.url) continue;
                        const decUrl = await decryptVidrockUrl(entry.url);
                        if(!decUrl || !decUrl.startsWith("http")) continue;
                        if(decUrl.includes("hellstorm.lol/playlist/")){
                            try{
                                const plRes = await fetchWithCFBypass(decUrl, {"Referer":"https://vidrock.net/"});
                                if(plRes && plRes.body){
                                    const plJson = safeParse(plRes.body, null);
                                    if(Array.isArray(plJson)){
                                        for(const q of plJson){
                                            if(q.url){
                                                streams.push(new StreamResult({
                                                    url: q.url,
                                                    quality: (q.resolution||"Auto")+"p",
                                                    source: `VidRock ${key} - ${q.language||"English"} - ${q.resolution||""}p HLS Seek [${q.flag||"us"}]`,
                                                    headers: {"Referer":"https://vidrock.net/"},
                                                    subtitles: subs
                                                }));
                                            }
                                        }
                                        continue;
                                    }
                                }
                            }catch{}
                            streams.push(new StreamResult({url:decUrl, quality:"Auto", source:`VidRock ${key} - ${entry.language||"English"} HLS`, headers:{"Referer":"https://vidrock.net/"}, subtitles:subs}));
                        }else if(decUrl.includes(".m3u8")){
                            streams.push(new StreamResult({url:decUrl, quality:"Auto HLS", source:`VidRock ${key} - ${entry.language||"English"} HLS Seekable [${entry.flag||"us"}]`, headers:{"Referer":"https://vidrock.net/"}, subtitles:subs}));
                        }else{
                            streams.push(new StreamResult({url:decUrl, quality:entry.type||"Auto", source:`VidRock ${key} - ${entry.language||"English"}`, headers:{"Referer":"https://vidrock.net/"}, subtitles:subs}));

                        }
                    }
                    if(streams.length) break;
                }catch{}
            }
        }catch(e){ log("VidRock err", e.message); }
        return streams;
    }

    async function fetchVidsrcVip(tmdbId, season, episode, type){
        const streams=[];
        try{
            const map=['a','b','c','d','e','f','g','h','i','j'];
            let raw = type==="movie" ? String(tmdbId).split('').map(d=>map[parseInt(d)]||'a').join('') : `${tmdbId}-${season}-${episode}`;
            const rev = raw.split('').reverse().join('');
            const b1 = btoa(rev);
            const b2 = btoa(b1);
            const url = `https://api2.vidsrc.vip/${type==="movie"?"movie":"tv"}/${b2}`;
            const res = await fetchWithCFBypass(url, HEADERS);
            if(!res || !res.body) return streams;
            const json = safeParse(res.body, null);
            if(!json) return streams;
            for(let i=1; json[`source${i}`]; i++){
                const src = json[`source${i}`];
                if(src && src.url && src.url.startsWith("http")){
                    streams.push(new StreamResult({url:src.url, source:`VidsrcVip S${i}`, headers:HEADERS}));
                }
            }
        }catch(e){}
        return streams;
    }

    async function scrapeOriginalSites(tmdbId, season, episode, type){
        const streams=[];
        const PATTERNS=[
            {base:"https://popcornmovies.io", movie:id=>`/watch/movie/${id}`, tv:(id,s,e)=>`/watch/tv/${id}/${s}/${e}`, name:"PopcornMovies"},
            {base:"https://www.cineby.at", movie:id=>`/movie/${id}`, tv:(id,s,e)=>`/tv/${id}/${s}/${e}`, name:"Cineby"},
            {base:"https://zstream.mov", movie:id=>`/media/tmdb-movie-${id}`, tv:(id,s,e)=>`/media/tmdb-tv-${id}/${s}/${e}`, name:"ZStream"},
            {base:"https://primeshows.org", movie:id=>`/movie/${id}`, tv:(id,s,e)=>`/tv/${id}/season/${s}/episode/${e}`, name:"PrimeShows"},
            {base:"https://fireflix.pages.dev", movie:id=>`/movie/${id}`, tv:(id,s,e)=>`/tv/${id}/${s}/${e}`, name:"FireFlix"},
            {base:"https://screenscape.me", movie:id=>`/movie/${id}`, tv:(id,s,e)=>`/tv/${id}/${s}/${e}`, name:"ScreenScape"}
        ];
        for(const site of PATTERNS){
            try{
                const path = type==="movie"? site.movie(tmdbId) : site.tv(tmdbId, season, episode);
                const fullUrl = site.base+path;
                const res = await fetchWithCFBypass(fullUrl, {"User-Agent":HEADERS["User-Agent"], "Referer":site.base+"/"});
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
                const regexes=[/["'](https?:\/\/[^"']*vidsrc[^"']*)["']/gi, /["'](https?:\/\/[^"']*2embed[^"']*)["']/gi, /["'](https?:\/\/[^"']*filemoon[^"']*)["']/gi, /["'](https?:\/\/[^"']*streamtape[^"']*)["']/gi, /["'](https?:\/\/[^"']*mixdrop[^"']*)["']/gi];
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

    async function loadStreams(url, cb){
        try{
            let payload;
            try{ payload=JSON.parse(url); if(typeof payload==="string") payload=JSON.parse(payload); if(Array.isArray(payload)) payload=payload[0]; }catch{ payload={tmdbId:0, type:"movie"}; }
            const tmdbId=payload.tmdbId||payload.id||0;
            const type=payload.type==="series"?"tv":(payload.type||"movie");
            const season=payload.season||1;
            const episode=payload.episode||1;
            if(!tmdbId) return cb({success:true, data:[]});
            log(`ULTRA loadStreams ${tmdbId} ${type} S${season}E${episode}`);

            let all=[];

            const [vidlink, vidrock, vipsrc, original] = await Promise.all([
                fetchVidLink(tmdbId, season, episode, type),
                fetchVidrock(tmdbId, season, episode, type),
                fetchVidsrcVip(tmdbId, season, episode, type),
                scrapeOriginalSites(tmdbId, season, episode, type)
            ]);

            all = all.concat(vidlink).concat(vidrock).concat(vipsrc).concat(original);

            // Deduplicate
            const seen=new Set();
            const unique=[];
            for(const s of all){
                if(!s.url || seen.has(s.url)) continue;
                seen.add(s.url);
                unique.push(s);
            }

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

            log(`ULTRA TOTAL ${unique.length} streams`);
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
