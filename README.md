# 🚀 Pi-Dashboards 2.0 (Desktop Edition)

A modern, native desktop dashboard and agent execution environment for the [Pi Coding Agent](https://github.com/earendil-works/pi). Built with Electron, React, Node.js, and TypeScript.

---

## ✨ Features

* **🖥️ 100% Native Desktop App:** Runs directly on Windows, macOS, and Linux without requiring Docker or virtual machines.
* **🔒 Clean Workspace Isolation & Confinement:** Strict sandbox enforcement ensures all worker edits and artifacts stay confined within the active project workspace.
* **💬 Intelligent Multi-Model Chat:** Streaming conversations with Claude, GPT, OpenRouter, Gemini, and local Ollama models with visual diff rendering and branch history.
* **📁 Built-in File Explorer & Code Editor:** Syntax-highlighted code editing with CodeMirror, line numbers, and live file saving.
* **⚡ Native Terminal:** Embedded pseudo-terminal powered by `node-pty` for direct PowerShell, CMD, or Git Bash execution.
* **🤖 Multi-Provider Worker Delegation:** Autonomous background worker suite supporting **Sub-PI**, **Google Antigravity CLI**, **OpenAI Codex CLI**, and **Anthropic Claude CLI** with dynamic bounds (turns, timeouts, output limits).
* **📜 2-Level Markdown Rule System:** Global router matrix (`WORKERS.md`) and per-provider guidelines (`rules/*.md`) editable directly inside the in-app dual-pane editor.
* **◫ Live Web & HTML App Previewer:** Integrated iframe canvas for previewing local workspace `.html` files or tunneling live local dev servers (Vite `:5173`, React `:3000`, etc.) with responsive Desktop, Tablet, and Mobile device frames.
* **🎛️ Experience Stacks & Feature Checklists:** One-click presets for **`★ User / Basic`**, **`⚡ Developer`**, and **`🏢 Business`** with instant in-app feature and worker toggles.
* **🔌 Modular Plugin Architecture:** Interchangeable dashboards and tool suites tailored for Developers, Businesses, and Researchers.
* **🚀 5-Step Guided Onboarding:** Custom display name, optional `USER.md` / `MEMORY.md` import, provider authentication, and feature toggles.

---

## 🛠️ Quick Start

### Prerequisites
* [Node.js](https://nodejs.org/) (v20 or newer)
* [Git](https://git-scm.com/)

### Installation & Launch

```powershell
# Clone the repository
git clone https://github.com/mwiltb-design/pi-dashboard-2.0.git Pi-Dashboards
cd Pi-Dashboards

# Launch developer desktop environment (auto-installs dependencies)
.\scripts\dev.ps1
```

*(On macOS or Linux, run `./scripts/dev.sh`)*

---

## 📁 Architecture Overview

```
Pi-Dashboards/
├── electron/          # Native Electron shell & window manager
├── server/            # Backend API, RPC process runner & PTY bridge
│   ├── docs/          # Built-in documentation (abilities, limits, shortcuts)
│   ├── skills/        # Built-in agent lookup skills
│   └── templates/     # Clean starter project templates (MEMORY.md)
├── ui/                # React + Vite frontend application
├── packages/          # Shared plugin-sdk
└── scripts/           # Platform launch and build scripts
```

---

## 🔒 Private Remote Access with Tailscale Serve

You can securely access your Pi Dashboard from your phone, iPad, or remote laptop over your private Tailnet without exposing any ports to the public internet:

1. Open **Settings** in the dashboard and find **"Remote Connectivity & Tailscale Serve"**.
2. Check **"Enable Tailscale Serve Remote Access"**.
3. Enter your Tailnet hostname (e.g. `my-pc.tailnet.ts.net`) and set your custom password.
4. Click **"💾 Save & Protect"**.
5. Run the generated command in PowerShell on your host computer:
   ```powershell
   tailscale serve --bg --https=8443 http://127.0.0.1:5173
   ```
6. Visit `https://my-pc.tailnet.ts.net:8443` on your mobile browser, enter your password, and control your dashboard remotely!

---

## ⚙️ Configuration & Ports

* **Default Ports:** UI on `127.0.0.1:5173` and Backend on `127.0.0.1:4317`.
* **Zero Collisions:** Multi-window instances dynamically hunt the next open ports (`5174`, `4318`, etc.).
* **Zero File Editing:** Configure your settings, projects, and Tailscale password directly in the dashboard UI.

---

## 📜 License
GNU General Public License v3.0 (GPLv3). Created by [mwiltb-design](https://github.com/mwiltb-design).
