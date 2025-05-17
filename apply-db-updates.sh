#!/bin/bash
set -e

# Carica il file .env se esiste
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# --- Configura qui i tuoi parametri locali ---
#ENV_NAME="LOCAL"
DB_HOST="127.0.0.1"
DB_PORT="3306"
#DB_USER="trading_user"
#DB_PASS="trading_pass"
DB_NAME="Trading"

echo "🔍 Verifico se esiste la tabella schema_version nel DB..."
mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE -e "
CREATE TABLE IF NOT EXISTS schema_version (
  id INT AUTO_INCREMENT PRIMARY KEY,
  script_name VARCHAR(255) UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"

for script in $(ls db/*.sql | sort); do
  script_name=$(basename "$script")

  already_applied=$(mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE -N -B -e \
    "SELECT COUNT(*) FROM schema_version WHERE script_name = '$script_name';")

  if [[ "$already_applied" -eq "0" ]]; then
    echo "⚙️  Applico $script_name su $ENV_NAME..."
    OUTPUT=$(mysql --abort-source-on-error -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < "$script" 2>&1)
    STATUS=$?

    echo "$OUTPUT"

    if [[ $STATUS -ne 0 ]]; then
      echo "❌ Errore durante l'applicazione di $script_name"
      exit 1
    fi

    mysql -h $DB_HOST -P $DB_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE -e \
      "INSERT INTO schema_version (script_name) VALUES ('$script_name');"
  else
    echo "✅ $script_name già applicato su $ENV_NAME, salto."
  fi
done

echo "🏁 Migrazioni completate per $ENV_NAME"
