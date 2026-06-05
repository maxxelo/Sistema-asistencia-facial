# Usa la imagen oficial de Node.js versión 24 liviana
FROM node:24-alpine

# Crea la carpeta de trabajo dentro del contenedor
WORKDIR /app

# Copia primero el package.json para aprovechar el cache de Docker
COPY package*.json ./

# Instala las dependencias dentro del contenedor
RUN npm install --omit=dev

# Copia el resto del código
COPY . .

# Expone el puerto 3003
EXPOSE 3003

# Comando para arrancar la API
CMD ["node", "index.js"]