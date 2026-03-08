#!/bin/bash
set -e

# 1. Start Node.js microservice (REST API on port 3009)
node /app/ibkr-login-desktop/server.js &

# 2. Start virtual display (1280x800, 24-bit color)
Xvfb :0 -screen 0 1280x800x24 &
sleep 1

export DISPLAY=:0

# 3. Launch Chromium pointing to IBKR Client Portal Gateway
#    localhost:5000 resolves to the gateway via shared network namespace (network_mode: service:ibkrgw-paper)
chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-features=VizDisplayCompositor \
  --window-size=1280,800 \
  --ignore-certificate-errors \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  "https://localhost:5000" &

# 4. Start x11vnc (no password — access protected by Traefik ForwardAuth)
x11vnc -display :0 -nopw -forever -shared -quiet -rfbport 5900 &

# 5. Start noVNC/websockify (foreground — keeps the container alive)
exec websockify --web /usr/share/novnc/ 6080 localhost:5900
