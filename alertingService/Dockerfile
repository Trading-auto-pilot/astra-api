# Base image with Node.js
FROM node:18

# Set working directory
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella LiveMarketListener e share dal context (la root del progetto)
COPY alertingService/ ./alertingService/
COPY shared/ ./shared/
COPY alertingService/package.json .

# Installa le dipendenze

RUN npm install


# Expose application port
EXPOSE 3000

# Start the service
CMD [ "node", "alertingService/server.js" ]
