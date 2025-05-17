#!/bin/bash

set -e

# Carica .env se esiste
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DB_HOST="127.0.0.1"
DB_PORT="3306"
DB_NAME="Trading"

echo "🔍 Backup delle tabelle coinvolte..."
TABLES_TO_BACKUP=("strategies" "transazioni")

for table in "${TABLES_TO_BACKUP[@]}"; do
  echo "🗄️  Backup di $table..."
  mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -e "
    DROP TABLE IF EXISTS ${table}_backup;
    CREATE TABLE ${table}_backup AS SELECT * FROM ${table};
  "
done

echo "🔄 Avvio delle migrazioni..."

for script in $(ls db/*.sql | sort); do
  script_name=$(basename "$script")
  echo "⚙️  Applico $script_name..."
  
  set +e
  OUTPUT=$(mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME < "$script" 2>&1)
  STATUS=$?
  set -e

  echo "$OUTPUT"

  if [[ $STATUS -ne 0 ]] || echo "$OUTPUT" | grep -qi "ERROR"; then
    echo "❌ Errore durante l'applicazione di $script_name. Ripristino backup..."

    for table in "${TABLES_TO_BACKUP[@]}"; do
      echo "🔄 Ripristino $table da ${table}_backup..."
      mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -e "
        DROP TABLE IF EXISTS ${table};
        RENAME TABLE ${table}_backup TO ${table};
      "
    done

    echo "🚨 Operazione fallita. Migrazioni annullate."
    exit 1
  fi

  mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -e "
    INSERT INTO schema_version (script_name) VALUES ('$script_name');
  "
done

echo "✅ Migrazioni completate con successo. Pulizia dei backup..."

for table in "${TABLES_TO_BACKUP[@]}"; do
  echo "🗑️  Eliminazione ${table}_backup..."
  mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -e "
    DROP TABLE IF EXISTS ${table}_backup;
  "
done

echo "🏁 Tutte le operazioni completate con successo."
exit 0
