// ===========================================================================
//  GOATED — SkyStream provider  v1
//  https://goated.cx — free movies & TV shows (TMDB catalog + reallyfast
//  streams). Fully on-device: TMDB API for the catalog and the site's own
//  stream-resolve API (challenge -> proof-of-work -> AES-256-GCM -> HLS).
//  No server, no ffmpeg, no yt-dlp.
// ===========================================================================
(function () {
    "use strict";

    var TMDB_KEY = "aa8db17cefbe569dc21a8809090b7b93";
    var TMDB_BASE = "https://api.themoviedb.org/3";
    var IMG = "https://image.tmdb.org/t/p/";
    var RF_BASE = "https://api.reallyfast.xyz";
    var RF_SECRET = "79eb073a697f8e22d44fdb60971efa9b1cd224fa7963f9095e48971f5e13866b";

    // ------------------------------------------------------------------
    //  Crypto: SHA-256 (native bridge w/ pure-JS fallback) + AES-256-GCM
    // ------------------------------------------------------------------

    function sha256Hex(str) {
        try {
            if (typeof nativeSha256 === "function") {
                var h = nativeSha256(String(str));
                if (h) return h.toLowerCase();
            }
        } catch (e) { /* fall through */ }
        return sha256Pure(str);
    }

    // Pure-JS SHA-256 (fallback / used when the native bridge is absent).
    function sha256Pure(ascii) {
        function rightRotate(v, a) { return (v >>> a) | (v << (32 - a)); }
        var mathPow = Math.pow;
        var maxWord = mathPow(2, 32);
        var result = "";
        var words = [];
        var asciiBitLength = ascii.length * 8;
        var hash = sha256Pure.h = sha256Pure.h || [];
        var k = sha256Pure.k = sha256Pure.k || [];
        var primeCounter = k.length;
        var isComposite = {};
        for (var candidate = 2; primeCounter < 64; candidate++) {
            if (!isComposite[candidate]) {
                for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
                hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
                k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
            }
        }
        ascii += "\x80";
        while ((ascii.length % 64) - 56) ascii += "\x00";
        for (var i = 0; i < ascii.length; i++) {
            var j = ascii.charCodeAt(i);
            if (j >> 8) return ""; // ASCII only
            words[i >> 2] |= j << (((3 - i) % 4) * 8);
        }
        words[words.length] = ((asciiBitLength / maxWord) | 0);
        words[words.length] = asciiBitLength;
        for (var j = 0; j < words.length;) {
            var w = words.slice(j, (j += 16));
            var oldHash = hash;
            hash = hash.slice(0, 8);
            for (var i = 0; i < 64; i++) {
                var w15 = w[i - 15], w2 = w[i - 2];
                var a = hash[0], e = hash[4];
                var temp1 = hash[7] +
                    (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
                    ((e & hash[5]) ^ (~e & hash[6])) + k[i] +
                    (w[i] = (i < 16) ? w[i] :
                        (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                         w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
                var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
                    ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
                hash = [(temp1 + temp2) | 0].concat(hash);
                hash[4] = (hash[4] + temp1) | 0;
            }
            for (var i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
        }
        for (var i = 0; i < 8; i++) {
            for (var j = 3; j + 1; j--) {
                var b = (hash[i] >> (j * 8)) & 255;
                result += ((b < 16) ? "0" : "") + b.toString(16);
            }
        }
        return result;
    }

    function hexToBytes(hex) {
        var out = [];
        for (var i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
        return out;
    }

    function zeros(n) {
        var a = new Array(n);
        for (var i = 0; i < n; i++) a[i] = 0;
        return a;
    }

    function bytesToHex(arr) {
        var s = "";
        for (var i = 0; i < arr.length; i++) s += ((arr[i] < 16) ? "0" : "") + (arr[i] & 0xff).toString(16);
        return s;
    }

    // ---- AES-256 (plain JS arrays) ----
    var SBOX = [
      99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,
      202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,
      183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,
      4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,
      9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,
      83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,
      208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,
      81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,
      205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,
      96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,
      224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,
      231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,
      186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,
      112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,
      225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,
      140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22
    ];
    var RCON = [0,1,2,4,8,16,32,64,128,27,54];

    function gmul(a, b) {
        var p = 0;
        for (var i = 0; i < 8; i++) {
            if (b & 1) p ^= a;
            var hi = a & 0x80;
            a = (a << 1) & 0xff;
            if (hi) a ^= 0x1b;
            b >>= 1;
        }
        return p;
    }

    function keyExpansion(key) {
        var w = new Array(60);
        for (var i = 0; i < 8; i++) w[i] = ((key[4*i] << 24) | (key[4*i+1] << 16) | (key[4*i+2] << 8) | key[4*i+3]) | 0;
        for (var i = 8; i < 60; i++) {
            var t = w[i-1] | 0;
            if (i % 8 === 0) {
                t = ((t << 8) | ((t >>> 24) & 0xff)) | 0;
                t = (SBOX[(t >>> 24) & 0xff] << 24) | (SBOX[(t >>> 16) & 0xff] << 16) | (SBOX[(t >>> 8) & 0xff] << 8) | SBOX[t & 0xff];
                t = (t ^ (RCON[(i/8)|0] << 24)) | 0;
            } else if (i % 8 === 4) {
                t = (SBOX[(t >>> 24) & 0xff] << 24) | (SBOX[(t >>> 16) & 0xff] << 16) | (SBOX[(t >>> 8) & 0xff] << 8) | SBOX[t & 0xff];
            }
            w[i] = (w[i-8] ^ t) | 0;
        }
        return w;
    }

    function aesEncryptBlock(st, w) {
        var s0 = st[0], s1 = st[1], s2 = st[2], s3 = st[3];
        s0 = (s0 ^ w[0]) | 0; s1 = (s1 ^ w[1]) | 0; s2 = (s2 ^ w[2]) | 0; s3 = (s3 ^ w[3]) | 0;
        for (var round = 1; round < 14; round++) {
            var t0 = (SBOX[(s0>>>24)&0xff]<<24)|(SBOX[(s0>>>16)&0xff]<<16)|(SBOX[(s0>>>8)&0xff]<<8)|SBOX[s0&0xff];
            var t1 = (SBOX[(s1>>>24)&0xff]<<24)|(SBOX[(s1>>>16)&0xff]<<16)|(SBOX[(s1>>>8)&0xff]<<8)|SBOX[s1&0xff];
            var t2 = (SBOX[(s2>>>24)&0xff]<<24)|(SBOX[(s2>>>16)&0xff]<<16)|(SBOX[(s2>>>8)&0xff]<<8)|SBOX[s2&0xff];
            var t3 = (SBOX[(s3>>>24)&0xff]<<24)|(SBOX[(s3>>>16)&0xff]<<16)|(SBOX[(s3>>>8)&0xff]<<8)|SBOX[s3&0xff];
            var c0 = [t0>>>24, (t1>>>16)&0xff, (t2>>>8)&0xff, t3&0xff];
            var c1 = [t1>>>24, (t2>>>16)&0xff, (t3>>>8)&0xff, t0&0xff];
            var c2 = [t2>>>24, (t3>>>16)&0xff, (t0>>>8)&0xff, t1&0xff];
            var c3 = [t3>>>24, (t0>>>16)&0xff, (t1>>>8)&0xff, t2&0xff];
            var k = round*4;
            function mx(c){ return [
                gmul(c[0],2)^gmul(c[1],3)^gmul(c[2],1)^gmul(c[3],1),
                gmul(c[0],1)^gmul(c[1],2)^gmul(c[2],3)^gmul(c[3],1),
                gmul(c[0],1)^gmul(c[1],1)^gmul(c[2],2)^gmul(c[3],3),
                gmul(c[0],3)^gmul(c[1],1)^gmul(c[2],1)^gmul(c[3],2) ]; }
            var m0=mx(c0), m1=mx(c1), m2=mx(c2), m3=mx(c3);
            s0 = (((m0[0]<<24)|(m0[1]<<16)|(m0[2]<<8)|m0[3]) ^ w[k])   | 0;
            s1 = (((m1[0]<<24)|(m1[1]<<16)|(m1[2]<<8)|m1[3]) ^ w[k+1]) | 0;
            s2 = (((m2[0]<<24)|(m2[1]<<16)|(m2[2]<<8)|m2[3]) ^ w[k+2]) | 0;
            s3 = (((m3[0]<<24)|(m3[1]<<16)|(m3[2]<<8)|m3[3]) ^ w[k+3]) | 0;
        }
        var b0 = [SBOX[(s0>>>24)&0xff], SBOX[(s1>>>16)&0xff], SBOX[(s2>>>8)&0xff], SBOX[s3&0xff]];
        var b1 = [SBOX[(s1>>>24)&0xff], SBOX[(s2>>>16)&0xff], SBOX[(s3>>>8)&0xff], SBOX[s0&0xff]];
        var b2 = [SBOX[(s2>>>24)&0xff], SBOX[(s3>>>16)&0xff], SBOX[(s0>>>8)&0xff], SBOX[s1&0xff]];
        var b3 = [SBOX[(s3>>>24)&0xff], SBOX[(s0>>>16)&0xff], SBOX[(s1>>>8)&0xff], SBOX[s2&0xff]];
        return [
            ((((b0[0]<<24)|(b0[1]<<16)|(b0[2]<<8)|b0[3]) ^ w[56]) | 0),
            ((((b1[0]<<24)|(b1[1]<<16)|(b1[2]<<8)|b1[3]) ^ w[57]) | 0),
            ((((b2[0]<<24)|(b2[1]<<16)|(b2[2]<<8)|b2[3]) ^ w[58]) | 0),
            ((((b3[0]<<24)|(b3[1]<<16)|(b3[2]<<8)|b3[3]) ^ w[59]) | 0)
        ];
    }

    function aesEncryptBytes(key, bytes) {
        // bytes: array, multiple of 16 -> encrypted array
        var w = keyExpansion(key);
        var out = [];
        for (var o = 0; o < bytes.length; o += 16) {
            var st = [
                (bytes[o]<<24)|(bytes[o+1]<<16)|(bytes[o+2]<<8)|bytes[o+3],
                (bytes[o+4]<<24)|(bytes[o+5]<<16)|(bytes[o+6]<<8)|bytes[o+7],
                (bytes[o+8]<<24)|(bytes[o+9]<<16)|(bytes[o+10]<<8)|bytes[o+11],
                (bytes[o+12]<<24)|(bytes[o+13]<<16)|(bytes[o+14]<<8)|bytes[o+15]
            ];
            var r = aesEncryptBlock(st, w);
            out.push((r[0]>>>24)&0xff,(r[0]>>>16)&0xff,(r[0]>>>8)&0xff,r[0]&0xff);
            out.push((r[1]>>>24)&0xff,(r[1]>>>16)&0xff,(r[1]>>>8)&0xff,r[1]&0xff);
            out.push((r[2]>>>24)&0xff,(r[2]>>>16)&0xff,(r[2]>>>8)&0xff,r[2]&0xff);
            out.push((r[3]>>>24)&0xff,(r[3]>>>16)&0xff,(r[3]>>>8)&0xff,r[3]&0xff);
        }
        return out;
    }

    // GF(2^128) multiply (NIST SP 800-38D bit-serial)
    function gfMul(X, Y) {
        var Z = new Array(16);
        for (var i = 0; i < 16; i++) Z[i] = 0;
        var V = Y.slice();
        for (var i = 0; i < 128; i++) {
            if ((X[i >> 3] >> (7 - (i & 7))) & 1) {
                for (var j = 0; j < 16; j++) Z[j] ^= V[j];
            }
            var lsb = V[15] & 1;
            for (var j = 15; j > 0; j--) V[j] = ((V[j] >> 1) | ((V[j-1] & 1) << 7)) & 0xff;
            V[0] = (V[0] >> 1) & 0xff;
            if (lsb) V[0] ^= 0xe1;
        }
        return Z;
    }

    function ghash(H, data) {
        var Y = new Array(16);
        for (var i = 0; i < 16; i++) Y[i] = 0;
        for (var o = 0; o < data.length; o += 16) {
            var X = new Array(16);
            for (var i = 0; i < 16; i++) X[i] = Y[i] ^ data[o + i];
            Y = gfMul(X, H);
        }
        return Y;
    }

    function b64encodeArr(bytes) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var out = "";
        for (var i = 0; i < bytes.length; i += 3) {
            var b0 = bytes[i], b1 = i+1 < bytes.length ? bytes[i+1] : -1, b2 = i+2 < bytes.length ? bytes[i+2] : -1;
            out += chars[b0 >> 2];
            out += chars[((b0 & 3) << 4) | (b1 >= 0 ? (b1 >> 4) : 0)];
            out += b1 >= 0 ? chars[((b1 & 15) << 2) | (b2 >= 0 ? (b2 >> 6) : 0)] : "=";
            out += b2 >= 0 ? chars[b2 & 63] : "=";
        }
        return out;
    }

    function b64encodeStr(s) {
        return b64encodeArr(utf8Bytes(s));
    }

    function utf8Bytes(str) {
        var bytes = [];
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c < 0x80) bytes.push(c);
            else if (c < 0x800) bytes.push(0xC0 | (c >> 6), 0x80 | (c & 63));
            else if (c < 0x10000) bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            else bytes.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
        return bytes;
    }

    function utf8BytesToString(bytes) {
        var s = "";
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return s;
    }

    // AES-256-GCM encrypt. key/iv/plaintext/aad are plain byte arrays.
    // Returns { cipher, tag }.
    function aesGcmEncrypt(keyBytes, ivBytes, plaintext, aad) {
        var H = aesEncryptBytes(keyBytes, zeros(16));
        var n = plaintext.length;
        var padded = n % 16 === 0 ? n : n + (16 - (n % 16));
        var streamIn = new Array(padded);
        var counter = new Array(16);
        for (var i = 0; i < 12; i++) counter[i] = ivBytes[i];
        for (var i = 12; i < 15; i++) counter[i] = 0;
        counter[15] = 1;
        for (var o = 0; o < padded; o += 16) {
            for (var b = 15; b >= 0; b--) { counter[b]++; if (counter[b] !== 0) break; }
            var enc = aesEncryptBytes(keyBytes, counter);
            for (var j = 0; j < 16 && o + j < padded; j++) streamIn[o + j] = enc[j];
        }
        var cipher = new Array(n);
        for (var i = 0; i < n; i++) cipher[i] = plaintext[i] ^ streamIn[i];

        var aadLen = aad ? aad.length : 0;
        var padA = (16 - (aadLen % 16)) % 16;
        var padC = (16 - (n % 16)) % 16;
        var ghData = new Array(aadLen + padA + n + padC + 16);
        var p = 0;
        if (aad) { for (var i = 0; i < aadLen; i++) ghData[p++] = aad[i]; }
        p += padA;
        for (var i = 0; i < n; i++) ghData[p++] = cipher[i];
        p += padC;
        var L = p;
        for (var i = L; i < L + 16; i++) ghData[i] = 0;
        var aadBits = aadLen * 8, ctBits = n * 8;
        var aadHi = Math.floor(aadBits / 0x100000000), aadLo = aadBits % 0x100000000;
        var ctHi = Math.floor(ctBits / 0x100000000), ctLo = ctBits % 0x100000000;
        ghData[L]   = (aadHi >>> 24) & 0xff; ghData[L+1] = (aadHi >>> 16) & 0xff; ghData[L+2] = (aadHi >>> 8) & 0xff; ghData[L+3] = aadHi & 0xff;
        ghData[L+4] = (aadLo >>> 24) & 0xff; ghData[L+5] = (aadLo >>> 16) & 0xff; ghData[L+6] = (aadLo >>> 8) & 0xff; ghData[L+7] = aadLo & 0xff;
        ghData[L+8]  = (ctHi >>> 24) & 0xff; ghData[L+9] = (ctHi >>> 16) & 0xff; ghData[L+10] = (ctHi >>> 8) & 0xff; ghData[L+11] = ctHi & 0xff;
        ghData[L+12] = (ctLo >>> 24) & 0xff; ghData[L+13] = (ctLo >>> 16) & 0xff; ghData[L+14] = (ctLo >>> 8) & 0xff; ghData[L+15] = ctLo & 0xff;

        var S = ghash(H, ghData);
        var j0 = new Array(16);
        for (var i = 0; i < 12; i++) j0[i] = ivBytes[i];
        for (var i = 12; i < 15; i++) j0[i] = 0;
        j0[15] = 1;
        var ej0 = aesEncryptBytes(keyBytes, j0);
        var tag = new Array(16);
        for (var i = 0; i < 16; i++) tag[i] = S[i] ^ ej0[i];
        return { cipher: cipher, tag: tag };
    }

    // ------------------------------------------------------------------
    //  HTTP helpers
    // ------------------------------------------------------------------
    function respText(res) {
        if (res && typeof res === "object" && res.body != null) return String(res.body);
        if (typeof res === "string") return res;
        return "";
    }

    async function httpGetText(url, headers) {
        headers = headers || {};
        if (typeof http_get === "function") {
            try {
                const res = await http_get(url, headers);
                const t = respText(res);
                if (t) return t;
            } catch (e) { /* fall through */ }
        }
        if (typeof fetch === "function") {
            const r = await fetch(url, { headers: headers });
            if (r && typeof r.text === "function") return await r.text();
        }
        return "";
    }

    async function httpGetJson(url, headers) {
        const t = await httpGetText(url, headers);
        if (!t) throw new Error("empty response");
        return JSON.parse(t);
    }

    async function httpPostJson(url, headers, body) {
        headers = headers || {};
        if (typeof http_post === "function") {
            const res = await http_post(url, headers, body);
            const t = respText(res);
            if (t) return JSON.parse(t);
        }
        if (typeof fetch === "function") {
            const r = await fetch(url, { method: "POST", headers: headers, body: body });
            if (r && typeof r.text === "function") return JSON.parse(await r.text());
        }
        throw new Error("no http bridge");
    }

    // ------------------------------------------------------------------
    //  TMDB catalog
    // ------------------------------------------------------------------
    function tmdb(path, params) {
        var qs = "api_key=" + TMDB_KEY + "&language=en-US&include_adult=false";
        if (params) {
            for (var k in params) {
                if (params[k] === undefined || params[k] === null) continue;
                qs += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k]));
            }
        }
        return httpGetJson(TMDB_BASE + path + "?" + qs, { "User-Agent": "Mozilla/5.0" });
    }

    function poster(p, size) {
        return p ? IMG + size + p : "";
    }

    function itemUrl(type, id) {
        return JSON.stringify({ t: type, id: String(id) });
    }

    function epUrl(id, s, e) {
        return JSON.stringify({ t: "tv", id: String(id), s: s, e: e });
    }

    function toItem(o, type) {
        // o: TMDB media object (movie or tv)
        var t = type || o.media_type || (o.title ? "movie" : "tv");
        var title = o.title || o.name || "Unknown";
        var date = o.release_date || o.first_air_date || "";
        var year = date ? parseInt(date.split("-")[0], 10) : null;
        var it = {
            title: title,
            url: itemUrl(t, o.id),
            posterUrl: poster(o.poster_path, "w500"),
            bannerUrl: poster(o.backdrop_path, "w1280") || poster(o.poster_path, "w500"),
            type: t === "tv" ? "tvseries" : "movie",
            score: o.vote_average
        };
        if (o.overview) it.description = o.overview;
        if (year) it.year = year;
        return it;
    }

    // ------------------------------------------------------------------
    //  reallyfast.xyz stream resolve
    // ------------------------------------------------------------------
    function utcDateStr() {
        try {
            return new Date().toISOString().slice(0, 10);
        } catch (e) {
            var d = new Date();
            var mm = String(d.getUTCMonth() + 1), dd = String(d.getUTCDate());
            if (mm.length < 2) mm = "0" + mm;
            if (dd.length < 2) dd = "0" + dd;
            return d.getUTCFullYear() + "-" + mm + "-" + dd;
        }
    }

    async function getChallenge() {
        return await httpGetJson(RF_BASE + "/api/challenge", { "User-Agent": "Mozilla/5.0" });
    }

    function proofOfWork(challenge, difficulty) {
        var prefix = "";
        for (var i = 0; i < difficulty; i++) prefix += "0";
        var n = 0;
        var max = 200000;
        while (n <= max) {
            if (sha256Hex(challenge + String(n)).indexOf(prefix) === 0) return String(n);
            n++;
        }
        throw new Error("proof-of-work failed");
    }

    function encryptPayload(plaintext) {
        var date = utcDateStr();
        var key = hexToBytes(sha256Hex(RF_SECRET + ":" + date));
        // random-ish 12-byte IV (not secret, but unique per request)
        var iv = [];
        for (var i = 0; i < 12; i++) iv.push((Math.random() * 256) | 0);
        var pt = utf8Bytes(JSON.stringify(plaintext));
        var r = aesGcmEncrypt(key, iv, pt, null);
        return {
            q: b64encodeArr(r.cipher),
            s: b64encodeArr(iv),
            t: b64encodeArr(r.tag),
            d: date
        };
    }

    async function resolve(plaintext) {
        var ch = await getChallenge();
        var nonce = proofOfWork(ch.challenge, ch.difficulty || 4);
        var payload = {};
        for (var k in plaintext) payload[k] = plaintext[k];
        payload.challenge = ch.challenge;
        payload.nonce = nonce;
        var body = encryptPayload(payload);
        return await httpPostJson(
            RF_BASE + "/api/resolve",
            { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
            JSON.stringify(body)
        );
    }

    // ------------------------------------------------------------------
    //  SkyStream entry points
    // ------------------------------------------------------------------
    async function getHome(cb) {
        try {
            var results = await Promise.all([
                tmdb("/trending/all/week"),
                tmdb("/trending/movie/week"),
                tmdb("/trending/tv/week"),
                tmdb("/movie/popular"),
                tmdb("/tv/popular")
            ]);
            var trend = results[0], tMov = results[1], tTv = results[2], pMov = results[3], pTv = results[4];

            function list(res, type) {
                var out = [];
                for (var i = 0; i < res.length; i++) {
                    var o = res[i];
                    if (!o || !o.id) continue;
                    if (type === "all" && o.media_type === "person") continue;
                    out.push(toItem(o, type === "all" ? null : type));
                }
                return out;
            }

            var data = {};
            data["Trending"] = list(trend.results, "all");
            data["Trending Movies"] = list(tMov.results, "movie");
            data["Trending TV Shows"] = list(tTv.results, "tv");
            data["Popular Movies"] = list(pMov.results, "movie");
            data["Popular TV Shows"] = list(pTv.results, "tv");
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: "ERROR", message: "Failed to load: " + (e && e.message ? e.message : e) });
        }
    }

    async function search(query, cb) {
        try {
            var r = await tmdb("/search/multi", { query: query, page: 1 });
            var out = [];
            var res = (r && r.results) || [];
            for (var i = 0; i < res.length; i++) {
                var o = res[i];
                if (!o || !o.id) continue;
                if (o.media_type === "person") continue;
                if (o.media_type !== "movie" && o.media_type !== "tv") continue;
                out.push(toItem(o, o.media_type));
            }
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "ERROR", message: "Search failed: " + (e && e.message ? e.message : e) });
        }
    }

    async function load(url, cb) {
        var m;
        try { m = JSON.parse(String(url || "")); } catch (e) {
            return cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid URL" });
        }
        try {
            if (m.t === "tv") {
                var d = await tmdb("/tv/" + m.id);
                var seasons = (d.seasons || []).filter(function (s) {
                    return s && s.season_number > 0 && s.episode_count > 0;
                });
                // cap to avoid huge shows
                if (seasons.length > 25) seasons = seasons.slice(0, 25);
                var eps = [];
                // fetch each season's episodes with bounded concurrency
                var i = 0;
                async function worker() {
                    while (i < seasons.length) {
                        var idx = i++;
                        var sn = seasons[idx].season_number;
                        try {
                            var sd = await tmdb("/tv/" + m.id + "/season/" + sn);
                            var list = (sd && sd.episodes) || [];
                            for (var k = 0; k < list.length; k++) {
                                var ep = list[k];
                                if (!ep) continue;
                                eps.push({
                                    name: "S" + sn + " E" + ep.episode_number + " — " + (ep.name || ("Episode " + ep.episode_number)),
                                    url: epUrl(m.id, sn, ep.episode_number),
                                    season: sn,
                                    episode: ep.episode_number,
                                    airDate: ep.air_date || undefined,
                                    description: ep.overview || undefined,
                                    posterUrl: ep.still_path ? poster(ep.still_path, "w500") : undefined
                                });
                            }
                        } catch (e2) { /* skip season */ }
                    }
                }
                var workers = [];
                for (var w = 0; w < 4; w++) workers.push(worker());
                await Promise.all(workers);

                var item = {
                    title: d.name || "TV Show",
                    url: itemUrl("tv", m.id),
                    posterUrl: poster(d.poster_path, "w500"),
                    bannerUrl: poster(d.backdrop_path, "w1280") || poster(d.poster_path, "w500"),
                    description: d.overview || "",
                    type: "tvseries",
                    year: d.first_air_date ? parseInt(d.first_air_date.split("-")[0], 10) : null,
                    score: d.vote_average,
                    status: (d.status && d.status.toLowerCase().indexOf("ended") >= 0) ? "completed" : "ongoing",
                    tags: (d.genres || []).map(function (g) { return g.name; }),
                    episodes: eps
                };
                cb({ success: true, data: item });
            } else {
                var dd = await tmdb("/movie/" + m.id, { append_to_response: "recommendations" });
                var item = {
                    title: dd.title || "Movie",
                    url: itemUrl("movie", m.id),
                    posterUrl: poster(dd.poster_path, "w500"),
                    bannerUrl: poster(dd.backdrop_path, "w1280") || poster(dd.poster_path, "w500"),
                    description: dd.overview || "",
                    type: "movie",
                    year: dd.release_date ? parseInt(dd.release_date.split("-")[0], 10) : null,
                    score: dd.vote_average,
                    duration: dd.runtime || null,
                    tags: (dd.genres || []).map(function (g) { return g.name; }),
                    // SkyStream only enables the Play button when a title has
                    // at least one episode — movies get a single synthetic one.
                    episodes: [{
                        name: dd.title || "Movie",
                        url: itemUrl("movie", m.id),
                        season: 1,
                        episode: 1,
                        posterUrl: poster(dd.poster_path, "w500")
                    }]
                };
                var recs = dd.recommendations && dd.recommendations.results;
                if (recs && recs.length) {
                    item.recommendations = [];
                    for (var i = 0; i < recs.length && i < 12; i++) {
                        item.recommendations.push(toItem(recs[i], "movie"));
                    }
                }
                cb({ success: true, data: item });
            }
        } catch (e) {
            cb({ success: false, errorCode: "ERROR", message: "Failed to load details: " + (e && e.message ? e.message : e) });
        }
    }

    async function loadStreams(url, cb) {
        var m;
        try { m = JSON.parse(String(url || "")); } catch (e) {
            return cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid URL" });
        }
        var mediaType = m.t === "tv" ? "tv" : "movie";
        try {
            var plaintext = { mediaType: mediaType, id: String(m.id) };
            if (mediaType === "tv") {
                plaintext.season = parseInt(m.s, 10) || 1;
                plaintext.episode = parseInt(m.e, 10) || 1;
            }
            var r = await resolve(plaintext);
            if (!r || !r.url) {
                return cb({ success: false, errorCode: "NO_STREAM", message: "No stream found for this title." });
            }

            // The reallyfast CDN serves playlists openly but 403s the actual
            // segments unless the request carries Referer: https://goated.cx/.
            // Route the stream through the app's local proxy (MAGIC_PROXY_v1)
            // so that Referer is injected into every playlist + segment fetch.
            function wrapStream(url, label) {
                return new StreamResult({
                    url: "MAGIC_PROXY_v1" + b64encodeStr(url),
                    source: label,
                    headers: {
                        "User-Agent": "Mozilla/5.0",
                        "Referer": "https://goated.cx/"
                    }
                });
            }

            var out = [];
            out.push(wrapStream(r.url, r.source ? "Goated — " + r.source : "Goated"));

            // offer alternate sources (source switching), up to 2 extra
            var sources = r.availableSources || [];
            if (sources.length > 1) {
                for (var i = 0; i < sources.length && out.length < 3; i++) {
                    if (sources[i] === r.source) continue;
                    try {
                        var p2 = { mediaType: mediaType, id: String(m.id), source: sources[i] };
                        if (mediaType === "tv") { p2.season = plaintext.season; p2.episode = plaintext.episode; }
                        var r2 = await resolve(p2);
                        if (r2 && r2.url) {
                            out.push(wrapStream(r2.url, "Goated — " + r2.source));
                        }
                    } catch (e2) { /* skip */ }
                }
            }
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "ERROR", message: "Could not resolve stream: " + (e && e.message ? e.message : e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
