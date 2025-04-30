# Usa Node.js ufficiale come base
FROM node:20

# Imposta la working directory
WORKDIR /app

# Copia package.json e package-lock.json (se esiste)
COPY package*.json ./

# Installa solo le dipendenze necessarie
RUN npm install

# Copia tutto il progetto nella working directory
COPY . .

# Imposta la porta esposta dal container
EXPOSE 3000

# Comando di avvio del server
CMD ["node", "server.js"]
