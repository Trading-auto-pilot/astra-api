#!/bin/bash
set -e

# 1. Start Node.js microservice (REST API on port 3009)
node /app/ibkr-login-desktop/server.js &

# 2. Start virtual display — iPhone 17 viewport (393x852 CSS px × DPR 3 = 1179x2556 physical)
Xvfb :0 -screen 0 1179x2556x24 &
sleep 1

export DISPLAY=:0

# 3. Launch Chromium in mobile emulation mode (iPhone 17)
#    localhost:5000 resolves to the gateway via shared network namespace (network_mode: service:ibkrgw-paper)
IPHONE17_UA="Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1"
chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-features=VizDisplayCompositor \
  --window-size=393,852 \
  --force-device-scale-factor=3 \
  --user-agent="${IPHONE17_UA}" \
  --ignore-certificate-errors \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  "https://localhost:5000" &

# 4. Start x11vnc (no password — access protected by Traefik ForwardAuth)
x11vnc -display :0 -nopw -forever -shared -quiet -rfbport 5900 &

# 5. Start noVNC/websockify (foreground — keeps the container alive)
exec websockify --web /usr/share/novnc/ 6080 localhost:5900
