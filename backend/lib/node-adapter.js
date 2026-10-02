import { createApp } from './app.js';
import { getPool } from './db.js';
import { supabaseVerifier } from './auth.js';

let app;
function getApp() {
  if (!app) {
    app = createApp({
      pool: getPool(),
      verifyToken: supabaseVerifier({ url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY }),
    });
  }
  return app;
}

async function readBody(req) {
  if (req.body !== undefined) return req.body; // already parsed (Vercel)
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return undefined;
  return JSON.parse(text);
}

// Works for both a plain Node http server (server.js) and a Vercel serverless function.
export async function nodeHandler(req, res) {
  let out;
  try {
    const body = await readBody(req);
    out = await getApp()({ method: req.method, url: req.url, headers: req.headers, body });
  } catch (e) {
    const invalid = e instanceof SyntaxError;
    out = {
      status: invalid ? 400 : 500,
      body: { error: { code: invalid ? 'INVALID_JSON' : 'INTERNAL_ERROR', message: invalid ? 'Request body is not valid JSON' : 'Unexpected server error' } },
    };
    if (!invalid) console.error(e);
  }
  res.statusCode = out.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(out.body));
}
