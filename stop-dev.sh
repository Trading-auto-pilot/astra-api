#!/bin/bash
set -e

echo "🛑 Interruzione ambiente di sviluppo..."

# 1. Termina tutti i processi Node.js figli dello script start-dev.sh
echo "🔍 Terminazione microservizi Node.js..."
PIDS=$(ps aux | grep -E "npm --prefix|node server\.js|sed|while read|start-dev\.sh" | grep -v grep | awk '{print $2}')

if [ -n "$PIDS" ]; then
  echo "🚫 Terminazione PID(s): $PIDS"
  kill $PIDS
else
  echo "✅ Nessun microservizio Node.js attivo trovato."
fi

# 2. Ferma i container Docker mysql e redis se sono attivi
echo "🧱 Arresto container Docker mysql e redis..."

if docker ps --format '{{.Names}}' | grep -q "^mysql$"; then
  docker-compose stop mysql
  echo "✅ MySQL fermato."
else
  echo "ℹ️  MySQL non era attivo."
fi

docker-compose stop mysql redis


echo "🏁 Ambiente di sviluppo arrestato con successo."
