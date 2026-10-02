// MODEL TESTS: talk to PostgreSQL directly (no API) to prove the DATABASE enforces the rules.
// CAT05: "API validation alone is not sufficient".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, cleanup } from './helpers.js';

const HAS_COST = true;
const q = (sql, params) => pool.query(sql, params);
const cat = async (slug, parent = null) =>
  (await q('insert into categories (name, slug, parent_id) values ($1, $1, $2) returning id', [slug, parent])).rows[0].id;
const prod = async (slug, category) =>
  (await q('insert into products (category_id, name, slug) values ($1, $2, $2) returning id', [category, slug])).rows[0].id;
const variant = async (product, a, b) =>
  (await q('insert into variants (product_id, dial_color, strap) values ($1, $2, $3) returning id', [product, a, b])).rows[0].id;
const sku = (product, variantId, code, price = '10.00', stock = 0) =>
  q(`insert into skus (product_id, variant_id, sku_code, price, ${HAS_COST ? 'cost_price, ' : ''}stock_quantity)
     values ($1, $2, $3, $4, ${HAS_COST ? '1, ' : ''}$5) returning id`, [product, variantId, code, price, stock]);

let catId;
beforeAll(async () => { await cleanup(); catId = await cat('test-m-root'); });
afterAll(async () => { await cleanup(); await pool.end(); });

