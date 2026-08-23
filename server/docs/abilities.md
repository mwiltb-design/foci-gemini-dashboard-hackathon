# Pi-Dashboard Abilities & Features

Pi-Dashboard is an intelligent coding assistant interface and agent execution environment designed for developers, researchers, and creators.

## 🌟 Core Abilities

### 1. Interactive AI Chat & Assistance
* Real-time streaming conversation with leading model providers (Anthropic Claude, OpenAI, OpenRouter, Google Gemini, local Ollama).
* Multi-turn context management with intelligent session branching and history persistence.
* Visual code diff rendering and Markdown execution tracking.

### 2. File Explorer & Code Editor
* In-browser and native desktop file navigation.
* Full-featured syntax-highlighted editor with line numbering, file diff inspection, and live saving.
* Direct workspace synchronization without cloud telemetry leaks.

### 3. Modular Skills & Tools
* Dynamic tool execution (file read, grep, find, edit, write).
* Custom user skills loaded from markdown instruction packs.
* Automated documentation lookups and self-guided capability discovery.

### 4. Interchangeable Plugin System
* Extensible architecture for custom domain dashboards (Developer, Business, Research).
* Isolated plugin runtimes communicating over secure local protocols.
* Downloadable and toggleable capabilities.

### 5. Native Terminal Integration
* Embedded pseudo-terminal powered by `node-pty`.
* Direct PowerShell, Command Prompt, or Git Bash execution inside the dashboard with ANSI color support.

### 6. Multi-Provider Autonomous Workers
* Background agent coordinator for offloading complex multi-step research, review, or implementation tasks.
* Supports **Sub-PI**, **Google Antigravity CLI**, **OpenAI Codex CLI**, and **Anthropic Claude CLI**.
* **2-Level Markdown Rule System**: Level 1 Router (`WORKERS.md`) and Level 2 Provider Guidelines (`rules/*.md`) editable in-app.
* **Strict Workspace Confinement**: Enforces that all edits, scripts, and artifacts are created strictly inside the active project directory.
* **Dynamic Bounds**: Custom sliders for turn limits (1-32), timeouts (1-60m), and result payload limits.
* **Interactive CLI Management**: Embedded terminal console for account login (`codex login`, `claude login`, `agy`) and tool management.

### 7. Live Web & HTML App Previewer
* Integrated iframe preview canvas for responsive web development.
* Direct workspace static file serving (`/api/preview/workspace/*`) with automatic `.html` file discovery dropdown.
* Tunneling and live hot-reloading for local dev servers (Vite `:5173`, React `:3000`, Local `:8080`).
* Responsive device frame testing: **Desktop**, **Tablet (768px)**, and **Mobile (375px)**.

### 8. Experience Stacks & Feature Checklists
* Choose between **`★ User / Basic`**, **`⚡ Developer`**, and **`🏢 Business`** presets in Settings.
* Granular in-app feature and worker toggles with instant live updates (no server restart required).

### 9. Sandboxed Project Manager
* All user projects are safely sandboxed under `~/Pi-Dashboards/<ProjectName>` with starter `MEMORY.md` and `Notes.md`.
* Multi-window project switching with dynamic port collision avoidance.

### 10. Private Remote Access (Tailscale Serve)
* In-app configuration for private, encrypted remote pairing over Tailscale (`https://<machine>.tailnet.ts.net:8443`).
* Custom password authentication with complete subprocess token protection.
