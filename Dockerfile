# ---------- 1) build frontend ----------
FROM node:24-bookworm-slim AS webbuild
WORKDIR /app/web
COPY web/package.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npx vite build

# ---------- 2) runtime ----------
FROM node:24-bookworm-slim
ENV NODE_ENV=production
# Chromium for server-side PDF rendering (Puppeteer uses the system binary)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app/server
COPY server/package.json ./
RUN npm install --no-audit --no-fund
COPY server/ ./

# built frontend + seed data
COPY --from=webbuild /app/web/dist /app/web/dist
COPY data/seed /app/data/seed

COPY ops/docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
VOLUME ["/app/data"]
ENTRYPOINT ["/app/entrypoint.sh"]
