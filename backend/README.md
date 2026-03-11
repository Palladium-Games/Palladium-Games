# Palladium Backend (JAR)

Requires:

- JDK 21
- Node.js (for Scramjet + Discord bot sidecars)
- Ollama (for local AI sidecar mode)

This backend is a Java JAR service for:

- `GET /health`
- `GET /api/games`
- `GET /api/games?category=fnaf`
- `GET /api/games?q=fly`
- `GET /api/categories`
- `GET /api/proxy/health`
- `GET /api/proxy/fetch?url=https://example.com`
- `POST /api/ai/chat`
- `GET /api/config/public`

The frontend is intended to be hosted separately as static files.
`/api/games` returns `path`, `image`, and `playerPath` values already aligned to frontend-relative URLs.

## Build

```bash
cd backend
mvn clean package
```

## Configure

```bash
cd backend
cp config/backend.example.properties config/backend.properties
```

Edit `config/backend.properties` for server settings and bot config values.

Important production settings:

- `cors.origin` should be your exact frontend origin, not `*`
- `security.rate.limit.*` values should stay enabled
- `proxy.block.private.network.targets=true` should stay enabled
- `security.trust.proxy.headers=true` only when traffic is behind trusted reverse proxy

## Run

```bash
cd backend
java -jar target/palladium-backend-1.0.0.jar
```

By default, running the JAR also starts the Scramjet service from `backend/scramjet-service`
on `http://127.0.0.1:1337` (health endpoint: `/health`).
If the service directory does not exist yet, the JAR auto-creates it from embedded templates.
On first run it also installs Scramjet dependencies (`npm install --omit=dev --no-audit`) unless disabled.
If Scramjet is already running on that host/port, the backend reuses the existing process.

By default, running the JAR also starts Ollama using `ollama serve` and waits for
`ollama.base.url` to become healthy. If `ollama.pull.model.on.start=true`, the backend ensures
the configured `ollama.model` is available (pulling it on first run when missing).

By default, running the JAR also starts Discord bot sidecars from `backend/discord-bots`:

- `discord-commit-presence.js` (when `discord.commit.bot.token` is set)
- `discord-link-command-bot.js` (when `discord.link.bot.token` is set)
- `discord-community-bot.js` (when `discord.community.bot.token` is set)

If `backend/discord-bots` does not exist yet, the JAR auto-creates it from embedded bot templates.

Or with explicit config path:

```bash
cd backend
BACKEND_CONFIG=./config/backend.properties java -jar target/palladium-backend-1.0.0.jar
```

Set `scramjet.autostart=false` in `backend.properties` if you want to run Scramjet separately.
Set `scramjet.install.dependencies=false` if dependencies are preinstalled.
Use `scramjet.npm.command` and `scramjet.install.timeout.seconds` to customize first-run dependency install.
Set `ollama.autostart=false` if Ollama is managed outside the backend.
Use `ollama.command`, `ollama.startup.timeout.seconds`, and `ollama.pull.*` to tune AI startup.
Set `discord.bots.autostart=false` in `backend.properties` if you want bots managed separately.

## Production Guides

- User guide: `docs/USER_PRODUCTION_GUIDE.md`
- Agent/operator guide: `docs/AGENT_PRODUCTION_OPERATIONS.md`
- Service templates: `deploy/`

Monochrome music service can be hosted alongside backend via Docker Compose.
See `deploy/README.md` for clone/start instructions and systemd integration.
