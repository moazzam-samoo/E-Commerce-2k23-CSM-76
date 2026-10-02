import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, call, cleanup, makeCategory, makeProduct } from './helpers.js';

let cat;
beforeAll(async () => { await cleanup(); cat = await makeCategory('test-heritage'); });
afterAll(async () => { await cleanup(); await pool.end(); });

describe('creation with required fields', () => {
  it('admin creates category -> product (draft) -> variant -> SKU and reads them back', async () => {
    const p = await makeProduct('test-aurora', cat.id);
    expect(p.status).toBe('draft');
    expect(p.variants).toEqual([]);
    expect(p.skus).toEqual([]);

    const v = await call('POST', `/products/${p.id}/variants`, { body: { dial_color: 'Black', strap: 'Steel' } });
    expect(v.status).toBe(201);

    const s = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-AUR-BLK-STL', variant_id: v.body.data.id, cost_price: 1, price: '899.00', stock_quantity: 5 } });
    expect(s.status).toBe(201);
    expect(s.body.data.price).toBe('899.00'); // money stays a string, never a float
    expect(s.body.data.availability).toBe('in_stock');

    const list = await call('GET', '/products');
    const found = list.body.data.find((x) => x.slug === 'test-aurora');
    expect(found.variants).toHaveLength(1);
    expect(found.skus[0].sku_code).toBe('TEST-AUR-BLK-STL');
  });

  it('rejects missing/invalid fields with a consistent 400 error', async () => {
    const r = await call('POST', '/products', { body: { name: 'x' } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['category_id', 'slug']));
  });

  it('rejects a bad slug, unknown fields and a non-draft status on create', async () => {
    const r = await call('POST', '/products', { body: { name: 'x', slug: 'Bad Slug', category_id: cat.id, status: 'published', hacker: 1 } });
    expect(r.status).toBe(400);
    expect(r.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['slug', 'status', 'hacker']));
  });

  it('rejects an unknown category with 422 INVALID_REFERENCE', async () => {
    const r = await call('POST', '/products', { body: { name: 'x', slug: 'test-nocat', category_id: 999999 } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('INVALID_REFERENCE');
  });
});

describe('duplicate rejection (database constraints, not just API checks)', () => {
  it('duplicate category slug -> 409 DUPLICATE_SLUG', async () => {
    const r = await call('POST', '/categories', { body: { name: 'dup', slug: 'test-heritage' } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE_SLUG');
  });

  it('duplicate product slug -> 409 DUPLICATE_SLUG', async () => {
    await makeProduct('test-dup-product', cat.id);
    const r = await call('POST', '/products', { body: { name: 'again', slug: 'test-dup-product', category_id: cat.id } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE_SLUG');
  });

  it('duplicate SKU code -> 409 DUPLICATE_SKU_CODE (also across products)', async () => {
    const a = await makeProduct('test-sku-a', cat.id);
    const b = await makeProduct('test-sku-b', cat.id);
    const ok = await call('POST', `/products/${a.id}/skus`, { body: { sku_code: 'TEST-DUP-1', cost_price: 1, price: 100 } });
    expect(ok.status).toBe(201);
    const dup = await call('POST', `/products/${b.id}/skus`, { body: { sku_code: 'TEST-DUP-1', cost_price: 1, price: 200 } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_SKU_CODE');
  });

  it('the database itself rejects a duplicate slug (bypassing the API)', async () => {
    await expect(pool.query(`insert into categories (name, slug) values ('x', 'test-heritage')`)).rejects.toMatchObject({ code: '23505' });
  });
});

describe('category hierarchy', () => {
  it('prevents a category from becoming its own ancestor (cycle)', async () => {
    const a = await makeCategory('test-cyc-a');
    const b = await makeCategory('test-cyc-b', a.id);
    const c = await makeCategory('test-cyc-c', b.id);
    const r = await call('PATCH', `/categories/${a.id}`, { body: { parent_id: c.id } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('CATEGORY_CYCLE');
  });

  it('prevents a category from being its own parent', async () => {
    const a = await makeCategory('test-self');
    const r = await call('PATCH', `/categories/${a.id}`, { body: { parent_id: a.id } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('CATEGORY_CYCLE');
  });

  it('returns the category tree with children nested', async () => {
    const root = await makeCategory('test-tree-root');
    await makeCategory('test-tree-child', root.id);
    const r = await call('GET', '/categories');
    const node = r.body.data.find((c) => c.slug === 'test-tree-root');
    expect(node.children.map((c) => c.slug)).toEqual(['test-tree-child']);
  });

  it('deactivating a parent deactivates its subtree; a child cannot be re-activated under an inactive parent', async () => {
    const root = await makeCategory('test-act-root');
    const child = await makeCategory('test-act-child', root.id);
    const grand = await makeCategory('test-act-grand', child.id);
    const off = await call('PATCH', `/categories/${root.id}`, { body: { is_active: false } });
    expect(off.status).toBe(200);
    const rows = await pool.query(`select slug, is_active from categories where slug like 'test-act-%'`);
    expect(rows.rows.every((r) => r.is_active === false)).toBe(true);
    const on = await call('PATCH', `/categories/${grand.id}`, { body: { is_active: true } });
    expect(on.status).toBe(422);
    expect(on.body.error.code).toBe('PARENT_INACTIVE');
  });
});

describe('variants, SKUs, price and stock rules', () => {
  it('rejects negative stock at the API (400) and at the database (23514)', async () => {
    const p = await makeProduct('test-stock', cat.id);
    const s = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-STOCK-1', cost_price: 1, price: 50, stock_quantity: 3 } });
    const r = await call('PATCH', `/skus/${s.body.data.id}`, { body: { stock_quantity: -5 } });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].field).toBe('stock_quantity');
    await expect(pool.query('update skus set stock_quantity = -1 where id = $1', [s.body.data.id])).rejects.toMatchObject({ code: '23514' });
    const ok = await call('PATCH', `/skus/${s.body.data.id}`, { body: { stock_quantity: 0 } });
    expect(ok.body.data.availability).toBe('out_of_stock');
  });

  it('rejects float / zero / negative prices; accepts 2-decimal money', async () => {
    const p = await makeProduct('test-price', cat.id);
    for (const price of [12.345, 0, -5, 'abc']) {
      const r = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-PRICE-X', cost_price: 1, price } });
      expect(r.status).toBe(400);
    }
    const ok = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-PRICE-OK', cost_price: 1, price: '1299.50' } });
    expect(ok.status).toBe(201);
    expect(ok.body.data.price).toBe('1299.50');
    await expect(pool.query(`update skus set price = 0 where id = $1`, [ok.body.data.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('cost_price is required, may be 0, and can never be negative or a float with >2 decimals', async () => {
    const p = await makeProduct('test-cost', cat.id);
    const missing = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-COST-0', price: 100 } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.map((d) => d.field)).toContain('cost_price');
    for (const cost_price of [-1, 1.234, 'abc']) {
      const r = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-COST-1', price: 100, cost_price } });
      expect(r.status).toBe(400);
    }
    const ok = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-COST-OK', price: '1000.00', cost_price: '650.50' } });
    expect(ok.status).toBe(201);
    expect(ok.body.data.cost_price).toBe('650.50');
    await expect(pool.query('update skus set cost_price = -1 where id = $1', [ok.body.data.id])).rejects.toMatchObject({ code: '23514' });
    const upd = await call('PATCH', `/skus/${ok.body.data.id}`, { body: { cost_price: '700.00' } });
    expect(upd.body.data.cost_price).toBe('700.00');
  });

  it('two SKUs may share the same price', async () => {
    const p = await makeProduct('test-same-price', cat.id);
    const v1 = await call('POST', `/products/${p.id}/variants`, { body: { dial_color: 'A' } });
    const v2 = await call('POST', `/products/${p.id}/variants`, { body: { dial_color: 'B' } });
    const s1 = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-SP-A', variant_id: v1.body.data.id, cost_price: 1, price: 700 } });
    const s2 = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-SP-B', variant_id: v2.body.data.id, cost_price: 1, price: 700 } });
    expect([s1.status, s2.status]).toEqual([201, 201]);
  });

  it('only valid combinations exist: duplicate variant rejected, missing combination creates no row', async () => {
    const p = await makeProduct('test-combo', cat.id);
    const mk = (shade, size) => call('POST', `/products/${p.id}/variants`, { body: { dial_color: shade, strap: size } });
    expect((await mk('Black', 'Steel')).status).toBe(201);
    expect((await mk('Black', 'Leather')).status).toBe(201);
    expect((await mk('Silver', 'Steel')).status).toBe(201);
    const dup = await mk('Black', 'Steel');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_VARIANT');
    const n = await pool.query('select count(*)::int as n from variants where product_id = $1', [p.id]);
    expect(n.rows[0].n).toBe(3); // Silver/Leather was never created
    const skus = await pool.query('select count(*)::int as n from skus where product_id = $1', [p.id]);
    expect(skus.rows[0].n).toBe(0); // no fake zero-stock SKUs were generated
  });

  it('a SKU cannot use a variant of another product', async () => {
    const a = await makeProduct('test-own-a', cat.id);
    const b = await makeProduct('test-own-b', cat.id);
    const va = await call('POST', `/products/${a.id}/variants`, { body: { dial_color: 'X' } });
    const r = await call('POST', `/products/${b.id}/skus`, { body: { sku_code: 'TEST-OWN-1', variant_id: va.body.data.id, cost_price: 1, price: 10 } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('INVALID_REFERENCE');
  });

  it('variants and variant-less SKUs cannot be mixed on one product', async () => {
    const p = await makeProduct('test-mix', cat.id);
    await call('POST', `/products/${p.id}/variants`, { body: { dial_color: 'Only' } });
    const r = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-MIX-1', cost_price: 1, price: 10 } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VARIANT_MISMATCH');
  });
});

describe('product lifecycle', () => {
  it('a draft product may have no SKU; publishing needs an active SKU; the last active SKU cannot be removed', async () => {
    const p = await makeProduct('test-publish', cat.id);
    const early = await call('PATCH', `/products/${p.id}`, { body: { status: 'published' } });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('NOT_SELLABLE');

    const s = await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-PUB-1', cost_price: 1, price: 300, stock_quantity: 2 } });
    const pub = await call('PATCH', `/products/${p.id}`, { body: { status: 'published' } });
    expect(pub.status).toBe(200);
    expect(pub.body.data.status).toBe('published');

    const off = await call('PATCH', `/skus/${s.body.data.id}`, { body: { is_active: false } });
    expect(off.status).toBe(422);
    expect(off.body.error.code).toBe('NOT_SELLABLE');
    const del = await call('DELETE', `/skus/${s.body.data.id}`);
    expect(del.status).toBe(422);
  });

  it('only draft products can be deleted; published ones must be archived', async () => {
    const d = await makeProduct('test-del-draft', cat.id);
    expect((await call('DELETE', `/products/${d.id}`)).status).toBe(200);
    const p = await makeProduct('test-del-pub', cat.id);
    await call('POST', `/products/${p.id}/skus`, { body: { sku_code: 'TEST-DEL-1', cost_price: 1, price: 10 } });
    await call('PATCH', `/products/${p.id}`, { body: { status: 'published' } });
    const r = await call('DELETE', `/products/${p.id}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PRODUCT_NOT_DRAFT');
    expect((await call('PATCH', `/products/${p.id}`, { body: { status: 'archived' } })).status).toBe(200);
  });

  it('validates the specifications JSON rule', async () => {
    const good = await call('POST', '/products', { body: { name: 'spec', slug: 'test-spec-ok', category_id: cat.id, specifications: { finish: 'matte', vegan: true, weight_g: 3 } } });
    expect(good.status).toBe(201);
    const bad = await call('POST', '/products', { body: { name: 'spec', slug: 'test-spec-bad', category_id: cat.id, specifications: { nested: { a: 1 } } } });
    expect(bad.status).toBe(400);
  });

  it('returns 404 for unknown records and 400 for malformed ids', async () => {
    expect((await call('GET', '/products/999999')).status).toBe(404);
    expect((await call('PATCH', '/skus/999999', { body: { is_active: true } })).status).toBe(404);
    expect((await call('GET', '/products/abc')).status).toBe(400);
  });
});
