FROM node:20-alpine

WORKDIR /app

# Copiar dependencias primero (aprovecha caché de Docker)
COPY package*.json ./
# Instala TODAS las dependencias (incluye devDeps para desarrollo)
RUN npm install

# Copiar el resto del código
COPY . .

EXPOSE 3002

# --watch detecta cambios en archivos y reinicia automáticamente (Node 18+)
CMD ["node", "--watch", "index.js"]
