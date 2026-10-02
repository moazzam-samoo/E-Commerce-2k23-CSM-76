-- =====================================================================
-- Kelvorne - Sprint 2: Catalog Data Foundation
-- Migration 001: categories, products, variants, skus, assets
-- Target: PostgreSQL 15+ (Supabase). Money = numeric(12,2), never float.
-- Custom SQLSTATE codes used by triggers (mapped to API errors):
--   BQ001 category cycle        BQ002 inactive parent
--   BQ003 product not sellable  BQ004 variant/SKU mismatch
-- =====================================================================

create or replace function bq_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- categories
create table categories (
  id          bigint generated always as identity primary key,
  parent_id   bigint references categories(id) on delete restrict on update cascade,
  name        text        not null,
  slug        text        not null,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categories_slug_key        unique (slug),
  constraint categories_name_not_blank  check (length(btrim(name)) > 0),
  constraint categories_slug_format     check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint categories_not_own_parent  check (parent_id is null or parent_id <> id)
);
create index categories_parent_idx on categories(parent_id);

-- A category can never become its own ancestor (walks up the parent chain).
create or replace function bq_categories_check_cycle() returns trigger
language plpgsql as $$
declare
  cur   bigint;
  steps int := 0;
begin
  if tg_op = 'INSERT' or new.parent_id is null then
    return new;
  end if;
  cur := new.parent_id;
  while cur is not null loop
    if cur = new.id then
      raise exception 'Category % cannot become its own ancestor', new.id
        using errcode = 'BQ001';
    end if;
    select parent_id into cur from categories where id = cur;
    steps := steps + 1;
    if steps > 100 then
      raise exception 'Category tree too deep' using errcode = 'BQ001';
    end if;
  end loop;
  return new;
end $$;

create trigger categories_check_cycle
  before update of parent_id on categories
  for each row execute function bq_categories_check_cycle();

-- An active category must not sit under an inactive parent.
create or replace function bq_categories_parent_active() returns trigger
language plpgsql as $$
begin
  if new.is_active and new.parent_id is not null
     and exists (select 1 from categories where id = new.parent_id and not is_active) then
    raise exception 'Cannot activate a category whose parent is inactive'
      using errcode = 'BQ002';
  end if;
  return new;
end $$;

create trigger categories_parent_active
  before insert or update of is_active, parent_id on categories
  for each row execute function bq_categories_parent_active();

-- Deactivating a parent deactivates its whole subtree (cascades via re-firing).
create or replace function bq_categories_cascade_deactivate() returns trigger
language plpgsql as $$
begin
  update categories set is_active = false where parent_id = new.id and is_active;
  return null;
end $$;

create trigger categories_cascade_deactivate
  after update of is_active on categories
  for each row when (old.is_active and not new.is_active)
  execute function bq_categories_cascade_deactivate();

create trigger categories_updated_at before update on categories
  for each row execute function bq_set_updated_at();

-- ------------------------------------------------------------------ products
create table products (
  id             bigint generated always as identity primary key,
  category_id    bigint      not null references categories(id) on delete restrict on update cascade,
  name           text        not null,
  slug           text        not null,
  description    text        not null default '',
  status         text        not null default 'draft',
  specifications jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint products_slug_key          unique (slug),
  constraint products_name_not_blank    check (length(btrim(name)) > 0),
  constraint products_slug_format       check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_status_valid      check (status in ('draft', 'published', 'archived')),
  constraint products_specs_is_object   check (jsonb_typeof(specifications) = 'object')
);
create index products_category_idx on products(category_id);

-- ------------------------------------------------------------------ variants
-- A variant is one VALID option combination (dial colour and/or strap) of a watch model.
-- Combinations that do not exist simply have no row.
create table variants (
  id          bigint generated always as identity primary key,
  product_id  bigint      not null references products(id) on delete cascade on update cascade,
  dial_color  text,
  strap       text,
  created_at  timestamptz not null default now(),
  constraint variants_has_option     check (dial_color is not null or strap is not null),
  constraint variants_id_product_key unique (id, product_id),
  constraint variants_combination_key unique nulls not distinct (product_id, dial_color, strap)
);
create index variants_product_idx on variants(product_id);

