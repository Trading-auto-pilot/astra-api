#!/bin/bash


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
echo "📝 Title: $global_title"
echo -e "📝 Note:\n$global_note"
echo "============================================"
echo ""

echo "🧪 Estrazione versioni + note dai moduli"
echo ""

# Directory di primo livello con release.json, escludendo doc, db, .git
first_level_services=$(find . -mindepth 1 -maxdepth 1 -type d \
  -not -name "doc" -not -name "db" -not -name ".git" \
  -exec test -f '{}/release.json' \; -print | sed 's|^\./||')

# Directory di secondo livello sotto strategies/ con release.json
second_level_services=$(find ./strategies -mindepth 1 -maxdepth 1 -type d \
  -exec test -f '{}/release.json' \; -print | sed 's|^\./||')

# Unisci i risultati
services="$first_level_services $second_level_services"

# Filtra solo quelle con .js corrispondente
valid_services=()

#for service in DBManager cacheManager capitalManager alertingService strategyUtils LiveMarketListener orderListner orderSimulator MarketSimulator strategies/sma; do
for service in $services; do
  name=$(basename "$service" | tr '[:upper:]' '[:lower:]')
  js_file="$service/$(basename "$service").js"
  if [[ -f "$js_file" ]]; then
    valid_services+=("$service")

    version_file=$(find "$valid_services" -type f -name "*.js" | while read -r f; do
      file_base=$(basename "$f" .js | tr '[:upper:]' '[:lower:]')
      echo "🔍 Trovato modulo $name in $valid_services"

      if [[ "$file_base" == "$name" ]]; then
        echo "$f"
        break
      fi
    done)

    if [[ -z "$version_file" ]]; then
      echo "⚠️  Nessun file .js corrispondente trovato in $valid_services, salto..."
      continue
    fi

    #version=$(grep MODULE_VERSION "$version_file" | sed -E "s/.*MODULE_VERSION *= *['\"]([^'\";]+)['\"].*/\1/" | tr -d '\r')
    version=$(grep -E 'MODULE_VERSION.*=' "$version_file" | sed -E "s/.*MODULE_VERSION.*= *['\"]([^'\";]+)['\"].*/\1/" | tr -d '\r')

    release_file="$valid_services/release.json"
    if [[ -f "$release_file" ]]; then
      last_update=$(grep '"lastUpdate"' "$release_file" | sed -E 's/.*: *"?([^",]+)"?.*/\1/' | tr -d '\r')
      #note=$(grep '"note"' "$release_file" | sed -E 's/.*: *"?([^"]+)"?.*/\1/' | tr -d '\r')
      # Estrai tutte le note come array
      note=$(jq -r '.note[]' "$release_file" | sed 's/^/- /' | tr '\n' '\n')
      # Unisci le note con newline

        note+="\n"
      for n in "${notes_array[@]}"; do
        note+="$n"$'\n'
      done
    else
      last_update="N/D"
      note="Nessuna release note disponibile"
    fi

    echo "📦 $name → v$version"
    echo "   🕒 Last update: $last_update"
    echo  -e "   📝 Note: $note"
    echo ""
  fi
done
} > "$RELEASE_NOTES_FILE"