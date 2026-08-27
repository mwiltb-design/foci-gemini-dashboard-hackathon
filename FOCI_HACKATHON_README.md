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
  -e GEMINI_MODEL=gemini-3.5-flash \
  foci-dashboard:test
```

Then open `http://127.0.0.1:8080`.

## Cloud Run deploy draft

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
  --min-instances 0 \
  --memory 1Gi \
  --set-env-vars FOCI_AGENT_PROVIDER=gemini,GEMINI_MODEL=gemini-3.5-flash,GEMINI_WORKER_MODEL=gemini-3.5-flash \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest
```

For an authenticated deployment, remove `--allow-unauthenticated`. If dashboard-level token authentication is also required, store `PI_DASHBOARD_AUTH_TOKEN` as a separate Secret Manager secret and add it to `--set-secrets` rather than placing it in `.env` or `--set-env-vars`.

If the hackathon publishes a different exact Gemini 3.5 model ID, update `GEMINI_MODEL` and `GEMINI_WORKER_MODEL`.
