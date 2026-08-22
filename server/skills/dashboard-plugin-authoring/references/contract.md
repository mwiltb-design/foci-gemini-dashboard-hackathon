# Pi Dashboard Plugin Authoring Contract

This reference is the authoritative implementation map for all Dashboard plugin development.

## 1. Supported Package Type Matrix

| Category | Typical Use Cases | Location | Manifest Backend | Manifest Agent Tools & Skills | Permissions | Source Identifier / Installation | Restart Required |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Static Workspace Plugin** | Calculators, reference cards, visualizers, browser games | Workspace: `plugins/<id>/` | None | None | `[]` | `workspace:plugins/<id>` (Plugins page review) | **None** |
| **Hosted Agent-Connected Workspace Plugin** | Project task lists, custom logs, databases, tools Pi can query or mutate | Workspace: `plugins/<id>/` | `protocol: "host-module"`, `module: "server.ts"` | Supported (`/agent/*` tools, `skills/`) | `plugin-data:read`, `plugin-data:write` | `workspace:plugins/<id>` (Plugins page review) | **None** |
| **Local Machine Plugin** | Private developer plugins stored across projects | `~/.pi/agent/plugins/<id>/` | Optional `host-module` | Optional `/agent/*` | Supported | `local:<id>` (Plugins page review) | **None** |
| **Bundled First-Party Plugin** | Core plugins shipped with Dashboard (e.g. `notes`) | Dashboard: `plugins/<id>/` | `protocol: "host-module"` | Supported | Supported | Auto-discovered at Dashboard startup | Server restart on file change |

---

## 2. Decision Rule

- **Testing or building for the active project?** → Create a standalone Git repository in the active workspace at `plugins/<plugin-id>`. Provide `workspace:plugins/<plugin-id>` for installation via the Plugins page.
- **Creating a first-party feature for the Dashboard repository?** → Place directly in the Dashboard codebase `plugins/<plugin-id>`.

---

## 3. Routed Files

Always inspect:
- `packages/plugin-sdk/src/index.ts` (Manifest types and validation)
- `packages/plugin-sdk/README.md` (SDK contract)

For hosted or agent-connected plugins, inspect:
- `plugins/notes/plugin.json` (Reference manifest)
- `plugins/notes/server.ts` (Reference host-module backend)
- `plugins/notes/app.js` (Reference frontend postMessage client)
- `server/src/plugin-host.ts` (Backend module runtime & storage)
- `server/src/plugin-service.ts` (Review, installation, and lifecycle)
- `server/extensions/dashboard-plugin-tools.ts` (Pi dynamic tool registration)

For UI interactions:
- `ui/src/components/PluginManager.tsx`
- `ui/src/components/PluginBrowser.tsx`

---

## 4. End-to-End Plugin Examples

### Example A: Static Workspace Plugin

**Folder structure:**
```text
<workspace>/plugins/quick-calc/
├── plugin.json
├── index.html
└── styles.css
```

**`plugin.json`:**
```json
{
  "schemaVersion": 1,
  "id": "quick-calc",
  "name": "Quick Calculator",
  "version": "1.0.0",
  "description": "Simple browser-based developer calculator.",
  "dashboardVersion": ">=0.9.0-beta.1 <2.0.0",
  "entry": {
    "frontend": "index.html"
  },
  "navigation": {
    "label": "Calculator",
    "icon": "🧮"
  },
  "permissions": []
}
```

**Setup & Installation:**
```bash
cd plugins/quick-calc
git init
git add -A
git commit -m "feat: initial calculator plugin"
```
Install in Dashboard: **Plugins** → **Add plugin** → Enter `workspace:plugins/quick-calc` → **Review repository** → **Install plugin**.

---

### Example B: Hosted Agent-Connected Workspace Plugin

**Folder structure:**
```text
<workspace>/plugins/project-todo/
├── plugin.json
├── index.html
├── app.js
├── server.ts
└── skills/
    └── project-todo-guide/
        └── SKILL.md
```

**`plugin.json`:**
```json
{
  "schemaVersion": 1,
  "id": "project-todo",
  "name": "Project To-Do",
  "version": "1.0.0",
  "description": "Manage project tasks with UI and Pi assistant access.",
  "dashboardVersion": ">=0.9.0-beta.1 <2.0.0",
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
        "name": "project-todo-guide",
        "description": "Instructions on how to manage project tasks via Project To-Do.",
        "path": "skills/project-todo-guide"
      }
    ],
    "tools": [
      {
        "name": "list_tasks",
        "label": "List tasks",
        "description": "List all current project tasks.",
        "access": "read",
        "method": "GET",
        "path": "/agent/tasks",
        "parameters": {
          "type": "object",
          "properties": {},
          "additionalProperties": false
        }
      },
      {
        "name": "add_task",
        "label": "Add a task",
        "description": "Add a new task to the project list.",
        "access": "write",
        "method": "POST",
        "path": "/agent/tasks",
        "parameters": {
          "type": "object",
          "properties": {
            "title": {
              "type": "string",
              "description": "Task description, up to 120 characters."
            }
          },
          "required": ["title"],
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

**`server.ts`:**
```typescript
interface Task {
  id: string
  title: string
  completed: boolean
}

