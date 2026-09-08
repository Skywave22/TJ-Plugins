#!/usr/bin/env node
/**
 * Live end-to-end tester for TJ-Plugins against the SkyStream native engine
 * contract. Emulates the engine globals (http_get/http_post/storage/classes),
 * then runs search → getHome → load → loadStreams for every plugin.
 *
 * Usage: node test/live-test.mjs [PluginName ...]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const UA =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36";

/* ---------------- engine shims ---------------- */

async function http_get(url, headers) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...(headers || {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text();
  const h = {};
  res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
  return { body, status: res.status, statusCode: res.status, headers: h };
}

async function http_post(url, headers, body) {
  let h = headers || {};
  let payload = body;
  if (h && typeof h === "object" && !Array.isArray(h) && (h.body || h.headers)) {
    payload = h.body;
    h = h.headers || {};
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "User-Agent": UA, ...(h || {}) },
    body: payload == null ? undefined : String(payload),
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  const hh = {};
  res.headers.forEach((v, k) => (hh[k.toLowerCase()] = v));
  return { body: text, status: res.status, statusCode: res.status, headers: hh };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* dean edwards packer unpack (p,a,c,k,e,d) */
function unPack(source) {
  const m = source.match(/eval\(function\(p,a,c,k,e,[dr]*\)\{[\s\S]*?\}\('(.*)',(\d+),(\d+),'([^']*)'\.split\('\|'\)/);
  if (!m) return source;
  let payload = m[1].replace(/\\'/g, "'");
  const radix = parseInt(m[2], 10), count = parseInt(m[3], 10), keys = m[4].split("|");
  const dict = {};
  for (let i = count - 1; i >= 0; i--) dict[base(i, radix)] = keys[i] || String(i);
  return payload.replace(/\b\w+\b/g, (w) => (w in dict ? dict[w] : w));
  function base(num, b) {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let out = "";
    do { out = chars[num % b] + out; num = Math.floor(num / b); } while (num > 0);
    return out;
  }
}

function makeSandbox(manifest) {
  const prefs = {};
  const sb = {
    manifest,
    console: {
      log: (...a) => console.log("        [js]", ...a.map(String).join(" ").slice(0, 160)),
      warn: () => {},
      error: (...a) => console.log("        [js:err]", ...a.map(String).join(" ").slice(0, 160)),
    },
    log: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    http_get,
    http_post,
    http_parallel: async (reqs) => Promise.all(reqs.map((r) => (r.method || "GET").toUpperCase() === "POST" ? http_post(r.url, r.headers, r.body) : http_get(r.url, r.headers))),
    parse_html: async (html, selector, attr) => [],
    getAndUnpack: async (js) => unPack(js),
    getPreference: async (k) => (k in prefs ? prefs[k] : null),
    setPreference: async (k, v) => { prefs[k] = v; },
    crypto: {
      decryptAES: async (data, key, iv, options) => {
        const mode = (options && options.mode) || "cbc";
        const algo = mode === "ecb" ? "aes-128-ecb" : "aes-128-cbc";
        const d = crypto.createDecipheriv(
          algo,
          Buffer.from(String(key), "utf8").subarray(0, 16),
          mode === "ecb" ? null : Buffer.from(String(iv || ""), "utf8").subarray(0, 16)
        );
        return Buffer.concat([d.update(Buffer.from(String(data), "base64")), d.final()]).toString("utf8");
      },
      pbkdf2: async (pw, salt, iters, keyLen) =>
        crypto.pbkdf2Sync(String(pw), String(salt), iters || 10000, keyLen || 32, "sha1").toString("hex"),
    },
    solveCaptcha: async () => { throw new Error("captcha solver unavailable in tests"); },
    CloudStream: { getLanguage: () => "en", getRegion: () => "US" },
    MultimediaItem: function (p) { Object.assign(this, { type: "movie", status: "ongoing", streams: [], syncData: {} }, p); },
    Episode: function (p) { Object.assign(this, { season: 0, episode: 0, streams: [] }, p); },
    StreamResult: function (p) { Object.assign(this, p); this.source = this.source || "Auto"; },
    Actor: function (p) { Object.assign(this, p); },
    Trailer: function (p) { Object.assign(this, p); },
    NextAiring: function (p) { Object.assign(this, p); },
  };
  sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb;
  return sb;
}

function loadPlugin(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, dir, "plugin.json"), "utf8"));
  const code = fs.readFileSync(path.join(ROOT, dir, "plugin.js"), "utf8");
  const sb = makeSandbox(manifest);
  const names = Object.keys(sb);
  const fn = new Function(
    "globalThis", ...names,
    code +
      "\n;return {" +
      ["getHome", "search", "load", "loadStreams", "getProviders", "getSettings"]
        .map((n) => `${n}: (typeof ${n}!=='undefined'?${n}:undefined)`)
        .join(",") +
      "};"
  );
  fn(sb, ...names.map((n) => sb[n]));
  const api = {
    getHome: sb.getHome,
    search: sb.search,
    load: sb.load,
    loadStreams: sb.loadStreams,
    getProviders: sb.getProviders,
    getSettings: sb.getSettings,
  };
  return { manifest, api };
}

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms: ${label}`)), ms)),
  ]);

/**
 * Mirrors the engine's _invoke (js_engine_worker.dart): calls fn(...args, dart_cb)
 * — if fn returns a promise its value also lands in dart_cb. Then unwraps the
 * {success, data} envelope exactly like invokeAsync does.
 */
function engineInvoke(fn, ms, label, ...args) {
  return withTimeout(
    new Promise((resolve, reject) => {
      let settled = false;
      const dart_cb = (res) => {
        if (settled) return;
        settled = true;
        if (res === "__dart_void__" || res === undefined) return resolve(undefined);
        if (res && typeof res === "object" && !Array.isArray(res) && "success" in res) {
          if (res.success) return resolve(res.data);
          const err = new Error(res.message || res.errorCode || "plugin reported failure");
          err.code = res.errorCode;
          return reject(err);
        }
        resolve(res);
      };
      let out;
      try {
        out = fn(...args, dart_cb);
      } catch (e) {
        return reject(e);
      }
      if (out && typeof out.then === "function") {
        out.then(dart_cb).catch((e) => { if (!settled) { settled = true; reject(e); } });
      } else if (out !== undefined) {
        dart_cb(out);
      }
    }),
    ms,
    label
  );
}

const isHttp = (u) => /^https?:\/\/[^\s"']+/i.test(String(u || ""));

function flatItems(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    if (Array.isArray(v.items)) return v.items;
    const rows = Object.values(v).filter(Array.isArray);
    if (rows.length) return rows.flat();
  }
  return [];
}

/* ---------------- runner ---------------- */

const results = [];
const args = process.argv.slice(2);
const dirs = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, "plugin.js")))
  .map((d) => d.name)
  .filter((d) => args.length === 0 || args.some((a) => d.toLowerCase().includes(a.toLowerCase())));

for (const dir of dirs) {
  const row = { dir, phases: {}, errors: [] };
  console.log(`\n━━━ ${dir} ━━━`);
  let api, manifest;
  try {
    ({ api, manifest } = loadPlugin(dir));
    row.phases.load = "ok";
  } catch (e) {
    row.phases.load = "FAIL";
    row.errors.push("load: " + e.message);
    results.push(row);
    continue;
  }

  const probeQuery = (manifest.categories || []).some((c) => /anime/i.test(c)) ? "one piece" : "avengers";

  // search
  let items = [];
  if (typeof api.search === "function") {
    try {
      const r = await engineInvoke(api.search, 45000, "search", probeQuery);
      items = flatItems(r).filter((i) => i && i.url);
      row.phases.search = items.length ? `ok(${items.length})` : "EMPTY";
    } catch (e) {
      row.phases.search = "FAIL";
      row.errors.push("search: " + e.message);
    }
  } else row.phases.search = "n/a";

  // getHome
  if (typeof api.getHome === "function") {
    try {
      const r = await engineInvoke(api.getHome, 45000, "getHome");
      const hItems = flatItems(r).filter((i) => i && i.url);
      row.phases.getHome = hItems.length ? `ok(${hItems.length})` : "EMPTY";
      if (!items.length) items = hItems;
    } catch (e) {
      row.phases.getHome = "FAIL";
      row.errors.push("getHome: " + e.message);
    }
  } else row.phases.getHome = "n/a";

  if (!items.length) {
    results.push(row);
    continue;
  }

  // load details (try a few items until one loads)
  let details = null, detailsUrl = null;
  for (const cand of items.slice(0, 3)) {
    try {
      const d = await engineInvoke(api.load, 45000, "load", cand.url);
      if (d && (d.title || d.episodes || d.url || d.type)) { details = d; detailsUrl = d.url || cand.url; row.phases.load2 = "ok"; break; }
    } catch (e) {
      row.phases.load2 = "FAIL";
      row.errors.push(`load(${String(cand.url).slice(0, 60)}): ` + e.message);
    }
  }
  if (!details) { results.push(row); continue; }

  // pick stream url: episode url for series, else details url
  let streamUrl = detailsUrl;
  if (Array.isArray(details.episodes) && details.episodes.length) {
    streamUrl = details.episodes[0].url || streamUrl;
  }
  if (typeof api.loadStreams === "function") {
    try {
      const r = await engineInvoke(api.loadStreams, 60000, "loadStreams", streamUrl);
      const streams = (Array.isArray(r) ? r : flatItems(r)).filter((s) => s && isHttp(s.url));
      row.phases.loadStreams = streams.length ? `ok(${streams.length})` : "EMPTY";
      if (streams.length) {
        const s = streams[0];
        row.sample = `${s.source || s.quality || "?"} ← ${String(s.url).slice(0, 72)}`;
      }
    } catch (e) {
      row.phases.loadStreams = "FAIL";
      row.errors.push("loadStreams: " + e.message);
    }
  } else row.phases.loadStreams = "n/a";

  results.push(row);
}

console.log("\n════════ MATRIX ════════");
for (const r of results) {
  const p = r.phases;
  console.log(
    r.dir.padEnd(14),
    "load:" + String(p.load).padEnd(4),
    "search:" + String(p.search).padEnd(10),
    "home:" + String(p.getHome).padEnd(10),
    "details:" + String(p.load2).padEnd(4),
    "streams:" + String(p.loadStreams).padEnd(10),
    r.sample ? "| " + r.sample : ""
  );
  for (const e of r.errors) console.log("    ✘", e.slice(0, 200));
}
const bad = results.filter((r) => Object.values(r.phases).some((v) => v === "FAIL" || v === "EMPTY"));
console.log(`\n${results.length - bad.length}/${results.length} plugins fully healthy`);
process.exit(0);