describe('model: categories', () => {
  it('slug must be unique and well-formed; name must not be blank', async () => {
    await expect(q(`insert into categories (name, slug) values ('x', 'test-m-root')`)).rejects.toMatchObject({ code: '23505', constraint: 'categories_slug_key' });
    await expect(q(`insert into categories (name, slug) values ('x', 'Bad Slug')`)).rejects.toMatchObject({ code: '23514', constraint: 'categories_slug_format' });
    await expect(q(`insert into categories (name, slug) values ('   ', 'test-m-blank')`)).rejects.toMatchObject({ code: '23514' });
  });

  it('cannot be its own parent, nor its own ancestor (cycle trigger BQ001)', async () => {
    const a = await cat('test-m-a');
    const b = await cat('test-m-b', a);
    const c = await cat('test-m-c', b);
    // the trigger (BQ001) fires before the CHECK (23514 categories_not_own_parent); either way it is rejected
    await expect(q('update categories set parent_id = id where id = $1', [a])).rejects.toMatchObject({ code: expect.stringMatching(/^(BQ001|23514)$/) });
    await expect(q('update categories set parent_id = $2 where id = $1', [a, c])).rejects.toMatchObject({ code: 'BQ001' });
    await expect(q('update categories set parent_id = $2 where id = $1', [a, b])).rejects.toMatchObject({ code: 'BQ001' });
  });

  it('parent -> child deletion is RESTRICTed while children or products exist', async () => {
    const parent = await cat('test-m-par');
    await cat('test-m-kid', parent);
    await expect(q('delete from categories where id = $1', [parent])).rejects.toMatchObject({ code: '23503' });
    await prod('test-m-in-cat', catId);
    await expect(q('delete from categories where id = $1', [catId])).rejects.toMatchObject({ code: '23503' });
  });

  it('deactivating a parent deactivates the subtree; an active child under an inactive parent is rejected (BQ002)', async () => {
    const r = await cat('test-m-ar');
    const k = await cat('test-m-ak', r);
    const g = await cat('test-m-ag', k);
    await q('update categories set is_active = false where id = $1', [r]);
    const rows = await q('select is_active from categories where id in ($1, $2, $3)', [r, k, g]);
    expect(rows.rows.every((x) => x.is_active === false)).toBe(true);
    await expect(q('update categories set is_active = true where id = $1', [g])).rejects.toMatchObject({ code: 'BQ002' });
    await expect(q(`insert into categories (name, slug, parent_id) values ('n', 'test-m-new', $1)`, [r])).rejects.toMatchObject({ code: 'BQ002' });
  });

  it('updated_at is maintained by a trigger', async () => {
    const id = await cat('test-m-ts');
    const before = (await q('select updated_at from categories where id = $1', [id])).rows[0].updated_at;
    await new Promise((r) => setTimeout(r, 15));
    await q(`update categories set name = 'renamed' where id = $1`, [id]);
    const after = (await q('select updated_at from categories where id = $1', [id])).rows[0].updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe('model: products', () => {
  it('defaults to draft with an empty specifications object; slug unique; status restricted', async () => {
    const id = await prod('test-m-p1', catId);
    const row = (await q('select status, specifications, created_at from products where id = $1', [id])).rows[0];
    expect(row.status).toBe('draft');
    expect(row.specifications).toEqual({});
    expect(row.created_at).toBeInstanceOf(Date);
    await expect(q(`insert into products (category_id, name, slug) values ($1, 'x', 'test-m-p1')`, [catId])).rejects.toMatchObject({ code: '23505', constraint: 'products_slug_key' });
    await expect(q(`update products set status = 'sold' where id = $1`, [id])).rejects.toMatchObject({ code: '23514', constraint: 'products_status_valid' });
  });

  it('requires an existing category (FK) and a JSON-object specification', async () => {
    await expect(q(`insert into products (category_id, name, slug) values (999999, 'x', 'test-m-nocat')`)).rejects.toMatchObject({ code: '23503' });
    await expect(q(`insert into products (category_id, name, slug, specifications) values ($1, 'x', 'test-m-badspec', '[1,2]'::jsonb)`, [catId])).rejects.toMatchObject({ code: '23514', constraint: 'products_specs_is_object' });
  });

  it('a published product needs an active SKU, and keeps one (BQ003)', async () => {
    const p = await prod('test-m-pub', catId);
    await expect(q(`update products set status = 'published' where id = $1`, [p])).rejects.toMatchObject({ code: 'BQ003' });
    const s = (await sku(p, null, 'TEST-M-PUB-1')).rows[0].id;
    await q(`update products set status = 'published' where id = $1`, [p]);
    await expect(q('update skus set is_active = false where id = $1', [s])).rejects.toMatchObject({ code: 'BQ003' });
    await expect(q('delete from skus where id = $1', [s])).rejects.toMatchObject({ code: 'BQ003' });
  });

  it('deleting a draft product cascades to its variants and SKUs', async () => {
    const p = await prod('test-m-cascade', catId);
    const v = await variant(p, 'A', null);
    await sku(p, v, 'TEST-M-CAS-1');
    await q('delete from products where id = $1', [p]);
    expect((await q('select count(*)::int n from variants where product_id = $1', [p])).rows[0].n).toBe(0);
    expect((await q('select count(*)::int n from skus where product_id = $1', [p])).rows[0].n).toBe(0);
  });
});

describe('model: variants and SKUs', () => {
  it('a variant needs at least one option, and each combination exists only once (NULLs count as equal)', async () => {
    const p = await prod('test-m-var', catId);
    await expect(q('insert into variants (product_id) values ($1)', [p])).rejects.toMatchObject({ code: '23514', constraint: 'variants_has_option' });
    await variant(p, 'A', null);
    await expect(variant(p, 'A', null)).rejects.toMatchObject({ code: '23505', constraint: 'variants_combination_key' });
    await variant(p, 'A', 'B'); // a different combination is fine
  });

  it('sku_code is unique across the whole catalog and must be UPPERCASE-with-hyphens', async () => {
    const p1 = await prod('test-m-sk1', catId);
    const p2 = await prod('test-m-sk2', catId);
    await sku(p1, null, 'TEST-M-SKU-1');
    await expect(sku(p2, null, 'TEST-M-SKU-1')).rejects.toMatchObject({ code: '23505', constraint: 'skus_sku_code_key' });
    await expect(sku(p2, null, 'test-lowercase')).rejects.toMatchObject({ code: '23514', constraint: 'skus_sku_code_format' });
  });

  it('price must be > 0 and stock must not be negative', async () => {
    const p = await prod('test-m-money', catId);
    await expect(sku(p, null, 'TEST-M-PR-0', '0')).rejects.toMatchObject({ code: '23514', constraint: 'skus_price_positive' });
    await expect(sku(p, null, 'TEST-M-PR-N', '-5')).rejects.toMatchObject({ code: '23514' });
    await expect(sku(p, null, 'TEST-M-ST-N', '10', -1)).rejects.toMatchObject({ code: '23514', constraint: 'skus_stock_non_negative' });
    const id = (await sku(p, null, 'TEST-M-ST-OK', '10', 2)).rows[0].id;
    await expect(q('update skus set stock_quantity = stock_quantity - 3 where id = $1', [id])).rejects.toMatchObject({ code: '23514', constraint: 'skus_stock_non_negative' });
  });

  it.runIf(HAS_COST)('cost_price must not be negative', async () => {
    const p = await prod('test-m-cost', catId);
    const id = (await sku(p, null, 'TEST-M-COST-1')).rows[0].id;
    await expect(q('update skus set cost_price = -1 where id = $1', [id])).rejects.toMatchObject({ code: '23514', constraint: 'skus_cost_non_negative' });
    await expect(q('update skus set cost_price = null where id = $1', [id])).rejects.toMatchObject({ code: '23502' });
  });

  it('money is exact NUMERIC(12,2), never floating point', async () => {
    const cols = await q(`select column_name, data_type, numeric_scale from information_schema.columns
                          where table_name = 'skus' and column_name in ('price'${HAS_COST ? ", 'cost_price'" : ''})`);
    for (const c of cols.rows) {
      expect(c.data_type).toBe('numeric');
      expect(c.numeric_scale).toBe(2);
    }
    const p = await prod('test-m-exact', catId);
    const id = (await sku(p, null, 'TEST-M-EXACT', '19.9')).rows[0].id;
    expect((await q('select price::text as p from skus where id = $1', [id])).rows[0].p).toBe('19.90');
  });

  it('a SKU can only use a variant of the SAME product (composite FK)', async () => {
    const a = await prod('test-m-own-a', catId);
    const b = await prod('test-m-own-b', catId);
    const va = await variant(a, 'X', null);
    await expect(sku(b, va, 'TEST-M-OWN-1')).rejects.toMatchObject({ code: '23503', constraint: 'skus_variant_same_product_fkey' });
  });

  it('variants and variant-less SKUs cannot be mixed; only one default SKU per product (BQ004)', async () => {
    const p = await prod('test-m-mix', catId);
    await sku(p, null, 'TEST-M-MIX-1');
    await expect(sku(p, null, 'TEST-M-MIX-2')).rejects.toMatchObject({ code: '23505', constraint: 'skus_one_default_per_product' });
    await expect(variant(p, 'A', null)).rejects.toMatchObject({ code: 'BQ004' });
    const p2 = await prod('test-m-mix2', catId);
    await variant(p2, 'A', null);
    await expect(sku(p2, null, 'TEST-M-MIX-3')).rejects.toMatchObject({ code: 'BQ004' });
  });

  it('assets: role is restricted and a variant must belong to the same product', async () => {
    const a = await prod('test-m-as-a', catId);
    const b = await prod('test-m-as-b', catId);
    const vb = await variant(b, 'X', null);
    await expect(q(`insert into assets (product_id, storage_key, role) values ($1, 'k', 'banner')`, [a])).rejects.toMatchObject({ code: '23514', constraint: 'assets_role_valid' });
    await expect(q(`insert into assets (product_id, variant_id, storage_key) values ($1, $2, 'k')`, [a, vb])).rejects.toMatchObject({ code: '23503' });
    await q(`insert into assets (product_id, storage_key, role) values ($1, 'k', 'primary')`, [a]);
  });
});
