# Base image
FROM node:20

# Set working directory
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia solo i file necessari per installare i pacchetti
COPY strategies/sma/package*.json ./strategies/sma/

# Installa le dipendenze
WORKDIR /app/strategies/sma
RUN npm install

# Copia i file della strategia
COPY strategies/sma/ ./

# Torna alla root per copiare la shared library
WORKDIR /app
# Copia i file condivisi
COPY shared/ ./shared/
WORKDIR /app/shared
RUN npm install

# Torna nella directory SMA per eseguire l'app
WORKDIR /app/strategies/sma


# Expose application port
EXPOSE 3010

# Start the app
CMD ["npm", "start"]
