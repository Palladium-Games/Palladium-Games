# Palladium Games

Palladium runs as a single Node monolith (`apps.js`) that:

- serves static frontend pages from repo root
- exposes backend APIs for games, AI, proxy fetch, and link checks
- optionally manages sidecars (Scramjet proxy, Ollama, Discord bots)
- powers Settings-based tab cloaking (custom title/favicon + about:blank launcher)

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

1. Run Palladium on your server (it listens on `SITE_PORT`, default `3000`).
2. Point DNS for your hostname to that server (A/AAAA record).
3. Put a reverse proxy/CDN in front (Nginx, Caddy, Fastly, Cloudflare, etc.).
4. Forward all routes to your Palladium origin (`http://127.0.0.1:3000` or your internal origin).
5. Keep original host/proto headers (`Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`) so generated URLs stay correct.
6. Enable TLS on the public hostname (HTTPS certificate).

Minimum requirement: it must proxy both static pages and API routes (including `/api/*` and `/link-check`), not just a single page.

### Fastly-style checklist

- Backend origin: your server/domain running Palladium
- Service domain: your custom public hostname
- Pass-through for dynamic paths (`/api/*`, `/health`, `/link-check`)
- Do not aggressively cache API responses
- Valid TLS cert for the public hostname

If you host frontend and backend on different domains, frontend can target backend via query param:

```text
https://your-frontend.example/?backend=https://your-backend.example
```

## Ports

- Site/API: `3000` (`SITE_PORT`, default)
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
- `config/palladium.env.example` contains all supported runtime settings.
