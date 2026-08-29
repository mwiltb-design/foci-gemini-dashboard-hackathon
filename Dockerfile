# Foci Dashboard — Google Cloud Run container
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
COPY ui/package*.json ./ui/
COPY electron/package*.json ./electron/
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm --prefix server run build:emit
RUN npm --prefix ui run build

FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV FOCI_AGENT_PROVIDER=gemini
ENV PI_DASHBOARD_DATA_DIR=/data/dashboard
ENV PI_PROJECTS_ROOT=/data/projects
ENV PI_AGENT_DIR=/data/agent
ENV PI_DASHBOARD_ANTIGRAVITY_HOME=/data/gemini
ENV ANTIGRAVITY_HOME=/data/gemini
ENV FOCI_STATIC_UI_DIR=/app/ui/dist
ENV PATH="/usr/local/bin:/home/node/.local/bin:${PATH}"

# Install Antigravity CLI (agy) only as external CLI worker
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash && \
    if [ -x /root/.local/bin/agy ]; then cp /root/.local/bin/agy /usr/local/bin/agy; elif command -v agy >/dev/null 2>&1; then cp "$(command -v agy)" /usr/local/bin/agy; fi && \
    test -x /usr/local/bin/agy && /usr/local/bin/agy --version && \
    (chmod -R 755 /usr/local/bin 2>/dev/null || true)

COPY --from=deps /app/package*.json ./
COPY --from=deps /app/server/package*.json ./server/
COPY --from=deps /app/ui/package*.json ./ui/
COPY --from=deps /app/electron/package*.json ./electron/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/ui/dist ./ui/dist
COPY plugins ./plugins
COPY server/extensions ./server/extensions
COPY server/skills ./server/skills
COPY server/templates ./server/templates
COPY server/package*.json ./server/dist/server/
COPY server/templates ./server/dist/server/templates

RUN mkdir -p /data/dashboard/onboarding /data/projects /data/agent /data/gemini /workspace /home/node && \
    echo '{"schemaVersion":1,"completed":true,"dismissed":false,"appName":"Foci Dashboard","features":{"terminal":true,"workers":true}}' > /data/dashboard/onboarding/state.json && \
    ln -sfn /data/gemini /home/node/.gemini && \
    chown -R node:node /data /workspace /home/node
USER node
EXPOSE 8080
CMD ["node", "server/dist/server/src/index.js"]
