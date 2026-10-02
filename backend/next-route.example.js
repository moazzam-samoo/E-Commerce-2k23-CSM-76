// OPTIONAL (Sprint 3): when the Next.js storefront is scaffolded, expose the SAME admin API
// from Next.js by saving this file as  app/api/v1/admin/[...path]/route.js
// and copying/importing the backend `lib/` folder. The API core (lib/app.js) is framework-agnostic.
import { createApp } from '@/backend/lib/app.js';
import { getPool } from '@/backend/lib/db.js';
import { supabaseVerifier } from '@/backend/lib/auth.js';

const app = createApp({
  pool: getPool(),
  verifyToken: supabaseVerifier({ url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY }),
});

async function run(request) {
  const body = ['POST', 'PATCH', 'PUT'].includes(request.method) ? await request.json().catch(() => undefined) : undefined;
  const out = await app({
    method: request.method,
    url: new URL(request.url).pathname + new URL(request.url).search,
    headers: Object.fromEntries(request.headers),
    body,
  });
  return Response.json(out.body, { status: out.status });
}

export { run as GET, run as POST, run as PATCH, run as DELETE };
