import { ApiError } from './errors.js';

// Verifies a Supabase access token by asking Supabase Auth who it belongs to.
export function supabaseVerifier({ url, anonKey }) {
  return async function verifyToken(token) {
    if (!url || !anonKey) throw new ApiError(500, 'SERVER_MISCONFIGURED', 'SUPABASE_URL / SUPABASE_ANON_KEY are not set');
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  };
}

export const isAdmin = (user) => !!user && user.app_metadata && user.app_metadata.role === 'admin';

// 401 = not authenticated, 403 = authenticated but not an administrator.
export async function requireAdmin(headers, verifyToken) {
  const raw = headers['authorization'] || headers['Authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m) throw new ApiError(401, 'UNAUTHENTICATED', 'Missing or malformed Authorization header');
  const user = await verifyToken(m[1]);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid or expired token');
  if (!isAdmin(user)) throw new ApiError(403, 'FORBIDDEN', 'Administrator role required');
  return user;
}
