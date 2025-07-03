# Base image
FROM node:20

# Set working directory
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella LiveMarketListener e share dal context (la root del progetto)
COPY cacheManager/ ./cacheManager/
COPY shared/ ./shared/
COPY cacheManager/package.json .

# Installa le dipendenze
RUN npm install


# Expose port
EXPOSE 3000

# Default command
CMD [ "node", "server.js" ]
