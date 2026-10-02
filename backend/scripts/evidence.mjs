// Generates real request/response evidence for docs/SPRINT_2.md.
// Usage: start the API (npm run dev) in one terminal, then run `npm run evidence` in another.
// Output: docs/EVIDENCE_OUTPUT.md  (bearer token, Supabase URL and DB URL are redacted)
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, PORT } = process.env;
const BASE = process.env.EVIDENCE_BASE_URL || `http://localhost:${PORT || 3000}`;
const API = '/api/v1/admin';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'EVIDENCE_OUTPUT.md');

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD })) {
  if (!v) { console.error(`Missing ${k} in backend/.env`); process.exit(1); }
}

const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
}).then((r) => r.json());
const TOKEN = login.access_token;
if (!TOKEN) { console.error('Admin login failed:', login.error_description || login.msg || login); process.exit(1); }

const redact = (s) => String(s)
  .split(TOKEN).join('<REDACTED>')
  .split(SUPABASE_URL).join('<SUPABASE_URL>')
  .split(SUPABASE_ANON_KEY).join('<REDACTED>');

const sfx = Date.now().toString(36);          // keeps slugs / SKU codes unique on every run
const blocks = [];
let n = 0;

async function call(title, method, route, body, { token = TOKEN, query = '' } = {}) {
  n += 1;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${API}${route}${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  const req = [`${method} ${API}${route}${query}`, token ? 'Authorization: Bearer <REDACTED>' : '(no Authorization header)']
    .concat(body ? ['Content-Type: application/json', '', JSON.stringify(body, null, 2)] : []).join('\n');
  let shown = JSON.stringify(json, null, 2);
  const big = shown.split('\n').length > 60;
  const resBlock = '```json\n' + redact(shown) + '\n```';
  blocks.push(`##### E${n}. ${title}\n\n\`\`\`http\n${req}\n\`\`\`\n\nResponse: **${res.status}**\n\n` +
    (big ? `<details>\n<summary>Show full response</summary>\n\n${resBlock}\n\n</details>` : resBlock) + '\n');
  return { status: res.status, json };
}

const P = (s) => `${s}-${sfx}`;
// ---- happy path
const parent = await call('Create parent category', 'POST', '/categories', { name: 'Demo Collection', slug: P('demo-collection') });
const child = await call('Create child category (2-level tree)', 'POST', '/categories', { name: 'Demo Line', slug: P('demo-line'), parent_id: parent.json.data.id });
const prod = await call('Create product (always starts as draft)', 'POST', '/products', { name: 'Demo Watch', slug: P('demo-watch'), category_id: child.json.data.id, description: 'Evidence demo watch', specifications: { movement: 'quartz', case_mm: 40 } });
const pid = prod.json.data.id;
await call('Publishing without an active SKU is refused', 'PATCH', `/products/${pid}`, { status: 'published' });
const variant = await call('Create variant (valid combination)', 'POST', `/products/${pid}/variants`, { dial_color: 'White', strap: 'Leather' });
const vid = variant.json.data.id;
const code = `DEMO-${sfx.toUpperCase()}-WHT-LTH`;
const sku = await call('Create SKU', 'POST', `/products/${pid}/skus`, { sku_code: code, variant_id: vid, price: '24900.00', cost_price: '14500.00', stock_quantity: 10 });
const sid = sku.json.data.id;
await call('Update SKU price and stock', 'PATCH', `/skus/${sid}`, { price: '25900.00', stock_quantity: 12 });
await call('Publish product (now has a sellable SKU)', 'PATCH', `/products/${pid}`, { status: 'published' });
await call('Read one product with variants and SKUs', 'GET', `/products/${pid}`);
await call('List products', 'GET', '/products', null, { query: '?limit=3' });
await call('List categories (tree)', 'GET', '/categories');
// ---- rejection paths
await call('No token -> 401', 'GET', '/products', null, { token: null });
await call('Duplicate SKU code -> 409', 'POST', `/products/${pid}/skus`, { sku_code: code, variant_id: vid, price: '1.00', cost_price: '0.50', stock_quantity: 1 });
await call('Duplicate product slug -> 409', 'POST', '/products', { name: 'Dup', slug: P('demo-watch'), category_id: child.json.data.id });
await call('Negative stock -> 400', 'PATCH', `/skus/${sid}`, { stock_quantity: -5 });
await call('Category cycle -> 422', 'PATCH', `/categories/${parent.json.data.id}`, { parent_id: child.json.data.id });
await call('Duplicate variant combination -> 409', 'POST', `/products/${pid}/variants`, { dial_color: 'White', strap: 'Leather' });
await call('Published product cannot be hard-deleted -> 409', 'DELETE', `/products/${pid}`);

const md = `Captured ${new Date().toISOString().slice(0, 10)} against the team's Supabase project. Base URL: \`${BASE}\`. Token and project URL are redacted.\n\n` +
  `#### Core flow\n\n${blocks.slice(0, 11).join('\n')}\n#### Rejection paths\n\n${blocks.slice(11).join('\n')}`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md);
console.log(`Wrote ${out} (${n} calls)`);
