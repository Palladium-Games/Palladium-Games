# Proxy setup (self-hosted)

The proxy lives **in this repo** under **`proxy-service/`**. It runs as a separate Node server (Scramjet).

## Quick start

1. **Run the proxy locally**
   ```bash
   cd proxy-service
   pnpm install
   pnpm start
   ```
   It listens on **http://localhost:8080**.

2. **Point the site at it**  
   In **proxy.js**, set:
   ```js
   const PROXY_SERVICE_BASE = 'http://localhost:8080/';
   ```
   Open the Proxy tab; the iframe will load Scramjet and you can browse through it.

## Production (deploy)

- **Main site** (games, homepage, Proxy tab UI): deploy as static to Netlify / Vercel / etc.
- **Proxy** (actual browsing): deploy only the **proxy-service** folder to a Node host (Railway, Render, Fly.io, or a VPS). See **proxy-service/README.md** for steps.

Then in **proxy.js** set:
```js
const PROXY_SERVICE_BASE = 'https://your-proxy-url/';
```
Use your deployed proxy URL with a trailing slash.

## Default search

The site uses **Google** as the default search. When no proxy is set, the Proxy tab can still load Google in the iframe.
