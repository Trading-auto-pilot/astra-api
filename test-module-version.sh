#!/bin/bash

echo "🧪 Test estrazione versione da file .js"

for service in DBManager cacheManager capitalManager alertingService strategyUtils LiveMarketListener orderListner orderSimulator marketsimulator strategies/sma; do
  name=$(basename "$service" | tr '[:upper:]' '[:lower:]')

  # Trova il file con lo stesso nome della cartella
  version_file=$(find "$service" -type f -name "*.js" | while read -r f; do
    file_base=$(basename "$f" .js | tr '[:upper:]' '[:lower:]')
    if [[ "$file_base" == "$name" ]]; then
      echo "$f"
      break
    fi
  done)

  if [[ -z "$version_file" ]]; then
    echo "⚠️  Nessun file corrispondente trovato in $service, salto..."
    continue
  fi

  # Estrai la versione da MODULE_VERSION (gestisce '1.0' o "1.0"; e spazi)
  version=$(grep MODULE_VERSION "$version_file" | sed -E "s/.*MODULE_VERSION *= *['\"]([^'\";]+)['\"].*/\1/" | tr -d '
')

  echo "📦 $name → $version (da $version_file)"
done
