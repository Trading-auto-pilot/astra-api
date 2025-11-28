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
COPY tickerScanner/package*.json ./tickerScanner/

WORKDIR /app/tickerScanner

# Install dependencies
RUN npm install --production

# Ora copia il resto dei sorgenti del microservizio
COPY tickerScanner/ ./

# Porta esposta (placeholder)
EXPOSE 3013

# Start the server
CMD ["node", "server.js"]
