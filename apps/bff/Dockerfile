# BFF image — Fastify + tsx (runs the TypeScript directly). Build context = repo root.
FROM node:22-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
# Install prod deps for the whole workspace (hoisted). tsx is a runtime dep of the BFF.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/bff/package.json apps/bff/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
# tini for correct signal handling / zombie reaping in containers.
RUN apt-get update && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/shared ./packages/shared
COPY apps/bff ./apps/bff
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8787/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "--workspace=@jarvis/bff", "run", "start"]
