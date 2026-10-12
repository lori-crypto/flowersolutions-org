-- ============================================================
-- 28_ugyfelnev_javitas.sql — Ügyfélnév-duplikátumok megszüntetése.
-- A régi CSV-import elrontotta a román ékezeteket ('?'/jelcsere),
-- az API helyesen hozza — ugyanaz az ügyfél két írásmóddal él.
--  1) Egyszeri adatjavítás: a hibás neveket átírjuk a helyes
--     változatra (csak ott, ahol a párosítás egyértelmű).
--  2) app_cash_clients: normalizált kulcs szerinti kiszűrés,
--     mindig a legfrissebb (helyes) írásmódot adja vissza.
-- Idempotens. Előfeltétel: 27.
-- ============================================================

-- 1) Adatjavítás a sales_lines-ban
with bad as (
  select distinct s.nume_cli from sales_lines s
  where s.nume_cli like '%?%' or s.nume_cli like '%' || chr(65533) || '%'
),
good as (
  select distinct s.nume_cli from sales_lines s
  where s.nume_cli not like '%?%' and s.nume_cli not like '%' || chr(65533) || '%'
),
map as (
  select b.nume_cli as bad_name, min(g.nume_cli) as good_name
  from bad b
  join good g
    on regexp_replace(upper(g.nume_cli), '[^A-Z0-9 ]', '', 'g')
     = regexp_replace(upper(b.nume_cli), '[^A-Z0-9 ]', '', 'g')
  group by b.nume_cli
  having count(distinct g.nume_cli) = 1
)
update sales_lines s
set nume_cli = m.good_name
from map m
where s.nume_cli = m.bad_name;

-- 2) Ügyfél-kereső: normalizált kulcsonként egy (legfrissebb) név
create or replace function app_cash_clients(p_q text)
returns table(label text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (app_has_cap('penztar') or app_has_cap('hr')) then
    raise exception 'Nincs jogosultság.';
  end if;
  return query
  select y.label from (
    select distinct on (x.norm) x.label, x.norm from (
      select s.nume_cli as label,
             regexp_replace(upper(s.nume_cli), '[^A-Z0-9 ]', '', 'g') as norm,
             max(s.data_doc) as last_doc
      from sales_lines s
      where s.nume_cli ilike '%' || p_q || '%'
      group by s.nume_cli
    ) x
    order by x.norm, x.last_doc desc
  ) y
  order by y.label
  limit 40;
end $$;

grant execute on function app_cash_clients(text) to authenticated;

-- Ellenőrzés: maradt-e kérdőjeles név (ideális esetben 0 vagy csak
-- olyan, aminek nincs helyes párja az adatbázisban)
select count(*) as kerdojeles_nevu_sorok from sales_lines
where nume_cli like '%?%' or nume_cli like '%' || chr(65533) || '%';
