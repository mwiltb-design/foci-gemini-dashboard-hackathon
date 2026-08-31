# Foci / Pi Dashboard Overview

Foci Dashboard 2.0 is an autonomous, multi-agent AI collaboration platform and engineering workspace available in two deployment modes:
1. **Google Cloud Run (Hosted Cloud Studio):** Fully containerized, serverless cloud workspace with persistent Google Cloud Storage (`/data`), Python 3.11 geospatial compute stack, and Lead Gemini ⇄ Worker autonomous delegation.
2. **Native Desktop Application:** Local Electron + Node.js + React desktop app running directly on your workstation with local pseudo-terminal and optional Tailscale Serve remote connectivity.

## Primary Product Shape

The desktop build includes:

- **Chat**: Multi-Model AI pairing with streaming diffs (Claude, GPT, Gemini, Ollama, OpenRouter).
- **Files & Editor**: In-browser CodeMirror syntax-highlighted editor with line numbers and live saving.
- **Native Terminal**: PowerShell / Bash pseudo-terminal via `node-pty`.
- **App Previewer**: Live web app & HTML responsive iframe preview canvas with Desktop, Tablet, and Mobile viewports.
- **Sessions**: Complete session history, compaction, and branching.
- **Skills & Tools**: Extensible agent capabilities and documentations.
- **Autonomous Workers**: Background delegation suite (**Sub-PI**, **Google Antigravity CLI**, **OpenAI Codex CLI**, and **Anthropic Claude CLI**) with 2-level markdown routing rules (`WORKERS.md` and `rules/*.md`).
- **Sandboxed Project Manager**: Sandboxed workspaces under `~/Pi-Dashboards/`.
- **Plugins**: Local runtime & custom tool suites (Developer, Business, Research).
- **Remote Connectivity**: In-app Tailscale Serve manager.
- **Settings & Experience Stacks**: One-click presets (**`★ User / Basic`**, **`⚡ Developer`**, and **`🏢 Business`**) with granular feature checkboxes.

## Main Processes

- `Electron Shell` (`electron/main.cjs`): native desktop window lifecycle and multi-instance port resolution.
- `Dashboard Backend` (`server/src/index.ts`): Node.js service managing Pi RPC, project files, sessions, skills, tools, workers, preview tunneling, and remote access. Bound strictly to `127.0.0.1:4317`.
- `Dashboard UI` (`ui/src/`): React + Vite frontend bound strictly to `127.0.0.1:5173`. Proxies `/api`, `/ws`, and `/plugin-assets` to the backend.

The backend stores private Dashboard state in `~/.pi-dashboard/` (including worker configs and rules in `~/.pi-dashboard/workers/`) and provider credentials in `~/.pi/agent/`. Sandboxed user projects live in `~/Pi-Dashboards/<project>`.

## Feature & Stack Model

The dashboard provides dynamic, in-app stack presets and feature toggling:

- **User / Basic Stack**: Core features + Terminal + Sub-PI solo worker.
- **Developer Stack**: User Stack + Multi-Provider Workers (Antigravity & Codex) + Rules Editor + Live App Previewer.
- **Business Stack**: Developer Stack + Claude CLI + Automated Tasks / Cron + Enterprise MCPs.
- **Custom Mode**: Any individual feature or worker provider can be toggled on/off at will in Settings.

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
