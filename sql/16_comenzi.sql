-- ============================================================
-- 16_comenzi.sql — NEXUS vevői rendelések (comenzi clienti):
-- előrendelés-állomány + a HITELES szállításinap-naptár.
-- A hét-számítás innentől a valódi naptárból megy (a vasárnapi/
-- hétfői kis szállítási napok NEM hét-határok).
-- Idempotens. Előfeltétel: 09, 10, 15.
-- ============================================================

create table if not exists nexus_orders (
  id           bigserial primary key,
  id_document  text not null unique,
  anluna       text not null,
  data_document date,
  data_livrare date not null,
  seria        text,
  nr           text,
  id_client    text,
  nume_cli     text,
  valoare      numeric(14,2) not null default 0,      -- nettó
  valoare_tva  numeric(14,2) not null default 0,      -- bruttó
  stare        text,
  gestiune     text,
  loaded_at    timestamptz not null default now()
);
create index if not exists nexus_orders_liv on nexus_orders(data_livrare);
create index if not exists nexus_orders_luna on nexus_orders(anluna);

alter table nexus_orders enable row level security;
drop policy if exists no_select on nexus_orders;
create policy no_select on nexus_orders for select to authenticated
  using (app_has_cap('hr'));

-- ── Haladás-mutatók: naptár-alapú hetek + előrendelés-kártya ─
create or replace function app_stat_progress()
returns table(k text, cur_from date, cur_to date, prev_from date, prev_same_to date,
              prev_full_to date, cur numeric, prev_same numeric, prev_full numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  y_start date := date_trunc('year', today)::date;
  m_start date := date_trunc('month', today)::date;
  ly_date date := (today - interval '1 year')::date;
  ly_y_start date := date_trunc('year', ly_date)::date;
  ly_y_end date := (date_trunc('year', ly_date) + interval '1 year - 1 day')::date;
  ly_m_start date := date_trunc('month', ly_date)::date;
  ly_m_end date := (date_trunc('month', ly_date) + interval '1 month - 1 day')::date;
  ly_m_same date := least((ly_m_start + (today - m_start))::date, ly_m_end);
  w_start date; w_end_full date;
  lw_start date; lw_end date;
  next_liv date; ly_liv date;
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;

  -- FŐ szállítási napok naptára: kedd–szombat (vasárnap/hétfő kis napok kizárva)
  -- Forrás: nexus_orders.data_livrare; tartalék: webshop_cycles; végső: hétfői hét.
  select max(t.d) into w_start from (
    select distinct o.data_livrare as d from nexus_orders o
    where extract(isodow from o.data_livrare) between 2 and 6
  ) t where t.d <= today;
  if w_start is null then
    select max(c.delivery_date) into w_start from webshop_cycles c where c.delivery_date <= today;
  end if;
  if w_start is null then w_start := date_trunc('week', today)::date; end if;

  select min(t.d) - 1 into w_end_full from (
    select distinct o.data_livrare as d from nexus_orders o
    where extract(isodow from o.data_livrare) between 2 and 6
  ) t where t.d > w_start;
  if w_end_full is null then w_end_full := w_start + 6; end if;

  -- tavalyi hét: a naptárból a (w_start - 364)-hez legközelebbi fő szállítási nap
  select t.d into lw_start from (
    select distinct o.data_livrare as d from nexus_orders o
    where extract(isodow from o.data_livrare) between 2 and 6
  ) t where t.d between (w_start - 368) and (w_start - 360)
  order by abs(t.d - (w_start - 364)) limit 1;
  if lw_start is null then lw_start := w_start - 364; end if;

  select min(t.d) - 1 into lw_end from (
    select distinct o.data_livrare as d from nexus_orders o
    where extract(isodow from o.data_livrare) between 2 and 6
  ) t where t.d > lw_start;
  if lw_end is null or lw_end > lw_start + 9 then lw_end := lw_start + (w_end_full - w_start); end if;

  -- következő szállítási nap (előrendelés-kártya) + tavalyi párja
  select min(t.d) into next_liv from (
    select distinct o.data_livrare as d from nexus_orders o
    where extract(isodow from o.data_livrare) between 2 and 6
  ) t where t.d >= today;
  if next_liv is not null then
    select t.d into ly_liv from (
      select distinct o.data_livrare as d from nexus_orders o
      where extract(isodow from o.data_livrare) between 2 and 6
    ) t where t.d between (next_liv - 368) and (next_liv - 360)
    order by abs(t.d - (next_liv - 364)) limit 1;
    if ly_liv is null then ly_liv := next_liv - 364; end if;
  end if;

  return query
  select 'year'::text, y_start, today, ly_y_start, ly_date, ly_y_end,
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between y_start and today),
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between ly_y_start and ly_date),
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between ly_y_start and ly_y_end)
  union all
  select 'month', m_start, today, ly_m_start, ly_m_same, ly_m_end,
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between m_start and today),
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between ly_m_start and ly_m_same),
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between ly_m_start and ly_m_end)
  union all
  -- HÉT: a tavalyi TELJES héthez mérünk (a hét mindig a köv. szállítási nap
  -- előestéjén zárul — kedden vagy szerdán —, rész-hét összevetés nincs)
  select 'week', w_start, today, lw_start, lw_end, lw_end,
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between w_start and today),
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between lw_start and lw_end),
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between lw_start and lw_end)
  union all
  select 'orders', next_liv, next_liv, ly_liv, ly_liv, ly_liv,
    (select coalesce(sum(o.valoare_tva),0) from nexus_orders o where o.data_livrare = next_liv),
    (select coalesce(sum(o.valoare_tva),0) from nexus_orders o where o.data_livrare = ly_liv),
    (select coalesce(sum(o.valoare_tva),0) from nexus_orders o where o.data_livrare = ly_liv)
  where next_liv is not null;
end $$;

grant execute on function app_stat_progress() to authenticated;
