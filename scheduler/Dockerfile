FROM node:20

# Working directory root
WORKDIR /app

# (opzionale, se vuoi essere uniforme agli altri)
RUN apt-get update && apt-get install -y curl

# Copia microservizio e shared
COPY scheduler/ ./scheduler/
COPY shared/ ./shared/

# Usa il package.json del microservizio ma installa in /app/node_modules
COPY scheduler/package.json .

RUN npm install --omit=dev

# Porta esposta
EXPOSE 3014

# Avvia il server
CMD ["node", "scheduler/server.js"]
