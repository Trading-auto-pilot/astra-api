#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# start-simulation.sh — Avvia l'ambiente di simulazione
#
# Cosa fa:
#   1. Carica variabili da .env.local
#   2. Builda l'immagine sim-engine
#   3. Avvia sim-engine + ricrea decision-engine, capital-manager, liquidity-manager
#      con le env var di simulazione (URL → sim-engine, liquidity → mock)
#
# Servizi che devono essere già attivi (non toccati da questo script):
#   datahub, redis, cachemanager, traefik, scheduler, ecc.
#
# Usage:
#   ./start-simulation.sh           # usa .env.local, build solo se necessario
#   ./start-simulation.sh --build   # forza rebuild immagine sim-engine
# ---------------------------------------------------------------------------

FORCE_BUILD=false
for arg in "$@"; do
  [[ "$arg" == "--build" ]] && FORCE_BUILD=true
done

ENV_FILE=".env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ File $ENV_FILE non trovato — eseguire dalla root del progetto"
  exit 1
fi

# Estrai solo le variabili necessarie per i log (docker compose gestisce il resto via --env-file)
_env_get() { grep -m1 "^${1}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true; }
SIM_MODE=$(_env_get SIM_MODE); SIM_MODE=${SIM_MODE:-sync}
SIM_INITIAL_CAPITAL=$(_env_get SIM_INITIAL_CAPITAL); SIM_INITIAL_CAPITAL=${SIM_INITIAL_CAPITAL:-100000}
SIM_SLIPPAGE_PCT=$(_env_get SIM_SLIPPAGE_PCT); SIM_SLIPPAGE_PCT=${SIM_SLIPPAGE_PCT:-0.001}
ENV_NAME=$(_env_get ENV); ENV_NAME=${ENV_NAME:-local}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SIMULATION START"
echo "  ENV: ${ENV_NAME}  |  SIM_MODE: ${SIM_MODE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Build sim-engine
if [[ "$FORCE_BUILD" == true ]]; then
  echo ""
  echo "🔨 Build sim-engine (--no-cache)..."
  docker compose -f docker-compose.local.yml -f docker-compose.sim.yml \
    --env-file "$ENV_FILE" \
    build --no-cache sim-engine
else
  echo ""
  echo "🔨 Build sim-engine..."
  docker compose -f docker-compose.local.yml -f docker-compose.sim.yml \
    --env-file "$ENV_FILE" \
    build sim-engine
fi

# 2. Avvia sim-engine + ricrea i servizi overridati con env di simulazione
echo ""
echo "▶️  Avvio sim-engine e ricreazione servizi con config simulazione..."
docker compose \
  -f docker-compose.local.yml \
  -f docker-compose.sim.yml \
  --env-file "$ENV_FILE" \
  --profile simulator \
  --profile decision-engine \
  --profile capital-manager \
  --profile liquidity-manager \
  up -d --force-recreate \
  sim-engine decision-engine capital-manager liquidity-manager

# 3. Stato finale
echo ""
echo "🐳 Stato container simulazione:"
docker compose \
  -f docker-compose.local.yml \
  -f docker-compose.sim.yml \
  --env-file "$ENV_FILE" \
  --profile simulator \
  --profile decision-engine \
  --profile capital-manager \
  --profile liquidity-manager \
  ps sim-engine decision-engine capital-manager liquidity-manager

echo ""
echo "✅ Ambiente di simulazione attivo."
echo "   sim-engine → http://localhost:3010"
echo "   SIM_MODE=${SIM_MODE} | Capital=${SIM_INITIAL_CAPITAL} | Slippage=${SIM_SLIPPAGE_PCT}"
echo ""
echo "   Per fermare e ripristinare live: ./stop-simulation.sh"
