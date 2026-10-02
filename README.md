# Kelvorne: Luxury Watch E-Commerce

Kelvorne is a single-brand luxury watch store (not a marketplace) for style-conscious buyers aged 20 to 35. This repository is built sprint by sprint for the E-Commerce course (Department of Computer Science / Artificial Intelligence, Institute of Mathematics & Computer Science, University of Sindh, Jamshoro).

## Project status

| Sprint | Theme | Status | Document |
|---|---|---|---|
| Sprint 1 | Architecture, MVP scope, tech stack, initial ERD | Done | [`docs/SPRINT_1.md`](docs/SPRINT_1.md) |
| Sprint 2 | Catalog data foundation: categories, products, variants, SKUs, admin API, seed, tests | Done | [`docs/SPRINT_2.md`](docs/SPRINT_2.md) |
| Sprint 3 | Specifications, assets, public catalog reads, catalog-to-cart readiness | Planned | see Sprint 3 backlog in `docs/SPRINT_2.md` |

## Tech stack

| Layer | Choice |
|---|---|
| Database, auth | Supabase (managed PostgreSQL + Supabase Auth) |
| Backend | Node.js 20+, plain HTTP handlers, `pg` (direct PostgreSQL connection) |
| Tests | Vitest against a real PostgreSQL database |
| Storefront (planned) | Next.js + React Three Fiber (3D watch viewer) |
| Hosting (planned) | Vercel (frontend) + Supabase Cloud |

## What Sprint 2 delivers

- Category tree (collection → watch line) with unique slugs and cycle prevention.
- Products with one canonical category and a `draft → published → archived` lifecycle. A published product must always keep at least one active SKU.
- Variants (valid dial colour and strap combinations only) and SKUs, each with its own unique code, price, cost price, stock and active flag.
- Constraints enforced by PostgreSQL itself, not only the API: unique slugs and SKU codes, foreign keys with explicit delete/update policies, `NUMERIC(12,2)` money, non-negative stock, triggers for the business rules.
- Administrator-only API under `/api/v1/admin` (401 for no or invalid token, 403 for a logged-in non-admin).
- Reproducible seed data, automated tests, and request/response evidence.

## Repository layout

```
.
├── backend/
│   ├── api/v1/[...slug].js       Vercel serverless entry (optional)
│   ├── lib/                      API core: routes, auth, validation, handlers
│   ├── scripts/                  migrate, seed, get-token, evidence
│   ├── supabase/
│   │   ├── migrations/           001_catalog.sql (schema, triggers, RLS)
│   │   └── seed.sql              demo catalog
│   ├── tests/                    model, validation, authorization tests
│   ├── server.js                 local HTTP server
│   ├── .env.example              environment variable template
│   └── README.md                 backend details
├── docs/
│   ├── SPRINT_1.md               architecture and scope
│   └── SPRINT_2.md               design, ERD, routes, evidence, test results
├── .gitignore
└── README.md                     this file
```

## Quick start

Requirements: Node.js 20 or newer, and a free Supabase project.

```powershell
cd backend
npm install
Copy-Item .env.example .env     # then fill in the values below
npm run migrate                 # creates tables, triggers and policies
npm run seed                    # loads the demo catalog
npm run dev                     # API on http://localhost:3000/api/v1/admin
```

In a second terminal (inside `backend/`):

```powershell
npm test                        # automated tests
npm run evidence                # writes docs/EVIDENCE_OUTPUT.md (needs npm run dev running)
```

On macOS or Linux use `cp .env.example .env` instead of `Copy-Item`.

### Make a user an administrator

Create a user in Supabase (Authentication → Users → Add user, with "Auto Confirm User"), then run this once in the Supabase SQL Editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'
where email = 'admin@kelvorne.test';
```

`npm run token` then prints an access token to use as `Authorization: Bearer <token>`.

## Environment variables (`backend/.env`)

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL (no trailing `/` or `/rest/v1`) |
| `SUPABASE_ANON_KEY` | Project Settings → API Keys → anon key |
| `DATABASE_URL` | Connect → Connection string → URI → **Session pooler**, with your database password |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | the admin user above (used by `npm run token` and `npm run evidence`) |
| `TEST_USER_EMAIL`, `TEST_USER_PASSWORD` | optional second user **without** the admin role, enables 4 extra authorization tests |
| `PORT` | optional, default 3000 |

If the database password contains characters such as `@`, `#` or `/`, URL-encode them in `DATABASE_URL` (`@` becomes `%40`). `.env` is git-ignored and must never be committed. The `service_role` key is not used anywhere.

## Admin API

Base path `/api/v1/admin`. Every route requires `Authorization: Bearer <Supabase access token>` of a user whose `app_metadata.role` is `admin`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/categories` | Create a category |
| GET | `/categories` | Return the category tree |
| PATCH | `/categories/:id` | Update, move or deactivate a category |
| POST | `/products` | Create a draft product |
| GET | `/products` | List products with variants and SKUs |
| GET | `/products/:id` | One product with variants and SKUs |
| PATCH | `/products/:id` | Update content, category or status |
| DELETE | `/products/:id` | Delete a draft product |
| POST | `/products/:id/variants` | Add a variant |
| POST | `/products/:id/skus` | Add a SKU |
| PATCH | `/skus/:id` | Update price, cost, stock or active status |
| DELETE | `/skus/:id` | Delete a SKU (not the last active one of a published product) |

Errors always use one shape: `{ "error": { "code": "DUPLICATE_SKU_CODE", "message": "..." } }`. Request fields, status codes and live examples are in [`docs/SPRINT_2.md`](docs/SPRINT_2.md).

## Testing

`npm test` (inside `backend/`) runs Vitest against the database in `DATABASE_URL`. Last recorded run: 5 test files, 141 passed, 4 skipped (the skipped tests need `TEST_USER_*`). Test rows use a `test-` / `TEST-` prefix and are removed afterwards. `npm run seed` truncates the catalog tables, so only run it against this project's own database.

## Troubleshooting

| Problem | Fix |
|---|---|
| `ECONNREFUSED ::1:5432` | `DATABASE_URL` is missing or malformed, so the driver fell back to localhost. Check `backend/.env`. |
| `ENOTFOUND` or timeout | Use the **Session pooler** string, not the Direct connection (which needs IPv6). |
| `password authentication failed` | Wrong database password, or the pooler user is not `postgres.<project-ref>`. |
| `403 FORBIDDEN` | The admin SQL above was not run, or request a fresh token after running it. |
| `npm run evidence` fails to connect | Start the API first with `npm run dev`. |
| `npm` cannot find `package.json` | Run commands inside the `backend/` folder. |

## Security

- No secrets are committed. `.env` is ignored; `.env.example` contains placeholders only.
- Row Level Security is enabled on all catalog tables, allowing only admin JWTs.
- Reset the Supabase database password if it was ever shared outside the team.
