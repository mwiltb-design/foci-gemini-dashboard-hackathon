# Foci Dashboard — Google Cloud Run container
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
COPY ui/package*.json ./ui/
COPY electron/package*.json ./electron/
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm --prefix server run build:emit
RUN npm --prefix ui run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV FOCI_AGENT_PROVIDER=gemini
ENV PI_DASHBOARD_WORKSPACE=/workspace
ENV FOCI_STATIC_UI_DIR=/app/ui/dist

COPY --from=deps /app/package*.json ./
COPY --from=deps /app/server/package*.json ./server/
COPY --from=deps /app/ui/package*.json ./ui/
COPY --from=deps /app/electron/package*.json ./electron/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/ui/dist ./ui/dist
COPY plugins ./plugins
COPY server/templates ./server/templates
COPY server/package*.json ./server/dist/server/
COPY server/templates ./server/dist/server/templates

RUN mkdir -p /workspace
EXPOSE 8080
CMD ["node", "server/dist/server/src/index.js"]
