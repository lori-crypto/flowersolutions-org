-- ============================================================
-- 18_compare_tavalyi.sql — Heti összevetés tavalyi sorozatokkal:
-- hetenként az idei webshop-rendelés + számlázott MELLETT a
-- tavalyi megfelelő hét rendelés-állománya (NEXUS comenzi) és
-- valós eladása. +1 jövőbeli hét (a tavalyi adatok egy héttel
-- előre látszanak). A hét-határok a fő szállítási napok
-- (kedd–szombat; vasárnap/hétfő kis szállítások nem határok).
-- Idempotens. Előfeltétel: 10, 16.
-- ============================================================

create or replace function app_stat_compare_weeks(p_from date, p_to date)
returns table(week date, week_end date, is_future boolean,
              cur_order numeric, cur_gross numeric, cur_net numeric,
              ly_from date, ly_to date, ly_order numeric, ly_gross numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  return query
  with cal as (
    select distinct u.d from (
      select o.data_livrare as d from nexus_orders o
      union
      select c.delivery_date from webshop_cycles c
    ) u
    where extract(isodow from u.d) between 2 and 6
  ),
  starts as (
    select c.d from cal c where c.d between p_from and p_to
    union
    select (select min(c2.d) from cal c2
            where c2.d > (select max(c3.d) from cal c3 where c3.d between p_from and p_to))
  ),
  weeks as (
    select s.d as wk,
           coalesce((select min(c2.d) from cal c2 where c2.d > s.d) - 1, s.d + 6) as wke
    from (select distinct st.d from starts st where st.d is not null) s
  ),
  ly as (
    select w.wk, w.wke,
      coalesce((select c.d from cal c where c.d between w.wk - 368 and w.wk - 360
                order by abs(c.d - (w.wk - 364)) limit 1), w.wk - 364) as lyf
    from weeks w
  ),
  ly2 as (
    select l.wk, l.wke, l.lyf,
      least(coalesce((select min(c.d) from cal c where c.d > l.lyf) - 1,
                     l.lyf + (l.wke - l.wk)),
            l.lyf + 9) as lyt
    from ly l
  )
  select l.wk, l.wke, l.wk > today,
    coalesce((select sum(wo.value) from webshop_order_lines wo
              where wo.delivery_date between l.wk and l.wke), 0),
    coalesce((select sum(s.real_gross) from sales_lines s
              where s.tip_doc='Factura' and s.data_doc between l.wk and l.wke), 0),
    coalesce((select sum(s.real_net) from sales_lines s
              where s.tip_doc='Factura' and s.data_doc between l.wk and l.wke), 0),
    l.lyf, l.lyt,
    coalesce((select sum(o.valoare_tva) from nexus_orders o
              where o.data_livrare between l.lyf and l.lyt), 0),
    coalesce((select sum(s.real_gross) from sales_lines s
              where s.tip_doc='Factura' and s.data_doc between l.lyf and l.lyt), 0)
  from ly2 l
  order by l.wk;
end $$;

grant execute on function app_stat_compare_weeks(date, date) to authenticated;
