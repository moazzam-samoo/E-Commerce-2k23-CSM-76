import 'dotenv/config';
import { getPool } from '../lib/db.js';
import { createApp } from '../lib/app.js';

export const pool = getPool();

// Fake token verifier: the tests exercise OUR authorization logic without calling Supabase.
const USERS = {
  'admin-token': { id: 'u-admin', app_metadata: { role: 'admin' } },
  'shopper-token': { id: 'u-shopper', app_metadata: {} },
};
export const app = createApp({ pool, verifyToken: async (t) => USERS[t] || null });

export async function call(method, path, { body, token = 'admin-token', headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  return app({ method, url: `/api/v1/admin${path}`, headers: h, body });
}

// All test rows use slug prefix "test-" / SKU prefix "TEST-" so cleanup never touches real/seed data.
export async function cleanup() {
  await pool.query(`delete from products where slug like 'test-%'`);
  await pool.query(`update categories set parent_id = null where slug like 'test-%'`);
  await pool.query(`delete from categories where slug like 'test-%'`);
}

export async function makeCategory(slug, parent_id) {
  const r = await call('POST', '/categories', { body: { name: slug, slug, ...(parent_id ? { parent_id } : {}) } });
  if (r.status !== 201) throw new Error('makeCategory failed: ' + JSON.stringify(r.body));
  return r.body.data;
}

export async function makeProduct(slug, category_id) {
  const r = await call('POST', '/products', { body: { name: slug, slug, category_id } });
  if (r.status !== 201) throw new Error('makeProduct failed: ' + JSON.stringify(r.body));
  return r.body.data;
}
