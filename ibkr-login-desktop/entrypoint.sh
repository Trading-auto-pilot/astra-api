#!/bin/bash
set -e

# 1. Start Node.js microservice (REST API on port 3009)
node /app/ibkr-login-desktop/server.js &

# 2. Start virtual display — 834x1194: iPad Pro 11" portrait viewport
Xvfb :0 -screen 0 834x1194x24 &
sleep 1

export DISPLAY=:0

# 3. Launch Chromium in kiosk mode (iPad Pro 11" viewport)
#    --kiosk: no address bar / toolbar — the full 834x1194 goes to the IBKR web content.
#    localhost:5000 resolves to the gateway via shared network namespace (network_mode: service:ibkrgw-paper)
IPAD_UA="Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-features=VizDisplayCompositor \
  --kiosk \
  --window-size=834,1194 \
  --user-agent="${IPAD_UA}" \
  --allow-insecure-localhost \
  --remote-debugging-port=9222 \
  "https://localhost:5000" &

# 4. Start x11vnc (no password — access protected by Traefik ForwardAuth)
x11vnc -display :0 -nopw -forever -shared -quiet -rfbport 5900 &

# 5. Start noVNC/websockify (foreground — keeps the container alive)
exec websockify --web /usr/share/novnc/ 6080 localhost:5900
