# Foci Dashboard — Gemini Cloud Hackathon Build

This branch/folder is the isolated hackathon version of Pi Dashboard.

## What changed

- Added Gemini Cloud agent mode via `FOCI_AGENT_PROVIDER=gemini`.
- Added `server/src/gemini-agent.ts` with Gemini streaming, file tools, safe command tooling, and file-backed memory prompt loading.
- Added a built-in `gemini-worker` provider for bounded multi-agent worker tasks.
- Added Cloud Run-ready `Dockerfile` and `.dockerignore`.
- Added static serving of the built React UI from the Node backend for single-container deployment.

## Local checks

```bash
npm install
npm --prefix server run build
npm --prefix ui run build
docker build -t foci-dashboard:test .
```

## Local `.env` setup

Copy the checked-in example to a local `.env`, then replace the placeholder API key:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

The example selects Gemini for the primary agent and configures both the primary and worker models. `PI_DASHBOARD_AUTH_TOKEN` is optional for local-only use, but should be set to a strong value before exposing the dashboard remotely.

Install dependencies and start the local server with `npm --prefix server run start` (or use `npm --prefix server run dev` for watch mode). The server loads the repository-root `.env` for both local `tsx` runs and compiled runs. Existing shell or platform environment variables take precedence over values in `.env`.

If a local demo isolates `HOME` or `USERPROFILE`, set `PI_DASHBOARD_ANTIGRAVITY_HOME` (or `ANTIGRAVITY_HOME`) to the parent Gemini config directory, such as `C:\Users\you\.gemini`, so the Antigravity worker can find existing credentials.

Never commit `.env`. It is ignored by Git and excluded from the Docker build context; pass production secrets through the deployment platform instead.

## Local Cloud-container smoke test

```bash
docker run --rm -p 8080:8080 \
  -e GEMINI_API_KEY=YOUR_KEY \
  -e GEMINI_MODEL=gemini-3.7-flash \
  foci-dashboard:test
```

Then open `http://127.0.0.1:8080`. Health checks are available at `/api/health` and `/healthz`.

## Cloud Run deploy draft

For the fastest hackathon deployment, deploy from the local source tree with `gcloud run deploy --source .`. GitHub-connected Cloud Run deployment also works, but only after committing and pushing this hackathon branch/repository; until then it will not include local-only commits or UI polish.

Create the API-key secret once, then grant the Cloud Run service identity access to it. This example creates the secret from a local prompt without putting the key in the image or deployment command:

```bash
read -s GEMINI_KEY
printf %s "$GEMINI_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=-
unset GEMINI_KEY
```

For an existing secret, add a new version with `gcloud secrets versions add GEMINI_API_KEY --data-file=-`. Ensure the service account used by Cloud Run has the Secret Manager Secret Accessor role for `GEMINI_API_KEY`, then deploy:

```bash
gcloud run deploy foci-dashboard \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 3 \
  --memory 2Gi \
  --cpu 1 \
  --timeout 3600 \
  --port 8080 \
  --set-env-vars FOCI_AGENT_PROVIDER=gemini,GEMINI_MODEL=gemini-3.7-flash,GEMINI_WORKER_MODEL=gemini-3.7-flash,NODE_ENV=production \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest
```

For Google-authenticated access, remove `--allow-unauthenticated`. For simple dashboard password protection on a public demo URL, store `PI_DASHBOARD_AUTH_TOKEN` as a separate Secret Manager secret and add it to `--set-secrets` rather than placing it in `.env` or `--set-env-vars`; the static login UI and health probes remain reachable before token login.

If the hackathon publishes a different exact Gemini model ID, update `GEMINI_MODEL` and `GEMINI_WORKER_MODEL`.

## Persistence & Environment Variable Routing

When deploying to Cloud Run with persistent storage (such as a mounted GCS volume at `/data` or persistent disk), configure the following environment variables:

| Environment Variable | Description | Default | Cloud Container Default |
|---|---|---|---|
| `PI_DASHBOARD_DATA_DIR` (or `FOCI_DASHBOARD_DATA_DIR`) | Base directory for dashboard metadata, project sessions, activity log, worker rules/tasks, onboarding, and plugins | `~/.pi-dashboard` | `/data/dashboard` |
| `PI_PROJECTS_ROOT` (or `PI_DASHBOARD_PROJECTS_ROOT` / `FOCI_PROJECTS_ROOT`) | Directory containing all project workspaces | `~/Pi-Dashboards` | `/data/projects` |
| `PI_AGENT_DIR` (or `FOCI_AGENT_DIR`) | Directory containing agent identity (`USER.md`), global collaboration memory (`MEMORY.md`), and settings | `~/.pi/agent` | `/data/agent` |
| `PI_DASHBOARD_WORKSPACE` (or `FOCI_WORKSPACE`) | Explicit active workspace override. If unset, restores the last active project from `<data-dir>/active-workspace.json`, or defaults to `<projects-root>/Default` | Unset (auto-restores) | Unset (auto-restores) |
| `PI_DASHBOARD_WORKER_RULES_ROOT` | Optional override for worker rules and configurations | `<data-dir>/workers` | `/data/dashboard/workers` |
| `PI_DASHBOARD_ANTIGRAVITY_HOME` / `ANTIGRAVITY_HOME` | Antigravity CLI credential/config directory. In the container, `/home/node/.gemini` is symlinked here so Manage CLI OAuth state persists on the mounted volume. | `~/.gemini` | `/data/gemini` |
| `PI_DASHBOARD_CODEX_HOME` / `CODEX_HOME` | Codex CLI credential/config directory. In the container, `/home/node/.codex` is symlinked here so Manage CLI sign-in state persists on the mounted volume. | `~/.codex` | `/data/codex` |
| `FOCI_ENABLED_WORKERS` | Comma-separated list of enabled worker providers, in default preference order | `codex-cli,gemini-worker,antigravity-cli` (in cloud mode) | `codex-cli,gemini-worker,antigravity-cli` |

### Active Workspace Persistence
- When a user creates or switches projects in the UI (`/api/projects/switch`), the selected active workspace path is recorded in `<data-dir>/active-workspace.json`.
- On container startup or server restart, if no explicit `PI_DASHBOARD_WORKSPACE` is passed, the server automatically restores the previously selected active project.
- Non-active projects in `PI_PROJECTS_ROOT` are preserved and remain selectable in the Projects modal.
