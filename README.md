# 🚀 Pi-Dashboards 2.0 (Desktop Edition)

A modern, native desktop dashboard and agent execution environment for the [Pi Coding Agent](https://github.com/earendil-works/pi). Built with Electron, React, Node.js, and TypeScript.

---

## ✨ Features

* **🖥️ 100% Native Desktop App:** Runs directly on Windows, macOS, and Linux without requiring Docker or virtual machines.
* **🔒 Clean Workspace Isolation:** Keeps user project folders completely clean, storing internal skills, documentation, and metadata in private background app storage.
* **💬 Intelligent Multi-Model Chat:** Streaming conversations with Claude, GPT, OpenRouter, Gemini, and local Ollama models with visual diff rendering and branch history.
* **📁 Built-in File Explorer & Code Editor:** Syntax-highlighted code editing with CodeMirror, line numbers, and live file saving.
* **⚡ Native Windows Terminal:** Embedded pseudo-terminal powered by `node-pty` for direct PowerShell, CMD, or Git Bash execution.
* **🤖 Sub-Agent Worker Delegation:** Background coordinator for parallel research, code reviews, and implementation tasks.
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
├── packages/          # Shared plugin-sdk and plugin-runtime
└── scripts/           # Platform launch and build scripts
```

---

## ⚙️ Configuration & Ports

By default, Pi-Dashboard 2.0 starts on **port `5173`** (UI) and **port `4317`** (Backend). 

If port `5173` is busy, the desktop launcher automatically shifts to the next available port with zero collisions.

To customize your environment, copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

---

## 📜 License
MIT License. Created by [mwiltb-design](https://github.com/mwiltb-design).
