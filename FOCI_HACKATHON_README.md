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

## Local Cloud-container smoke test

```bash
docker run --rm -p 8080:8080 \
  -e GEMINI_API_KEY=YOUR_KEY \
  -e GEMINI_MODEL=gemini-3.5-flash \
  foci-dashboard:test
```

Then open `http://127.0.0.1:8080`.

## Cloud Run deploy draft

```bash
gcloud run deploy foci-dashboard \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --memory 1Gi \
  --set-env-vars FOCI_AGENT_PROVIDER=gemini,GEMINI_MODEL=gemini-3.5-flash \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest
```

If the hackathon publishes a different exact Gemini 3.5 model ID, update `GEMINI_MODEL` and `GEMINI_WORKER_MODEL`.
