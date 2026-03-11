# Palladium Games

Palladium now runs as a single Node monolith:

- serves the static frontend
- exposes API routes (`/api/games`, `/api/ai/chat`, `/api/proxy/fetch`, `/link-check`)
- manages sidecars (Scramjet proxy, Ollama, Discord bots)

## Repo Layout

| Path | Purpose |
|------|--------|
| `frontend/` | All website HTML/CSS/JS and static assets |
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

## Notes

- Frontend HTML files are unchanged and served directly from `frontend/`.
- Game catalog API reads from `frontend/games.html` so titles/authors stay aligned with the UI.
- Discord tokens/channels are configured in `config/palladium.env`.
