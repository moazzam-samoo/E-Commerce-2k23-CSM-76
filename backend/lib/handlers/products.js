import { validate, parseId } from '../validate.js';
import { ApiError } from '../errors.js';
import { notFound, updateRow } from './util.js';

const CREATE = {
  category_id: { type: 'id', required: true },
  name: { type: 'string', required: true },
  slug: { type: 'slug', required: true },
  description: { type: 'text' },
  status: { type: 'enum', values: ['draft'] }, // products are always created as drafts
  specifications: { type: 'specs' },
};
const PATCH = {
  category_id: { type: 'id' },
  name: { type: 'string' },
  slug: { type: 'slug' },
  description: { type: 'text' },
  status: { type: 'enum', values: ['draft', 'published', 'archived'] },
  specifications: { type: 'specs' },
};
const VARIANT = {
  dial_color: { type: 'string', max: 60 },
  strap: { type: 'string', max: 60 },
};

// One query returns the product with its variants and SKUs. Prices are cast to text
// so money never passes through a JavaScript float.
const SELECT = `
  select p.id, p.category_id, p.name, p.slug, p.description, p.status, p.specifications,
         p.created_at, p.updated_at,
    (select coalesce(json_agg(json_build_object(
        'id', v.id, 'dial_color', v.dial_color, 'strap', v.strap
      ) order by v.id), '[]'::json) from variants v where v.product_id = p.id) as variants,
    (select coalesce(json_agg(json_build_object(
        'id', s.id, 'variant_id', s.variant_id, 'sku_code', s.sku_code,
        'price', s.price::text, 'cost_price', s.cost_price::text, 'stock_quantity', s.stock_quantity, 'is_active', s.is_active,
        'availability', case when not s.is_active then 'unavailable'
                             when s.stock_quantity = 0 then 'out_of_stock'
                             else 'in_stock' end
      ) order by s.id), '[]'::json) from skus s where s.product_id = p.id) as skus
  from products p`;

export async function fetchProduct(db, id) {
  const r = await db.query(`${SELECT} where p.id = $1`, [id]);
  return r.rows[0];
}

export async function createProduct({ db, body }) {
  const f = validate(body, CREATE);
  const r = await db.query(
    `insert into products (category_id, name, slug, description, specifications)
     values ($1, $2, $3, coalesce($4, ''), coalesce($5::jsonb, '{}'::jsonb)) returning id`,
    [f.category_id, f.name, f.slug, f.description ?? null, f.specifications ? JSON.stringify(f.specifications) : null],
  );
  return { status: 201, body: { data: await fetchProduct(db, r.rows[0].id) } };
}

export async function patchProduct({ db, params, body }) {
  const id = parseId(params[0]);
  const f = validate(body, PATCH, { requireAny: true });
  const row = await updateRow(db, 'products', id, f, ['specifications']);
  if (!row) throw notFound('Product');
  return { status: 200, body: { data: await fetchProduct(db, id) } };
}

export async function listProducts({ db, query }) {
  const where = [];
  const vals = [];
  if (query.status) {
    if (!['draft', 'published', 'archived'].includes(query.status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid query parameter', [{ field: 'status', message: 'must be draft, published or archived' }]);
    }
    vals.push(query.status); where.push(`p.status = $${vals.length}`);
  }
  if (query.category_id) {
    vals.push(parseId(query.category_id, 'category_id')); where.push(`p.category_id = $${vals.length}`);
  }
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination', [{ field: 'limit/offset', message: 'limit must be 1-200 and offset >= 0' }]);
  }
  vals.push(limit, offset);
  const sql = `${SELECT} ${where.length ? 'where ' + where.join(' and ') : ''}
               order by p.id limit $${vals.length - 1} offset $${vals.length}`;
  const r = await db.query(sql, vals);
  return { status: 200, body: { data: r.rows, meta: { limit, offset, count: r.rows.length } } };
}

export async function getProduct({ db, params }) {
  const row = await fetchProduct(db, parseId(params[0]));
  if (!row) throw notFound('Product');
  return { status: 200, body: { data: row } };
}

// Only DRAFT products can be hard-deleted. Anything that may be referenced by carts/orders
// must be archived instead (status = "archived") so history is never lost.
export async function deleteProduct({ db, params }) {
  const id = parseId(params[0]);
  const r = await db.query(`delete from products where id = $1 and status = 'draft' returning id`, [id]);
  if (r.rowCount === 0) {
    const e = await db.query('select status from products where id = $1', [id]);
    if (!e.rowCount) throw notFound('Product');
    throw new ApiError(409, 'PRODUCT_NOT_DRAFT', 'Only draft products can be deleted; archive it instead (PATCH status = "archived")');
  }
  return { status: 200, body: { data: { id, deleted: true } } };
}

export async function createVariant({ db, params, body }) {
  const productId = parseId(params[0]);
  const f = validate(body, VARIANT);
  if (f.dial_color === undefined && f.strap === undefined) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'dial_color/strap', message: 'at least one of dial_color or strap is required' }]);
  }
  const p = await db.query('select 1 from products where id = $1', [productId]);
  if (!p.rowCount) throw notFound('Product');
  const r = await db.query(
    `insert into variants (product_id, dial_color, strap) values ($1, $2, $3) returning *`,
    [productId, f.dial_color ?? null, f.strap ?? null],
  );
  return { status: 201, body: { data: r.rows[0] } };
}
