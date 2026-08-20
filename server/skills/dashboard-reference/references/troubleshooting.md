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

Check `DASHBOARD_ALLOWED_HOSTS` for the Tailscale hostname or configure it directly in the **Settings** tab.

## Remote Access Not Responding
1. Confirm the dashboard is running on your host computer (it must remain open for remote devices to connect).
2. Check if Tailscale Serve background proxy is active:
   ```powershell
   tailscale serve status
   ```
3. If disconnected or reset, run the copyable command from the Settings tab:
   ```powershell
   tailscale serve --bg --https=8443 http://127.0.0.1:5173
   ```

## Terminal Or Workers Missing

Verify that the features are enabled in your dashboard profile or settings. Then inspect `/api/config`. The expected primary feature list includes:

```text
chat, files, files-editor, sessions, skills, settings, plugins, terminal, workers
```

## Verification Pattern

When debugging:

1. Confirm the active UI port (`5173`) and Backend port (`4317`).
2. Verify auth status via `/api/auth/status` or the Settings tab.
3. Verify backend activity logs in the Activity / Diagnostics panel.
4. Verify the exact response headers involved.
6. Reproduce through the API before blaming the plugin UI.
