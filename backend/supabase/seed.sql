-- Kelvorne seed data (Sprint 2). Re-runnable: wipes the catalog tables first.
-- Demonstrates: 2-level category tree (collection -> line), 4 products, variants, 6 SKUs
-- with price AND cost, one intentionally unavailable combination (Aurora Silver / Leather
-- has NO row), one out-of-stock SKU, one draft product without any SKU.
begin;

truncate table assets, skus, variants, products, categories restart identity cascade;

-- Categories: collection (level 1) -> watch line (level 2)
insert into categories (name, slug) values ('Heritage', 'heritage'), ('Sport', 'sport');
insert into categories (parent_id, name, slug) values
  ((select id from categories where slug = 'heritage'), 'Automatic',     'automatic'),
  ((select id from categories where slug = 'heritage'), 'Dress',         'dress'),
  ((select id from categories where slug = 'sport'),    'Chronograph',   'chronograph'),
  ((select id from categories where slug = 'sport'),    'Diver',         'diver');

-- Products (always created as draft; published after their SKUs exist)
insert into products (category_id, name, slug, description, specifications) values
  ((select id from categories where slug = 'automatic'),   'Aurora Automatic',  'aurora-automatic',
     'Self-winding automatic watch with a sunburst dial.',
     '{"movement":"automatic","case_mm":40,"water_resistance_m":50,"glass":"sapphire"}'),
  ((select id from categories where slug = 'chronograph'), 'Meridian Chronograph', 'meridian-chronograph',
     'Sporty quartz chronograph with a tachymeter bezel.',
     '{"movement":"quartz","case_mm":42,"water_resistance_m":100,"glass":"mineral"}'),
  ((select id from categories where slug = 'dress'),       'Solstice Slim',     'solstice-slim',
     'Ultra-thin dress watch, one dial and one strap.',
     '{"movement":"quartz","case_mm":38,"water_resistance_m":30,"glass":"sapphire"}'),
  ((select id from categories where slug = 'diver'),       'Eclipse Diver',     'eclipse-diver',
     'Draft product: SKUs not created yet.', '{}');

-- Variants. Aurora: dials Black/Silver x straps Steel/Leather, but Silver + Leather is NOT produced.
insert into variants (product_id, dial_color, strap) values
  ((select id from products where slug = 'aurora-automatic'),      'Black',  'Steel'),
  ((select id from products where slug = 'aurora-automatic'),      'Black',  'Leather'),
  ((select id from products where slug = 'aurora-automatic'),      'Silver', 'Steel'),
  ((select id from products where slug = 'meridian-chronograph'),  'Blue',   'Rubber'),
  ((select id from products where slug = 'meridian-chronograph'),  'Green',  'Rubber');

-- SKUs (price and cost_price per sellable unit)
insert into skus (product_id, variant_id, sku_code, price, cost_price, stock_quantity, is_active)
select v.product_id, v.id, x.code, x.price, x.cost, x.stock, true
from (values
  ('aurora-automatic',     'Black',  'Steel',   'KLV-AUR-BLK-STL', 48500.00, 29000.00,  8),
  ('aurora-automatic',     'Black',  'Leather', 'KLV-AUR-BLK-LTH', 45500.00, 27000.00,  5),
  ('aurora-automatic',     'Silver', 'Steel',   'KLV-AUR-SLV-STL', 48500.00, 29000.00,  0),  -- out of stock, still active
  ('meridian-chronograph', 'Blue',   'Rubber',  'KLV-MER-BLU-RBR', 36500.00, 21000.00, 12),
  ('meridian-chronograph', 'Green',  'Rubber',  'KLV-MER-GRN-RBR', 36500.00, 21000.00,  7)   -- same price as Blue
) as x(pslug, dial, strap, code, price, cost, stock)
join products p on p.slug = x.pslug
join variants v on v.product_id = p.id and v.dial_color = x.dial and v.strap = x.strap;

-- Default (variant-less) SKU for the single-option watch
insert into skus (product_id, variant_id, sku_code, price, cost_price, stock_quantity)
values ((select id from products where slug = 'solstice-slim'), null, 'KLV-SOL-STD', 29900.00, 17500.00, 15);

-- Publish products that have an active SKU (the diver stays draft, no SKU)
update products set status = 'published'
where slug in ('aurora-automatic', 'meridian-chronograph', 'solstice-slim');

commit;
