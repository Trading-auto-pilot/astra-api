# syntax=docker/dockerfile:1

FROM node:20-alpine
WORKDIR /app

COPY help-trading/package*.json ./
RUN npm ci

COPY help-trading/ .
RUN npm run build

EXPOSE 3000 3106

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ >/dev/null && wget -qO- http://localhost:3106/api/docs/health >/dev/null || exit 1

CMD ["sh", "-c", "npm run serve -- --host 0.0.0.0 --port 3000 & npm start"]
