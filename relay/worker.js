/**
 * TJ-Plugins relay (Cloudflare Worker): "geo-pass" for the SkyStream plugins.
 *
 * When a site is blocked on a user's network (provider DNS block, connection cut, or a
 * Cloudflare country/VPN ban), the plugin sends the same request here, and this Worker
 * fetches it from Cloudflare's network and hands back the page. Providers almost never
 * block *.workers.dev, so the plugins keep working in any country without a VPN.
 *
 * Only page/API requests go through here (a few KB each). Videos still play directly.
 *
 * Request :  POST /  with header  x-tj-key: <KEY>
 *            body {"url": "https://…", "method": "GET"|"POST", "headers": {…}, "body": "…"}
 * Response:  {"status": 200, "finalUrl": "https://…", "headers": {…}, "body": "…"}
 *
 * Deploy  :  see README-relay.md (copy, paste, Deploy, about 5 minutes, free plan).
 */

// Must match the key built into the plugins (tools/relay.json). Change both together.
const DEFAULT_KEY = "tj-relay-2026-skystream";

const MAX_BODY = 8 * 1024 * 1024; // the app refuses bodies over 8 MB anyway
const DROP_HEADERS = /^(host|content-length|connection|keep-alive|transfer-encoding|upgrade|te|trailer|proxy-.*|cf-.*|x-forwarded-.*|x-real-ip|forwarded|true-client-ip|cdn-loop)$/i;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const key = (env && env.KEY) || DEFAULT_KEY;
    if (request.method === "GET") return new Response("TJ-Plugins relay is running.\n", { headers: { "content-type": "text/plain" } });
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (request.headers.get("x-tj-key") !== key) return json({ error: "forbidden" }, 403);

    let job;
    try { job = await request.json(); } catch (e) { return json({ error: "bad json" }, 400); }
    const url = String((job && job.url) || "");
    if (!/^https?:\/\/[^\/\s]+/i.test(url)) return json({ error: "bad url" }, 400);
    const method = String(job.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";

    const headers = new Headers();
    const h = (job && job.headers) || {};
    for (const k of Object.keys(h)) {
      if (DROP_HEADERS.test(k) || h[k] == null) continue;
      try { headers.set(k, String(h[k])); } catch (e) {}
    }
    if (!headers.has("user-agent")) headers.set("user-agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: method === "POST" && job.body != null ? String(job.body) : undefined,
        redirect: "follow",
      });
    } catch (e) {
      return json({ status: 0, error: "relay fetch failed: " + String((e && e.message) || e), finalUrl: url, headers: {}, body: "" });
    }

    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_BODY) return json({ status: 0, error: "response too large", finalUrl: res.url || url, headers: {}, body: "" });
    let body = "";
    try { body = await res.text(); } catch (e) {}
    if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY);

    const outHeaders = {};
    res.headers.forEach((v, k) => { outHeaders[k] = v; });
    return json({ status: res.status, finalUrl: res.url || url, headers: outHeaders, body });
  },
};
