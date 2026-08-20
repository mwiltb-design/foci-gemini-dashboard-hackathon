# Pi Dashboard Overview

Pi Dashboard 2.0 is a modern, native desktop application (built with Electron, React, Node.js, and TypeScript) and agent execution environment for the Pi Coding Agent. It keeps project files, Pi credentials, sessions, plugin state, and dashboard settings strictly separated.

## Primary Product Shape

The desktop build includes:

- Chat (Multi-Model AI pairing with streaming diffs)
- Files and file editing (CodeMirror syntax-highlighted editor)
- Native Terminal (PowerShell / Bash pseudo-terminal via `node-pty`)
- Sessions & Session Branching
- Skills and Tools
- Sub-Agent Workers (Background coordination)
- Sandboxed Project Manager (`~/Pi-Dashboards/`)
- Plugins (Local runtime & domain custom tool suites)
- Remote Connectivity (In-app Tailscale Serve manager)
- Settings & Windows Desktop Shortcut Creator

## Main Processes

- `Electron Shell` (`electron/main.cjs`): native desktop window lifecycle and multi-instance port resolution.
- `Dashboard Backend` (`server/src/index.ts`): Node.js service managing Pi RPC, project files, sessions, skills, tools, and remote access. Bound strictly to `127.0.0.1:4317`.
- `Dashboard UI` (`ui/src/`): React + Vite frontend bound strictly to `127.0.0.1:5173`. Proxies `/api`, `/ws`, and `/plugin-assets` to the backend.

The backend stores private Dashboard state in `~/.pi-dashboard/` and provider credentials in `~/.pi/agent/`. Sandboxed user projects live in `~/Pi-Dashboards/<project>`.

## Feature Model

The backend controls visible features through `PI_DASHBOARD_PROFILE` and `PI_DASHBOARD_ADDONS`.

- Primary shared build: `PI_DASHBOARD_PROFILE=core`
- Expected add-ons: `PI_DASHBOARD_ADDONS=terminal,workers`
- Historical full workbench: `PI_DASHBOARD_PROFILE=workbench`

Disabled features should be hidden in the UI and rejected by backend routes.

## How Pi Should Use Dashboard Knowledge

Pi should not guess Dashboard architecture from memory when the user asks about Dashboard behavior. Use this `dashboard-reference` skill, then read only the relevant reference file.

For plugin work, use `dashboard-plugin-authoring` after reading the plugin overview in this skill. That skill contains the implementation contract and exact files/tests to inspect.

## Important Boundaries

- The browser never receives the Dashboard auth token.
- Mutating browser requests require an allowed origin.
- Project files live outside the private Pi state volume.
- Plugin UI enablement is separate from Pi read/write access.
- Repository plugins are reviewed by exact source state.
- Hosted plugin backends run inside the Dashboard backend process and use plugin-private storage.
- Do not copy credentials, sessions, memories, or `.env` files into source or release artifacts.
