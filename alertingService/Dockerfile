# Base image with Node.js
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files first (for caching dependencies)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app
COPY . .

# Expose application port
EXPOSE 3007

# Start the service
CMD [ "node", "server.js" ]
