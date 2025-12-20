# Base image
FROM node:20

# Working directory root
WORKDIR /app

# (opzionale, ma utile se ti serve curl anche negli altri servizi)
RUN apt-get update && apt-get install -y curl

# =========================
# Codice condiviso + servizio
# =========================
COPY serviceControlPlane/ ./serviceControlPlane/
COPY shared/ ./shared/

# Usa il package.json del microservizio ma installa in /app/node_modules
COPY serviceControlPlane/package.json .

RUN npm install --omit=dev

# Porta esposta (placeholder)
EXPOSE 3016

# Start the server
CMD ["node", "serviceControlPlane/server.js"]
