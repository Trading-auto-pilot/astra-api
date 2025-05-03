# Usa una base image Node.js
FROM node:18

# Imposta la directory di lavoro
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella LiveMarketListener e share dal context (la root del progetto)
COPY capitalManager/ ./capitalManager/
COPY shared/ ./shared/

# Vai nella cartella della tua app
WORKDIR /app/capitalManager

# Installa le dipendenze
COPY capitalManager/package.json .
RUN npm install


# Espone la porta (puoi cambiarla se necessario)
EXPOSE 3007

# Comando di avvio
CMD ["npm", "start"]
