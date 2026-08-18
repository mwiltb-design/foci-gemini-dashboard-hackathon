# Pi Dashboard Overview

Pi Dashboard is a local-first workspace for working with Pi through a browser UI. It packages a frontend, a backend, and optional helper services in Docker Compose while keeping project files, Pi credentials, sessions, plugin state, and dashboard settings separated.

## Primary Product Shape

The current primary build is the core Dashboard with:

- Chat
- Files and file editing
- Terminal
- Sessions
- Skills and Tools
- Workers, including Sub Pi
- Plugins
- Settings

Legacy Cron, Project Board, and Preview are intentionally not part of the primary build. Keep legacy versions as reference material for future plugin conversions.

## Main Services

- `dashboard`: serves the React frontend with Vite preview.
- `dashboard-backend`: owns authenticated API routes, Pi RPC, files, sessions, skills, tools, plugins, workers, and plugin hosted runtime requests.
- `dashboard-terminal`: optional isolated project terminal service enabled by the `terminal` Compose profile.

The backend stores private Dashboard/Pi state in the `pi-agent-data` Docker volume. The selected project folder is bind-mounted at `/workspace/project`.

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
