# Dashboard Troubleshooting Reference

Use this document when Dashboard behavior differs between Pi, the browser, desktop processes, or Tailscale.

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

## Plugin Backend Protocol Errors

Pi Dashboard 2.0 uses in-process hosted modules (`host-module`) for all backend and agent-connected plugins. The old Docker/socket sidecar protocol (`http-unix-v1`) is completely phased out.

All plugins with backend logic must declare:

```json
"backend": { "protocol": "host-module", "module": "server.ts" }
```

If a plugin fails validation with an invalid backend protocol, ensure its manifest uses `protocol: "host-module"` and contains a valid `server.ts` exporting a default handler object.

## Login Works Locally But Mutations Fail Remotely

Check `PI_DASHBOARD_ALLOWED_ORIGINS`. It must include the exact browser origin, including scheme and port:

```text
https://my-pc.tailnet.ts.net:8443
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
