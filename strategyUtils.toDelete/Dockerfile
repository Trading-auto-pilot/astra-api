FROM node:18

# Set working directory
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella LiveMarketListener e share dal context (la root del progetto)
COPY strategyUtils/ ./strategyUtils/
COPY shared/ ./shared/

# Vai nella cartella della tua app
WORKDIR /app/strategyUtils

# Installa le dipendenze
COPY strategyUtils/package.json .
RUN npm install

# Expose the port (update if different)
EXPOSE 3007

# Start the server
CMD ["node", "server.js"]
