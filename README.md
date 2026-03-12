# Palladium Games

Palladium runs as a single Node monolith (`apps.js`) that:

- serves static frontend pages from repo root
- exposes backend APIs for games, AI, proxy fetch, and link checks
- optionally manages sidecars (Scramjet proxy, Ollama, Discord bots)
- powers Settings-based tab cloaking (custom title/favicon + about:blank launcher)

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Palladium-Games/Palladium-Games)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/Palladium-Games/Palladium-Games)
[![Deploy to Render](https://img.shields.io/badge/Deploy%20to-Render-46E3B7?logo=render&logoColor=black)](https://render.com/deploy?repo=https://github.com/Palladium-Games/Palladium-Games)

## Repo Layout

| Path | Purpose |
|------|--------|
| repo root (`.`) | Website HTML/CSS/JS pages and shared assets (`index.html`, `games.html`, `proxy.html`, `ai.html`, `music.html`, `settings.html`, `games/`, `images/`) |
| `discord-bots/` | Discord bot scripts started by `apps.js` |
| `scramjet-service/` | Scramjet proxy sidecar (port `1337` by default) |
| `config/` | Runtime config (`palladium.env`) |
| `apps.js` | Main monolith runtime |
| `start.sh` | Start script for production/local |
| `services/` | Optional extras (e.g. monochrome) |

## Quick Start

```bash
./start.sh
```

On first run, `config/palladium.env` is auto-created from `config/palladium.env.example` if missing.

## Make Your Own Link

If you want your own public URL (domain/subdomain) for this site:

1. Run Palladium on your server (it listens on `SITE_PORT`, default `8080`).
2. Point DNS for your hostname to that server (A/AAAA record).
3. Put a reverse proxy/CDN in front (Nginx, Caddy, Fastly, Cloudflare, etc.).
4. Forward all routes to your Palladium origin (`http://127.0.0.1:8080` or your internal origin).
5. Keep original host/proto headers (`Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`) so generated URLs stay correct.
6. Enable TLS on the public hostname (HTTPS certificate).

Minimum requirement: it must proxy both static pages and API routes (including `/api/*` and `/link-check`), not just a single page.

### Nginx example

```nginx
server {
    listen 80;
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:8080;
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

## Games

We source our games from GN-Math (`gn-math.dev`) and other websites.

## Ports

- Site/API: `8080` (`SITE_PORT`, default)
- Scramjet sidecar: `1337` (`SCRAMJET_PORT`, default)
- Ollama: `11434` (`OLLAMA_BASE_URL`, default)

If `SCRAMJET_PORT` is occupied by an incompatible process, backend startup will launch managed Scramjet on the next free port and expose that resolved value via `/api/config/public`.

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

## Settings Page

`/settings.html` lets users:

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

- Frontend HTML files are served directly from the repo root (`FRONTEND_DIR=.`).
- Static serving blocks backend/internal paths (`config/`, `discord-bots/`, `scramjet-service/`, `services/`, dotfiles).
- Game catalog API reads from `games.html` so titles/authors stay aligned with the UI.
- Discord tokens/channels are configured in `config/palladium.env`.
- Commit bot tracks remote GitHub commits (not local-only git state). Optional settings: `DISCORD_COMMIT_REPO`, `DISCORD_COMMIT_BRANCH`, `DISCORD_COMMIT_POLL_MS`, `DISCORD_COMMIT_GITHUB_TOKEN`, `DISCORD_COMMIT_POST_ON_BOOTSTRAP`, `DISCORD_COMMIT_BOOTSTRAP_POST_COUNT`.
- If `DISCORD_COMMIT_BRANCH` is wrong (for example `master` on a `main` repo), the bot auto-falls back to the repo default branch.
- `config/palladium.env.example` contains all supported runtime settings.
