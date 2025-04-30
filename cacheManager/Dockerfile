# Base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Set environment variables if needed (can be overridden in docker-compose)
ENV NODE_ENV=production
ENV PORT=3006

# Expose port
EXPOSE 3006

# Default command
CMD [ "node", "server.js" ]
