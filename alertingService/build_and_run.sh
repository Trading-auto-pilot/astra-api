#!/bin/bash

# Settaggio colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}[INFO] Estrazione modulo e versione...${NC}"

# Estrai MODULE_NAME e MODULE_VERSION da alertingService.js
MODULE_NAME_RAW=$(grep "const MODULE_NAME" alertingService.js | awk -F"'" '{print $2}')
MODULE_VERSION=$(grep "const MODULE_VERSION" alertingService.js | awk -F"'" '{print $2}')

# Converto il nome in minuscolo
MODULE_NAME=$(echo "$MODULE_NAME_RAW" | tr '[:upper:]' '[:lower:]')

if [ -z "$MODULE_NAME" ] || [ -z "$MODULE_VERSION" ]; then
  echo -e "${RED}[ERROR] Impossibile leggere MODULE_NAME o MODULE_VERSION dal file alertingService.js${NC}"
  exit 1
fi

# Definizione immagine
IMAGE_NAME="${MODULE_NAME}:${MODULE_VERSION}"

echo -e "${GREEN}[INFO] Costruzione immagine Docker: $IMAGE_NAME${NC}"

# Build dell'immagine
docker build -t "$IMAGE_NAME" .

# Ferma ed elimina il container esistente
CONTAINER_NAME="$MODULE_NAME"

if [ "$(docker ps -aq -f name=^/${CONTAINER_NAME}$)" ]; then
    echo -e "${YELLOW}[INFO] Arresto container esistente: $CONTAINER_NAME${NC}"
    docker stop "$CONTAINER_NAME"
    docker rm "$CONTAINER_NAME"
fi

# Avvia nuovo container
#echo -e "${GREEN}[INFO] Avvio nuovo container: $CONTAINER_NAME${NC}"
#docker run -d --name "$CONTAINER_NAME" -p 3002:3002 --env-file ../.env "$IMAGE_NAME"

#echo -e "${GREEN}[SUCCESS] Container $CONTAINER_NAME avviato con successo!${NC}"

# Chiedi se pushare su Docker Hub
read -p "$(echo -e $YELLOW"[QUESTION] Vuoi pushare l'immagine su Docker Hub? (y/n): "$NC)" scelta

if [[ "$scelta" == "y" ]]; then
    read -p "$(echo -e $YELLOW"[QUESTION] Inserisci il tuo Docker Hub username: "$NC)" dockerhub_user

    FULL_IMAGE_NAME="${dockerhub_user}/${MODULE_NAME}:${MODULE_VERSION}"

    echo -e "${GREEN}[INFO] Tag immagine come: $FULL_IMAGE_NAME${NC}"
    docker tag "$IMAGE_NAME" "$FULL_IMAGE_NAME"

    echo -e "${GREEN}[INFO] Push dell'immagine su Docker Hub...${NC}"
    docker push "$FULL_IMAGE_NAME"

    echo -e "${GREEN}[SUCCESS] Push completato su Docker Hub: $FULL_IMAGE_NAME${NC}"
else
    echo -e "${YELLOW}[INFO] Push saltato.${NC}"
fi
