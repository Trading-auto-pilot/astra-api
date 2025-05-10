#!/bin/bash

# Configurazioni
DB_NAME="Trading"
DB_USER="root"
DB_PASS="example"
DB_HOST="127.0.0.1"
DB_PORT="3316"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
OUTPUT_DIR="./db"
OUTPUT_FILE="$OUTPUT_DIR/tradingDb-${DB_NAME}-${TIMESTAMP}.sql"

# Assicurati che la cartella di output esista
# mkdir -p "$OUTPUT_DIR"

# Dump del database
echo "📦 Dump del database '$DB_NAME' su porta $DB_PORT → $OUTPUT_FILE"
#mysqldump --protocol=TCP -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" --skip-lock-tables --extended-insert "$DB_NAME" > "$OUTPUT_FILE"
mysqldump --protocol=TCP -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" --skip-lock-tables --no-create-info --extended-insert "$DB_NAME" > "$OUTPUT_DIR/tradingDb-${DB_NAME}-${TIMESTAMP}-data.sql"

# Verifica esito
if [ $? -eq 0 ]; then
  echo "✅ Dump completato con successo."
else
  echo "❌ Errore durante il dump."
  exit 1
fi
