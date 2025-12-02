FROM node:20

# Working directory root
WORKDIR /app

# (opzionale ma utile come gli altri)
RUN apt-get update && apt-get install -y curl

# Copia microservizio e shared
COPY tickerScanner/ ./tickerScanner/
COPY shared/ ./shared/

# Installa dipendenze usando il package.json del microservizio
COPY tickerScanner/package.json .

RUN npm install --omit=dev

# Porta esposta
EXPOSE 3013

# Avvia il server
CMD ["node", "tickerScanner/server.js"]
