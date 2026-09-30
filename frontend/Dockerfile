# Frontend image for local development via docker-compose.yml: build the Vite
# app, then serve the static dist/ with nginx. Production deploys to Vercel
# (frontend/vercel.json) and does not use this file.

# ---- build stage ------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* variables into the bundle at BUILD time, so the API
# origin must be a build arg — setting it as a runtime env var on the nginx
# container would have no effect. Empty means same-origin relative URLs.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ---- runtime stage ----------------------------------------------------------
# nginx-unprivileged runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
