# Base image
FROM node:20

# Set working directory
WORKDIR /app

# Copy package and install dependencies
COPY package.json ./
RUN npm install

# Copy all remaining source files
COPY . .

# Expose application port
EXPOSE 3010

# Start the app
CMD ["npm", "start"]
