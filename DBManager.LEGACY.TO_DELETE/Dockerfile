# Usa Node.js ufficiale come base
FROM node:20

# Imposta la working directory
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella DBManager e share dal context (la root del progetto)
COPY DBManager/ ./DBManager/
COPY shared/ ./shared/
COPY DBManager/package.json . 

# Installa le dipendenze
RUN npm install

# Imposta la porta esposta dal container
EXPOSE 3000

# Comando di avvio del server
CMD ["node", "DBManager/server.js"]
