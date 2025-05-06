# Base image
FROM node:18

# Crea directory di lavoro
WORKDIR /app

# Copia package.json e installa dipendenze
COPY orderSimulator/package*.json ./orderSimulator/
WORKDIR /app/orderSimulator
RUN npm install

# Torna alla root per copiare shared e codice
WORKDIR /app
COPY orderSimulator/ ./orderSimulator/
COPY shared/ ./shared/

# Espone la porta (modifica se diversa)
EXPOSE 3010

# Comando di avvio
CMD ["node", "orderSimulator/server.js"]
