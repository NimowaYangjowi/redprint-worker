FROM node:20-slim AS base
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates gnupg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client-17 && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN npm install --production

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /tmp/redprint-transcode
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD node -e "process.exit(0)"
CMD ["npx", "tsx", "scripts/transcode-worker.ts"]
