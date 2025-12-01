#!/usr/bin/env bash
set -euo pipefail

# Uso:
#   ./deploy-with-profiles.sh           # default ENV = PAPER
#   ./deploy-with-profiles.sh PAPER
#   ./deploy-with-profiles.sh LIVE

ENV_NAME="${1:-PAPER}"
COMPOSE_FILE="${2:-docker-compose.paper.yml}"
ENV_FILE="${3:-.env}"

echo "🚀 Deploy environment: $ENV_NAME"
echo "📄 Compose file:       $COMPOSE_FILE"
echo "🔧 Env file:           $ENV_FILE"

# 1) Carico le variabili da .env (le rende esportate per Node e docker compose)
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "❌ Env file '$ENV_FILE' non trovato"
  exit 1
fi

# 2) Calcolo i profili dal DB
PROFILES=$(node scripts/build-compose-profiles.js "$ENV_NAME")

echo "🧩 Profili attivi dal DB per $ENV_NAME: '${PROFILES}'"

# Se non ci sono profili attivi, partiranno solo i servizi senza profiles (core)
if [[ -z "$PROFILES" ]]; then
  echo "⚠️ Nessun profilo attivo trovato, avvio solo i servizi core (senza profiles)..."
fi

LOWER_PROJECT_NAME=$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]')

# 3) Avvio/aggiorno stack con i profili calcolati
COMPOSE_PROFILES="$PROFILES" \
  docker compose -f "$COMPOSE_FILE" \
  --env-file "$ENV_FILE" \
  -p "$LOWER_PROJECT_NAME" \
  up -d --remove-orphans
