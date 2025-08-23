# Base image
FROM node:20

# Set working directory
WORKDIR /app

# Copy shared code and simulator
COPY shared/ ./shared/
COPY MarketSimulator/ ./MarketSimulator/

# Set working dir for MarketSimulator
WORKDIR /app/MarketSimulator

# Install dependencies
COPY MarketSimulator/package*.json ./
RUN npm install

# Expose WebSocket/API port
EXPOSE 3010

# Start the server
CMD ["node", "server.js"]
