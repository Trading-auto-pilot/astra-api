# Base image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the app
COPY . .

# Expose the port (update if different)
EXPOSE 3007

# Start the server
CMD ["node", "server.js"]
