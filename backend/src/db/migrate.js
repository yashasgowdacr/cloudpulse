const fs = require('fs');
const path = require('path');
const db = require('./index');
require('dotenv').config();

async function runMigrations() {
  console.log('[MIGRATION] Connected to PostgreSQL');
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    await db.query(sql);
    console.log('[MIGRATION] Schema migration completed successfully');
  } catch (error) {
    console.error('[MIGRATION] Migration failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  runMigrations()
    .then(async () => {
      if (db.pool && typeof db.pool.end === 'function') {
        await db.pool.end();
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runMigrations };

