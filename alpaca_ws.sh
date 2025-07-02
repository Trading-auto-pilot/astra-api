#!/bin/bash

API_KEY="PKNS94MR3ZI0U7AFMEBS"
API_SECRET="Sm2wcfjDQZo0aNGoofSWFSDESWgdVhPD6QczFx0R"
WS_URL="wss://stream.data.alpaca.markets/v2/iex"

AUTH_MSG=$(jq -nc --arg k "$API_KEY" --arg s "$API_SECRET" \
  '{action: "auth", key: $k, secret: $s}')

SUBSCRIBE_MSG='{"action":"subscribe","bars":["MSFT","AAPL","GLD","SPY","AMZN","SIL","GOOG","TSLA","META","XLF"]}'

# Usa process substitution per tenere stdin aperto
websocat "$WS_URL" < <(
  echo "$AUTH_MSG"
  sleep 1
  echo "$SUBSCRIBE_MSG"
  # Mantieni stdin aperto per evitare la chiusura
  tail -f /dev/null
)
