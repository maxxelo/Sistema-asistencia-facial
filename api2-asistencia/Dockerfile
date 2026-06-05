FROM node:20-alpine

WORKDIR /app

# Copiar dependencias primero (aprovecha caché de Docker)
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el resto del código
COPY . .

EXPOSE 3002

CMD ["node", "index.js"]
