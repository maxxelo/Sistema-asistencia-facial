// Importa el cliente de PostgreSQL
const { Pool } = require('pg')

// Importa las variables del archivo .env
require('dotenv').config()

// Crea un pool de conexiones a PostgreSQL
// Un pool maneja múltiples conexiones simultáneas eficientemente
const pool = new Pool({
  host: process.env.DB_HOST,         // nombre del contenedor: "postgres"
  port: process.env.DB_PORT,         // puerto: 5432
  database: process.env.POSTGRES_DB, // nombre BD: colegio_db
  user: process.env.POSTGRES_USER,   // usuario: admin
  password: process.env.POSTGRES_PASSWORD // contraseña: admin123
})

// Exporta el pool para usarlo en las rutas
module.exports = pool