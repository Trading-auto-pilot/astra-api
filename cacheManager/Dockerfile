# Base image
FROM node:20

# Working directory root
WORKDIR /app

# Copy shared code (comune a tutti i microservizi)
COPY shared/ ./shared/

# =========================
# Microservizio specifico
# =========================
# Copia solo package.json per caching corretto
COPY cacheManager/package*.json ./cacheManager/

WORKDIR /app/cacheManager

# Install dependencies
RUN npm install --production

# Ora copia il resto dei sorgenti del microservizio
COPY cacheManager/ ./

# Porta esposta (placeholder)
EXPOSE 3006

# Start the server
CMD ["node", "server.js"]
