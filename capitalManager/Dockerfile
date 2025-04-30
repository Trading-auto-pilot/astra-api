# Usa una base image Node.js
FROM node:18

# Imposta la directory di lavoro
WORKDIR /app

# Copia i file package
COPY package*.json ./

# Installa le dipendenze
RUN npm install

# Copia il resto dei file
COPY . .

# Espone la porta (puoi cambiarla se necessario)
EXPOSE 3007

# Comando di avvio
CMD ["npm", "start"]
