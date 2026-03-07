# Self-hosted proxy (Scramjet)

This folder contains a [Scramjet](https://docs.titaniumnetwork.org/proxies/scramjet/) proxy app so you can run the proxy from the same repo.

## Run locally

1. Install [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/).
2. From the repo root:
   ```bash
   cd proxy-service
   pnpm install
   pnpm start
   ```
3. The proxy will listen on **http://localhost:8080**.
4. In the main site’s **proxy.js**, set:
   ```js
   const PROXY_SERVICE_BASE = 'http://localhost:8080/';
   ```
5. Open the Proxy tab and you’ll get the Scramjet UI (or load `http://localhost:8080` in the iframe).

## Deploy (production)

The proxy is a **Node server**. Deploy only the `proxy-service` folder to a Node host, for example:

- **Railway** – connect the repo, set root directory to `proxy-service`, add start script `pnpm start`.
- **Render** – new Web Service, root directory `proxy-service`, build `pnpm install`, start `pnpm start`.
- **Fly.io / VPS** – run `node src/index.js` (or `pnpm start`) and expose port 8080.

Then in **proxy.js** (in the main site you deploy to Netlify/Vercel/etc.), set:

```js
const PROXY_SERVICE_BASE = 'https://your-proxy-url.up.railway.app/';
```

Use your proxy’s real URL (with trailing slash). The Proxy tab will load that URL in the iframe so all traffic goes through your Scramjet instance.

## Optional assets

- **sj.png** – logo on the Scramjet landing page. If missing, the image area will be empty; the proxy still works. You can copy it from [Scramjet-App public/](https://github.com/MercuryWorkshop/Scramjet-App/tree/main/public).
- **favicon.ico** – browser tab icon. Copy from Scramjet-App if you want one.

## Port

Override with the `PORT` environment variable (e.g. `PORT=3000 pnpm start`).

## License

Scramjet and related packages are by Mercury Workshop. See [Scramjet-App](https://github.com/MercuryWorkshop/Scramjet-App) and [Titanium Network](https://docs.titaniumnetwork.org/) for terms.
