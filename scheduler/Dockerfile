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
COPY scheduler/package*.json ./scheduler/

WORKDIR /app/scheduler

# Install dependencies
RUN npm install --production

# Ora copia il resto dei sorgenti del microservizio
COPY scheduler/ ./

# Porta esposta (placeholder)
EXPOSE 3014

# Start the server
CMD ["node", "server.js"]
