<div align="center">

# 🚀 Foci Dashboard
### Autonomous Multi-Agent Collaborative Workspace & Scientific Discovery Studio
**Google AI Hackathon — Track 2: The Collaborative Partner**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-3.7_Flash_%7C_2.5_Pro-4285F4?logo=google)](https://ai.google.dev/)
[![Google Cloud Run](https://img.shields.io/badge/Google_Cloud_Run-Serverless_Container-34A853?logo=googlecloud)](https://cloud.google.com/run)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.11_%7C_GDAL_%7C_Rasterio-3776AB?logo=python)](https://python.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev/)

<p align="center">
  <b>A unified, cloud-native developer and research workspace where human intent, Lead Gemini, and autonomous worker agents collaborate seamlessly through live sessions, contextual rules, and tool execution.</b>
</p>

</div>

---

## ✨ Key Capabilities

### 🤖 Multi-Agent Division of Labor (`Track 2`)
* **Lead Gemini Orchestrator (`gemini-3.7-flash` / `gemini-2.5-pro`):** Directs the research strategy, interprets high-level human directives, prevents hallucinations, and synthesizes findings into concrete deliverables.
* **Autonomous Task Delegation (`delegate_worker`):** The lead agent delegates specialized sub-tasks (`research`, `review`, `implement`) to background workers:
  * **`gemini-worker`:** Fast, cloud-native execution for repetitive file operations, data ingestion, and batch operations.
  * **`antigravity-cli`:** Deep scientific investigation, counter-explanation checks, and benchmark validation with Google OAuth subscription support.

### 📜 Contextual Rules & Memory Engine (`rules.md` / `MEMORY.md`)
* **Hierarchical Memory Banks:** Agents automatically discover and load workspace guidelines, project memory banks (`MEMORY.md`), and localized rules (`rules.md`) to maintain persistent context without repetitive prompting.
* **Smart Session Resumption:** Automatically tracks, serializes, and restores active conversation trajectories across project workspace switches.

### 🔬 High-Performance Scientific Geospatial Stack
* **Pre-installed Geospatial Runtime:** Python 3.11, GDAL (`gdal-bin`, `libgdal-dev`), `rasterio`, `scipy`, `numpy`, `shapely`, and `geopandas` built directly into the container.
* **LiDAR Elevation Processing:** Capable of windowed slicing of massive USGS 3DEP 1m bare-earth DEMs, Difference-of-Gaussians / Local Relief Modeling (LRM), and multi-dataset empirical benchmarking (Wyoming, Morasko, and Kaali crater fields).

### 🛠️ Integrated Studio & App Previewer
* **Monaco Code Editor & Integrated Terminal:** Full PTY shell access with real-time command streaming and Git status badges.
* **Live App & HTML Previewer:** Instant rendering of generated interactive HTML visualizers, terrain relief maps, and evidence cards directly inside the dashboard.
* **Adaptive Progress Loop:** High 200-turn capacity with progress-reset on tool success, 30-minute command timeouts, and duplicate-action safety brakes.

---

## 🏗️ Architecture

```
foci-gemini-dashboard/
├── Dockerfile                 # Cloud Run container definition with Python/GDAL & C syscall shims
├── server/                    # Node.js backend API & Multi-Agent Coordinator
│   ├── src/
│   │   ├── gemini-agent.ts    # Lead Gemini adaptive agent loop & tool orchestration
│   │   ├── gemini-worker.ts   # Cloud-native delegated worker adapter
│   │   ├── antigravity-worker.ts # Antigravity CLI worker adapter with OAuth priority
│   │   ├── gemini-auth-sync.ts# Bidirectional GCS persistent OAuth token synchronizer
│   │   ├── fuse-chmod-shim.c  # Compiled Linux C shim for GCS FUSE POSIX compatibility
│   │   ├── git-service.ts     # FUSE-safe Git status, diff, and branch coordinator
│   │   └── index.ts           # WebSocket RPC server, project switcher & static UI host
│   └── test/                  # Automated test suite (sessions, worker routing, persistence)
├── ui/                        # React + Vite frontend workspace studio
│   ├── src/components/        # Chat timeline, Monaco editor, App Previewer, Worker console
│   └── src/hooks/             # usePiChat, useProjects, useWorkers, useTerminal
└── plugins/                   # Custom agent extension modules and tool packages
```

---

## 🚀 Reproducible Testing & Running Guide

### 1. Prerequisites
* **Node.js:** v20.x or v22.x LTS
* **Google Gemini API Key:** From [Google AI Studio](https://aistudio.google.com/)
* *(Optional for Docker/Cloud):* Docker or Google Cloud SDK (`gcloud`)

---

### 2. Local Quickstart (Node.js / TypeScript)

```bash
# 1. Clone the repository
git clone https://github.com/mwiltb-design/foci-gemini-dashboard-hackathon.git
cd foci-gemini-dashboard-hackathon

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and insert your GEMINI_API_KEY:
# GEMINI_API_KEY="your-gemini-api-key"
# FOCI_AGENT_PROVIDER="gemini"
# GEMINI_MODEL="gemini-3.7-flash"

# 4. Build frontend and compile TypeScript backend
npm --prefix server run build:emit
npm --prefix ui run build

# 5. Start the server
npm --prefix server run start
```
Open **`http://localhost:8080`** in your browser to launch the dashboard.

---

### 3. Automated Test Suite Execution

Run the backend unit and integration test suite:

```bash
npm --prefix server run test
```

---

### 4. Local Docker Container Smoke Test

Test the exact production container image locally:

```bash
# 1. Build the container image
docker build -t foci-dashboard:local .

# 2. Run the container with your Gemini API key
docker run --rm -it -p 8080:8080 \
  -e GEMINI_API_KEY="your-api-key" \
  -e GEMINI_MODEL="gemini-3.7-flash" \
  -e FOCI_AGENT_PROVIDER="gemini" \
  foci-dashboard:local
```
Open **`http://localhost:8080`** and verify health at **`http://localhost:8080/api/system`**.

---

### 5. Google Cloud Run Deployment

Deploy directly to serverless Google Cloud Run:

```bash
# 1. Set your GCP Project
gcloud config set project YOUR_GCP_PROJECT_ID

# 2. Store your API Key securely in Secret Manager
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=-

# 3. Deploy to Cloud Run
gcloud run deploy foci-dashboard \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --memory 16Gi \
  --cpu 4 \
  --timeout 3600 \
  --port 8080 \
  --set-env-vars FOCI_AGENT_PROVIDER=gemini,GEMINI_MODEL=gemini-3.7-flash,NODE_ENV=production \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest
```

---

## 🔒 Security & Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Google Gemini API key for primary agent and workers | Required |
| `GEMINI_MODEL` | Primary agent model ID (`gemini-3.7-flash`, `gemini-2.5-pro`) | `gemini-3.7-flash` |
| `FOCI_AGENT_PROVIDER` | Core agent runtime engine (`gemini` or `pi`) | `gemini` |
| `PI_DASHBOARD_DATA_DIR` | Directory for persistent sessions, rules, and activity store | `/data/dashboard` |
| `PI_PROJECTS_ROOT` | Directory holding active project workspaces | `/data/projects` |
| `PI_DASHBOARD_ANTIGRAVITY_HOME` | Persistent Google OAuth credential storage volume | `/data/gemini` |

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** — see the [LICENSE](./LICENSE) file for details.