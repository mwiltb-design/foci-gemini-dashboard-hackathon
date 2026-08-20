# Dashboard Operations & Tailscale Guide

Use this document for startup, ports, Tailscale Serve remote access, project workspaces, and operational questions.

## Native Desktop Architecture

Pi Dashboard 2.0 runs as a 100% native desktop application (powered by Electron, Node.js, Vite, and React) without requiring Docker or virtual machines.

When started:
- `electron/main.cjs` launches the Node.js backend (`server/src/index.ts`) on port `4317` (bound strictly to `127.0.0.1`).
- `electron/main.cjs` launches the Vite React UI on port `5173` (bound strictly to `127.0.0.1`).
- Vite proxies `/api`, `/ws`, and `/plugin-assets` to the backend on localhost.
- The user's projects are sandboxed inside `~/Pi-Dashboards/<ProjectName>` with starter `MEMORY.md` and `Notes.md`.

## Starting the Application

- **Windows Desktop Shortcut:** Double-click the `Pi Dashboard` icon on your Desktop (starts silently with no console windows).
- **Windows Terminal:** `.\scripts\dev.ps1`
- **macOS / Linux:** `./scripts/dev.sh`

## Tailscale Serve (Remote Access from Phone / Laptop)

Pi Dashboard includes built-in support for **Tailscale Serve**, allowing private, encrypted HTTPS access from any device on your Tailnet.

### How to Connect to Tailscale (Step-by-Step)

1. **Open Settings in Pi Dashboard:**
   - Navigate to the **Settings** tab.
   - Scroll to the **"Remote Connectivity & Tailscale Serve"** card.
2. **Enable & Configure:**
   - Check **"Enable Tailscale Serve Remote Access"**.
   - Enter your computer's Tailnet hostname (e.g. `my-pc.tailnet.ts.net`).
   - Type your custom remote access password (or click **"🎲 Generate Random"**).
   - Click **"💾 Save & Protect"**.
3. **Start Tailscale Serve on your PC:**
   - Open PowerShell or Terminal on this PC and run the copyable command displayed in Settings:
     ```powershell
     tailscale serve --bg --https=8443 http://127.0.0.1:5173
     ```
4. **Access from Your Phone or Remote Device:**
   - Open any browser on your phone/tablet connected to your Tailnet.
   - Navigate to: `https://my-pc.tailnet.ts.net:8443`
   - Log in with your password to access your dashboard!

### Helpful Tailscale Commands
- **Check Status:** `tailscale serve status`
- **Stop / Reset Remote Access:** `tailscale serve reset`

### Security Guarantees
- **Strict Localhost Binding:** The backend and frontend are never bound to `0.0.0.0`. They remain strictly on `127.0.0.1`.
- **UI-Only Proxy:** Tailscale proxies only the UI port (`5173`). Vite handles backend proxying internally.
- **Subprocess Isolation:** The auth token is stored privately in `~/.pi-dashboard/remote-access.json` and is strictly stripped before launching Pi RPC, sub-agents, or terminal sessions.

## Ports

- Default UI Port: `127.0.0.1:5173`
- Default Backend Port: `127.0.0.1:4317`
- Dynamic Port Hunting: If multiple dashboard windows are opened, new instances automatically hunt the next available ports (`5174`, `4318`, etc.) with zero collisions.

## Backup and State

Private user state is stored in:
- `~/.pi-dashboard/` (global preferences, remote access settings, custom plugins)
- `~/.pi/agent/` (provider authentication credentials)
- `~/Pi-Dashboards/` (sandboxed project workspaces)
