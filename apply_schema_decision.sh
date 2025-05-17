#!/bin/bash

DECISION=$1

if [[ -z "$DECISION" ]]; then
  echo "❌ Devi specificare OK o KO come parametro."
  exit 1
fi

echo "🔍 Recupero delle tabelle di backup presenti nel database..."

# Recupera l'elenco delle tabelle _backup
TABLES=$(mysql -h $DB_HOST -u $DB_USER -p$DB_PASS -N -e "SHOW TABLES LIKE '%_backup';" $DB_NAME)

if [[ -z "$TABLES" ]]; then
  echo "ℹ️  Nessuna tabella di backup trovata."
  exit 0
fi

if [[ "$DECISION" == "OK" ]]; then
  echo "✅ Pulizia di tutte le tabelle di backup..."
  for table in $TABLES; do
    echo "🗑️  Eliminazione $table..."
    mysql -h $DB_HOST -u $DB_USER -p$DB_PASS -e "DROP TABLE IF EXISTS \`$DB_NAME\`.\`$table\`;"
  done
  echo "✅ Pulizia completata."

elif [[ "$DECISION" == "KO" ]]; then
  echo "❌ Ripristino delle tabelle originali dai backup..."
  for backup_table in $TABLES; do
    original_table=${backup_table%_backup}
    echo "🔄 Ripristino $original_table da $backup_table..."
    mysql -h $DB_HOST -u $DB_USER -p$DB_PASS -e "
      DROP TABLE IF EXISTS \`$DB_NAME\`.\`$original_table\`;
      RENAME TABLE \`$DB_NAME\`.\`$backup_table\` TO \`$DB_NAME\`.\`$original_table\`;
    "
  done
  echo "✅ Ripristino completato."

else
  echo "⚠️  Parametro non valido. Usa OK o KO."
  exit 1
fi