-- ---------------------------------------------------------------------- skus
-- A SKU is the sellable unit: unique code, own price, own cost (for profit), own stock.
create table skus (
  id              bigint generated always as identity primary key,
  product_id      bigint        not null references products(id) on delete cascade on update cascade,
  variant_id      bigint,
  sku_code        text          not null,
  price           numeric(12,2) not null,
  cost_price      numeric(12,2) not null,
  stock_quantity  integer       not null default 0,
  is_active       boolean       not null default true,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  constraint skus_sku_code_key        unique (sku_code),
  constraint skus_sku_code_format     check (sku_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  constraint skus_price_positive      check (price > 0),
  constraint skus_cost_non_negative   check (cost_price >= 0),
  constraint skus_stock_non_negative  check (stock_quantity >= 0),
  -- composite FK: a SKU's variant must belong to the SAME product (NULL variant skips the check)
  constraint skus_variant_same_product_fkey
    foreign key (variant_id, product_id) references variants(id, product_id)
    on delete no action on update cascade
);
create index skus_product_idx on skus(product_id);
create index skus_variant_idx on skus(variant_id);
-- A product without variants may have only ONE default (variant-less) SKU.
create unique index skus_one_default_per_product on skus(product_id) where variant_id is null;

create trigger skus_updated_at before update on skus
  for each row execute function bq_set_updated_at();
create trigger products_updated_at before update on products
  for each row execute function bq_set_updated_at();

-- Variants and variant-less SKUs cannot be mixed on one product.
create or replace function bq_skus_variant_rule() returns trigger
language plpgsql as $$
begin
  if new.variant_id is null
     and exists (select 1 from variants where product_id = new.product_id) then
    raise exception 'Product % has variants: the SKU must reference one of them', new.product_id
      using errcode = 'BQ004';
  end if;
  return new;
end $$;

create trigger skus_variant_rule
  before insert or update of variant_id on skus
  for each row execute function bq_skus_variant_rule();

create or replace function bq_variants_rule() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from skus where product_id = new.product_id and variant_id is null) then
    raise exception 'Product % already has a variant-less default SKU', new.product_id
      using errcode = 'BQ004';
  end if;
  return new;
end $$;

create trigger variants_rule
  before insert on variants
  for each row execute function bq_variants_rule();

-- A published product must always keep at least one active SKU.
create or replace function bq_products_publish_rule() returns trigger
language plpgsql as $$
begin
  if new.status = 'published'
     and not exists (select 1 from skus where product_id = new.id and is_active) then
    raise exception 'A published product needs at least one active SKU'
      using errcode = 'BQ003';
  end if;
  return new;
end $$;

create trigger products_publish_rule
  before insert or update of status on products
  for each row execute function bq_products_publish_rule();

create or replace function bq_skus_keep_sellable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and not (old.is_active and not new.is_active) then
    return new;
  end if;
  if tg_op = 'DELETE' and not old.is_active then
    return old;
  end if;
  if exists (select 1 from products where id = old.product_id and status = 'published')
     and not exists (select 1 from skus
                      where product_id = old.product_id and is_active and id <> old.id) then
    raise exception 'Cannot remove the last active SKU of a published product'
      using errcode = 'BQ003';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger skus_keep_sellable_upd
  before update of is_active on skus
  for each row execute function bq_skus_keep_sellable();
create trigger skus_keep_sellable_del
  before delete on skus
  for each row execute function bq_skus_keep_sellable();

-- -------------------------------------------------------------------- assets
-- Schema only in Sprint 2 (upload/storage is Sprint 3).
create table assets (
  id          bigint generated always as identity primary key,
  product_id  bigint      not null references products(id) on delete cascade on update cascade,
  variant_id  bigint,
  storage_key text        not null,
  role        text        not null default 'gallery',
  alt_text    text        not null default '',
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now(),
  constraint assets_role_valid check (role in ('primary', 'gallery', 'model_3d')),
  constraint assets_variant_same_product_fkey
    foreign key (variant_id, product_id) references variants(id, product_id)
    on delete no action on update cascade
);
create index assets_product_idx on assets(product_id);

-- ------------------------------------------------- Row Level Security (Supabase)
-- Direct Supabase API access (anon/authenticated) is limited to admins.
-- The backend connects with the database owner role, which bypasses RLS.
do $$
declare t text;
begin
  foreach t in array array['categories','products','variants','skus','assets'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all to authenticated
         using ((auth.jwt() -> ''app_metadata'' ->> ''role'') = ''admin'')
         with check ((auth.jwt() -> ''app_metadata'' ->> ''role'') = ''admin'')',
      t || '_admin_all', t);
  end loop;
end $$;
