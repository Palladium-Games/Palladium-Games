# Palladium Games

Palladium now supports a split deployment model:

- `frontend/` is the static UI export for Netlify, Vercel, GitHub Pages, and similar hosts
- `backend/` is the runtime wrapper for the real backend on `api.sethpang.com`
- repo root remains the source of truth for editing and local development

The backend runtime (`apps.js`) handles:

- backend APIs for games, AI, proxy fetch, and link checks
- hosted game files
- optional runtime services (Ollama, Discord bots)
- public config consumed by the static frontend
- Settings-based tab cloaking (custom title/favicon + about:blank launcher)

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Palladium-Games/Palladium-Games)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/Palladium-Games/Palladium-Games)
[![Deploy to Render](https://img.shields.io/badge/Deploy%20to-Render-46E3B7?logo=render&logoColor=black)](https://render.com/deploy?repo=https://github.com/Palladium-Games/Palladium-Games)

## Repo Layout

| Path | Purpose |
|------|--------|
| repo root (`.`) | Source of truth for website HTML/CSS/JS pages and shared assets |
| `frontend/` | Generated static export for Netlify/Vercel/static hosting |
| `backend/` | Backend runtime wrapper for `apps.js` |
| `games/` | Hosted game files served by the backend |
| `discord-bots/` | Discord bot scripts started by `apps.js` |
| `config/` | Runtime config (`palladium.env`) |
| `apps.js` | Main monolith runtime |
| `scripts/sync-frontend.js` | Builds the static frontend export |
| `start.sh` | Start script for production/local |
| `services/` | Optional extras (e.g. monochrome) |

## Quick Start

```bash
./start.sh
```

On first run, `config/palladium.env` is auto-created from `config/palladium.env.example` if missing.

## Split Deploy Flow

### Frontend

Build the static frontend export:

```bash
npm run build:frontend
```

Deploy the generated `frontend/` folder to Netlify, Vercel, GitHub Pages, or another static host.

Outside local development, `backend.js` defaults the frontend to:

```text
https://api.sethpang.com
```

So the UI keeps its own pages and styling, while the real work is piped to the backend origin.

### Backend

Run the backend locally:

```bash
npm run start:backend
```

Or keep using:

```bash
./start.sh
```

Recommended production shape:

- frontend host: static deploy of `frontend/`
- backend host: `api.sethpang.com`
- backend serves `/api/*`, `/games/*`, `/health`, `/link-check`
- frontend pages call backend APIs through `backend.js`

### Backend Server Setup

For the split setup, the backend app should listen only on localhost and Nginx should expose it publicly:

```text
backend app: 127.0.0.1:8080
public HTTPS: api.sethpang.com:443
```

1. Clone the repo on the server and install Node.js.
2. Create the runtime config:

```bash
mkdir -p config
cp config/palladium.env.example config/palladium.env
```

3. Set the backend host and port in `config/palladium.env`:

```env
SITE_HOST=127.0.0.1
SITE_PORT=8080
```

4. Start the backend locally for a quick test:

```bash
npm run start:backend
```

5. Install Nginx and create a plain HTTP site config first:

```nginx
server {
    listen 80;
    server_name api.sethpang.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
        proxy_send_timeout 300;
        proxy_buffering off;
    }
}
```

6. Test and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

7. After the HTTP config works, issue the certificate:

```bash
sudo certbot --nginx -d api.sethpang.com
```

8. Put the backend under `systemd` so it stays online:

```ini
[Unit]
Description=Palladium Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/Palladium-Games
ExecStart=/usr/bin/npm run start:backend
Restart=always
RestartSec=5
User=root
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Save that as `/etc/systemd/system/palladium-backend.service`, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now palladium-backend
sudo systemctl status palladium-backend
```

9. Confirm the live backend:

```bash
curl https://api.sethpang.com/health
```

Expected result:

- static frontend hosted on Netlify/Vercel
- backend reachable at `https://api.sethpang.com`
- `games/`, AI, proxy, and APIs all served by the backend box

## Make Your Own Link

If you want your own public URL (domain/subdomain) for this site:

1. Run Palladium on your server (it listens on `SITE_PORT`, default `443`).
2. Point DNS for your hostname to that server (A/AAAA record).
3. Put a reverse proxy/CDN in front (Nginx, Caddy, Fastly, Cloudflare, etc.).
4. Forward all routes to your Palladium origin (`http://127.0.0.1:443` or your internal origin).
5. Keep original host/proto headers (`Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`) so generated URLs stay correct.
6. Enable TLS on the public hostname (HTTPS certificate).

Minimum requirement: it must proxy both static pages and API routes (including `/api/*` and `/link-check`), not just a single page.

### Nginx example

```nginx
server {
    listen 80;
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:443;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Fastly checklist

- Backend origin: your server/domain running Palladium
- Service domain: your custom public hostname
- Pass-through for dynamic paths (`/api/*`, `/health`, `/link-check`)
- Do not aggressively cache API responses
- Valid TLS cert for the public hostname

If you host frontend and backend on different domains, frontend can target backend via query param:

```text
https://your-frontend.example/?backend=https://your-backend.example
```

## Automatic Git Updates

Enable automatic updates so a new push to your repository auto-pulls and restarts the app:

1. Set `GIT_AUTO_PULL_ENABLED=true` in `config/palladium.env`.
2. Confirm `GIT_AUTO_PULL_REMOTE=origin` and `GIT_AUTO_PULL_BRANCH=` (or set your branch explicitly).
3. Start with `./start.sh`.

Behavior:

- `apps.js` polls `git fetch` every `GIT_AUTO_PULL_INTERVAL_MS`.
- If remote `HEAD` differs from local `HEAD`, it runs `git pull --ff-only`.
- After a successful pull, the process exits with `42` and `start.sh` restarts automatically.

Useful knobs:

- `GIT_AUTO_PULL_INTERVAL_MS` (default `120000`)
- `GIT_AUTO_PULL_COMMAND_TIMEOUT_MS` (default `90000`)

## Games

We source our games from GN-Math (`gn-math.dev`) and other websites.

## Ports

- Site/API: `443` (`SITE_PORT`, default)
- Ollama: `11434` (`OLLAMA_BASE_URL`, default)

## Core Routes

### Pages

- `/` or `/index.html`
- `/games.html`
- `/game-player.html`
- `/proxy.html`
- `/ai.html`
- `/music.html`
- `/settings.html`

### API

- `/health`
- `/api/config/public`
- `/api/games`
- `/api/categories`
- `/api/proxy/fetch?url=...`
- `/api/proxy/health`
- `/api/ai/chat`
- `/link-check?url=...`

`/link-check` is a server-side signature probe. It can detect known block pages, but it cannot guarantee a URL is unblocked on every school network.
`/api/ai/chat` supports streaming NDJSON when request payload includes `"stream": true`.

## Settings Page

`/settings.html` lets users:

- choose website themes (`Default`, `Color Wash`, `Miami`, `Rainbow`)
- set a custom tab title
- set a custom favicon (path/URL/data URL)
- detect favicon from a website URL
- upload an image and use it as favicon
- open the site in an `about:blank` tab

The website-url detector only updates favicon, not title.

## Monochrome Music

- Page: `/music.html`
- Config: `MONOCHROME_BASE_URL` (default `https://monochrome.tf`)

## Configuration Notes

- Repo root is still the editable source for frontend files.
- `npm run build:frontend` copies the static UI into `frontend/`.
- Frontend pages default to `https://api.sethpang.com` outside local development.
- `game-player.html` loads hosted game files from the backend origin instead of assuming local static `games/`.
- Backend can still serve the root site directly for local or single-host deployments (`FRONTEND_DIR=.` by default).
- Proxy page can target your external proxy via `PROXY_BASE_URL` (recommended to use HTTPS/443).
- If `PROXY_BASE_URL` is empty, `proxy.html` falls back to `https://<current-host>:443`.
- Static serving blocks backend/internal paths (`config/`, `discord-bots/`, `services/`, dotfiles).
- Game catalog API reads from `games.html` so titles/authors stay aligned with the UI.
- Discord tokens/channels are configured in `config/palladium.env`.
- Commit bot tracks remote GitHub commits (not local-only git state). Optional settings: `DISCORD_COMMIT_REPO`, `DISCORD_COMMIT_BRANCH`, `DISCORD_COMMIT_POLL_MS`, `DISCORD_COMMIT_GITHUB_TOKEN`, `DISCORD_COMMIT_POST_ON_BOOTSTRAP`, `DISCORD_COMMIT_BOOTSTRAP_POST_COUNT`, `DISCORD_COMMIT_PING_ROLE_NAME`, `DISCORD_COMMIT_PING_ROLE_ID`.
- If `DISCORD_COMMIT_BRANCH` is wrong (for example `master` on a `main` repo), the bot auto-falls back to the repo default branch.
- `config/palladium.env.example` contains all supported runtime settings.
