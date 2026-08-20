# Plugin Platform Reference

Use this document to orient plugin questions before implementing. For implementation, also use the `dashboard-plugin-authoring` skill.

## Plugin Types

### Static Repository Plugin

Use for browser-only features such as visual tools, calculators, games, dashboards, or simple embedded views.

Required files:

```text
plugin.json
index.html
optional local CSS/JS/assets
```

Static repository plugins:

- are installed from a reviewed exact Git commit or `workspace:` path;
- cannot declare backend runtime, Pi tools, Pi skills, or plugin data permissions;
- should not require `npm install`, build scripts, remote scripts, credentials, symlinks, or generated dependency folders;
- run in a sandboxed iframe and communicate only with the host mechanisms allowed by the platform.

### Hosted Plugin

Use for trusted plugins that need server logic, durable plugin-owned data, or Pi tools. A hosted plugin declares:

```json
"entry": {
  "frontend": "index.html",
  "backend": { "protocol": "host-module", "module": "server.ts" }
}
```

Hosted modules run inside the Dashboard backend host, not in a separate sidecar container. They receive a bounded request object and a `PluginHostContext` with plugin-private storage and response helpers.

Use hosted plugins for new first-party plugins that need data or Pi access. Do not add a special Compose service unless there is a clear runtime requirement that the hosted module cannot satisfy.

## Shared Notes Pattern

Shared Notes is the reference hosted plugin:

- manifest: `plugins/notes/plugin.json`
- UI: `plugins/notes/index.html`
- UI bridge: `plugins/notes/app.js`
- hosted backend: `plugins/notes/server.ts`
- host runtime: `server/src/plugin-host.ts`

Its browser UI sends runtime requests through the parent Dashboard iframe bridge. Its backend stores data in plugin-private JSON storage. Pi tools use `/agent/*` routes and require explicit read/write grants.

## Pi Access Model

Plugin enablement and Pi access are separate.

- Enabling a plugin makes the plugin UI/runtime available.
- Pi read access exposes read-only plugin tools/skills.
- Pi write access exposes mutation tools.
- Write tools must create, update, delete, send, or otherwise affect state only when the user has granted write access.

Every Pi-facing tool must have:

- a narrow name;
- an honest `read` or `write` classification;
- a bounded parameter schema;
- a route beginning with `/agent/`.

## Browser Security Rules

Plugin iframes use:

```text
sandbox="allow-scripts allow-forms"
```

Plugin asset responses also send a CSP sandbox:

```text
sandbox allow-scripts allow-forms
```

Both places must allow forms because many plugin UIs use normal HTML forms while still handling submission through JavaScript. If browser-created plugin actions fail with a sandbox form error, inspect `server/src/plugin-asset-policy.ts` and `app/src/components/PluginBrowser.tsx`.

## Files To Inspect For Plugin Work

Always start with:

- `packages/plugin-sdk/src/index.ts`
- `packages/plugin-sdk/README.md`
- `server/skills/dashboard-plugin-authoring/references/contract.md`

For hosted plugin work, inspect:

- `server/src/plugin-host.ts`
- `server/src/plugin-service.ts`
- `server/extensions/dashboard-plugin-tools.ts`
- `plugins/notes/plugin.json`
- `plugins/notes/server.ts`
- `plugins/notes/app.js`
- `server/test/plugin-host.test.ts`
- `server/test/shared-notes-migration.test.ts`
- `server/test/plugin-service.test.ts`
- `server/test/dashboard-plugin-tools.test.ts`

## Acceptance Checks

For plugin platform changes, prefer focused tests first:

```powershell
cd server
npm test
```

Run `npm run build` from the workspace root to verify full TypeScript and Vite compilation.
