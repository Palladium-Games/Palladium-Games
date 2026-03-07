# Proxy setup (self-hosted)

The proxy lives **in this repo** under **`proxy-service/`**. It runs as a separate Node server (Scramjet).

## Quick start

1. **Run the proxy locally**
   ```bash
   cd proxy-service
   npm install
   npm start
   ```
   It listens on **http://localhost:8080**.

2. **Point the site at it**  
   In **browse.js**, set the endpoint (base64) in the config comment at the top; default is `http://localhost:8080/`.
   Open the Browse tab; the iframe will load Scramjet and you can browse through it.

## Production (deploy)

- **Main site** (games, homepage, Browse tab UI): deploy as static to Netlify / Vercel / etc.
- **Proxy** (actual browsing): deploy only the **proxy-service** folder to a Node host (Railway, Render, Fly.io, or a VPS). See **proxy-service/README.md** for steps.

Then in **browse.js** set the endpoint (base64 config at top) to your deployed proxy URL, e.g. `https://your-proxy-url/` (with trailing slash).

## Default search

The site uses **Google** as the default search. When no proxy is set, the Browse tab can still load Google in the iframe.
