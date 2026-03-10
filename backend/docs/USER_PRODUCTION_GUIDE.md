# Palladium Production User Guide

## What This Deploys

- Java backend API on `127.0.0.1:8080`
- Scramjet proxy sidecar on `127.0.0.1:1337` (auto-started by JAR)
- Discord bot sidecars from `backend/discord-bots` (auto-started by JAR when tokens are configured)
- TLS/public access handled by reverse proxy (recommended nginx)

## Checklist

1. Build backend:

```bash
cd backend
mvn clean package
```

2. Configure backend:

```bash
cp config/backend.example.properties config/backend.properties
```

3. Edit `config/backend.properties`:

- Set `cors.origin` to your frontend domain
- Keep `proxy.block.private.network.targets=true`
- Keep `security.rate.limit.enabled=true`
- Set Discord tokens/channel IDs

4. Run backend:

```bash
BACKEND_CONFIG=./config/backend.properties java -jar target/palladium-backend-1.0.0.jar
```

5. Verify:

- `GET /health` returns `ok:true`
- `GET /api/proxy/health` returns `ok:true`
- Scramjet health: `http://127.0.0.1:1337/health`

## Recommended Production Topology

- Frontend hosted on static platform (Netlify/Vercel/etc.)
- API and browse domains behind nginx:
  - `api.example.com -> 127.0.0.1:8080`
  - `browse.example.com -> 127.0.0.1:1337`
  - `music.example.com -> 127.0.0.1:3000` (Monochrome)

See `backend/deploy/nginx/palladium.conf` and `backend/deploy/systemd/`.

## Monochrome Bring-Up

```bash
mkdir -p /opt/palladium/services
cd /opt/palladium/services
git clone https://github.com/monochrome-music/monochrome.git
cd monochrome
docker compose up -d
```

If Docker is not installed, install Docker Engine + Compose plugin first.
