#!/bin/bash
        for service in DBManager cacheManager capitalManager alertingService strategyUtils LiveMarketListener orderListner orderSimulator marketsimulator strategies/sma; do
          name=$(basename "$service" | tr '[:upper:]' '[:lower:]')

          # Trova il file .js con lo stesso nome della cartella (confronto in lowercase)
          version_file=$(find "$service" -type f -name "*.js" | while read -r f; do
            file_base=$(basename "$f" .js | tr '[:upper:]' '[:lower:]')
            if [[ "$file_base" == "$name" ]]; then
              echo "$f"
              break
            fi
          done)

          if [[ -z "$version_file" ]]; then
            echo "⚠️  Nessun file corrispondente trovato in $service, salto versione..."
            continue
          fi

          version=$(grep MODULE_VERSION "$version_file" | head -n1 | sed -E "s/.*=[[:space:]]*['\"']([^'\"']+)['\"'].*/\1/" | tr -d '\r')
          echo "🔧 Building $name from $version_file with version $version..."

          docker build -t $DOCKERHUB_USERNAME/$name:latest -t $DOCKERHUB_USERNAME/$name:$version ./$service
          docker push $DOCKERHUB_USERNAME/$name:latest
          docker push $DOCKERHUB_USERNAME/$name:$version
        done