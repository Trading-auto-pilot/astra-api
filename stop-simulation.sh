#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# stop-simulation.sh — Ferma la simulazione e ripristina l'ambiente live
#
# Cosa fa:
#   1. Carica variabili da .env.local
#   2. Ferma e rimuove sim-engine
#   3. Ricrea decision-engine, capital-manager, liquidity-manager
#      con le env var originali (URL live, liquidity provider reale)
#
# Usage:
#   ./stop-simulation.sh
# ---------------------------------------------------------------------------

ENV_FILE=".env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ File $ENV_FILE non trovato — eseguire dalla root del progetto"
  exit 1
fi

# Nessuna variabile necessaria per i log — docker compose gestisce il file via --env-file

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SIMULATION STOP — ripristino ambiente live"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Ferma e rimuovi sim-engine
echo ""
echo "⛔ Stop sim-engine..."
docker compose \
  -f docker-compose.local.yml \
  -f docker-compose.sim.yml \
  --env-file "$ENV_FILE" \
  --profile simulator \
  stop sim-engine || true

docker compose \
  -f docker-compose.local.yml \
  -f docker-compose.sim.yml \
  --env-file "$ENV_FILE" \
  --profile simulator \
  rm -f sim-engine || true

# 2. Ricrea i servizi con la configurazione live (solo docker-compose.local.yml)
#    --force-recreate garantisce che le env var di simulazione vengano sostituite
#    con quelle originali anche se il container era già running.
echo ""
echo "♻️  Ripristino decision-engine, capital-manager, liquidity-manager in modalità live..."
docker compose \
  -f docker-compose.local.yml \
  --env-file "$ENV_FILE" \
  --profile decision-engine \
  --profile capital-manager \
  --profile liquidity-manager \
  up -d --force-recreate \
  decision-engine capital-manager liquidity-manager

# 3. Stato finale
echo ""
echo "🐳 Stato container dopo ripristino:"
docker compose \
  -f docker-compose.local.yml \
  --env-file "$ENV_FILE" \
  --profile decision-engine \
  --profile capital-manager \
  --profile liquidity-manager \
  ps decision-engine capital-manager liquidity-manager

echo ""
echo "✅ Ambiente live ripristinato."
echo "   decision-engine, capital-manager, liquidity-manager → config originale"
echo "   sim-engine → rimosso"
