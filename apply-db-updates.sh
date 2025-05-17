#!/bin/bash
set -e

# Carica .env se esiste
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DB_HOST="127.0.0.1"
DB_PORT="3306"
DB_NAME="Trading"

echo "🔍 Verifico se esiste la tabella schema_version nel DB..."
mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -e "
CREATE TABLE IF NOT EXISTS schema_version (
  id INT AUTO_INCREMENT PRIMARY KEY,
  script_name VARCHAR(255) UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"

echo "🔄 Avvio delle migrazioni..."

for script in $(ls db/*.sql | sort); do
  script_name=$(basename "$script")

  # ✅ Verifica se lo script è già stato applicato
  already_applied=$(mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -N -B -e \
    "SELECT COUNT(*) FROM schema_version WHERE script_name = '$script_name';")

  if [[ "$already_applied" -eq "0" ]]; then
    echo "⚙️  Applico $script_name..."

    set +e
    OUTPUT=$(mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME < "$script" 2>&1)
    STATUS=$?
    set -e

    echo "$OUTPUT"

    if [[ $STATUS -ne 0 ]] || echo "$OUTPUT" | grep -qi "ERROR"; then
      echo "❌ Errore durante l'applicazione di $script_name. Ripristino backup..."

      # ✅ Trova tutte le tabelle _backup e le ripristina
      TABLES=$(mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -N -e "SHOW TABLES LIKE '%_backup';")

      if [[ -n "$TABLES" ]]; then
        for backup_table in $TABLES; do
          original_table=${backup_table%_backup}
          echo "🔄 Ripristino $original_table da $backup_table..."
          mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -e "
            DROP TABLE IF EXISTS $original_table;
            RENAME TABLE $backup_table TO $original_table;
          "
        done
      fi

      echo "🚨 Operazione fallita. Migrazioni annullate."
      exit 1
    fi

    # ✅ Registra lo script come già applicato
    mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -e \
      "INSERT INTO schema_version (script_name) VALUES ('$script_name');"

  else
    echo "✅ $script_name già applicato, salto."
  fi
done

echo "✅ Migrazioni completate con successo. Pulizia dei backup..."

# ✅ Pulizia di tutte le tabelle _backup rimaste
TABLES=$(mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -N -e "SHOW TABLES LIKE '%_backup';")

if [[ -n "$TABLES" ]]; then
  for backup_table in $TABLES; do
    echo "🗑️  Eliminazione $backup_table..."
    mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME -e "DROP TABLE IF EXISTS $backup_table;"
  done
else
  echo "ℹ️  Nessun backup da eliminare."
fi

echo "🏁 Tutte le operazioni completate con successo."
exit 0
