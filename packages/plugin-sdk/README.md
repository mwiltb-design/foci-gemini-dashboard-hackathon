# Pi Dashboard Plugin SDK v1

This package provides the versioned manifest schema, types, path validation, and message protocols shared across the Dashboard host, plugin authors, and test suites.

## Supported Manifest Shapes

The SDK validates both **Static (Frontend-Only)** and **Hosted (Backend & Agent-Connected)** plugin manifests.

### 1. Static Plugin Manifest
For browser-only tools, visualizers, games, or calculators:

```json
{
  "schemaVersion": 1,
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "dashboardVersion": ">=0.9.0-beta.1 <2.0.0",
  "description": "A standalone browser plugin",
  "entry": {
    "frontend": "index.html"
  },
  "navigation": {
    "label": "Example",
    "icon": "◇"
  },
  "permissions": []
}
```

### 2. Hosted Agent-Connected Manifest
For plugins that provide persistent data, server logic, or Pi agent tools and skills:

```json
{
  "schemaVersion": 1,
  "id": "todo-tracker",
  "name": "To-Do Tracker",
  "version": "1.0.0",
  "dashboardVersion": ">=0.9.0-beta.1 <2.0.0",
  "description": "Manage tasks with UI and Pi assistant access",
  "entry": {
    "frontend": "index.html",
    "backend": {
      "protocol": "host-module",
      "module": "server.ts"
    }
  },
  "agent": {
    "skills": [
      {
        "name": "todo-guide",
        "description": "Explains how to use the todo tracker tools",
        "path": "skills/todo-guide"
      }
    ],
    "tools": [
      {
        "name": "list_tasks",
        "label": "List tasks",
        "description": "List all active tasks",
        "access": "read",
        "method": "GET",
        "path": "/agent/tasks",
        "parameters": {
          "type": "object",
          "properties": {},
          "additionalProperties": false
        }
      }
    ]
  },
  "navigation": {
    "label": "To-Do",
    "icon": "✓"
  },
  "permissions": [
    "plugin-data:read",
    "plugin-data:write"
  ]
}
```

## Manifest Specification

- **`schemaVersion`**: Must be `1`.
- **`id`**: Lowercase alphanumeric string with hyphens (`^[a-z][a-z0-9-]{1,47}$`).
- **`version`**: Semantic version string (e.g. `1.0.0`).
- **`dashboardVersion`**: Semantic version range string (e.g. `>=0.9.0-beta.1 <2.0.0`). Required for repository review.
- **`entry.frontend`**: Relative path to the entry HTML file (e.g. `index.html`).
- **`entry.backend`**:
  - `protocol`: `"host-module"` (In-process handler executed via `PluginHost`).
  - `module`: Relative path to server script (e.g. `server.ts` or `server.js`).
- **`agent.tools`**: Array of 1–24 tool declarations. Paths must start with `/agent/`. Each tool requires an explicit `access` classification (`"read"` or `"write"`).
- **`agent.skills`**: Array of skill declarations pointing to directories with a `SKILL.md` file.
- **`permissions`**: Supported permissions:
  - `plugin-data:read`: Read from plugin-private storage.
  - `plugin-data:write`: Write to plugin-private storage.
  - `dashboard-theme:read`: Read current dashboard theme.
  - `dashboard-notifications:write`: Send dashboard notifications.

## Frontend to Host PostMessage Bridge

Frontend iframes communicate with their backend runtime by posting messages to the parent Dashboard:

```javascript
// Request to backend host-module:
parent.postMessage({
  schemaVersion: 1,
  pluginId: 'todo-tracker',
  type: 'runtime-request',
  requestId: crypto.randomUUID(),
  method: 'GET',
  path: '/api/tasks',
}, '*')

// Host responds with:
// { schemaVersion: 1, pluginId: 'todo-tracker', type: 'runtime-response', requestId, status: 200, body: [...] }
```

## Repository Installation & Lifecycle

Repository plugins are reviewed from a pinned Git commit and verified with a SHA256 digest:
- Supported repository formats: `workspace:plugins/<id>`, `local:<id>`, or `https://github.com/<owner>/<repo>`.
- Installed to `~/.pi/agent/dashboard/plugins/installed/<id>`.
- One previous version is retained in `backups/code/` for instant rollback.
- Data is isolated under `~/.pi/agent/dashboard/plugins/data/<id>`.
- Removing a plugin allows choosing between retaining or permanently deleting its stored data.

