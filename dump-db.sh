#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

# Variabili d’ambiente standard
DB_HOST="${MYSQL_HOST:-127.0.0.1}"
DB_PORT="${MYSQL_PORT:-3306}"
DB_USER="${MYSQL_USER:-root}"
DB_PASS="${MYSQL_PASSWORD:-example}"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Uso: $0 <AMBIENTE> [OUTPUT_FILENAME]"
  echo "Esempio: $0 PAPER trading_dump_paper.sql"
  exit 1
fi

AMBIENTE="$1"

TS="$(date +%Y%m%d_%H%M%S)"

SRC_DB="Trading_${AMBIENTE}"

# Path per dump e versioning
DB_DIR="db"
VERSIONS_DIR="${DB_DIR}/versions"

mkdir -p "$DB_DIR" "$VERSIONS_DIR"

# Sposta eventuali dump/archivi precedenti per questo ambiente in versions
for f in "${DB_DIR}/Trading_${AMBIENTE}_"*; do
  mv "$f" "$VERSIONS_DIR/" || true
done

if [ "$#" -eq 2 ]; then
  OUTPUT_SQL="$2"
else
  OUTPUT_SQL="Trading_${AMBIENTE}_${TS}.sql"
fi

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
> "${DB_DIR}/${OUTPUT_SQL}"

echo "Dump completato."

# Compressione
tar -czf "${DB_DIR}/${OUTPUT_TAR}" -C "${DB_DIR}" "${OUTPUT_SQL}"

rmdir --ignore-fail-on-non-empty "${DB_DIR}" >/dev/null 2>&1 || true

echo "Compressione completata: ${DB_DIR}/${OUTPUT_TAR}"
# Rimuove il file SQL lasciando solo il .tar.gz nel folder db/
rm -f "${DB_DIR}/${OUTPUT_SQL}"
echo "Pronto per la delivery."
