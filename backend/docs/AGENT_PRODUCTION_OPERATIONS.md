# Palladium Production Agent Operations Guide

## Scope

This guide is for maintainers/agents operating Palladium backend in production.

## Startup Flow

1. `PalladiumBackendApplication` loads config.
2. `ScramjetProcessManager` starts Scramjet sidecar unless disabled.
3. `DiscordBotProcessManager` starts configured Discord bot scripts unless disabled.
4. If Scramjet already listens on configured host/port, backend reuses it.
5. HTTP server starts on configured backend host/port.

## Safety Controls

- Rate limiting:
  - `security.rate.limit.enabled`
  - `security.rate.limit.window.seconds`
  - `security.rate.limit.proxy.requests`
  - `security.rate.limit.ai.requests`
- Proxy target hardening:
  - `proxy.block.private.network.targets=true` blocks localhost/private-address fetch targets
- AI request body cap:
  - `ai.max.request.body.bytes`

## Reverse Proxy Notes

- Set `security.trust.proxy.headers=true` only if `X-Forwarded-For` is injected by trusted edge.
- Keep backend and Scramjet bound to private interfaces where possible.
- Route Monochrome on separate host/domain (example `music.example.com -> 127.0.0.1:3000`).

## Incident Response

1. Check service status and logs:
   - `systemctl status palladium-backend`
   - `journalctl -u palladium-backend -f`
2. Verify internal health:
   - `curl http://127.0.0.1:8080/health`
   - `curl http://127.0.0.1:1337/health`
   - `curl http://127.0.0.1:3000/health` (Monochrome)
3. If overload suspected:
   - tighten rate limits in config
   - restart service after changes

## Regression Gates

- Always run:
  - `mvn test`
  - `mvn package`
- Do not deploy if either command fails.
