import { ApiError, toApiError } from './errors.js';
import { requireAdmin } from './auth.js';
import { createCategory, patchCategory, listCategories } from './handlers/categories.js';
import { createProduct, patchProduct, listProducts, getProduct, deleteProduct, createVariant } from './handlers/products.js';
import { createSku, patchSku, deleteSku } from './handlers/skus.js';

export const PREFIX = '/api/v1/admin';

export const ROUTES = [
  ['POST',   /^\/categories$/,                 createCategory],
  ['GET',    /^\/categories$/,                 listCategories],
  ['PATCH',  /^\/categories\/([^/]+)$/,        patchCategory],
  ['POST',   /^\/products$/,                   createProduct],
  ['GET',    /^\/products$/,                   listProducts],
  ['GET',    /^\/products\/([^/]+)$/,          getProduct],
  ['PATCH',  /^\/products\/([^/]+)$/,          patchProduct],
  ['DELETE', /^\/products\/([^/]+)$/,          deleteProduct],
  ['POST',   /^\/products\/([^/]+)\/variants$/, createVariant],
  ['POST',   /^\/products\/([^/]+)\/skus$/,    createSku],
  ['PATCH',  /^\/skus\/([^/]+)$/,              patchSku],
  ['DELETE', /^\/skus\/([^/]+)$/,              deleteSku],
];

const errorBody = (e) => ({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });

/**
 * Framework-agnostic core. Input:  { method, url, headers, body }
 * Output: { status, body }.  `pool` = pg Pool, `verifyToken(token) -> user | null`.
 */
export function createApp({ pool, verifyToken }) {
  return async function handle({ method, url, headers = {}, body }) {
    try {
      const u = new URL(url, 'http://localhost');
      let path = u.pathname.replace(/\/+$/, '');
      if (!path.startsWith(PREFIX)) throw new ApiError(404, 'NOT_FOUND', 'Route not found');
      path = path.slice(PREFIX.length) || '/';

      let match = null;
      let pathExists = false;
      for (const [m, re, fn] of ROUTES) {
        const r = re.exec(path);
        if (!r) continue;
        pathExists = true;
        if (m === method) { match = { fn, params: r.slice(1) }; break; }
      }
      if (!match) {
        throw pathExists
          ? new ApiError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed on this route`)
          : new ApiError(404, 'NOT_FOUND', 'Route not found');
      }

      await requireAdmin(headers, verifyToken); // 401 / 403 BEFORE touching the database

      const query = Object.fromEntries(u.searchParams.entries());
      return await match.fn({ db: pool, params: match.params, query, body: body ?? {} });
    } catch (raw) {
      const e = toApiError(raw);
      if (e) return { status: e.status, body: errorBody(e) };
      console.error('Unexpected error:', raw); // logged server-side only, never sent to the client
      return { status: 500, body: errorBody(new ApiError(500, 'INTERNAL_ERROR', 'Unexpected server error')) };
    }
  };
}
