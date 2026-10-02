import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../lib/db.js';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'seed.sql');
const pool = getPool();
try {
  await pool.query(fs.readFileSync(file, 'utf8'));
  const c = await pool.query(`select (select count(*) from categories) as categories,
    (select count(*) from products) as products, (select count(*) from variants) as variants,
    (select count(*) from skus) as skus`);
  console.log('Seed complete:', c.rows[0]);
} finally {
  await pool.end();
}
