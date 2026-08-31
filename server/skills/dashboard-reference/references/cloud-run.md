# Google Cloud Run Hosting, Storage & Runtime Reference

This document provides complete technical specifications for the Foci Dashboard running in Google Cloud Run.

---

## 1. Cloud Run Infrastructure & Compute Specs

- **GCP Project ID:** `gen-lang-client-0917427524` (Project Name: `Hackathon`)
- **Service Name:** `foci-dashboard`
- **Region:** `us-central1`
- **Current Resources:**
  - **Memory:** `4Gi` (4 GB RAM)
  - **vCPU:** `2` vCPUs
  - **Scaling:** `min-instances: 0` (scale-to-zero active, $0.00 idle cost), `max-instances: 2`
  - **Timeout:** 3600 seconds (1 hour per request)
- **Runtime Stack:**
  - Node.js `v22.23.2` + Debian Bookworm
  - Python 3.11 pre-configured with geospatial dependencies in `/opt/venv`:
    - `gdal-bin`, `libgdal-dev`, `rasterio`, `numpy`, `scipy`, `shapely`, `geopandas`, `requests`, `geotiff`
    - `/opt/venv/bin` is in the global `PATH`, so standard `python3 ...` and `pip ...` use this environment automatically.

---

## 2. Persistent Storage Architecture (`/data`)

- **Storage Engine:** Cloud Storage FUSE (GCS bucket `foci-dashboard-data-946747374832` mounted at `/data`).
- **Capacity:** **Virtually unlimited / Petabyte scale**. GCS expands dynamically as needed with no fixed partition limit.
- **Directory Layout:**
  - `/data/projects/<ProjectName>/`: User project workspaces. All files, code, datasets, GeoTIFFs, and HTML reports created here persist across container restarts.
  - `/data/agent/`: Persistent agent state:
    - `/data/agent/MEMORY.md`: Global collaboration memory and user communication preferences.
    - `/data/agent/USER.md`: User profile and identity facts.
    - `/data/agent/dashboard/`: Agent settings and memory checkpoint status counters.
  - `/data/gemini/`: Persistent Gemini OAuth credentials (`oauth_creds.json`), auto-synced with `/home/node/.gemini`.
- **FUSE File System POSIX Shim:**
  - GCS FUSE does not natively support POSIX permissions (`chmod 0600`/`0700`) or atomic socket locks.
  - The container preloads `/usr/local/lib/libfuse-chmod-shim.so` via `/etc/ld.so.preload`.
  - Native `git init`, `git add`, `git commit`, SQLite, and atomic file saves work seamlessly inside `/data/projects/`.

---

## 3. Web App & Vite Previewing on Cloud Run

### A. Static & Client-Side SPAs (Zero Configuration)
- Any HTML file, React/Vue/Vite production build, or Three.js/Leaflet dashboard in the project workspace is served directly via:
  ```
  https://foci-dashboard-xxx.run.app/api/preview/workspace/<path-to-file.html>
  ```
- **How to view:** Select the file from the **📁 HTML File** dropdown in the **App Previewer** tab.

### B. Building a Vite App for Preview on Cloud Run
1. When building a modern frontend app (e.g. React + Vite):
   - Run `npm run build` inside the project folder.
   - Vite outputs the bundled static app into `dist/index.html`.
2. Open the **App Previewer** and select `dist/index.html`.
3. The app renders with full JavaScript, CSS, API calls, and WebGL support.

---

## 4. Cloud Run Limitations & Plugin Guidelines

1. **Ephemeral Root vs. Persistent `/data`:**
   - Anything saved outside `/data` (e.g. in `/tmp` or `/home/node`) is wiped when the container scales to zero.
   - **Rule:** Always write project code, generated datasets, and persistent artifacts inside the active workspace (`/data/projects/<ProjectName>/`).
2. **Single Public Port (Port 8080):**
   - Google Cloud Run exposes only port `8080` to the internet.
   - Background dev servers listening on arbitrary ports (e.g. `localhost:5173`) cannot be directly accessed over the public internet unless proxied through the main backend or built as static client bundles.
3. **Headless Linux Environment (No Native X11 GUI):**
   - The container runs headless Debian Linux. GUI plugins that require a physical desktop display (like Electron native window popups) do not render.
   - All plugins and interactive dashboards must render as web-based UI components (HTML/CSS/JS) inside the dashboard or previewer iframe.
4. **Scale-to-Zero Latency (Cold Starts):**
   - When the container has been idle for >15 minutes, the next incoming request takes ~3–5 seconds to spin up the container instance before serving traffic.

---

## 5. Scaling Resources for Large Projects

If a project requires larger compute capacity (e.g. processing massive multi-gigabyte satellite rasters or complex neural model weights), the container can be scaled up using Google Cloud SDK:

```powershell
# Scale to 8 GB RAM / 4 vCPUs
gcloud run services update foci-dashboard `
  --project gen-lang-client-0917427524 `
  --region us-central1 `
  --memory 8Gi `
  --cpu 4

# Scale to 16 GB RAM / 8 vCPUs (High Performance Compute)
gcloud run services update foci-dashboard `
  --project gen-lang-client-0917427524 `
  --region us-central1 `
  --memory 16Gi `
  --cpu 8
```
