# Palladium Backend (JAR)

Requires JDK 21.

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

Edit `config/backend.properties` for server settings and Discord bot config values.

## Run

```bash
cd backend
java -jar target/palladium-backend-1.0.0.jar
```

Or with explicit config path:

```bash
cd backend
BACKEND_CONFIG=./config/backend.properties java -jar target/palladium-backend-1.0.0.jar
```
