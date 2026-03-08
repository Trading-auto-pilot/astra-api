FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    chromium \
    x11vnc \
    websockify \
    novnc \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy service directory and shared libraries
COPY ibkr-login-desktop/ ./ibkr-login-desktop/
COPY shared/ ./shared/

# Install Node.js dependencies
COPY ibkr-login-desktop/package.json .
RUN npm install --omit=dev

# Copy entrypoint
COPY ibkr-login-desktop/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Port 3009: Node.js REST API (General Settings)
# Port 6080: websockify/noVNC (Desktop remoto)
EXPOSE 3009 6080

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3009/status/health || exit 1

CMD ["/entrypoint.sh"]
