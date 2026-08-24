-- ============================================================
-- 11_statisztika_rpc.sql — Statisztika modul lekérdező RPC-i
-- Idempotens. Előfeltétel: 09, 10. Jogosultság: HR/admin.
-- ============================================================

-- Eladás-aggregálás tetszőleges dimenzió szerint
create or replace function app_stat_sales(
  p_from date, p_to date, p_dim text,
  p_client text default null, p_grupa text default null, p_q text default null
) returns table(label text, invoices bigint, qty numeric, net numeric, gross numeric, cost numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  return query
  select
    case p_dim
      when 'day'      then to_char(s.data_doc, 'YYYY-MM-DD')
      when 'month'    then to_char(s.data_doc, 'YYYY-MM')
      when 'client'   then coalesce(s.nume_cli, '—')
      when 'grupa'    then coalesce(s.grupa, '—')
      when 'clasa'    then coalesce(s.grupa, '—') || ' / ' || coalesce(s.clasa, '—')
      when 'subclasa' then coalesce(s.clasa, '—') || ' / ' || coalesce(s.subclasa, '—')
      when 'product'  then coalesce(s.denumire, '—')
      else 'Összesen'
    end as label,
    count(distinct coalesce(s.seria, '') || '/' || coalesce(s.nr, '')) as invoices,
    sum(s.cantitate) as qty,
    sum(s.real_net) as net,
    sum(s.real_gross) as gross,
    sum(s.val_pu) as cost
  from sales_lines s
  where s.data_doc between p_from and p_to
    and s.tip_doc = 'Factura'
    and (p_client is null or s.nume_cli = p_client)
    and (p_grupa is null or s.grupa = p_grupa)
    and (p_q is null or s.denumire ilike '%' || p_q || '%')
  group by 1
  order by 1;
end $$;

grant execute on function app_stat_sales(date, date, text, text, text, text) to authenticated;

-- Heti "előrendelés vs számlázott" összevetés (a cég hete: szállítási naptól
-- a következő szállítási nap előtti napig; ügyfél-párosítás nexus_id_client-en,
-- névre eséssel vissza)
create or replace function app_stat_compare(p_from date, p_to date)
returns table(week date, client text, order_ron numeric, nexus_net numeric, nexus_gross numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  return query
  with idmap as (
    select distinct w.nexus_id_client, max(w.company) as company
    from webshop_order_lines w
    where w.nexus_id_client is not null
    group by w.nexus_id_client
  ),
  ord as (
    select w.delivery_date as wk, coalesce(nullif(trim(w.company), ''), '—') as cli,
           sum(w.value) as order_ron
    from webshop_order_lines w
    where w.delivery_date between p_from and p_to
    group by 1, 2
  ),
  sal as (
    select
      (select max(c.delivery_date) from webshop_cycles c where c.delivery_date <= s.data_doc) as wk,
      coalesce(m.company, nullif(trim(s.nume_cli), ''), '—') as cli,
      sum(s.real_net) as net, sum(s.real_gross) as gross
    from sales_lines s
    left join idmap m on m.nexus_id_client = s.id_client
    where s.data_doc between p_from and p_to and s.tip_doc = 'Factura'
    group by 1, 2
  )
  select coalesce(o.wk, sa.wk) as week,
         coalesce(o.cli, sa.cli) as client,
         round(coalesce(o.order_ron, 0), 2),
         round(coalesce(sa.net, 0), 2),
         round(coalesce(sa.gross, 0), 2)
  from ord o
  full outer join sal sa on sa.wk = o.wk and sa.cli = o.cli
  where coalesce(o.wk, sa.wk) is not null
    and coalesce(o.wk, sa.wk) >= date '2026-07-22'  -- a webshop éles indulása
  order by 1, 2;
end $$;

grant execute on function app_stat_compare(date, date) to authenticated;
