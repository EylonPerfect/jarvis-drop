# Web image — build the Vite bundle, serve it with Nginx (also proxies /api → bff).
# Build context = repo root.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/bff/package.json apps/bff/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
# VITE_API_BASE defaults to "" → same-origin /api (Nginx proxies to the BFF).
RUN npm --workspace=@jarvis/web run build

FROM nginx:alpine AS run
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
