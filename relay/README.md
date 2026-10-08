# 🌍 TJ-Plugins relay (geo-pass): setup in 5 minutes

Some internet providers block movie sites, and some sites ban whole countries or VPN ranges
through Cloudflare. Then a plugin only works with a VPN.

All TJ-Plugins handle this themselves. When a site is blocked on someone's network, the plugin
sends that one page request to **your relay**, a tiny free Cloudflare Worker. The Worker fetches
the page from Cloudflare's network and hands it back. Providers almost never block Cloudflare
Workers, so the plugins work **in any country, without a VPN**.

- The relay is used **only** when a site is blocked for that user. Everyone else connects directly.
- Only page/catalog requests go through it (a few KB each). **Videos still play directly.** If
  the video server itself is blocked, the user still needs Private DNS or a VPN.
- It's free: Cloudflare's free plan allows **100,000 requests per day**. Opening a plugin's home
  screen costs about 10 requests, but only for users who are blocked. If it ever runs out, add a
  second relay (see the end of this guide).

You only do this once. The plugins are already set up to use it.

---

## Step 1: Create a free Cloudflare account

1. Open **https://dash.cloudflare.com/sign-up** (phone or PC).
2. Sign up with your email and a password, then confirm the email Cloudflare sends you.
   No credit card is needed, and you don't need a website or domain.

## Step 2: Create the Worker

1. In the Cloudflare dashboard, open **Workers & Pages** from the left menu (on some accounts
   it is under **Compute (Workers)**).
2. Tap **Create** → **Create Worker** (or "Start with Hello World").
3. Name it **`tj-relay`** and tap **Deploy**.
   Cloudflare may first ask you to choose a free `workers.dev` subdomain. Pick any name, for
   example your username.

## Step 3: Paste the relay code

1. On the new Worker, tap **Edit code**.
2. Delete everything in the editor.
3. Open this file, select all and copy:
   **https://raw.githubusercontent.com/Skywave22/TJ-Plugins/main/relay/worker.js**
4. Paste it into the editor and tap **Deploy**.

## Step 4: Check it

Open your Worker's address in a browser. It looks like:

```
https://tj-relay.YOURNAME.workers.dev
```

It should show: **`TJ-Plugins relay is running.`**

## Step 5: Turn it on for all plugins

Send the address to your developer, **or** do it yourself on GitHub:

1. Open **https://github.com/Skywave22/TJ-Plugins/edit/main/relay.json**
2. Put your address in the list:

```json
{
  "relays": ["https://tj-relay.YOURNAME.workers.dev"],
  "key": "tj-relay-2026-skystream"
}
```

3. Tap **Commit changes**.

That's it. Installed plugins read `relay.json` by themselves, with **no plugin update needed**.
Users who are blocked pick it up within about 30 minutes, or straight away after reopening the app.

---

### More capacity or a backup

Create a second Worker the same way (on another free Cloudflare account) and add it to the list:

```json
"relays": ["https://tj-relay.YOURNAME.workers.dev", "https://tj-relay.OTHER.workers.dev"]
```

The plugins try them in order and skip a relay that is down or out of daily requests.

### Questions

- **Is this safe?** The Worker only fetches the page the plugin asks for and returns it. The
  code saves nothing (Cloudflare's optional Worker logs are off unless you turn them on).
- **The key:** it only stops random people from using your relay. If you change it, change it
  in `relay.json` too, or set a `KEY` variable in the Worker settings.
- **workers.dev blocked in your country?** Rare, but if so, open the Worker → Settings →
  Domains & Routes and add a custom domain.
