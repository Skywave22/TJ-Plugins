#!/usr/bin/env node
/**
 * TJ-Plugins — SkyStream app-accurate plugin harness.
 *
 * `skystream test` runs plugins inside Node with Node's URL, Buffer, axios,
 * a forgiving http_get and no type checking of results. The real app is far
 * stricter, so a plugin can pass the CLI and still be broken on a phone.
 * This harness reproduces what the app actually does:
 *
 *  - Bundles plugin.js exactly like `skystream deploy` (esbuild, iife, es2020,
 *    minified) and runs THAT bundle, not the source.
 *  - Evaluates the app's own JS polyfills (tools/app-polyfills.js, extracted
 *    verbatim from the app source): minimal URL class, no URLSearchParams,
 *    no Buffer/fetch/TextDecoder/axios, single-argument console, app crypto.
 *  - Wraps the plugin in the app's namespaced installer (manifest/http_get/
 *    http_post as closure constants). Like the app, http_get does NOT unwrap a
 *    `{ headers: {...} }` object — such headers are reported and dropped.
 *  - HTTP: 15 s timeouts, 8 MB body cap, redirects followed, default app UA.
 *  - Invokes functions the way the app's worker does, with a 90 s timeout,
 *    and requires the `{ success: true, data }` envelope.
 *  - Validates every returned field against the Dart `fromJson` casts
 *    (`year as int?`, `tags` List<String>, `headers` Map<String,String>, …):
 *    any violation would throw in the app and blank the whole screen.
 *
 * Usage:
 *   node tools/app-harness.mjs <pluginDir> --auto [--search "query"] [--items 3]
 *   node tools/app-harness.mjs <pluginDir> --fn load --q "<url>"
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import axios from "axios";
import { JSDOM } from "jsdom";
import unpacker from "unpacker";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_BODY = 8 * 1024 * 1024;
const INVOKE_TIMEOUT = 90_000;

// ───────────────────────────── args ─────────────────────────────
const argv = process.argv.slice(2);
const pluginDir = path.resolve(argv[0] || ".");
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);
const VERBOSE = flag("--verbose");
const QUIET_HTTP = !flag("--http");

const C = { r: (s) => `\x1b[31m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[36m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };

// ───────────────────────────── bundle ─────────────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8"));
const entry = ["plugin.ts", "src/index.ts", "plugin.js"].map((f) => path.join(pluginDir, f)).find((f) => fs.existsSync(f));
const built = await esbuild.build({
  entryPoints: [entry], bundle: true, write: false, minify: true, format: "iife",
  globalName: "PluginModule", treeShaking: true, platform: "neutral", target: "es2020",
  footer: { js: "Object.assign(globalThis, PluginModule);" }, logLevel: "silent",
});
const rawScript = built.outputFiles[0].text;

// ───────────────────────────── runtime ─────────────────────────────
const issues = [];          // runtime/contract problems found while running
const httpLog = [];
const storage = {};
const dom = new Map(); let domCnt = 0;
const asyncReg = new Map();

function note(kind, msg) { issues.push({ kind, msg }); if (VERBOSE) console.log(C.y(`  [${kind}] ${msg}`)); }

const sandbox = Object.create(null);
const ctx = vm.createContext(sandbox);
const runJs = (code) => vm.runInContext(code, ctx);

function resolveAsync(id, value, isError) {
  // Same path as the app: _resolveDartAsync(id, json, isError) evaluated in JS.
  runJs(`_resolveDartAsync(${JSON.stringify(id)}, ${JSON.stringify(value === undefined ? null : value)}, ${isError ? "true" : "false"})`);
}

function serializeEl(el) {
  if (!el) return null;
  const id = "node_" + domCnt++;
  domPut(id, el);
  const attributes = {};
  for (const a of Array.from(el.attributes || [])) attributes[a.name] = a.value;
  return { nodeId: id, tagName: (el.localName || "").toLowerCase(), attributes, textContent: el.textContent || "", innerHTML: el.innerHTML || "", outerHTML: el.outerHTML || "" };
}
function domPut(id, v) {
  // The app keeps at most ~100 parsed nodes; older ones are evicted.
  if (dom.size > 100) { const keys = [...dom.keys()]; for (let i = 0; i < dom.size - 50 && i < keys.length; i++) dom.delete(keys[i]); }
  dom.set(id, v);
}

function normHeaders(h, url) {
  const out = {};
  if (h == null) return out;
  if (typeof h !== "object") { note("HTTP", `headers for ${url} is a ${typeof h}, app expects an object map`); return out; }
  for (const [k, v] of Object.entries(h)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") {
      note("HTTP-HEADERS", `http_get(${short(url)}) was passed a nested object under "${k}" — the app does NOT unwrap { headers: {...} } for GET, so these headers are LOST on device`);
      continue;
    }
    out[k] = String(v);
  }
  return out;
}
const short = (u) => String(u).length > 90 ? String(u).slice(0, 87) + "..." : String(u);

// --curl <regex|all>: send matching requests through curl instead of axios.
// Cloudflare challenges Node's TLS fingerprint on some hosts (gdflix, vixsrc…)
// that curl — and the app's Dart client — pass, so this keeps tests honest.
const CURL_RE = (() => { const v = opt("--curl", ""); return v ? (v === "all" ? /./ : new RegExp(v, "i")) : null; })();
async function curlHttp(method, url, headers, body) {
  const { spawn } = await import("node:child_process");
  const os = await import("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hc-"));
  const hf = path.join(tmp, "h"), bf = path.join(tmp, "b");
  const args = ["-s", "-L", "--max-redirs", "10", "-m", "15", "-X", method, "-D", hf, "-o", bf, "-w", "%{http_code} %{url_effective}", "--max-filesize", String(MAX_BODY)];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (body != null) args.push("--data-binary", "@-");
  args.push(url);
  const out = await new Promise((resolve) => {
    const p = spawn("curl", args); let o = "";
    p.stdout.on("data", (d) => (o += d));
    p.on("close", (code) => resolve({ code, o }));
    if (body != null) p.stdin.end(String(body)); else p.stdin.end();
  });
  const [st, ...fu] = out.o.trim().split(" ");
  const status = parseInt(st, 10) || 0;
  const resBody = fs.existsSync(bf) ? fs.readFileSync(bf, "utf8") : "";
  const rh = {};
  if (fs.existsSync(hf)) {
    const blocks = fs.readFileSync(hf, "utf8").trim().split(/\r?\n\r?\n/);
    for (const line of (blocks[blocks.length - 1] || "").split(/\r?\n/).slice(1)) {
      const i = line.indexOf(":"); if (i < 0) continue;
      const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
      if (k === "set-cookie") (rh[k] = rh[k] || []).push(v); else rh[k] = v;
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!status) throw new Error("curl exit " + out.code);
  return { status, body: resBody, headers: rh, finalUrl: fu.join(" ") || url };
}

// --block <regex> [--block-mode dns|cf]: simulate a provider block for matching hosts.
//   dns -> the request fails like a poisoned DNS answer (status 0, "Failed host lookup")
//   cf  -> Cloudflare "you have been blocked" page (HTTP 403, error 1020/1009)
const BLOCK_RE = (() => { const v = opt("--block", ""); return v ? new RegExp(v, "i") : null; })();
const BLOCK_MODE = opt("--block-mode", "dns");
async function doHttp(req) {
  const method = req.method || "GET";
  const url = req.url;
  if (BLOCK_RE && typeof url === "string" && BLOCK_RE.test((url.match(/^https?:\/\/([^\/?#]+)/i) || [])[1] || "")) {
    httpLog.push({ method, url, status: BLOCK_MODE === "cf" ? 403 : 0, ms: 0, err: "simulated block" });
    if (!QUIET_HTTP) console.log(C.d(`  [HTTP] ${method} BLOCKED(${BLOCK_MODE}) ${short(url)}`));
    if (BLOCK_MODE === "cf") return { code: 403, statusCode: 403, status: 403, headers: { server: "cloudflare" }, finalUrl: url,
      body: '<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body><div id="cf-error-details"><h1>Sorry, you have been blocked</h1><span>Error 1009</span> The owner of this website has banned the country or region your IP address is in.</div></body></html>' };
    return { code: 0, statusCode: 0, status: 0, body: "", error: "DioException [connection error]: SocketException: Failed host lookup: '" + ((url.match(/^https?:\/\/([^\/?#]+)/i) || [])[1]) + "'" };
  }
  const headers = normHeaders(req.headers, url);
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) headers["User-Agent"] = APP_UA;
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "accept-encoding")) headers["Accept-Encoding"] = "identity";
  if ((method === "POST" || method === "PUT") && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const t0 = Date.now();
  try {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("Invalid URL: " + url);
    if (CURL_RE && CURL_RE.test(url)) {
      const r = await curlHttp(method, url, headers, req.body ?? null);
      httpLog.push({ method, url, status: r.status, ms: Date.now() - t0, len: r.body.length });
      if (!QUIET_HTTP) console.log(C.d(`  [HTTP] ${method} ${r.status} ${Date.now() - t0}ms (curl) ${short(url)}`));
      return { code: r.status, statusCode: r.status, status: r.status, body: r.body, headers: r.headers, finalUrl: r.finalUrl };
    }
    const res = await axios.request({
      url, method, headers, data: req.body ?? undefined, responseType: "arraybuffer", decompress: true,
      timeout: 15000, maxContentLength: MAX_BODY, maxRedirects: 10, validateStatus: () => true,
      transformResponse: (x) => x,
    });
    const body = Buffer.from(res.data || []).toString("utf8");
    const rh = {};
    for (const [k, v] of Object.entries(res.headers || {})) rh[k] = k.toLowerCase() === "set-cookie" ? [].concat(v) : Array.isArray(v) ? v.join(",") : String(v);
    const finalUrl = res.request?.res?.responseUrl || url;
    httpLog.push({ method, url, status: res.status, ms: Date.now() - t0, len: body.length });
    if (!QUIET_HTTP) console.log(C.d(`  [HTTP] ${method} ${res.status} ${Date.now() - t0}ms ${short(url)}`));
    return { code: res.status, statusCode: res.status, status: res.status, body, headers: rh, finalUrl };
  } catch (e) {
    httpLog.push({ method, url, status: 0, ms: Date.now() - t0, err: e.message });
    if (!QUIET_HTTP) console.log(C.d(`  [HTTP] ${method} ERR ${e.code || e.message} ${short(url)}`));
    return { code: 0, statusCode: 0, status: 0, body: "", error: String(e.message || e) };
  }
}

function aesDecrypt({ data, key, iv, mode }) {
  const b = (s) => Buffer.from(String(s).replace(/\s+/g, ""), "base64");
  const k = b(key), ivb = b(iv), d = b(data);
  const bits = k.length * 8;
  if ((mode || "cbc").toLowerCase() === "gcm") {
    const tag = d.subarray(d.length - 16), ct = d.subarray(0, d.length - 16);
    const dc = crypto.createDecipheriv(`aes-${bits}-gcm`, k, ivb); dc.setAuthTag(tag);
    return Buffer.concat([dc.update(ct), dc.final()]).toString("utf8");
  }
  const dc = crypto.createDecipheriv(`aes-${bits}-cbc`, k, ivb);
  return Buffer.concat([dc.update(d), dc.final()]).toString("utf8");
}

// Sync channel — mirrors js_engine_worker.dart onMessage handlers
sandbox.sendMessage = function (channel, arg) {
  let p; try { p = typeof arg === "string" ? JSON.parse(arg) : arg; } catch { p = arg; }
  switch (channel) {
    case "console_log": console.log(C.d("  [JS] " + (typeof p === "string" ? p : JSON.stringify(p)))); return null;
    case "console_error": console.log(C.y("  [JS ERR] " + (typeof p === "string" ? p : JSON.stringify(p)))); return null;
    case "js_dispatch_callback": onCallback(p); return null;
    case "js_set_timeout": {
      setTimeout(() => { try { runJs(`(function(){var f=globalThis.timeout_registry[${JSON.stringify(p.id)}]; if(f) f();})()`); } catch (e) { note("TIMER", e.message); } }, p.delay || 0);
      return null;
    }
    case "js_unpack": try { return unpacker.detect(String(arg)) ? unpacker.unpack(String(arg)) : String(arg); } catch { return String(arg); }
    case "crypto_md5": return crypto.createHash("md5").update(String(p)).digest("hex");
    case "crypto_sha256": return crypto.createHash("sha256").update(String(p)).digest("hex");
    case "base64_decode": try { return Buffer.from(String(arg), "base64").toString("utf8"); } catch { return null; }
    case "base64_encode": return Buffer.from(String(arg), "utf8").toString("base64");
    case "set_storage": storage[p.key] = p.value == null ? null : typeof p.value === "string" ? p.value : JSON.stringify(p.value); return null;
    case "get_preference": return null; // sync bridge returns null in the app
    case "set_preference": storage[p.key] = p.value; return null;
    case "dom_query": {
      const node = dom.get(p.nodeId); if (!node) return null;
      let list; try { list = Array.from(node.querySelectorAll(p.query)); } catch { return null; }
      return p.multi ? JSON.stringify(list.map(serializeEl)) : JSON.stringify(list.length ? serializeEl(list[0]) : null);
    }
    case "dom_query_batch": {
      const node = dom.get(p.nodeId); if (!node) return null;
      return JSON.stringify((p.queries || []).map((q) => {
        const els = Array.from(node.querySelectorAll(q.query || "*"));
        const ex = (e) => (q.attr || "textContent") === "textContent" ? e.textContent : (q.attr === "innerHTML" ? e.innerHTML : q.attr === "outerHTML" ? e.outerHTML : e.getAttribute(q.attr));
        return q.first ? (els[0] ? ex(els[0]) : null) : els.map(ex);
      }));
    }
    case "regex_match_all": {
      try { const re = new RegExp(p.pattern, p.caseSensitive === false ? "gi" : "g"); return JSON.stringify([...String(p.text).matchAll(re)].map((m) => m[p.group || 0] ?? null)); } catch { return "[]"; }
    }
    case "json_extract": return JSON.stringify({});
    default:
      // IO bridges (async): http_request, http_parallel, get_storage, solve_captcha, crypto_*, dom_parse, parse_html
      return asyncBridge(channel, p);
  }
};

function asyncBridge(channel, p) {
  const id = p && p.id;
  const reply = (v, err) => setImmediate(() => { try { resolveAsync(id, v, err); } catch (e) { note("BRIDGE", e.message); } });
  switch (channel) {
    case "http_request": doHttp(p).then((r) => reply(r)); break;
    case "http_parallel": Promise.all((p.requests || []).map((r) => doHttp(r))).then((r) => reply(r)); break;
    case "get_storage": reply(storage[p.key] ?? null); break;
    case "solve_captcha": reply("mock_captcha_token"); break;
    case "crypto_decrypt_aes": try { reply(aesDecrypt(p)); } catch (e) { reply(String(e.message), true); } break;
    case "crypto_pbkdf2": try { reply(crypto.pbkdf2Sync(Buffer.from(p.password, "utf8"), Buffer.from(p.salt, "base64"), p.iterations || 10000, p.keyLength || 32, "sha256").toString("base64")); } catch (e) { reply(String(e.message), true); } break;
    case "dom_parse": { const did = "doc_" + domCnt++; domPut(did, new JSDOM(p.html || "").window.document); reply(did); break; }
    case "parse_html": { try { const d = new JSDOM(p.html || "").window.document; reply(Array.from(d.querySelectorAll(p.selector)).map((el) => ({ text: el.textContent, attr: p.attr ? el.getAttribute(p.attr) : null, innerHTML: el.innerHTML }))); } catch (e) { reply([]); } break; }
    case "dom_parse_and_extract": reply({}); break;
    default: note("BRIDGE", `unknown bridge channel '${channel}' (not available in the app)`); if (id) reply(null, true);
  }
  return null;
}

// ── load the app's polyfills, then the plugin wrapped like JsBasedProvider._buildIife
runJs(fs.readFileSync(path.join(__dirname, "app-polyfills.js"), "utf8"));
const NS = "__tj_" + manifest.packageName.replace(/[^a-zA-Z0-9_]/g, "_");
const wrapper = `
globalThis.__installer = function(__ssTok) {
  const __ssSend = function(channel, params) { params.__ssTok = __ssTok; return sendMessage(channel, JSON.stringify(params)); };
  const __ssAsync = function(channel, params) { params.__ssTok = __ssTok; return _dartAsyncCall(channel, params); };
  const manifest = ${JSON.stringify(manifest)};
  const getPreference = (key) => __ssSend('get_preference', { key: key });
  const setPreference = (key, value) => __ssSend('set_preference', { key: key, value: value });
  const __ssHttp = function(method, url, headers, body) {
    if (method === 'POST' && typeof headers === 'object' && headers !== null && !body && (headers.body || headers.headers)) { body = headers.body; headers = headers.headers; }
    return __ssAsync('http_request', { method: method, url: url, headers: headers || {}, body: body });
  };
  const http_get = function(url, headers, cb) { return __ssHttp('GET', url, headers, null).then(function(res) { if (cb && typeof cb === 'function') cb(res); return res; }); };
  const http_post = function(url, headers, body, cb) { return __ssHttp('POST', url, headers, body).then(function(res) { if (cb && typeof cb === 'function') cb(res); return res; }); };
  const http_parallel = function(requests) { return __ssAsync('http_parallel', { requests: requests }); };
  const _fetch = async function(url) { return await http_get(url, {}); };
  var exports = (function() {
    ${rawScript}
    return {
      getHome: (typeof getHome !== 'undefined') ? getHome : (typeof globalThis.getHome !== 'undefined' ? globalThis.getHome : undefined),
      search: (typeof search !== 'undefined') ? search : (typeof globalThis.search !== 'undefined' ? globalThis.search : undefined),
      load: (typeof load !== 'undefined') ? load : (typeof globalThis.load !== 'undefined' ? globalThis.load : undefined),
      loadStreams: (typeof loadStreams !== 'undefined') ? loadStreams : (typeof globalThis.loadStreams !== 'undefined' ? globalThis.loadStreams : undefined),
    };
  })();
  globalThis['${NS}'] = exports;
  if (globalThis.getHome) delete globalThis.getHome;
  if (globalThis.search) delete globalThis.search;
  if (globalThis.load) delete globalThis.load;
  if (globalThis.loadStreams) delete globalThis.loadStreams;
};`;
let initError = null;
try { runJs(wrapper); runJs(`globalThis.__installer('tok'); delete globalThis.__installer;`); }
catch (e) { initError = e; }

// ── invocation (mirrors js_engine_worker _invoke)
const pending = new Map(); let cbCnt = 0;
function onCallback({ callbackId, result, error }) {
  const p = pending.get(callbackId); if (!p) return;
  pending.delete(callbackId);
  p.resolve({ result, error });
}
function invoke(fn, args) {
  return new Promise((resolve) => {
    const id = "cb_" + cbCnt++;
    const timer = setTimeout(() => { pending.delete(id); resolve({ timeout: true }); }, INVOKE_TIMEOUT);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); } });
    const code = `(function() {
      try {
        var dart_cb = function(res) { executeCallback('${id}', res !== undefined ? res : "__dart_void__", null); };
        var fn = globalThis['${NS}'] && globalThis['${NS}']['${fn}'];
        if (typeof fn !== 'function') throw "Function ${NS}.${fn} not found";
        var args = ${JSON.stringify(args)};
        args.push(dart_cb);
        var res = fn.apply(null, args);
        if (res && (typeof res.then === 'function' || res instanceof Promise)) {
          res.then(dart_cb).catch(function(err) { executeCallback('${id}', null, err.toString()); });
        } else if (res !== undefined) { dart_cb(res); }
      } catch(e) { executeCallback('${id}', null, e.toString()); }
    })();`;
    try { runJs(code); } catch (e) { clearTimeout(timer); pending.delete(id); resolve({ error: "eval: " + e.message }); }
  });
}

// executeCallback → sendMessage JSON.stringify → Dart jsonDecode: emulate the JSON round-trip.
async function call(fn, arg) {
  const t0 = Date.now();
  const r = await invoke(fn, arg === undefined ? [] : [arg]);
  const ms = Date.now() - t0;
  if (r.timeout) return { ok: false, ms, err: `TIMEOUT: ${fn} did not call back within 90 s (app gives up)` };
  if (r.error) return { ok: false, ms, err: `JS ERROR: ${r.error}` };
  let un = r.result;
  if (un === "__dart_void__") un = null;
  if (typeof un === "string") { try { un = JSON.parse(un); } catch { /* keep */ } }
  if (un && typeof un === "object" && !Array.isArray(un)) {
    if (un.success !== undefined && typeof un.success !== "boolean") return { ok: false, ms, err: `envelope: success must be boolean, got ${typeof un.success}` };
    if (!un.success) {
      if (un.errorCode !== undefined && typeof un.errorCode !== "string") return { ok: false, ms, err: "envelope: errorCode must be a string" };
      if (un.message !== undefined && typeof un.message !== "string") return { ok: false, ms, err: "envelope: message must be a string" };
      return { ok: false, ms, err: `PLUGIN ERROR ${un.errorCode || "UNKNOWN_ERROR"}: ${un.message || "(no message)"}${un.success === undefined ? "  ← callback object has no `success:true` key, app treats it as failure" : ""}` };
    }
    return { ok: true, ms, data: un.data };
  }
  return { ok: true, ms, data: un };
}

