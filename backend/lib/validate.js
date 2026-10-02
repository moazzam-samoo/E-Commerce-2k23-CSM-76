import { ApiError } from './errors.js';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKU_CODE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const SPEC_KEY = /^[a-z0-9_]{1,50}$/;

export function parseId(value, field = 'id') {
  if (!/^\d{1,18}$/.test(String(value))) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a positive integer`, [{ field, message: 'must be a positive integer' }]);
  }
  return String(value);
}

// Specification validation rule (documented in docs/SPRINT_2.md):
// a flat JSON object, max 20 keys, keys snake_case (a-z0-9_, 1-50 chars),
// values are string (<=200 chars), finite number or boolean. No nesting, no null.
function checkSpecs(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'must be a JSON object';
  const keys = Object.keys(v);
  if (keys.length > 20) return 'at most 20 keys allowed';
  for (const k of keys) {
    if (!SPEC_KEY.test(k)) return `key "${k}" must be snake_case (a-z, 0-9, _), max 50 chars`;
    const x = v[k];
    const ok = (typeof x === 'string' && x.length <= 200) || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x));
    if (!ok) return `value of "${k}" must be a string (<=200 chars), number or boolean`;
  }
  return null;
}

const CHECKERS = {
  string: (v, r) => {
    if (typeof v !== 'string') return 'must be a string';
    const t = v.trim();
    if (!t) return 'must not be blank';
    if (t.length > (r.max || 200)) return `must be at most ${r.max || 200} characters`;
    return null;
  },
  text: (v) => (typeof v === 'string' && v.length <= 5000 ? null : 'must be a string of at most 5000 characters'),
  slug: (v) => (typeof v === 'string' && v.length <= 100 && SLUG.test(v) ? null : 'must be lowercase letters, digits and hyphens (e.g. "velvet-matte")'),
  skuCode: (v) => (typeof v === 'string' && v.length <= 50 && SKU_CODE.test(v) ? null : 'must be UPPERCASE letters, digits and hyphens (e.g. "BLQ-LIP-ROSE-3G")'),
  id: (v) => (/^\d{1,18}$/.test(String(v)) ? null : 'must be a positive integer id'),
  int: (v, r) => (Number.isInteger(v) && v >= 0 && v <= (r.max ?? 2147483647) ? null : 'must be a non-negative integer'),
  bool: (v) => (typeof v === 'boolean' ? null : 'must be true or false'),
  hex: (v) => (typeof v === 'string' && HEX.test(v) ? null : 'must be a hex colour like #C9566B'),
  money: (v) => {
    if (typeof v !== 'number' && typeof v !== 'string') return 'must be a number or numeric string';
    const s = String(v);
    if (!MONEY.test(s)) return 'must be a positive amount with at most 2 decimals';
    if (Number(s) <= 0) return 'must be greater than zero';
    return null;
  },
  cost: (v) => {
    if (typeof v !== 'number' && typeof v !== 'string') return 'must be a number or numeric string';
    return MONEY.test(String(v)) ? null : 'must be zero or a positive amount with at most 2 decimals';
  },
  enum: (v, r) => (r.values.includes(v) ? null : `must be one of: ${r.values.join(', ')}`),
  specs: (v) => checkSpecs(v),
};

/**
 * spec: { field: { type, required?, nullable?, values?, max? } }
 * Returns only the validated fields. Unknown fields are rejected.
 */
export function validate(body, spec, { requireAny = false } = {}) {
  const details = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object', [{ field: 'body', message: 'must be a JSON object' }]);
  }
  for (const k of Object.keys(body)) {
    if (!(k in spec)) details.push({ field: k, message: 'unknown field' });
  }
  const out = {};
  for (const [field, rule] of Object.entries(spec)) {
    const v = body[field];
    if (v === undefined) {
      if (rule.required) details.push({ field, message: 'is required' });
      continue;
    }
    if (v === null && rule.nullable) { out[field] = null; continue; }
    const msg = CHECKERS[rule.type](v, rule);
    if (msg) details.push({ field, message: msg });
    else out[field] = typeof v === 'string' && rule.type === 'string' ? v.trim() : ((rule.type === 'money' || rule.type === 'cost') ? String(v) : v);
  }
  if (!details.length && requireAny && Object.keys(out).length === 0) {
    details.push({ field: 'body', message: 'at least one updatable field is required' });
  }
  if (details.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
  return out;
}
