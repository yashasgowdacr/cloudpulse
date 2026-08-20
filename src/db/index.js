const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'cloudpulse',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  connectionString: process.env.DATABASE_URL || undefined,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('[DATABASE] Unexpected error on idle PostgreSQL client:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
