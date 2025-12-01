#!/usr/bin/env bash
set -euo pipefail

# Variabili d’ambiente standard
DB_HOST="127.0.0.1"
DB_PORT="${MYSQL_PORT:-3306}"
DB_USER="${MYSQL_USER:-root}"
DB_PASS="${MYSQL_PASSWORD:-example}"

# Utente applicativo a cui dare i permessi sul DB ripristinato
APP_USER="${APP_USER:-Trading}"
APP_HOST="${APP_HOST:-%}"

if [ "$#" -ne 2 ]; then
  echo "Uso: $0 <AMBIENTE> <DUMP_TAR_GZ>"
  echo "Esempio: $0 LIVE Trading_LIVE_dump.sql.tar.gz"
  exit 1
fi

AMBIENTE="$1"
TAR_FILE="$2"

DB_NAME="Trading_${AMBIENTE}"
PREV_DB="${DB_NAME}.prev"
TS="$(date +'%Y%m%d_%H%M%S')"

BACKUP_SQL="backup_${DB_NAME}_${TS}.sql"
BACKUP_TAR="${BACKUP_SQL}.tar.gz"

echo "Ambiente          : ${AMBIENTE}"
echo "DB da sostituire  : ${DB_NAME}"
echo "DB precedente     : ${PREV_DB}"
echo "File dump in input: ${TAR_FILE}"
echo "Connessione a     : ${DB_HOST}:${DB_PORT} come ${DB_USER}"
echo "Utente applicativo: ${APP_USER}@${APP_HOST}"

############################
# 1) BACKUP DB ESISTENTE  #
############################

echo "Eseguo backup del DB esistente: ${DB_NAME} → ${BACKUP_SQL}"

mysqldump -h "$DB_HOST" -P "$DB_PORT" --protocol=TCP \
  -u "$DB_USER" -p"$DB_PASS" \
  --triggers --events --add-drop-table \
  "$DB_NAME" \
| sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g' \
> "$BACKUP_SQL"

tar -czf "$BACKUP_TAR" "$BACKUP_SQL"
rm -f "$BACKUP_SQL"

echo "Backup completato: ${BACKUP_TAR}"

############################
# 2) ESTRAZIONE NUOVO DUMP #
############################

if [ ! -f "$TAR_FILE" ]; then
  echo "ERRORE: file $TAR_FILE non trovato."
  exit 1
fi

echo "Estraggo il dump da: ${TAR_FILE}"

SQL_IN_TAR="$(tar -tzf "$TAR_FILE" | grep -E '\.sql$' | head -n 1 || true)"

if [ -z "$SQL_IN_TAR" ]; then
  echo "ERRORE: nessun file .sql trovato dentro ${TAR_FILE}"
  exit 1
fi

tar -xzf "$TAR_FILE" "$SQL_IN_TAR"

echo "File SQL estratto: ${SQL_IN_TAR}"

############################
# 3) DROP + CREATE + GRANT #
############################

echo "Rinomino il DB esistente in ${PREV_DB} (se presente)"

# verifica esistenza DB corrente
DB_EXISTS=$(mysql -N -h "$DB_HOST" -P "$DB_PORT" --protocol=TCP -u "$DB_USER" -p"$DB_PASS" \
  -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${DB_NAME}';")

if [ "$DB_EXISTS" -gt 0 ]; then
  # elimina eventuale DB .prev precedente e ricrealo
  mysql -h "$DB_HOST" -P "$DB_PORT" --protocol=TCP -u "$DB_USER" -p"$DB_PASS" \
    -e "DROP DATABASE IF EXISTS \`${PREV_DB}\`; CREATE DATABASE \`${PREV_DB}\`;"

  TABLES=$(mysql -N -h "$DB_HOST" -P "$DB_PORT" --protocol=TCP -u "$DB_USER" -p"$DB_PASS" \
    -e "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema='${DB_NAME}';")

  if [ -n "$TABLES" ]; then
    for tbl in $TABLES; do
      mysql -h "$DB_HOST" -P "$DB_PORT" --protocol=TCP -u "$DB_USER" -p"$DB_PASS" \
        -e "RENAME TABLE \`${DB_NAME}\`.\`${tbl}\` TO \`${PREV_DB}\`.\`${tbl}\`;"
    done
  fi

  # droppa il DB ormai vuoto
  mysql -h "$DB_HOST" -P "$DB_PORT" --protocol=TCP -u "$DB_USER" -p"$DB_PASS" \
    -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`;"
else
  echo "Nessun DB ${DB_NAME} trovato: nessuna rinomina necessaria."
fi

echo "Creo il DB vuoto: ${DB_NAME}"

mysql -h "$DB_HOST" -P "$DB_PORT" --protocol=TCP \
  -u "$DB_USER" -p"$DB_PASS" \
  -e "CREATE DATABASE \`${DB_NAME}\`;"

mysql -h "$DB_HOST" -P "$DB_PORT" --protocol=TCP \
  -u "$DB_USER" -p"$DB_PASS" \
  -e "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${APP_USER}'@'${APP_HOST}'; FLUSH PRIVILEGES;"

############################
# 4) IMPORT NUOVO DUMP     #
############################

echo "Importo il nuovo dump nel DB: ${DB_NAME}"

mysql -h "$DB_HOST" -P "$DB_PORT" --protocol=TCP \
  -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$SQL_IN_TAR"

echo "Import completato."

# opzionale: eliminare il .sql estratto
rm -f "$SQL_IN_TAR"

echo "Ripristino completato con successo."
echo "Backup precedente disponibile in: ${BACKUP_TAR}"
