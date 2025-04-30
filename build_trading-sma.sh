#!/bin/bash

# Nome immagine e container
IMAGE_NAME="trading-sma"
CONTAINER_NAME="sma-strategy"
DOCKERFILE_PATH="strategies/sma/Dockerfile"
CONTEXT_DIR="strategies/sma"

echo "[INFO] Fermo eventuale container esistente..."
docker stop $CONTAINER_NAME 2>/dev/null || echo "[INFO] Nessun container da fermare."

echo "[INFO] Rimuovo eventuale container esistente..."
docker rm $CONTAINER_NAME 2>/dev/null || echo "[INFO] Nessun container da rimuovere."

echo "[INFO] Costruisco nuova immagine Docker..."
docker build -f $DOCKERFILE_PATH -t $IMAGE_NAME .

echo "[INFO] Avvio nuovo container..."
docker run -d --name $CONTAINER_NAME -p 3001:3001 $IMAGE_NAME

echo "[INFO] Tutto pronto! 🚀"
