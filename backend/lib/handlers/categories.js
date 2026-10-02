import { validate, parseId } from '../validate.js';
import { notFound, updateRow } from './util.js';

const CREATE = {
  name: { type: 'string', required: true },
  slug: { type: 'slug', required: true },
  parent_id: { type: 'id', nullable: true },
  is_active: { type: 'bool' },
};
const PATCH = {
  name: { type: 'string' },
  slug: { type: 'slug' },
  parent_id: { type: 'id', nullable: true },
  is_active: { type: 'bool' },
};

export async function createCategory({ db, body }) {
  const f = validate(body, CREATE);
  const r = await db.query(
    `insert into categories (name, slug, parent_id, is_active)
     values ($1, $2, $3, coalesce($4, true)) returning *`,
    [f.name, f.slug, f.parent_id ?? null, f.is_active ?? null],
  );
  return { status: 201, body: { data: r.rows[0] } };
}

export async function patchCategory({ db, params, body }) {
  const id = parseId(params[0]);
  const f = validate(body, PATCH, { requireAny: true });
  const row = await updateRow(db, 'categories', id, f);
  if (!row) throw notFound('Category');
  return { status: 200, body: { data: row } };
}

// Returns the whole category tree (children nested under their parent).
export async function listCategories({ db }) {
  const r = await db.query('select * from categories order by id');
  const byId = new Map(r.rows.map((c) => [c.id, { ...c, children: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    if (c.parent_id && byId.has(c.parent_id)) byId.get(c.parent_id).children.push(c);
    else roots.push(c);
  }
  return { status: 200, body: { data: roots } };
}
