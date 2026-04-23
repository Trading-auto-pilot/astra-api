#!/usr/bin/env bash
set -euo pipefail

# Uso:
#   ./deploy-with-profiles.sh                 # default ENV = PAPER
#   ./deploy-with-profiles.sh PAPER
#   ./deploy-with-profiles.sh LIVE

ENV_NAME="${1:-PAPER}"
COMPOSE_FILE="${2:-docker-compose.${ENV_NAME,,}.yml}"
ENV_FILE="${3:-.env}"

log() {
  # piccolo helper per log uniforme
  echo -e "$@"
}

log "🚀 Deploy environment: $ENV_NAME"
log "📄 Compose file:       $COMPOSE_FILE"
log "🔧 Env file:           $ENV_FILE"

# 1) Carico le variabili da .env
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  log "❌ Env file '$ENV_FILE' non trovato"
  exit 1
fi

# Debug: mostra versioni caricate
log "🧬 Variabili versione (da $ENV_FILE):"
env | grep -E 'VERSION=' || log "   (nessuna variabile *VERSION trovata)"

# 2) Leggo i profili da COMPOSE_PROFILES (già caricato dall'env file)
PROFILES="${COMPOSE_PROFILES:-}"
log "🧩 Profili attivi (da COMPOSE_PROFILES): '${PROFILES}'"

LOWER_PROJECT_NAME=$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]')
log "🏷  Docker Compose project name: ${LOWER_PROJECT_NAME}"

# Mostra i servizi definiti nel compose
log "🧱 Servizi definiti in ${COMPOSE_FILE}:"
ALL_SERVICES=$(docker compose -f "$COMPOSE_FILE" \
  --env-file "$ENV_FILE" \
  -p "$LOWER_PROJECT_NAME" \
  config --services)

log "$ALL_SERVICES"

# Debug: mostra anche l'immagine risolta per datahub
log "🔍 Config datahub risolto da docker compose:"
docker compose -f "$COMPOSE_FILE" \
  --env-file "$ENV_FILE" \
  -p "$LOWER_PROJECT_NAME" \
  config | sed -n '/datahub:/,/image/p' || true

# Mostra i container attivi per quel project
log "🐳 Container attivi per project '${LOWER_PROJECT_NAME}':"
docker compose -f "$COMPOSE_FILE" \
  --env-file "$ENV_FILE" \
  -p "$LOWER_PROJECT_NAME" \
  ps || true

# 4) Avvio/aggiorno stack con i profili calcolati
log "🛑 Fermiamo solo i microservizi NON core per l'ambiente $ENV_NAME"

CORE_SERVICES=("mysql" "redis")

for svc in $ALL_SERVICES; do
  if [[ ! " ${CORE_SERVICES[@]} " =~ " ${svc} " ]]; then
    log "⛔ Stop microservizio: $svc"

    # Verifico se esiste almeno un container per questo servizio
    SVC_CONTAINER_ID=$(docker compose -f "$COMPOSE_FILE" \
      --env-file "$ENV_FILE" \
      -p "$LOWER_PROJECT_NAME" \
      ps -q "$svc" || true)

    if [[ -z "$SVC_CONTAINER_ID" ]]; then
      log "ℹ️  Nessun container attivo per il servizio '$svc' (nulla da stoppare/rimuovere)"
    else
      log "   ➜ Container attivo: $SVC_CONTAINER_ID"
      docker compose -f "$COMPOSE_FILE" \
        --env-file "$ENV_FILE" \
        -p "$LOWER_PROJECT_NAME" \
        stop "$svc" || log "⚠️  stop '$svc' ha restituito errore (ignorato)"

      docker compose -f "$COMPOSE_FILE" \
        --env-file "$ENV_FILE" \
        -p "$LOWER_PROJECT_NAME" \
        rm -f "$svc" || log "⚠️  rm '$svc' ha restituito errore (ignorato)"
    fi
  else
    log "✅ Mantengo attivo il servizio core: $svc"
  fi
done

log "🧹 Pulizia immagini dangling prima del pull..."
docker images --filter "dangling=true" -q | xargs -r docker rmi || true

log "⬇️ Pull immagini CORE (mysql, redis, datahub)"
docker compose -f "$COMPOSE_FILE" \
  --env-file "$ENV_FILE" \
  -p "$LOWER_PROJECT_NAME" \
  pull mysql redis datahub

if [[ -n "$PROFILES" ]]; then
  log "⬇️ Scarico immagini per profili: ${PROFILES}"
  COMPOSE_PROFILES="$PROFILES" \
    docker compose -f "$COMPOSE_FILE" \
      --env-file "$ENV_FILE" \
      -p "$LOWER_PROJECT_NAME" \
      pull

  log "🧹 Pulizia immagini dangling dopo il pull..."
  docker images --filter "dangling=true" -q | xargs -r docker rmi || true

  log "▶️ Avvio stack con COMPOSE_PROFILES='${PROFILES}'"
  COMPOSE_PROFILES="$PROFILES" \
    docker compose -f "$COMPOSE_FILE" \
      --env-file "$ENV_FILE" \
      -p "$LOWER_PROJECT_NAME" \
      up -d --remove-orphans --force-recreate

else
  log "⚠️ Nessun profilo attivo: avvio solo core services"

  docker compose -f "$COMPOSE_FILE" \
    --env-file "$ENV_FILE" \
    -p "$LOWER_PROJECT_NAME" \
    pull

  log "🧹 Pulizia immagini dangling dopo il pull..."
  docker images --filter "dangling=true" -q | xargs -r docker rmi || true

  docker compose -f "$COMPOSE_FILE" \
    --env-file "$ENV_FILE" \
    -p "$LOWER_PROJECT_NAME" \
    up -d --remove-orphans --force-recreate
fi

log "🧽 Pulizia finale immagini dangling..."
docker images --filter "dangling=true" -q | xargs -r docker rmi || true

log "🐳 Stato finale container per project '${LOWER_PROJECT_NAME}':"
docker compose -f "$COMPOSE_FILE" \
  --env-file "$ENV_FILE" \
  -p "$LOWER_PROJECT_NAME" \
  ps || true

log "🎉 Deploy completato con successo per $ENV_NAME."
