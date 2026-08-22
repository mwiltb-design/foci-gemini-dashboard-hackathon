# Plugin Platform Reference

Use this document to orient plugin questions before implementing. For implementation, also use the `dashboard-plugin-authoring` skill.

## Supported Plugin Matrix

Pi Dashboard supports four plugin variations based on distribution (Bundled vs Repository-Installed) and capability (Static UI vs Hosted Backend with Pi Access):

| Plugin Type | Source Location | Manifest Backend (`entry.backend`) | Agent Tools & Skills (`agent`) | Permissions | Installation Procedure | Dashboard Restart / Rebuild |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Bundled Static** | Dashboard repo `plugins/<id>/` | None | None | `[]` | Auto-discovered at startup | Requires server start/restart |
| **Bundled Hosted** | Dashboard repo `plugins/<id>/` | `protocol: "host-module"` | Supported (`/agent/*` tools, `skills/`) | Supported (`plugin-data:*`, `dashboard-*`) | Auto-discovered at startup | Requires server start/restart |
| **Repository Static** | Standalone Git repo (`workspace:`, `local:`, GitHub) | None | None | `[]` | Plugins page: Review commit & Install | **None** (instant runtime install) |
| **Repository Hosted** | Standalone Git repo (`workspace:`, `local:`, GitHub) | `protocol: "host-module"` | Supported (`/agent/*` tools, `skills/`) | Supported (`plugin-data:*`, `dashboard-*`) | Plugins page: Review commit & Install | **None** (instant runtime install) |

> [!NOTE]
> Pi Dashboard 2.0 uses the in-process `host-module` runtime for all backend and agent-connected plugins. The legacy `http-unix-v1` socket sidecar protocol has been completely removed.

## Repository Source Formats

When installing or reviewing a repository plugin through **Plugins → Add plugin**, three source formats are supported:

1. **Workspace Repository (`workspace:plugins/<plugin-id>`)**:
   - Resolved relative to the active project workspace root (`PI_DASHBOARD_WORKSPACE`).
   - Must be an initialized Git repository with committed files (`git init && git add -A && git commit`).
   - Strict path boundary containment is enforced (paths escaping with `..` are blocked).
2. **Local Repository (`local:<plugin-id>`)**:
   - Resolved against the user's local plugins directory (`~/.pi/agent/plugins/<plugin-id>`) or fallback bundled root.
   - Must be a valid Git repository with committed files.
3. **Public GitHub Repository (`https://github.com/<owner>/<repo>`)**:
   - Cloned on demand at a shallow depth for exact-commit review and SHA256 digest pinning.

## Hosted Backend (`host-module`) Architecture

Hosted plugins run inside the Dashboard backend process via `PluginHost` (`server/src/plugin-host.ts`), providing persistent storage and API endpoints without external sidecar processes.

A hosted plugin declares:

```json
"entry": {
  "frontend": "index.html",
  "backend": { "protocol": "host-module", "module": "server.ts" }
}
```

The backend module (`server.ts`) exports a default object with a `handle(request, context)` method:

```typescript
export default {
  async handle(request: PluginHostRequest, context: PluginHostContext) {
    if (request.method === 'GET' && request.path === '/api/items') {
      const items = await context.storage.readJson('items.json', [])
      return context.json(items)
    }
    if (request.method === 'POST' && request.path === '/agent/items') {
      const body = request.json<{ text: string }>()
      // Handle Pi agent write tool...
      return context.json({ success: true })
    }
  }
}
```

### Context Services (`PluginHostContext`):
- `context.storage`: Plugin-private atomic JSON/text file storage (`readJson`, `writeJson`, `readText`, `writeText`, `transaction`).
- `context.json(data, status?)`: Helper to return standard JSON responses.
- `context.text(data, status?)`: Helper to return text responses.

## Shared Notes Reference Pattern

`plugins/notes/` serves as the reference implementation for hosted agent-connected plugins:

- Manifest: `plugins/notes/plugin.json`
- Frontend UI: `plugins/notes/index.html`
- PostMessage Bridge Client: `plugins/notes/app.js`
- Hosted Backend Module: `plugins/notes/server.ts`
- Host Runtime: `server/src/plugin-host.ts`

The frontend communicates with its backend by posting `runtime-request` messages to the parent window, and receives `runtime-response` messages.

## Pi Agent Access Model

Plugin enablement and Pi access are strictly decoupled:

1. **Plugin Enablement**: Toggling a plugin ON makes the frontend UI and backend routes available.
2. **Pi Read Access**: Explicit user grant required in the Plugins UI. Exposes read-only `/agent/*` tools and read-dependent skills to Pi.
3. **Pi Write Access**: Explicit user grant required in the Plugins UI. Exposes mutation tools (`POST`, `PUT`, `DELETE`, etc.) to Pi.

Every Pi tool must declare:
- A unique lowercase name (`^[a-z][a-z0-9_]{1,39}$`).
- An honest `read` or `write` access classification.
- A path beginning with `/agent/*`.
- A valid JSON Schema object describing its parameters with `additionalProperties: false`.

## Browser Sandbox & Security Rules

Plugin iframes run with strict sandbox protection:
```html
sandbox="allow-scripts allow-forms"
```
Asset responses are served with a per-plugin capability token and restrictive Content Security Policy (`CSP`). Form submission is permitted to support standard UI forms, with network containment enforced.

If plugin interactions fail with sandbox or iframe errors, inspect `server/src/plugin-service.ts` and `ui/src/components/PluginBrowser.tsx`.

## Key Files to Inspect

- Manifest specification and validators: `packages/plugin-sdk/src/index.ts`
- Authoring rules and contract: `server/skills/dashboard-plugin-authoring/references/contract.md`
- Backend host runtime: `server/src/plugin-host.ts`
- Plugin discovery, review, and lifecycle: `server/src/plugin-service.ts`
- Agent tool injection and execution: `server/extensions/dashboard-plugin-tools.ts`
- Reference hosted plugin: `plugins/notes/`

## Verification & Acceptance

1. Verify TypeScript types and build: `npm run build` from the workspace root.
2. Test installation, upgrade, rollback, and removal through the Dashboard Plugins UI.
3. Verify tool availability and access restrictions with Pi chat when read/write grants are toggled.
