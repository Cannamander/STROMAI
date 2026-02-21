#!/usr/bin/env node
'use strict';
/**
 * Run all SQL migrations in services/nws-ingestor/migrations/ in order.
 * Requires DATABASE_URL in .env. Safe to run multiple times (migrations use IF NOT EXISTS).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../..', '.env') });
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const migrationsDir = path.join(__dirname, '..', 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Set it in .env and try again.');
    process.exit(1);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  try {
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log('Running', file, '...');
      await pool.query(sql);
      console.log('  OK');
    }
    console.log('Migrations complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
