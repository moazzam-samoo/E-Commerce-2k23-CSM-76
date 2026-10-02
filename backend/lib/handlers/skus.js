import { validate, parseId } from '../validate.js';
import { notFound, updateRow } from './util.js';

const CREATE = {
  sku_code: { type: 'skuCode', required: true },
  variant_id: { type: 'id', nullable: true },
  price: { type: 'money', required: true },
  cost_price: { type: 'cost', required: true },
  stock_quantity: { type: 'int' },
  is_active: { type: 'bool' },
};
const PATCH = {
  price: { type: 'money' },
  cost_price: { type: 'cost' },
  stock_quantity: { type: 'int' },
  is_active: { type: 'bool' },
};

const shape = (s) => ({
  ...s,
  availability: !s.is_active ? 'unavailable' : s.stock_quantity === 0 ? 'out_of_stock' : 'in_stock',
});

export async function createSku({ db, params, body }) {
  const productId = parseId(params[0]);
  const f = validate(body, CREATE);
  const p = await db.query('select 1 from products where id = $1', [productId]);
  if (!p.rowCount) throw notFound('Product');
  const r = await db.query(
    `insert into skus (product_id, variant_id, sku_code, price, cost_price, stock_quantity, is_active)
     values ($1, $2, $3, $4, $5, coalesce($6, 0), coalesce($7, true)) returning *`,
    [productId, f.variant_id ?? null, f.sku_code, f.price, f.cost_price, f.stock_quantity ?? null, f.is_active ?? null],
  );
  return { status: 201, body: { data: shape(r.rows[0]) } };
}

export async function patchSku({ db, params, body }) {
  const id = parseId(params[0]);
  const f = validate(body, PATCH, { requireAny: true });
  const row = await updateRow(db, 'skus', id, f);
  if (!row) throw notFound('SKU');
  return { status: 200, body: { data: shape(row) } };
}

export async function deleteSku({ db, params }) {
  const id = parseId(params[0]);
  const r = await db.query('delete from skus where id = $1 returning id', [id]);
  if (!r.rowCount) throw notFound('SKU');
  return { status: 200, body: { data: { id, deleted: true } } };
}
