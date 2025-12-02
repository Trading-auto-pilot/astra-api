#!/usr/bin/env bash
set -euo pipefail

# Uso:
#   ./deploy-with-profiles.sh                 # default ENV = PAPER
#   ./deploy-with-profiles.sh PAPER
#   ./deploy-with-profiles.sh LIVE

ENV_NAME="${1:-PAPER}"
COMPOSE_FILE="${2:-docker-compose.${ENV_NAME,,}.yml}"
ENV_FILE="${3:-.env}"

echo "🚀 Deploy environment: $ENV_NAME"
echo "📄 Compose file:       $COMPOSE_FILE"
echo "🔧 Env file:           $ENV_FILE"

# 1) Carico le variabili da .env
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "❌ Env file '$ENV_FILE' non trovato"
  exit 1
fi

# 2) Controllo variabili MYSQL_* minime
: "${MYSQL_HOST:?MYSQL_HOST non impostata in $ENV_FILE}"
: "${MYSQL_USER:?MYSQL_USER non impostata in $ENV_FILE}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD non impostata in $ENV_FILE}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE non impostata in $ENV_FILE}"
MYSQL_PORT="${MYSQL_PORT:-3306}"

# 👉 Dall'host, 'mysql' non è risolvibile: uso sempre 127.0.0.1
DB_HOST="$MYSQL_HOST"
if [ "$DB_HOST" = "mysql" ]; then
  DB_HOST="127.0.0.1"
fi

echo "🗄  Leggo i service_flags da ${MYSQL_DATABASE} (env='${ENV_NAME}') su ${DB_HOST}:${MYSQL_PORT}..."

RAW_MS=$(mysql -N -h "$DB_HOST" -P "$MYSQL_PORT" \
  -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
  -e "SELECT microservice FROM service_flags WHERE env='${ENV_NAME}' AND enabled = 1 ORDER BY microservice;") || {
    echo "❌ Errore nella query a service_flags"
    exit 1
  }

PROFILES_LIST=""

if [[ -z "${RAW_MS// }" ]]; then
  echo "⚠️ Nessun microservizio abilitato in service_flags per env='${ENV_NAME}'"
else
  while IFS= read -r ms; do
    ms_lc=$(echo "$ms" | tr '[:upper:]' '[:lower:]')

    case "$ms_lc" in
      marketsimulator|ordersimulator)
        PROFILES_LIST+=$'\n'"simul"
        ;;
      *)
        PROFILES_LIST+=$'\n'"$ms_lc"
        ;;
    esac
  done <<< "$RAW_MS"
fi

# Rimuovo vuoti, dedup e trasformo in lista separata da virgole
if [[ -n "${PROFILES_LIST// }" ]]; then
  PROFILES=$(printf '%s\n' "$PROFILES_LIST" | sed '/^$/d' | sort -u | paste -sd, -)
else
  PROFILES=""
fi

echo "🧩 Profili attivi dal DB per $ENV_NAME: '${PROFILES}'"

LOWER_PROJECT_NAME=$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]')

# 4) Avvio/aggiorno stack con i profili calcolati
echo "🛑 Fermiamo solo i microservizi NON core per l'ambiente $ENV_NAME"

CORE_SERVICES=("mysql" "redis" "traefik")

ALL_SERVICES=$(docker compose -f "$COMPOSE_FILE" \
  --env-file "$ENV_FILE" \
  -p "$LOWER_PROJECT_NAME" \
  config --services)

for svc in $ALL_SERVICES; do
  if [[ ! " ${CORE_SERVICES[@]} " =~ " ${svc} " ]]; then
    echo "⛔ Stop microservizio: $svc"
    docker compose -f "$COMPOSE_FILE" \
      --env-file "$ENV_FILE" \
      -p "$LOWER_PROJECT_NAME" \
      stop "$svc"
    docker compose -f "$COMPOSE_FILE" \
      --env-file "$ENV_FILE" \
      -p "$LOWER_PROJECT_NAME" \
      rm -f "$svc"
  else
    echo "✅ Mantengo attivo il servizio core: $svc"
  fi
done


echo "🧹 Pulizia immagini dangling prima del pull..."
docker images --filter "dangling=true" -q | xargs -r docker rmi || true

if [[ -n "$PROFILES" ]]; then
  echo "⬇️ Scarico immagini per profili: ${PROFILES}"
  COMPOSE_PROFILES="$PROFILES" \
    docker compose -f "$COMPOSE_FILE" \
      --env-file "$ENV_FILE" \
      -p "$LOWER_PROJECT_NAME" \
      pull

  echo "🧹 Pulizia immagini dangling dopo il pull..."
  docker images --filter "dangling=true" -q | xargs -r docker rmi || true

  echo "▶️ Avvio stack con COMPOSE_PROFILES='${PROFILES}'"
  COMPOSE_PROFILES="$PROFILES" \
    docker compose -f "$COMPOSE_FILE" \
      --env-file "$ENV_FILE" \
      -p "$LOWER_PROJECT_NAME" \
      up -d --remove-orphans --force-recreate

else
  echo "⚠️ Nessun profilo attivo: avvio solo core services"

  docker compose -f "$COMPOSE_FILE" \
    --env-file "$ENV_FILE" \
    -p "$LOWER_PROJECT_NAME" \
    pull

  echo "🧹 Pulizia immagini dangling dopo il pull..."
  docker images --filter "dangling=true" -q | xargs -r docker rmi || true

  docker compose -f "$COMPOSE_FILE" \
    --env-file "$ENV_FILE" \
    -p "$LOWER_PROJECT_NAME" \
    up -d --remove-orphans --force-recreate
fi

echo "🧽 Pulizia finale immagini dangling..."
docker images --filter "dangling=true" -q | xargs -r docker rmi || true

echo "🎉 Deploy completato con successo per $ENV_NAME."
