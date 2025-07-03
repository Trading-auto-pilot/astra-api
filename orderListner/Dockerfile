FROM node:20

# Crea cartella di lavoro
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella LiveMarketListener e share dal context (la root del progetto)
COPY orderListner/ ./orderListner/
COPY shared/ ./shared/
COPY orderListner/package.json .


# Installa le dipendenze
RUN npm install

# Imposta la porta esposta dal container
EXPOSE 3000

# Avvia il server
CMD ["node", "orderListner/server.js"]
