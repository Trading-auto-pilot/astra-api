FROM node:20

WORKDIR /app

# (opzionale, se ti serve curl come negli altri)
RUN apt-get update && apt-get install -y curl

# Copia shared e microservizio
COPY cacheManager/ ./cacheManager/
COPY shared/ ./shared/

# Usa il package.json del microservizio ma nella root /app
COPY cacheManager/package.json .

# Installa le dipendenze in /app/node_modules
RUN npm install --omit=dev

EXPOSE 3006

CMD ["node", "cacheManager/server.js"]