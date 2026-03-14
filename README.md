# Palladium Backend

This folder is the backend runtime wrapper for Palladium Games.

What it runs:

- `apps.js` from the repo root
- AI APIs
- hosted game files
- proxy endpoints
- Monochrome endpoint configuration
- Discord bot sidecars

Run locally:

```bash
node backend/server.js
```

Production target:

- point `api.sethpang.com` at this backend
- keep `config/palladium.env` on the server
- host the generated `frontend/` folder separately on a static platform

Important:

- the backend remains the source of truth for `/api/*`, `/games/*`, `/health`, and `/link-check`
- the static frontend should not contain secrets, Discord tokens, or service runtime code
