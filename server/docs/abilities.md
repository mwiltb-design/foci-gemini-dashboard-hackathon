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

### 5. Native Terminal Integration (Optional Module)
* Embedded pseudo-terminal powered by `node-pty`.
* Direct PowerShell, Command Prompt, or Git Bash execution inside the dashboard.

### 6. Sub-Agent Workers (Optional Module)
* Background agent coordinator for offloading complex multi-step research, review, or implementation tasks.

### 7. Sandboxed Project Manager
* All user projects are safely sandboxed under `~/Pi-Dashboards/<ProjectName>` with starter `MEMORY.md` and `Notes.md`.
* Multi-window project switching with dynamic port collision avoidance.

### 8. Private Remote Access (Tailscale Serve)
* In-app configuration for private, encrypted remote pairing over Tailscale (`https://<machine>.tailnet.ts.net:8443`).
* Custom password authentication with complete subprocess token protection.