// ───────────────────────────── Dart contract validation ─────────────────────────────
const isInt = (v) => typeof v === "number" && Number.isInteger(v);
function V(errs, p) {
  return {
    str: (o, k) => { if (o[k] != null && typeof o[k] !== "string") errs.push(`${p}.${k} must be String, got ${typeof o[k]} (${short(JSON.stringify(o[k]))})`); },
    int: (o, k) => { if (o[k] != null && !isInt(o[k])) errs.push(`${p}.${k} must be int, got ${JSON.stringify(o[k])}`); },
    num: (o, k) => { if (o[k] != null && typeof o[k] !== "number") errs.push(`${p}.${k} must be num, got ${JSON.stringify(o[k])}`); },
    bool: (o, k) => { if (o[k] != null && typeof o[k] !== "boolean") errs.push(`${p}.${k} must be bool, got ${JSON.stringify(o[k])}`); },
    smap: (o, k) => { const v = o[k]; if (v == null) return; if (typeof v !== "object" || Array.isArray(v)) return errs.push(`${p}.${k} must be Map<String,String>`); for (const [a, b] of Object.entries(v)) if (typeof b !== "string") errs.push(`${p}.${k}["${a}"] must be String, got ${JSON.stringify(b)}`); },
    slist: (o, k) => { const v = o[k]; if (v == null) return; if (!Array.isArray(v)) return errs.push(`${p}.${k} must be List<String>`); v.forEach((x, i) => { if (typeof x !== "string") errs.push(`${p}.${k}[${i}] must be String, got ${JSON.stringify(x)}`); }); },
    list: (o, k) => { const v = o[k]; if (v != null && !Array.isArray(v)) errs.push(`${p}.${k} must be a List`); return Array.isArray(v) ? v : []; },
    map: (o, k) => { const v = o[k]; if (v != null && (typeof v !== "object" || Array.isArray(v))) errs.push(`${p}.${k} must be a Map`); return v && typeof v === "object" && !Array.isArray(v) ? v : null; },
  };
}
function checkItem(o, p, errs, depth = 0) {
  if (!o || typeof o !== "object" || Array.isArray(o)) { errs.push(`${p} must be an object (MultimediaItem)`); return; }
  if (o.media_type !== undefined && o.vote_average !== undefined && o.posterUrl === undefined) return; // TMDB branch
  const v = V(errs, p);
  ["title", "url", "posterUrl", "backgroundPosterUrl", "bannerUrl", "logoUrl", "description", "type", "contentType", "provider", "playbackPolicy", "vpnStatus", "imdbId", "source"].forEach((k) => v.str(o, k));
  ["year", "duration", "tmdbId"].forEach((k) => v.int(o, k));
  v.num(o, "score"); v.bool(o, "isAdult"); v.smap(o, "headers"); v.slist(o, "tags"); v.smap(o, "syncData");
  v.list(o, "episodes").forEach((e, i) => checkEpisode(e, `${p}.episodes[${i}]`, errs));
  v.list(o, "streams").forEach((s, i) => checkStream(s, `${p}.streams[${i}]`, errs, false));
  (o.cast ?? o.actors) != null && v.list(o, o.cast != null ? "cast" : "actors").forEach((a, i) => { if (!a || typeof a !== "object") return errs.push(`${p}.cast[${i}] must be an object`); const w = V(errs, `${p}.cast[${i}]`); ["name", "image", "role", "roleString"].forEach((k) => w.str(a, k)); });
  v.list(o, "trailers").forEach((t, i) => { if (!t || typeof t !== "object") return errs.push(`${p}.trailers[${i}] must be an object`); const w = V(errs, `${p}.trailers[${i}]`); w.str(t, "url"); w.str(t, "extractorUrl"); w.smap(t, "headers"); });
  if (depth < 1) v.list(o, "recommendations").forEach((r, i) => checkItem(r, `${p}.recommendations[${i}]`, errs, depth + 1));
  const na = v.map(o, "nextAiring"); if (na) { const w = V(errs, `${p}.nextAiring`); w.int(na, "episode"); w.int(na, "unixTime"); w.int(na, "season"); }
}
function checkEpisode(e, p, errs) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return errs.push(`${p} must be an object (Episode)`);
  const v = V(errs, p);
  ["name", "url", "description", "posterUrl", "airDate", "playbackPolicy", "vpnStatus"].forEach((k) => v.str(e, k));
  ["season", "episode"].forEach((k) => v.int(e, k));
  v.num(e, "rating"); v.int(e, "runtime"); if (e.runtime == null) v.int(e, "duration");
  v.smap(e, "headers");
  v.list(e, "streams").forEach((s, i) => checkStream(s, `${p}.streams[${i}]`, errs, false));
}
function checkStream(s, p, errs, fromLoadStreams) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return errs.push(`${p} must be an object (StreamResult)`);
  const v = V(errs, p);
  if (fromLoadStreams && typeof s.url !== "string") errs.push(`${p}.url must be a String (app does map['url'] as String)`);
  ["url", "source", "providerName", "drmKid", "drmKey", "licenseUrl"].forEach((k) => v.str(s, k));
  v.smap(s, "headers");
  v.list(s, "subtitles").forEach((x, i) => { if (!x || typeof x !== "object") return errs.push(`${p}.subtitles[${i}] must be an object`); const w = V(errs, `${p}.subtitles[${i}]`); ["url", "label", "lang"].forEach((k) => w.str(x, k)); });
}
// JSON round trip (what Dart actually receives)
const rt = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// ───────────────────────────── stream probe ─────────────────────────────
async function probeStream(s) {
  const url = s.url;
  if (/^magnet:/i.test(url)) return { ok: true, why: "magnet" };
  if (/^(magic_m3u8:|MAGIC_PROXY)/.test(url)) return { ok: true, why: "magic (resolved by app proxy)" };
  const headers = Object.assign({ "User-Agent": APP_UA }, s.headers || {});
  try {
    const res = await axios.get(url, { headers: Object.assign({ Range: "bytes=0-4095" }, headers), responseType: "arraybuffer", timeout: 15000, maxRedirects: 10, validateStatus: () => true, maxContentLength: 4 * 1024 * 1024 });
    const ct = String(res.headers["content-type"] || "");
    const head = Buffer.from(res.data || []).subarray(0, 4096).toString("utf8");
    if (res.status >= 400) return { ok: false, why: `HTTP ${res.status}` };
    if (head.trimStart().startsWith("#EXTM3U")) {
      // follow the first variant / segment once to be sure the playlist is alive
      const lines = head.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
      if (lines[0]) {
        const next = new URL(lines[0].trim(), res.request?.res?.responseUrl || url).href;
        const r2 = await axios.get(next, { headers: Object.assign({ Range: "bytes=0-2047" }, headers), responseType: "arraybuffer", timeout: 15000, validateStatus: () => true, maxContentLength: 4 * 1024 * 1024 }).catch((e) => ({ status: 0, e }));
        if (!r2.status || r2.status >= 400) return { ok: false, why: `m3u8 ok but child ${r2.status || r2.e?.code} (${short(next)})` };
      }
      return { ok: true, why: "HLS playlist" };
    }
    if (/<MPD/i.test(head)) return { ok: true, why: "DASH manifest" };
    if (/video|octet-stream|mp2t|matroska|mp4|x-mpegurl|binary/i.test(ct)) return { ok: true, why: `${res.status} ${ct}` };
    if (/text\/html/i.test(ct) || /^\s*<(!doctype|html)/i.test(head)) return { ok: false, why: `returns an HTML page (${ct}) — not a playable media URL` };
    return { ok: true, why: `${res.status} ${ct || "unknown type"}` };
  } catch (e) {
    // Server ignored Range and streamed a body past the cap = it is serving the file.
    if (/maxContentLength/i.test(String(e.message))) return { ok: true, why: "large body (server ignores Range) — media file" };
    return { ok: false, why: e.code || e.message };
  }
}

