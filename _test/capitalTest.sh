#!/bin/bash

BASE_URL="http://localhost:3009"
STRATEGY_IDS=(10 13 14 15 16 17 18 19 20 21)

# 1. GET /capital (cache completa)
echo "== GET /capital =="
capital_json=$(curl -s "$BASE_URL/capital")
echo "$capital_json" | jq
echo -e "\n"

# Estrai la mappa degli rimanente
declare -A OPEN_ORDERS_MAP
for ID in "${STRATEGY_IDS[@]}"; do
  OPEN_ORDERS=$(echo "$capital_json" | jq -r ".capitalData[\"$ID\"].rimanente")
  OPEN_ORDERS_MAP[$ID]=$OPEN_ORDERS
done

for ID in "${STRATEGY_IDS[@]}"; do
    sleep 1
    echo "== Strategy ID: $ID =="

    # 2. GET /capital/:strategy_id
    echo "--> Reserving capital"
    curl -s "$BASE_URL/capital/$ID" | jq

    # 3. POST /capital/:strategy_id
    REQUESTED=${OPEN_ORDERS_MAP[$ID]}
    APPROVED=${OPEN_ORDERS_MAP[$ID]}
    echo "--> Inserting order (requested: $REQUESTED, approved: $APPROVED)"
    curl -s -X POST "$BASE_URL/capital/$ID" \
      -H "Content-Type: application/json" \
      -d "{\"requested\": $REQUESTED, \"approved\": $APPROVED}" | jq

    # 4. PUT /capital/:strategy_id
    USED=${OPEN_ORDERS_MAP[$ID]}
    echo "--> Accepting order (approved: $APPROVED, used: $USED)"
    curl -s -X PUT "$BASE_URL/capital/$ID" \
      -H "Content-Type: application/json" \
      -d "{\"approved\": $APPROVED, \"used\": $USED}" | jq

    echo -e "\n"
done

echo "== Done =="
