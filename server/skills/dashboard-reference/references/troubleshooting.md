# Dashboard Troubleshooting Reference

Use this document when Dashboard behavior differs between Pi, the browser, Docker, or Tailscale.

## Shared Notes Loads But Manual Add Fails

If Pi can add a note but the browser cannot, Shared Notes storage and tools are probably working. Check browser iframe and CSP policy.

Known error:

```text
Blocked form submission to '' because the form's frame is sandboxed and the 'allow-forms' permission is not set.
```

Inspect:

- `app/src/components/PluginBrowser.tsx`
- `server/src/plugin-asset-policy.ts`

Both must allow forms:

```text
allow-scripts allow-forms
```

Also verify the live plugin asset response header contains:

```text
content-security-policy: sandbox allow-scripts allow-forms
```

## Start The Matching Plugin Service Before Enabling This Plugin

That error belongs to the old sidecar-service plugin model. New hosted plugins should use:

```json
"backend": { "protocol": "host-module", "module": "server.ts" }
```

If the plugin still declares `http-unix-v1`, it expects a matching sidecar service and Compose socket. For new first-party plugin work, prefer hosted modules unless isolation requirements justify a sidecar.

## Login Works Locally But Mutations Fail Remotely

Check `PI_DASHBOARD_ALLOWED_ORIGINS`. It must include the exact browser origin, including scheme and port:

```text
https://mj-dell.tailcd1616.ts.net:8443
```

Check `DASHBOARD_ALLOWED_HOSTS` for the Tailscale hostname.

## Browser Shows Old Behavior After Rebuild

Check whether the running container was actually recreated:

```powershell
docker compose ps --all
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}"
```

Check the live page or headers rather than assuming the local source is what the browser sees.

## Terminal Or Workers Missing

Verify:

```text
PI_DASHBOARD_ADDONS=terminal,workers
COMPOSE_PROFILES=terminal
```

Then inspect `/api/config`. The expected primary feature list includes:

```text
chat, files, files-editor, sessions, skills, settings, plugins, terminal, workers
```

## Windows Limitation Warnings

Docker Desktop bind mounts may appear with Linux UID/GID values that do not map cleanly to Windows accounts. That does not grant Windows administrator access. Terminal is still isolated to the mounted project path and has no Docker socket, Pi state, provider keys, or broad host mounts.

## Verification Pattern

When debugging:

1. Confirm the URL and local port.
2. Confirm the Compose project and image.
3. Verify auth and `/api/config`.
4. Verify backend logs.
5. Verify the exact response headers involved.
6. Reproduce through the API before blaming the plugin UI.
