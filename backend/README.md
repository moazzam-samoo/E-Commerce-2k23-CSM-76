# Kelvorne — Backend (Sprint 2: Catalog Data Foundation)

Admin API + PostgreSQL schema for categories, products, variants and SKUs of the Kelvorne watch store.
Full design, ERD, routes and evidence: [`../docs/SPRINT_2.md`](../docs/SPRINT_2.md).

## Requirements
- Node.js 20+
- A Supabase project (free tier) — PostgreSQL + Auth

## Local setup
```bash
cd backend
npm install
cp .env.example .env          # then fill in the values (never commit .env)
npm run migrate               # applies supabase/migrations/*.sql
npm run seed                  # demo catalog (re-runnable, wipes catalog tables)
npm run dev                   # http://localhost:3000/api/v1/admin
npm test                      # automated tests
```

## Environment variables (`backend/.env`)
| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` key |
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string → URI (Session pooler), with your DB password |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | the admin user created in Supabase Auth (only for `npm run token`) |
| `PORT` | optional, default 3000 |

Never commit secrets. `.env` is git-ignored; the `service_role` key is not used anywhere.

## Making a user an administrator
Run once in the Supabase SQL Editor:
```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'
where email = 'admin@kelvorne.test';
```
Then `npm run token` prints an access token for use as `Authorization: Bearer <token>`.

## Tests
`npm test` runs Vitest against the database in `DATABASE_URL`. Test rows use the `test-` / `TEST-` prefix and are deleted afterwards; the seed data is not touched.

## Next.js
The storefront (Next.js, Sprint 3) can expose the same API through `next-route.example.js`.
