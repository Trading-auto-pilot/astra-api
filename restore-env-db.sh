#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------
# 1️⃣ Parametri
# ---------------------------------------------------
if [ "$#" -ne 2 ]; then
  echo "Uso: $0 <ENV_NAME> <DUMP_TAR_GZ>"
  echo "Esempio: $0 PAPER Trading_PAPER_20251201.sql.tar.gz"
  exit 1
fi

ENV_NAME="$1"
TAR_FILE="$2"

# ---------------------------------------------------
# 2️⃣ Carico variabili da .env (che contiene MYSQL_*)
# ---------------------------------------------------
if [ -f .env ]; then
  set -a
  . .env
  set +a
else
  echo "❌ .env non trovato in $(pwd)"
  exit 1
fi

# ---------------------------------------------------
# 3️⃣ Controllo variabili obbligatorie
# ---------------------------------------------------
: "${MYSQL_USER:?MYSQL_USER non impostata in .env}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD non impostata in .env}"
: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD non impostata in .env}"

# ---------------------------------------------------
# 4️⃣ Imposto parametri DB dopo aver caricato .env
# ---------------------------------------------------
DB_HOST="127.0.0.1"                    # Sempre localhost per restore
DB_PORT="${MYSQL_PORT:-3306}"

# Utente ADMIN (root) per backup, drop/create, import, grant
DB_ADMIN_USER="root"
DB_ADMIN_PASS="$MYSQL_ROOT_PASSWORD"

# Utente applicativo
DB_APP_USER="$MYSQL_USER"
DB_APP_PASS="$MYSQL_PASSWORD"

# Logica DB:
#  - MAIN_DB = Trading          => DB corrente su cui importare il dump
#  - ENV_DB  = Trading_<ENV>    => es. Trading_PAPER, snapshot/backup dell'ambiente
MAIN_DB="Trading"
ENV_DB="Trading_${ENV_NAME}"

TS="$(date +'%Y%m%d_%H%M%S')"
BACKUP_TAR_CREATED=""

echo "Ambiente          : ${ENV_NAME}"
echo "DB corrente       : ${MAIN_DB}"
echo "DB ENV snapshot   : ${ENV_DB}"
echo "File dump in input: ${TAR_FILE}"
echo "Connessione admin : ${DB_HOST}:${DB_PORT} come ${DB_ADMIN_USER}"
echo "Utente applicativo: ${DB_APP_USER}@'%'"

# ---------------------------------------------------
# 5️⃣ Funzione: attesa MySQL healthy
# ---------------------------------------------------
wait_for_mysql_healthy() {
  local env_name="$1"
  local project_name="${env_name,,}"     # es. PAPER -> paper
  local container_id=""

  echo "⏳ Cerco il container MySQL per il project '${project_name}'..."

  # cerco un container tipo: paper-mysql-1
  for i in {1..10}; do
    container_id=$(docker ps -q --filter "name=${project_name}-mysql-")
    if [ -n "$container_id" ]; then
      echo "🆔 Trovato container MySQL: $container_id"
      break
    fi
    echo "⌛ Tentativo $i/10: container non ancora visibile, riprovo tra 2s..."
    sleep 2
  done

  if [ -z "$container_id" ]; then
    echo "❌ Impossibile trovare il container per '${project_name}-mysql-*'"
    exit 1
  fi

  echo "⏳ Attendo che MySQL sia healthy..."

  for i in {1..30}; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container_id" 2>/dev/null || echo "unknown")

    if [ "$status" = "healthy" ]; then
      echo "✅ MySQL è healthy (tentativo $i)"
      return 0
    fi

    echo "⌛ Tentativo $i/30: stato attuale = $status, riprovo tra 2s..."
    sleep 2
  done

  echo "❌ MySQL non è diventato healthy dopo 30 tentativi."
  exit 1
}

# ---------------------------------------------------
# 6️⃣ Avvio MySQL (solo servizio mysql)
# ---------------------------------------------------
echo "▶️ Avvio il servizio mysql per fare il restore..."
docker compose -f "docker-compose.${ENV_NAME,,}.yml" --env-file .env up -d mysql

wait_for_mysql_healthy "$ENV_NAME"
echo "✅ MySQL pronto, procedo con backup / rinomina / import..."

############################
# 1) BACKUP Trading_ENV    #
############################

echo "🔎 Verifico se il database ${ENV_DB} esiste per il backup..."

DB_ENV_EXISTS=$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASS" \
  -N -e "SHOW DATABASES LIKE '${ENV_DB}';" 2>/dev/null | wc -l)

