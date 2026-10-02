import { describe, it, expect, afterAll } from 'vitest';
import { pool, call } from './helpers.js';

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

describe('authorization', () => {
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
