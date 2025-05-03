# Base image
FROM node:20

# Set working directory
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia la cartella LiveMarketListener e share dal context (la root del progetto)
COPY cacheManager/ ./cacheManager/
COPY shared/ ./shared/

# Vai nella cartella della tua app
WORKDIR /app/cacheManager

# Installa le dipendenze
COPY cacheManager/package.json .
RUN npm install


# Expose port
EXPOSE 3006

# Default command
CMD [ "node", "server.js" ]
