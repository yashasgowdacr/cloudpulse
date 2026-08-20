const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const db = require('./index');
require('dotenv').config();

async function ensureDatabaseExists() {
  const targetDbName = process.env.DB_NAME || 'cloudpulse';

  // Connect to default 'postgres' database to check/create target database
  const rootPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    connectionString: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/\/[^/]+$/, '/postgres') : undefined
  });

  try {
    const res = await rootPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDbName]
    );

    if (res.rowCount === 0) {
      console.log(`[DATABASE] Database '${targetDbName}' does not exist. Creating database...`);
      // Sanitize identifier
      const safeDbName = targetDbName.replace(/"/g, '""');
      await rootPool.query(`CREATE DATABASE "${safeDbName}";`);
      console.log(`[DATABASE] Database '${targetDbName}' created successfully.`);
    }
  } catch (err) {
    console.error(`[DATABASE] Error checking/creating database '${targetDbName}':`, err.message);
    throw err;
  } finally {
    await rootPool.end();
  }
}

async function runMigrations() {
  await ensureDatabaseExists();
  console.log('[DATABASE] Running schema migrations...');
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    await db.query(sql);
    console.log('[DATABASE] Schema migrations executed successfully.');
  } catch (error) {
    console.error('[DATABASE] Migration failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
