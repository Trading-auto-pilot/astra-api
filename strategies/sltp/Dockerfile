# Base image
FROM node:20

# Set working directory
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia solo i file necessari per installare i pacchetti
COPY strategies/sltp/package*.json ./strategies/sltp/

# Installa le dipendenze
WORKDIR /app/strategies/sltp
RUN npm install

# Copia i file della strategia
COPY strategies/sltp/ ./

# Torna alla root per copiare la shared library
WORKDIR /app
# Copia i file condivisi
COPY shared/ ./shared/
WORKDIR /app/shared
RUN npm install

# Torna nella directory SLTP per eseguire l'app
WORKDIR /app/strategies/sltp


# Expose application port
EXPOSE 3011

# Start the app
CMD ["npm", "start"]
