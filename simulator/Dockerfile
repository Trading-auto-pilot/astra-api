FROM node:20
WORKDIR /app

RUN apt-get update && apt-get install -y curl python3 make g++

# Copy service directory
COPY simulator/ ./simulator/

# Copy shared libraries
COPY shared/ ./shared/

# Copy package.json
COPY simulator/package.json .

# Install dependencies
RUN npm install --omit=dev

# Expose port
EXPOSE 3010

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3010/status/health || exit 1

# Start service
CMD ["node", "simulator/server.js"]
