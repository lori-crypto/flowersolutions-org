-- ============================================================
-- 09_ertekesites.sql — Értékesítési tény-tábla (statisztika modul alapja)
-- Történelmi NEXUS-exportok + később a napi szinkron közös táblája.
-- Idempotens. Előfeltétel: 01_alap.sql
-- ============================================================

create table if not exists sales_lines (
  id          bigserial primary key,
  source      text not null default 'nexus_export',   -- nexus_export | nexus_api | webshop…
  tip_doc     text not null,                          -- Factura / AvizInsot.
  seria       text,
  nr          text,
  data_doc    date not null,
  anluna      text not null,                          -- YYYYMM
  cont        text,                                   -- 371=áru, 706=bérleti díj, 709=kedvezmény
  nume_cli    text,
  nume_gest   text,
  cod_ext     text,
  denumire    text,
  grupa       text,
  clasa       text,
  subclasa    text,
  um          text,
  cantitate   numeric(14,3),
  pu          numeric(14,4),    -- beszerzési egységár (árréshez)
  puv         numeric(14,4),    -- eladási egységár (lista)
  val_pu      numeric(14,2),    -- beszerzési érték
  val_puv     numeric(14,2),    -- eladási érték, kedvezmény ELŐTT (nettó)
  val_disc    numeric(14,2),
  val_tva     numeric(14,2),
  val_puv_tva numeric(14,2),    -- bruttó, kedvezmény előtt
  real_net    numeric(14,2),    -- VALÓS nettó (kedvezmény után, aviz-korrekcióval)
  real_gross  numeric(14,2),    -- VALÓS bruttó
  aviz        boolean not null default false,
  aviz_korr   boolean not null default false,  -- rákerült az 5%-os aviz-ügyfél korrekció
  loaded_at   timestamptz not null default now()
);

create index if not exists sales_lines_day   on sales_lines(data_doc);
create index if not exists sales_lines_luna  on sales_lines(anluna);
create index if not exists sales_lines_cli   on sales_lines(nume_cli);
create index if not exists sales_lines_prod  on sales_lines(cod_ext);
create index if not exists sales_lines_grp   on sales_lines(grupa, clasa, subclasa);

-- Érzékeny pénzügyi adat: csak HR/admin olvashatja; írás csak
-- szerveroldalról (service key) történik, kliens-írási policy nincs.
alter table sales_lines enable row level security;
drop policy if exists sales_select on sales_lines;
create policy sales_select on sales_lines for select to authenticated
  using (app_has_cap('hr'));