// ───────────────────────────── reporting ─────────────────────────────
const report = { plugin: manifest.name, packageName: manifest.packageName, version: manifest.version, steps: [] };
function step(name, ok, detail, errs = []) {
  report.steps.push({ name, ok, detail, errs });
  console.log(`${ok ? C.g("PASS") : C.r("FAIL")} ${name} ${C.d(detail || "")}`);
  errs.slice(0, 15).forEach((e) => console.log(C.r("     ✗ " + e)));
  if (errs.length > 15) console.log(C.r(`     … ${errs.length - 15} more`));
}
function finish() {
  const contract = issues.filter((i) => i.kind !== "TIMER");
  const uniq = [...new Map(contract.map((i) => [i.kind + i.msg, i])).values()];
  if (uniq.length) { console.log(C.y("\nRuntime warnings:")); uniq.slice(0, 20).forEach((i) => console.log(C.y(`  [${i.kind}] ${i.msg}`))); }
  report.warnings = uniq;
  report.pass = report.steps.every((s) => s.ok) && !uniq.some((i) => i.kind === "HTTP-HEADERS" || i.kind === "BRIDGE");
  const out = opt("--report"); if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n${report.pass ? C.g("■ ALL CHECKS PASSED") : C.r("■ CHECKS FAILED")} — ${manifest.name} v${manifest.version} (${httpLog.length} requests)`);
  process.exit(report.pass ? 0 : 1);
}

// ───────────────────────────── main ─────────────────────────────
console.log(C.b(`\n=== ${manifest.name} (${manifest.packageName}) v${manifest.version} — app-accurate harness ===`));
if (initError) { step("init (load plugin into app runtime)", false, String(initError.stack || initError).split("\n")[0]); finish(); }
step("init (load plugin into app runtime)", true, `bundle ${(rawScript.length / 1024).toFixed(1)} KB`);

const fnArg = opt("--fn");
if (fnArg) {
  const r = await call(fnArg, fnArg === "getHome" ? undefined : opt("--q", ""));
  if (!r.ok) step(fnArg, false, r.err);
  else {
    const errs = []; const d = rt(r.data);
    if (fnArg === "getHome") { if (!d || typeof d !== "object" || Array.isArray(d)) errs.push("getHome data must be a Map<category, List>"); else for (const [k, l] of Object.entries(d)) (Array.isArray(l) ? l : []).forEach((it, i) => checkItem(it, `home["${k}"][${i}]`, errs)); }
    else if (fnArg === "search") (Array.isArray(d) ? d : []).forEach((it, i) => checkItem(it, `search[${i}]`, errs));
    else if (fnArg === "load") checkItem(d, "load", errs);
    else if (fnArg === "loadStreams") (Array.isArray(d) ? d : []).forEach((s, i) => checkStream(s, `streams[${i}]`, errs, true));
    step(fnArg, errs.length === 0, `${r.ms}ms`, errs);
    console.log(JSON.stringify(d, null, 2).slice(0, Number(opt("--max", 6000))));
  }
  finish();
}

// --auto: full user journey
const maxItems = Number(opt("--items", 4));
const home = await call("getHome");
let homeItems = [];
if (!home.ok) step("getHome", false, home.err);
else {
  const d = rt(home.data); const errs = [];
  if (!d || typeof d !== "object" || Array.isArray(d)) errs.push("data must be a Map<category, List<MultimediaItem>> (app throws 'invalid home data')");
  else {
    for (const [k, l] of Object.entries(d)) {
      if (!Array.isArray(l)) { errs.push(`home["${k}"] is not a List (silently dropped by the app)`); continue; }
      l.forEach((it, i) => { checkItem(it, `home["${k}"][${i}]`, errs); if (it && (!it.url || !it.title)) errs.push(`home["${k}"][${i}] has empty title/url`); });
      homeItems.push(...l.map((x) => ({ ...x, __cat: k })));
    }
    if (!homeItems.length) errs.push("dashboard is EMPTY (no items in any category)");
  }
  const cats = d && typeof d === "object" ? Object.entries(d).map(([k, l]) => `${k}:${Array.isArray(l) ? l.length : "?"}`).join(", ") : "";
  step("getHome", errs.length === 0, `${home.ms}ms — ${cats}`, errs);
  const noPoster = homeItems.filter((x) => !x.posterUrl).length;
  if (noPoster) note("UX", `${noPoster}/${homeItems.length} home items have no posterUrl`);
}

// search
const firstTitle = homeItems[0]?.title || "";
const q = opt("--search") || firstTitle.replace(/\(.*?\)|\[.*?\]/g, "").split(/[\s:–-]+/).filter(Boolean).slice(0, 2).join(" ") || "the";
const sr = await call("search", q);
let searchItems = [];
if (!sr.ok) step(`search "${q}"`, false, sr.err);
else {
  const d = rt(sr.data); const errs = [];
  if (!Array.isArray(d)) errs.push(`search data must be a List (got ${typeof d}); app shows no results`);
  else { d.forEach((it, i) => checkItem(it, `search[${i}]`, errs)); searchItems = d; if (!d.length) errs.push("search returned 0 results"); }
  step(`search "${q}"`, errs.length === 0, `${sr.ms}ms — ${Array.isArray(d) ? d.length : 0} results${d?.[0]?.title ? ` (first: ${d[0].title})` : ""}`, errs);
}

// load + loadStreams on a few items (prefer a movie and a series)
const pool = [];
const seen = new Set();
for (const it of [...homeItems, ...searchItems]) { if (it && it.url && !seen.has(it.url)) { seen.add(it.url); pool.push(it); } }
const pick = [];
const movie = pool.find((x) => /movie/i.test(x.type || "")); const series = pool.find((x) => /series|anime|tv/i.test(x.type || ""));
[movie, series, ...pool].forEach((x) => { if (x && !pick.includes(x) && pick.length < maxItems) pick.push(x); });

let anyStreams = false, loadOk = 0;
for (const it of pick) {
  const ld = await call("load", it.url);
  const label = `load "${it.title}" [${it.type || "?"}]`;
  if (!ld.ok) { step(label, false, ld.err); continue; }
  const d = rt(ld.data); const errs = [];
  checkItem(d, "load", errs);
  if (!d || typeof d !== "object") { step(label, false, "load returned no object"); continue; }
  if (typeof d.title === "string" && d.title.startsWith("Error:")) errs.push("load returned an error title");
  const eps = Array.isArray(d.episodes) ? d.episodes : [];
  const isSeries = /series|anime|tv/i.test(d.type || it.type || "");
  if (isSeries && !eps.length) errs.push("series has no episodes (app shows nothing to play)");
  // details_controller.handlePlayPress: movies play details.episodes!.first.url, so a
  // movie/livestream with no episodes throws when Play is pressed.
  else if (!eps.length) errs.push("no episodes: the app's Play button needs episodes[0] (wrap a movie in one Episode)");
  eps.forEach((e, i) => { if (e && !e.url) errs.push(`episodes[${i}] has empty url`); });
  step(label, errs.length === 0, `${ld.ms}ms — ${eps.length} episode(s)${d.description ? "" : ", no description"}${d.posterUrl ? "" : ", no poster"}`, errs);
  if (errs.length === 0) loadOk++;
  const target = eps.length ? eps[0].url : (d.url || it.url);
  if (!target) continue;
  const ls = await call("loadStreams", target);
  if (!ls.ok) { step(`  loadStreams`, false, ls.err); continue; }
  const sd = rt(ls.data); const serrs = [];
  if (!Array.isArray(sd)) serrs.push(`loadStreams data must be a List (got ${typeof sd})`);
  const streams = Array.isArray(sd) ? sd : [];
  streams.forEach((s, i) => checkStream(s, `streams[${i}]`, serrs, true));
  if (!streams.length) serrs.push("no streams returned");
  // probe up to 4 streams
  const probes = [];
  for (const s of streams.slice(0, 4)) { const pr = await probeStream(s); probes.push(`${pr.ok ? "✓" : "✗"} ${s.source || "?"} — ${pr.why}`); if (pr.ok) anyStreams = true; s.__probe = pr; }
  const playable = streams.slice(0, 4).filter((s) => s.__probe?.ok).length;
  if (streams.length && !playable) serrs.push("none of the first streams is playable");
  step(`  loadStreams (${eps.length ? "S" + (eps[0].season ?? "?") + "E" + (eps[0].episode ?? "?") : "movie"})`, serrs.length === 0, `${ls.ms}ms — ${streams.length} stream(s), ${playable}/${Math.min(4, streams.length)} probed playable`, serrs);
  probes.forEach((p) => console.log(C.d("       " + p)));
}
if (!pick.length) step("load", false, "nothing to load (no items from getHome/search)");
else if (!anyStreams) step("playback", false, "no playable stream found for any tested title");
finish();
