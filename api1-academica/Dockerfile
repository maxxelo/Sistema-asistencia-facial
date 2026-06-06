FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# Instala TODAS las dependencias (incluye devDeps para desarrollo)
RUN npm install

COPY . .

EXPOSE 3001

# --watch detecta cambios en archivos y reinicia automáticamente (Node 18+)
CMD ["node", "--watch", "index.js"]
