-- ONLY for a plain local PostgreSQL (NOT Supabase): fakes the pieces of Supabase
-- that 001_catalog.sql references. Run once before the migration. Do not run on Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
