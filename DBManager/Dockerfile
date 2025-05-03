# Usa Node.js ufficiale come base
FROM node:20

# Imposta la working directory
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella DBManager e share dal context (la root del progetto)
COPY DBManager/ ./DBManager/
COPY shared/ ./shared/

# Vai nella cartella della tua app
WORKDIR /app/DBManager

# Installa le dipendenze
COPY DBManager/package.json .
RUN npm install

# Imposta la porta esposta dal container
EXPOSE 3000

# Comando di avvio del server
CMD ["node", "server.js"]
