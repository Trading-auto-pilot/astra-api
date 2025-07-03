# Usa una base image Node.js
FROM node:20

# Imposta la directory di lavoro
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella LiveMarketListener e share dal context (la root del progetto)
COPY capitalManager/ ./capitalManager/
COPY shared/ ./shared/
COPY capitalManager/package.json .


# Installa le dipendenze
RUN npm install

# Espone la porta (puoi cambiarla se necessario)
EXPOSE 3000

# Comando di avvio
CMD ["node", "capitalManager/server.js"]
