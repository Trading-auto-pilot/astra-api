FROM node:18

# Crea cartella di lavoro
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella LiveMarketListener e share dal context (la root del progetto)
COPY LiveMarketListener/ ./LiveMarketListener/
COPY shared/ ./shared/
COPY LiveMarketListener/package.json .

# Installa le dipendenze

RUN npm install

# Imposta la porta esposta dal container
EXPOSE 3011

# Avvia il server
CMD ["node", "LiveMarketListener/server.js"]
