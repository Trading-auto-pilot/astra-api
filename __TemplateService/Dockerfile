# Base image
FROM node:20

# Working directory root
WORKDIR /app

# (opzionale, ma utile se ti serve curl anche negli altri servizi)
RUN apt-get update && apt-get install -y curl

# =========================
# Codice condiviso + servizio
# =========================
COPY __SERVICE_FOLDER__/ ./__SERVICE_FOLDER__/
COPY shared/ ./shared/

# Usa il package.json del microservizio ma installa in /app/node_modules
COPY __SERVICE_FOLDER__/package.json .

RUN npm install --omit=dev

# Porta esposta (placeholder)
EXPOSE __PORT__

# Start the server
CMD ["node", "__SERVICE_FOLDER__/server.js"]
