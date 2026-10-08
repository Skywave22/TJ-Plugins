// Runs worker.js locally (Node 18+) so the plugin <-> relay path can be tested
// without a Cloudflare account:  node tools/relay/local-server.mjs [port]
import http from "node:http";
import worker from "../../relay/worker.js";

const port = Number(process.argv[2] || 8787);
http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/relay.json")) { // test stand-in for the repo's relay.json
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ relays: ["http://127.0.0.1:" + port], key: "tj-relay-2026-skystream" }));
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const request = new Request("http://127.0.0.1:" + port + req.url, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
  const out = await worker.fetch(request, {});
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.log("relay listening on 127.0.0.1:" + port));
