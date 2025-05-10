#!/bin/bash
#

# Salva output in file temporaneo
RELEASE_NOTES_FILE=release-notes.md
{
echo "============================================"
echo "🚀 Riepilogo Release Globale del Progetto"
echo "============================================"

global_release="./release.json"

if [[ -f "$global_release" ]]; then
  global_version=$(grep '"version"' "$global_release" | sed -E 's/.*: *"?([^",]+)"?.*/\1/' | tr -d '\r')
  global_update=$(grep '"lastUpdate"' "$global_release" | sed -E 's/.*: *"?([^",]+)"?.*/\1/' | tr -d '\r')
  global_title=$(grep '"title"' "$global_release" | sed -E 's/.*: *"?([^"]+)"?.*/\1/' | tr -d '\r')
  global_note=$(grep '"note"' "$global_release" | sed -E 's/.*: *"?([^"]+)"?.*/\1/' | tr -d '\r')
else
  global_version="N/D"
  global_update="N/D"
  global_title="N/D"
  global_note="File Release.json non trovato nella root"
fi

echo "📦 Version: $global_version"
echo "🕒 Last update: $global_update"
echo "🕒 Last update: $global_title"
echo "📝 Note: $global_note"
echo "====================================="
echo ""

echo "🧪 Estrazione versioni + note dai moduli"
echo ""

for service in DBManager cacheManager capitalManager alertingService strategyUtils LiveMarketListener orderListner orderSimulator MarketSimulator strategies/sma; do
  name=$(basename "$service" | tr '[:upper:]' '[:lower:]')

  version_file=$(find "$service" -type f -name "*.js" | while read -r f; do
    file_base=$(basename "$f" .js | tr '[:upper:]' '[:lower:]')
    if [[ "$file_base" == "$name" ]]; then
      echo "$f"
      break
    fi
  done)

  if [[ -z "$version_file" ]]; then
    echo "⚠️  Nessun file .js corrispondente trovato in $service, salto..."
    continue
  fi

  version=$(grep MODULE_VERSION "$version_file" | sed -E "s/.*MODULE_VERSION *= *['\"]([^'\";]+)['\"].*/\1/" | tr -d '\r')

  release_file="$service/release.json"
  if [[ -f "$release_file" ]]; then
    last_update=$(grep '"lastUpdate"' "$release_file" | sed -E 's/.*: *"?([^",]+)"?.*/\1/' | tr -d '\r')
    note=$(grep '"note"' "$release_file" | sed -E 's/.*: *"?([^"]+)"?.*/\1/' | tr -d '\r')
  else
    last_update="N/D"
    note="Nessuna release note disponibile"
  fi

  echo "📦 $name → v$version"
  echo "   🕒 Last update: $last_update"
  echo "   📝 Note: $note"
  echo ""
done
} > "$RELEASE_NOTES_FILE"