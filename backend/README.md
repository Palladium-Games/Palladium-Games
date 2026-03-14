# Palladium Backend

This folder is the backend runtime for Palladium Games.

What it runs:

- `apps.js` in this folder
- AI APIs
- hosted game files
- hosted game thumbnails from `backend/images/game-img`
- proxy endpoints
- Monochrome endpoint configuration
- Discord bot sidecars

Run locally:

```bash
cd backend
./start.sh
```

Production target:

- point `api.sethpang.com` at this backend
- keep `backend/config/palladium.env` on the server
- host the `../frontend/` folder separately on a static platform

Important:

- the backend remains the source of truth for `/api/*`, `/games/*`, `/health`, and `/link-check`
- the static frontend should not contain secrets, Discord tokens, or service runtime code
