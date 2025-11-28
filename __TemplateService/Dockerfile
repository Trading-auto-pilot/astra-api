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
COPY __SERVICE_FOLDER__/package*.json ./__SERVICE_FOLDER__/

WORKDIR /app/__SERVICE_FOLDER__

# Install dependencies
RUN npm install --production

# Ora copia il resto dei sorgenti del microservizio
COPY __SERVICE_FOLDER__/ ./

# Porta esposta (placeholder)
EXPOSE __PORT__

# Start the server
CMD ["node", "server.js"]
