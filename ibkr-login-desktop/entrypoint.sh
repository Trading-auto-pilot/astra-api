#!/bin/bash
set -e

# 1. Start Node.js microservice (REST API on port 3009)
node /app/ibkr-login-desktop/server.js &

# 2. Start virtual display — 360x700: compact mobile viewport, fits any phone screen via noVNC
Xvfb :0 -screen 0 360x700x24 &
sleep 1

export DISPLAY=:0

# 3. Launch Chromium in kiosk mode (iPhone SE viewport)
#    --kiosk: no address bar / toolbar — the full 375x700 goes to the IBKR web content.
#    DPR 1 is enough: IBKR renders mobile layout based on UA + 375px viewport width.
#    localhost:5000 resolves to the gateway via shared network namespace (network_mode: service:ibkrgw-paper)
IPHONE_UA="Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1"
chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-features=VizDisplayCompositor \
  --kiosk \
  --window-size=360,700 \
  --user-agent="${IPHONE_UA}" \
  --allow-insecure-localhost \
  --remote-debugging-port=9222 \
  "https://localhost:5000" &

# 4. Start x11vnc (no password — access protected by Traefik ForwardAuth)
x11vnc -display :0 -nopw -forever -shared -quiet -rfbport 5900 &

# 5. Start noVNC/websockify (foreground — keeps the container alive)
exec websockify --web /usr/share/novnc/ 6080 localhost:5900
