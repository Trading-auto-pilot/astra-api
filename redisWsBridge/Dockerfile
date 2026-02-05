# Base image
FROM node:20

# Working directory root
WORKDIR /app

# Optional tooling (curl used in healthchecks elsewhere)
RUN apt-get update && apt-get install -y curl

# Shared code + service
COPY redisWsBridge/ ./redisWsBridge/
COPY shared/ ./shared/

# Install dependencies at /app/node_modules
COPY redisWsBridge/package.json .
RUN npm install --omit=dev

# Expose service port
EXPOSE 3030

# Start the server
CMD ["node", "redisWsBridge/server.js"]
