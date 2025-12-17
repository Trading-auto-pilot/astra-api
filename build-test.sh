#!/usr/bin/env bash
set -euo pipefail

# Build immagini Docker localmente senza push.
# Namespace di default: "local" (override con DOCKER_NAMESPACE=...)
DOCKER_NAMESPACE="${DOCKER_NAMESPACE:-local}"

services=(
  DBManager
  cacheManager
  capitalManager
  alertingService
  LiveMarketListener
  orderListner
  orderSimulator
  MarketSimulator
  scheduler
  tickerScanner
  authService
  strategies/sma
  strategies/sltp
)

echo "🔧 Building images in namespace: ${DOCKER_NAMESPACE}"

for service in "${services[@]}"; do
  name="$(basename "$service" | tr '[:upper:]' '[:lower:]')"
  dockerfile="$service/Dockerfile"
  release_file="$service/release.json"
  image="${DOCKER_NAMESPACE}/${name}"

  if [[ ! -f "$dockerfile" ]]; then
    echo "⚠️  Nessun Dockerfile per $service, salto..."
    continue
  fi

  version=""
  if [[ -f "$release_file" ]]; then
    version="$(
      grep -oE '"version"[[:space:]]*:[[:space:]]*"([^"]+)"' "$release_file" \
        | head -n1 \
        | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
        || true
    )"
  fi

  if [[ -n "$version" ]]; then
    echo "🏷  ${image}:latest + ${image}:${version} (service=${service})"
    docker build -t "${image}:latest" -t "${image}:${version}" -f "$dockerfile" .
  else
    echo "🏷  ${image}:latest (service=${service})"
    docker build -t "${image}:latest" -f "$dockerfile" .
  fi
done

# Frontend (repo sibling): build opzionale se presente
if [[ -f "../astraai/Dockerfile" ]]; then
  echo "🧩 Building frontend image ${DOCKER_NAMESPACE}/astraai-frontend:latest from ../astraai"
  (cd ../astraai && docker build -t "${DOCKER_NAMESPACE}/astraai-frontend:latest" -f Dockerfile .)
fi
