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
