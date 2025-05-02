# Usa Node ufficiale come base
FROM node:20

# Working dir nel container
WORKDIR /app

# Copia i package.json per installare
COPY package*.json ./

# Installa
RUN npm install

# Copia tutta la cartella corrente della strategia
COPY . .

# COPIA ANCHE shared/ nella root del container
COPY ../../shared ./shared

# Espone la porta
EXPOSE 3001

# Avvia server
CMD ["node", "strategies/sma/server.js"]
