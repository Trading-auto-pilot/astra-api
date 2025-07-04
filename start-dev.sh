#!/bin/bash
set -e

# Carica variabili da .env
if [ -f ".env" ]; then
  echo "🟢 Caricamento variabili da .env..."
  export $(grep -v '^#' .env | xargs)
else
  echo "🟡 Nessun file .env trovato"
fi

#Avvio mysql e Redis
docker-compose -f docker-compose.yml --env-file .env start mysql redis

# Ordine dei servizi da avviare
SERVICES=(
  "dbManager"
  "MarketSimulator"
  "orderSimulator"
  "cacheManager"
  "alertingService"
  "capitalManager"
  "strategies/sltp"
  "strategies/sma"
  "orderListner"
  "liveMarketListener"
)

# Colori per i prefissi (ciclo tra questi)
COLORS=(
  "32"  # green
  "34"  # blue
  "35"  # magenta
  "36"  # cyan
  "33"  # yellow
  "31"  # red
)

echo "🚀 Avvio dei servizi..."

mkdir -p logs
TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')

INDEX=0
for SERVICE in "${SERVICES[@]}"; do
  NAME=$(basename "$SERVICE")
  COLOR=${COLORS[$((INDEX % ${#COLORS[@]}))]}
  INDEX=$((INDEX + 1))
  LOG_FILE="$(pwd)/logs/${NAME}.log"

  echo -e "\033[1;${COLOR}m▶️  Avvio $NAME... (log: $LOG_FILE)\033[0m"

  # Avvia in background con prefisso colorato
  (
    cd "$SERVICE"
    npm run dev 2>&1 | while IFS= read -r line; do
      echo -e "\033[1;${COLOR}m[$NAME]\033[0m $line"
      echo "[$NAME] $line" >> "$LOG_FILE"
    done
  ) &
  sleep 1
done

# Mantiene il terminale vivo finché tutti i servizi sono attivi
wait
