-- ============================================================
-- 10_webshop_atvetel.sql — Webshop-előrendelések átvétele + id_client
-- Idempotens. Előfeltétel: 09_ertekesites.sql
-- ============================================================

-- ügyfél-azonosító a NEXUS-ból (megbízható párosítás a webshop-oldallal)
alter table sales_lines add column if not exists id_client text;
create index if not exists sales_lines_idcli on sales_lines(id_client);

-- szállítási napok (a cég "hét"-határai a compare-hez)
create table if not exists webshop_cycles (
  delivery_date date primary key,
  loaded_at     timestamptz not null default now()
);

-- webshop-előrendelés sorok
create table if not exists webshop_order_lines (
  id              bigserial primary key,
  order_id        bigint not null,
  delivery_date   date not null,
  company         text,
  nexus_id_client text,
  den_produs      text,
  quantity        numeric(12,2) not null default 0,
  unit_price      numeric(12,4) not null default 0,
  value           numeric(14,2) not null default 0,
  category        text,
  subcategory     text,
  is_extra        boolean not null default false,
  loaded_at       timestamptz not null default now()
);
create index if not exists wol_date on webshop_order_lines(delivery_date);
create index if not exists wol_client on webshop_order_lines(nexus_id_client);

-- érzékeny üzleti adat: csak HR/admin olvashatja; írás szerveroldalról
alter table webshop_cycles enable row level security;
alter table webshop_order_lines enable row level security;
drop policy if exists wc_select on webshop_cycles;
create policy wc_select on webshop_cycles for select to authenticated
  using (app_has_cap('hr'));
drop policy if exists wol_select on webshop_order_lines;
create policy wol_select on webshop_order_lines for select to authenticated
  using (app_has_cap('hr'));
