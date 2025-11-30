#!/usr/bin/env bash
set -euo pipefail

# USO:
#   ./clone-db.sh NOME_DB sorgente AMBIENTE
# Esempio:
#   ./clone-db.sh trading_system paper
#
# Risultato:
#   trading_system_paper (copia completa)

DB_HOST="${MYSQL_HOST:-localhost}"
DB_USER="${MYSQL_USER:-root}"
DB_PASS="${MYSQL_PASSWORD:-example}"

# Utente applicativo a cui dare i permessi
APP_USER="${APP_USER:-trading_user}"
APP_HOST="${APP_HOST:-%}"   # o 'localhost' se preferisci

if [ "$#" -ne 2 ]; then
  echo "Uso: $0 <DBNAME> <AMBIENTE>"
  echo "Esempio: $0 trading_system paper"
  exit 1
fi

SRC_DB="$1"
ENV="$2"
TARGET_DB="${SRC_DB}_${ENV}"   # se vuoi proprio il punto: "${SRC_DB}.${ENV}"

echo "Sorgente : ${SRC_DB}"
echo "Destinaz.: ${TARGET_DB}"
echo "Connessione a: $DB_HOST:$MYSQL_PORT come $DB_USER"
echo "Concedo permessi a: ${APP_USER}@${APP_HOST}"

# Drop & create del DB di destinazione
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" \
  -e "DROP DATABASE IF EXISTS \`${TARGET_DB}\`;
      CREATE DATABASE \`${TARGET_DB}\`;
      GRANT ALL PRIVILEGES ON \`${TARGET_DB}\`.* TO '${APP_USER}'@'${APP_HOST}';
      FLUSH PRIVILEGES;"

# Dump + restore (copia completa)
mysqldump -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" \
    --triggers --events --add-drop-table \
  "$SRC_DB" \
| sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g' \
| mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$TARGET_DB"


echo "Verifica DB creato:"
mysql -h "$DB_HOST" -P "$MYSQL_PORT" -u "$DB_USER" -p"$DB_PASS" \
  -e "SHOW DATABASES LIKE '${TARGET_DB}';"

echo "Clonazione completata: ${SRC_DB} → ${TARGET_DB}"
