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
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN gcc -O2 -shared -fPIC -o /app/libfuse-chmod-shim.so /app/server/src/fuse-chmod-shim.c -ldl
RUN npm --prefix server run build:emit
RUN npm --prefix ui run build

FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates \
    python3 python3-pip python3-venv \
    gdal-bin libgdal-dev && \
    rm -rf /var/lib/apt/lists/*

# Python geospatial environment for DEM raster processing
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir \
      rasterio numpy scipy shapely geopandas requests

WORKDIR /app
COPY --from=builder /app/libfuse-chmod-shim.so /usr/local/lib/libfuse-chmod-shim.so
RUN echo "/usr/local/lib/libfuse-chmod-shim.so" > /etc/ld.so.preload
ENV LD_PRELOAD=/usr/local/lib/libfuse-chmod-shim.so
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
ENV PATH="/opt/venv/bin:/usr/local/bin:/home/node/.local/bin:${PATH}"

# Install Antigravity CLI (agy) only as external CLI worker
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash && \
    if [ -x /root/.local/bin/agy ]; then cp /root/.local/bin/agy /usr/local/bin/agy; elif command -v agy >/dev/null 2>&1; then cp "$(command -v agy)" /usr/local/bin/agy; fi && \
    test -x /usr/local/bin/agy && /usr/local/bin/agy --version && \
    (chmod -R 755 /usr/local/bin 2>/dev/null || true)

# System-wide Git defaults for Cloud Storage (GCS FUSE) and anonymous identity
RUN git config --system user.name "Foci Developer" && \
    git config --system user.email "developer@foci.local" && \
    git config --system core.filemode false && \
    git config --system core.trustctime false && \
    git config --system core.checkStat minimal && \
    git config --system init.defaultBranch main && \
    git config --system init.templateDir "" && \
    git config --system safe.directory "*"

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

RUN mkdir -p /data/dashboard/onboarding /data/projects /data/agent /data/gemini /workspace /home/node/.gemini/antigravity-cli/log /home/node/.gemini/antigravity-cli/crashes /home/node/.local/bin && \
    echo '{"schemaVersion":1,"completed":true,"dismissed":false,"appName":"Foci Dashboard","features":{"terminal":true,"workers":true}}' > /data/dashboard/onboarding/state.json && \
    chown -R node:node /data /workspace /home/node && \
    chmod -R 755 /home/node/.gemini
USER node
EXPOSE 8080
CMD ["node", "server/dist/server/src/index.js"]
