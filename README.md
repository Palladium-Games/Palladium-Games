# Palladium Games

Palladium now runs as a single Node monolith:

- serves the static frontend
- exposes API routes (`/api/games`, `/api/ai/chat`, `/api/proxy/fetch`, `/link-check`)
- manages sidecars (Scramjet proxy, Ollama, Discord bots)
- serves Music page integration for Monochrome

## Repo Layout

| Path | Purpose |
|------|--------|
| repo root (`.`) | Website HTML/CSS/JS and static assets (`index.html`, `ai.html`, `proxy.html`, `games/`, `images/`) |
| `discord-bots/` | Discord bot scripts started by `apps.js` |
| `scramjet-service/` | Scramjet proxy sidecar (port `1337` by default) |
| `config/` | Runtime config (`palladium.env`) |
| `apps.js` | Main monolith runtime |
| `start.sh` | Start script for production/local |
| `services/` | Optional extras (e.g. monochrome) |

## Run

```bash
./start.sh
```

First run auto-creates `config/palladium.env` from `config/palladium.env.example` if missing.

## Ports

- Site/API: `3000` (`SITE_PORT`)
- Scramjet: `1337` (`SCRAMJET_PORT`)
- Ollama: `11434` (`OLLAMA_BASE_URL`)

If `SCRAMJET_PORT` is already occupied by an incompatible process, the backend automatically launches managed Scramjet on the next free port and publishes it via `/api/config/public`.

## Music (Monochrome)

- Frontend page: `/music.html`
- Config key: `MONOCHROME_BASE_URL` (default `https://monochrome.tf`)

## Notes

- Frontend HTML files are served directly from the repo root (`FRONTEND_DIR=.`).
- Static serving blocks backend/internal paths (`config/`, `discord-bots/`, `scramjet-service/`, `services/`, dotfiles).
- Game catalog API reads from `games.html` so titles/authors stay aligned with the UI.
- Discord tokens/channels are configured in `config/palladium.env`.
