# Base image
FROM node:20

# Working directory root
WORKDIR /app

# (opzionale, ma utile se ti serve curl anche negli altri servizi)
RUN apt-get update && apt-get install -y curl

# =========================
# Codice condiviso + servizio
# =========================
COPY decision-engine/ ./decision-engine/
COPY shared/ ./shared/

# Usa il package.json del microservizio ma installa in /app/node_modules
COPY decision-engine/package.json .

RUN npm install --omit=dev

# Porta esposta (placeholder)
EXPOSE 3018

# Start the server
CMD ["node", "decision-engine/server.js"]
