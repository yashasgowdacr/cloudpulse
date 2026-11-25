// Importing the Express app during tests must not attempt a real database migration.
process.env.RUN_MIGRATIONS = 'false';
