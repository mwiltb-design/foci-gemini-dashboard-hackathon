# Dashboard Operations Reference

Use this document for install, update, Docker, port, Tailscale, and backup questions.

## Local Compose Shape

Dashboard is started with Docker Compose from the project root. The primary services are:

- `dashboard`
- `dashboard-backend`
- `dashboard-terminal` when `COMPOSE_PROFILES=terminal`

The primary shared configuration is:

```text
PI_DASHBOARD_PROFILE=core
PI_DASHBOARD_ADDONS=terminal,workers
COMPOSE_PROFILES=terminal
```

## Ports

Common local ports in this workspace:

- root untouched dashboard: `127.0.0.1:5173`
- `:8443` Tailscale dashboard target: `127.0.0.1:5181`
- clean 2.0 test dashboard: `127.0.0.1:5191`

Tailscale Serve can map:

```text
https://<machine>.<tailnet>.ts.net:8443 -> http://127.0.0.1:5181
```

When exposing through Tailscale, include the exact HTTPS origin in `PI_DASHBOARD_ALLOWED_ORIGINS` and the hostname in `DASHBOARD_ALLOWED_HOSTS`.

## Auth

`PI_DASHBOARD_AUTH_TOKEN` enables Dashboard login. It should live in `.env` or the host environment, not in source. The browser receives an HttpOnly session cookie after login; it should not receive or display the token except on the local login screen.

If mutating requests fail from a Tailscale URL but reads work, check allowed origins. `GET` requests may succeed while `POST`, `PATCH`, or `DELETE` fail.

## Backup And State

Dashboard source/image artifacts must not contain:

- `.env`
- provider credentials
- auth tokens
- Pi sessions
- memories
- plugin data
- activity logs
- private project files

Private state lives in Docker volumes, especially the `pi-agent-data` volume for the Compose project.

## Updating A Running Stack

To replace a stack while keeping its external route:

1. Confirm the Compose project name and local ports with `docker ps` and `docker inspect`.
2. Build or select the intended image.
3. Recreate the same Compose project with the same ports, token, allowed origins, and project bind mount.
4. Use `--remove-orphans` only when intentionally removing old sidecar services.
5. Verify `/api/config`, plugin headers, and a simple plugin runtime request.

Do not change the root/pinned dashboard unless the user explicitly asks.

## Release Tags

Use lowercase semver prerelease tags:

```text
v0.9.1-beta.1
```

Before tagging, ensure the Git worktree contains the same source as the image that was tested.