if [ "$DB_ENV_EXISTS" -eq 0 ]; then
  echo "⚠️ Il database ${ENV_DB} non esiste ancora. Salto il backup iniziale."
else
  BACKUP_SQL="backup_${ENV_DB}_${TS}.sql"
  BACKUP_TAR="${BACKUP_SQL}.tar.gz"

  echo "📦 Eseguo backup del DB esistente: ${ENV_DB} → ${BACKUP_TAR}"

  mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASS" \
    "$ENV_DB" > "$BACKUP_SQL"

  tar -czf "$BACKUP_TAR" "$BACKUP_SQL"
  rm -f "$BACKUP_SQL"

  BACKUP_TAR_CREATED="$BACKUP_TAR"
  echo "✅ Backup completato: ${BACKUP_TAR_CREATED}"
fi

############################
# 2) Trading → Trading_ENV #
############################

echo "🔄 Rinomino il DB ${MAIN_DB} in ${ENV_DB} (se ${MAIN_DB} esiste)..."

DB_MAIN_EXISTS=$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASS" \
  -N -e "SHOW DATABASES LIKE '${MAIN_DB}';" 2>/dev/null | wc -l)

if [ "$DB_MAIN_EXISTS" -eq 0 ]; then
  echo "⚠️ Il database ${MAIN_DB} non esiste. Nessuna rinomina da fare."
else
  echo "🧹 Droppo l'eventuale vecchio ${ENV_DB} e lo ricreo vuoto..."
  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASS" <<SQL
DROP DATABASE IF EXISTS \`${ENV_DB}\`;
CREATE DATABASE \`${ENV_DB}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SQL

  echo "📁 Sposto le tabelle da ${MAIN_DB} a ${ENV_DB}..."
  TABLES=$(mysql -N -h "$DB_HOST" -P "$DB_PORT" -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASS" \
    -e "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema='${MAIN_DB}';")

  if [ -n "$TABLES" ]; then
    for tbl in $TABLES; do
      mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASS" \
        -e "RENAME TABLE \`${MAIN_DB}\`.\`${tbl}\` TO \`${ENV_DB}\`.\`${tbl}\`;"
    done
  fi

  echo "🗑️  Droppo il DB ${MAIN_DB} ormai vuoto..."
  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASS" \
    -e "DROP DATABASE IF EXISTS \`${MAIN_DB}\`;"

  echo "✅ Rinomina completata: ${MAIN_DB} → ${ENV_DB}"
fi

############################
# 3) CREATE Trading + IMPORT
############################

echo "🆕 Creo il DB vuoto: ${MAIN_DB}"
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASS" \
  -e "CREATE DATABASE \`${MAIN_DB}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

if [ ! -f "$TAR_FILE" ]; then
  echo "❌ File dump ${TAR_FILE} non trovato."
  exit 1
fi

TMP_DIR=$(mktemp -d)
echo "📂 Estraggo il dump da ${TAR_FILE} in ${TMP_DIR}"
tar -xzf "$TAR_FILE" -C "$TMP_DIR"

SQL_FILE=$(find "$TMP_DIR" -name '*.sql' | head -n 1)

if [ -z "$SQL_FILE" ]; then
  echo "❌ Nessun file .sql trovato dentro ${TAR_FILE}"
  rm -rf "$TMP_DIR"
  exit 1
fi

echo "📥 Importo il file SQL: ${SQL_FILE} nel DB ${MAIN_DB}"

mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASS" \
  "$MAIN_DB" < "$SQL_FILE"

rm -rf "$TMP_DIR"
echo "✅ Import completato in ${MAIN_DB}"

############################
# 4) GRANT ALL ALL'UTENTE  #
############################

echo "🔐 Concedo tutti i permessi su ${MAIN_DB} a ${DB_APP_USER}@'%'"

mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASS" <<SQL
CREATE USER IF NOT EXISTS '${DB_APP_USER}'@'%' IDENTIFIED BY '${DB_APP_PASS}';
GRANT ALL PRIVILEGES ON \`${MAIN_DB}\`.* TO '${DB_APP_USER}'@'%';
FLUSH PRIVILEGES;
SQL

echo "✅ Permessi concessi a ${DB_APP_USER}@'%' su ${MAIN_DB}"

echo "🎉 Ripristino completato con successo."
if [ -n "$BACKUP_TAR_CREATED" ]; then
  echo "📦 Backup precedente di ${ENV_DB} disponibile in: ${BACKUP_TAR_CREATED}"
else
  echo "ℹ️ Nessun backup precedente creato perché ${ENV_DB} non esisteva."
fi
