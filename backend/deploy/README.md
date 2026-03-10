# Palladium Production Deployment

This folder contains production deployment templates for:

- `systemd` service management
- `nginx` reverse proxy + TLS termination
- Monochrome Docker Compose service integration

## Files

- `systemd/palladium-backend.service`
- `systemd/palladium-backend.env.example`
- `systemd/monochrome.service`
- `nginx/palladium.conf`

## Quick Start

1. Build the JAR:

```bash
cd backend
mvn clean package
```

2. Copy backend config:

```bash
cp backend/config/backend.example.properties backend/config/backend.properties
```

3. Install `systemd` templates:

```bash
sudo cp backend/deploy/systemd/palladium-backend.service /etc/systemd/system/
sudo cp backend/deploy/systemd/palladium-backend.env.example /etc/palladium/palladium-backend.env
sudo mkdir -p /etc/palladium
```

4. Edit `/etc/palladium/palladium-backend.env` and set:

- `PALLADIUM_WORKDIR`
- `BACKEND_CONFIG`
- `JAVA_HOME` (Java 21)

5. Enable and start service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable palladium-backend
sudo systemctl start palladium-backend
sudo systemctl status palladium-backend
```

6. Install nginx config and set your domain/cert paths:

```bash
sudo cp backend/deploy/nginx/palladium.conf /etc/nginx/sites-available/palladium.conf
sudo ln -s /etc/nginx/sites-available/palladium.conf /etc/nginx/sites-enabled/palladium.conf
sudo nginx -t
sudo systemctl reload nginx
```

## Monochrome Hosting

1. Clone service code:

```bash
mkdir -p /opt/palladium/services
cd /opt/palladium/services
git clone https://github.com/monochrome-music/monochrome.git
```

2. Start Monochrome:

```bash
cd /opt/palladium/services/monochrome
docker compose up -d
```

3. Optional: manage Monochrome with `systemd`:

```bash
sudo cp backend/deploy/systemd/monochrome.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable monochrome
sudo systemctl start monochrome
```

Monochrome default host port is `3000` (from its compose file).
