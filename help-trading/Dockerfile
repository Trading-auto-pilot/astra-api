# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

COPY help-trading/package*.json ./
RUN npm ci

COPY help-trading/ .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
