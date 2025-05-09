#!/bin/bash
#
# Controlla che sia stato passato un nome
if [ -z "$1" ]; then
  echo "Uso: $0 <nome_servizio_docker_compose>"
  exit 1
fi

SERVICE_NAME=$1

echo "==> [1] Stopping docker-compose service: $SERVICE_NAME"
docker-compose down "$SERVICE_NAME"

echo "==> [2] Rimuovendo container con nome: $SERVICE_NAME"
CONTAINER_ID=$(docker ps -a --filter "name=${SERVICE_NAME}" --format "{{.ID}}" | head -n 1)
if [ -n "$CONTAINER_ID" ]; then
  docker container rm "$CONTAINER_ID"
else
  echo "   Nessun container trovato per $SERVICE_NAME"
fi

echo "==> [3] Rimuovendo l'immagine docker collegata a: $SERVICE_NAME"
IMAGE_ID=$(docker images --filter=reference="*${SERVICE_NAME}*" --format "{{.ID}}" | head -n 1)
if [ -n "$IMAGE_ID" ]; then
  docker image rm "$IMAGE_ID"
else
  echo "   Nessuna immagine trovata per $SERVICE_NAME"
fi

echo "==> [4] Ricompilando l'immagine per $SERVICE_NAME senza cache"
docker-compose build "$SERVICE_NAME" --no-cache

echo "==> [5] Avviando il container $SERVICE_NAME in background"
docker-compose up "$SERVICE_NAME" -d

echo "==> Completato per il servizio: $SERVICE_NAME"
