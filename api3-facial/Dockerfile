# Usa la imagen oficial de Node.js versión 24 liviana
FROM node:24-alpine

# Crea la carpeta de trabajo dentro del contenedor
WORKDIR /app

# Copia primero el package.json para aprovechar el cache de Docker
COPY package*.json ./

# Instala TODAS las dependencias (incluye devDeps para desarrollo)
RUN npm install

# Copia el resto del código
COPY . .

# Expone el puerto 3003
EXPOSE 3003

# --watch detecta cambios en archivos y reinicia automáticamente (Node 18+)
CMD ["node", "--watch", "index.js"]