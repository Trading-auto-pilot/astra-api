# Base image with Node.js
FROM node:18

# Set working directory
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella LiveMarketListener e share dal context (la root del progetto)
COPY alertingService/ ./alertingService/
COPY shared/ ./shared/

# Vai nella cartella della tua app
WORKDIR /app/alertingService

# Installa le dipendenze
COPY alertingService/package.json .
RUN npm install


# Expose application port
EXPOSE 3007

# Start the service
CMD [ "node", "server.js" ]