export default {
  async handle(request: any, context: any) {
    // 1. UI route: GET /api/tasks
    if (request.method === 'GET' && request.path === '/api/tasks') {
      const tasks = await context.storage.readJson('tasks.json', [])
      return context.json(tasks)
    }

    // 2. Pi read tool route: GET /agent/tasks
    if (request.method === 'GET' && request.path === '/agent/tasks') {
      const tasks = await context.storage.readJson('tasks.json', [])
      return context.json({ tasks })
    }

    // 3. Pi write tool route: POST /agent/tasks
    if (request.method === 'POST' && request.path === '/agent/tasks') {
      const body = request.json()
      const title = String(body.title || '').trim()
      if (!title) return context.json({ error: 'Title is required' }, 400)

      const task: Task = { id: `task-${Date.now()}`, title, completed: false }
      await context.storage.transaction(async (tx: any) => {
        const list = await tx.readJson('tasks.json', [])
        list.push(task)
        await tx.writeJson('tasks.json', list)
      })
      return context.json({ success: true, task })
    }

    return context.json({ error: 'Not found' }, 404)
  }
}
```

**`app.js` (Frontend PostMessage Bridge):**
```javascript
async function requestRuntime(method, path, body) {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    function onMessage(event) {
      if (event.data?.type === 'runtime-response' && event.data?.requestId === requestId) {
        window.removeEventListener('message', onMessage)
        if (event.data.status >= 200 && event.data.status < 300) resolve(event.data.body)
        else reject(new Error(event.data.body?.error || `Status ${event.data.status}`))
      }
    }
    window.addEventListener('message', onMessage)
    parent.postMessage({
      schemaVersion: 1,
      pluginId: 'project-todo',
      type: 'runtime-request',
      requestId,
      method,
      path,
      body,
    }, '*')
  })
}
```

**`skills/project-todo-guide/SKILL.md`:**
```markdown
---
name: project-todo-guide
description: Guide for reading and adding tasks using the Project To-Do plugin.
---

# Project To-Do Guide

Use `plugin_project_todo_list_tasks` to check existing tasks.
Use `plugin_project_todo_add_task` to add a new task when requested by the user.
```

**Setup & Installation:**
```bash
cd plugins/project-todo
git init
git add -A
git commit -m "feat: initial project-todo plugin"
```
Install in Dashboard:
1. **Plugins** → **Add plugin** → Enter `workspace:plugins/project-todo` → **Review repository** → **Install plugin**.
2. Click **Enable** on the plugin card.
3. Under **Pi Access**, click **Grant read access** and **Grant write access** to allow Pi to execute the to-do tools.
4. **No Dashboard rebuild or restart is required!**

---

### Example C: Bundled First-Party Hosted Plugin
For plugins distributed with the Dashboard codebase itself:
- Located directly in `plugins/<plugin-id>/` (e.g. `plugins/notes/`).
- Discovered automatically when the Dashboard backend boots.
- Does not need git repository initialization inside the plugin directory.

---

## 5. Security & Isolation Constraints

- **Iframe Sandbox:** Ran with `sandbox="allow-scripts allow-forms"`. Direct DOM access to parent Dashboard or cookie access is denied.
- **Storage Isolation:** Host storage is strictly namespaced under `~/.pi/agent/dashboard/plugins/data/<plugin-id>`. Path traversal (`..`) is blocked.
- **Tool Protocol:** Pi tools must use `/agent/*` route prefixes. Parameter schemas must be explicit JSON Schema objects.
- **Decoupled Permissions:** Enabling a plugin does **not** grant Pi tools access. Users must explicitly grant Pi **Read** and **Write** permissions in the UI.

---

## 6. Acceptance Checks

Before handing off a plugin:
1. **Static Validation:** Validate `plugin.json` format, required fields, and relative paths.
2. **Git Status:** In repository plugins, ensure all files are committed (`git status` is clean).
3. **Review & Installation:** Test review and install via **Plugins** page (`workspace:plugins/<id>`). Verify SHA256 digest is generated.
4. **Enable & Runtime:** Enable the plugin and confirm UI loads cleanly.
5. **Agent Tools Test:** If agent tools are present, verify in chat:
   - Tools are inactive when grants are disabled.
   - Read tools function when Read grant is enabled.
   - Write tools function when Write grant is enabled.
6. **Workspace Build:** Run `npm run build` from the workspace root to confirm TypeScript compiles cleanly.
