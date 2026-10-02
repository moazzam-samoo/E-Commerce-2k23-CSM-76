// Prints an admin access token (for curl demos). Never commit or paste this token anywhere public.
import 'dotenv/config';

const { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
});
const data = await res.json();
if (!res.ok) { console.error('Login failed:', data.error_description || data.msg || data); process.exit(1); }
console.log(data.access_token);
