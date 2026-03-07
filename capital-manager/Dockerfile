FROM node:20
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copy service directory
COPY capital-manager/ ./capital-manager/

# Copy shared libraries
COPY shared/ ./shared/

# Copy package.json
COPY capital-manager/package.json .

# Install dependencies (only nodemon, rest is in shared)
RUN npm install --omit=dev

# Expose port
EXPOSE 3010

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3010/status/health || exit 1

# Start service
CMD ["node", "capital-manager/server.js"]
