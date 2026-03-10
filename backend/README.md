# Palladium Backend (JAR)

Requires:

- JDK 21
- Node.js (for Scramjet + Discord bot sidecars)

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
If Scramjet is already running on that host/port, the backend reuses the existing process.

By default, running the JAR also starts Discord bot sidecars from `backend/discord-bots`:

- `discord-commit-presence.js` (when `discord.commit.bot.token` is set)
- `discord-link-command-bot.js` (when `discord.link.bot.token` is set)
- `discord-community-bot.js` (when `discord.community.bot.token` is set)

Or with explicit config path:

```bash
cd backend
BACKEND_CONFIG=./config/backend.properties java -jar target/palladium-backend-1.0.0.jar
```

Set `scramjet.autostart=false` in `backend.properties` if you want to run Scramjet separately.
Set `discord.bots.autostart=false` in `backend.properties` if you want bots managed separately.

## Production Guides

- User guide: `docs/USER_PRODUCTION_GUIDE.md`
- Agent/operator guide: `docs/AGENT_PRODUCTION_OPERATIONS.md`
- Service templates: `deploy/`

Monochrome music service can be hosted alongside backend via Docker Compose.
See `deploy/README.md` for clone/start instructions and systemd integration.
