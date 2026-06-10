const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.POSTGRES_DB,
  user:     process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

pool.on('connect', () => console.log('[DB] API4 conectado a PostgreSQL'));
pool.on('error',   (err) => { console.error('[DB] Error pool:', err.message); process.exit(-1); });

module.exports = pool;
