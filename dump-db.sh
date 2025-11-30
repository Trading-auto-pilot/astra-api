#!/usr/bin/env bash
set -euo pipefail

# Variabili d’ambiente standard
DB_HOST="${MYSQL_HOST:-127.0.0.1}"
DB_PORT="${MYSQL_PORT:-3306}"
DB_USER="${MYSQL_USER:-root}"
DB_PASS="${MYSQL_PASSWORD:-example}"

if [ "$#" -ne 2 ]; then
  echo "Uso: $0 <AMBIENTE> <OUTPUT_FILENAME>"
  echo "Esempio: $0 PAPER trading_dump_paper.sql"
  exit 1
fi

AMBIENTE="$1"
OUTPUT_SQL="$2"

SRC_DB="Trading_${AMBIENTE}"
OUTPUT_TAR="${OUTPUT_SQL}.tar.gz"

echo "Database sorgente : ${SRC_DB}"
echo "File SQL          : ${OUTPUT_SQL}"
echo "File compresso    : ${OUTPUT_TAR}"
echo "Connessione a     : ${DB_HOST}:${DB_PORT} come ${DB_USER}"

# Dump + rimozione DEFINER
mysqldump -h "$DB_HOST" -P "$DB_PORT" --protocol=TCP \
  -u "$DB_USER" -p"$DB_PASS" \
  --triggers --events --add-drop-table \
  "$SRC_DB" \
| sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g' \
> "$OUTPUT_SQL"

echo "Dump completato."

# Compressione
tar -czf "$OUTPUT_TAR" "$OUTPUT_SQL"

echo "Compressione completata: ${OUTPUT_TAR}"
echo "Pronto per la delivery."
