import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, call } from './helpers.js';
import { createApp } from '../lib/app.js';
import { supabaseVerifier } from '../lib/auth.js';

afterAll(async () => { await pool.end(); });

// Every administrative route, with a minimal valid-looking body.
const ROUTES = [
  ['POST', '/categories', { name: 'x', slug: 'test-auth-x' }],
  ['GET', '/categories'],
  ['PATCH', '/categories/1', { name: 'y' }],
  ['POST', '/products', { name: 'x', slug: 'test-auth-p', category_id: 1 }],
  ['GET', '/products'],
  ['GET', '/products/1'],
  ['PATCH', '/products/1', { name: 'y' }],
  ['DELETE', '/products/1'],
  ['POST', '/products/1/variants', { dial_color: 'x' }],
  ['POST', '/products/1/skus', { sku_code: 'TEST-AUTH-1', price: 10, cost_price: 5 }],
  ['PATCH', '/skus/1', { price: 20 }],
  ['DELETE', '/skus/1'],
];

describe('authorization (fake users: admin / normal user / nobody)', () => {
  it.each(ROUTES)('%s %s -> 401 without a token', async (method, path, body) => {
    const r = await call(method, path, { body, token: null });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(ROUTES)('%s %s -> 401 with an invalid token', async (method, path, body) => {
    const r = await call(method, path, { body, token: 'garbage' });
    expect(r.status).toBe(401);
  });

  it.each(ROUTES)('%s %s -> 403 for a logged-in non-admin', async (method, path, body) => {
    const r = await call(method, path, { body, token: 'shopper-token' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('a rejected write never reaches the database', async () => {
    await call('POST', '/categories', { body: { name: 'sneaky', slug: 'test-sneaky' }, token: 'shopper-token' });
    const r = await pool.query(`select count(*)::int as n from categories where slug = 'test-sneaky'`);
    expect(r.rows[0].n).toBe(0);
  });

  it('malformed Authorization header -> 401', async () => {
    const r = await call('GET', '/products', { token: null, headers: { authorization: 'Token abc' } });
    expect(r.status).toBe(401);
  });

  it('unknown route -> 404 and wrong method -> 405, both in the standard error shape', async () => {
    const a = await call('GET', '/nope');
    expect(a.status).toBe(404);
    expect(a.body.error.code).toBe('NOT_FOUND');
    const b = await call('PUT', '/products');
    expect(b.status).toBe(405);
    expect(b.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });
});


// ---------------------------------------------------------------------------
// Authorization with REAL Supabase users (a real admin and a real normal "test user").
// Runs only when these variables are set in backend/.env; otherwise these tests are skipped.
//   SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, TEST_USER_EMAIL, TEST_USER_PASSWORD
// ---------------------------------------------------------------------------
const REAL = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'TEST_USER_EMAIL', 'TEST_USER_PASSWORD']
  .every((k) => process.env[k]);

async function login(email, password) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Supabase login failed for ${email}: ${data.error_description || data.msg || res.status}`);
  return data.access_token;
}

describe.skipIf(!REAL)('authorization with real Supabase users', () => {
  let realApp, adminToken, userToken;
  const hit = (method, path, token, body) =>
    realApp({ method, url: `/api/v1/admin${path}`, headers: token ? { authorization: `Bearer ${token}` } : {}, body });

  beforeAll(async () => {
    realApp = createApp({ pool, verifyToken: supabaseVerifier({ url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY }) });
    adminToken = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    userToken = await login(process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD);
  });

  it('real administrator can read the admin API (200)', async () => {
    const r = await hit('GET', '/products', adminToken);
    expect(r.status).toBe(200);
  });

  it('real administrator can create and remove a draft product', async () => {
    const cats = await hit('GET', '/categories', adminToken);
    const first = cats.body.data[0];
    const made = await hit('POST', '/products', adminToken, { name: 'auth probe', slug: 'test-real-admin-probe', category_id: first.id });
    expect(made.status).toBe(201);
    const del = await hit('DELETE', `/products/${made.body.data.id}`, adminToken);
    expect(del.status).toBe(200);
  });

  it('real logged-in NON-admin test user gets 403 on reads and writes, and nothing is written', async () => {
    expect((await hit('GET', '/products', userToken)).status).toBe(403);
    const w = await hit('POST', '/categories', userToken, { name: 'sneaky', slug: 'test-real-user-sneaky' });
    expect(w.status).toBe(403);
    expect(w.body.error.code).toBe('FORBIDDEN');
    const n = await pool.query(`select count(*)::int as n from categories where slug = 'test-real-user-sneaky'`);
    expect(n.rows[0].n).toBe(0);
  });

  it('no token or a tampered token gets 401', async () => {
    expect((await hit('GET', '/products', null)).status).toBe(401);
    expect((await hit('GET', '/products', adminToken.slice(0, -3) + 'abc')).status).toBe(401);
  });
});
