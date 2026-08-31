-- ============================================================
-- 21_ev_valogatas.sql — Tetszőleges év-kombináció a BI szűrőben:
-- az app_stat_sales új, opcionális p_years paramétert kap — ha meg van
-- adva, csak a felsorolt évek számítanak (pl. {2024,2026}, 2025 kihagyva).
-- A régi szignatúrát el kell dobni, különben a PostgREST nem tud
-- választani a két változat közül. Idempotens. Előfeltétel: 14.
-- ============================================================

drop function if exists app_stat_sales(date, date, text, text, text, text, boolean);

create or replace function app_stat_sales(
  p_from date, p_to date, p_dim text,
  p_client text default null, p_grupa text default null, p_q text default null,
  p_inv boolean default false, p_years int[] default null
) returns table(label text, invoices bigint, qty numeric, net numeric, gross numeric, cost numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  return query
  select
    case p_dim
      when 'day'         then to_char(s.data_doc, 'YYYY-MM-DD')
      when 'month'       then to_char(s.data_doc, 'YYYY-MM')
      when 'year'        then to_char(s.data_doc, 'YYYY')
      when 'client'      then coalesce(s.nume_cli, '—')
      when 'client_year' then to_char(s.data_doc, 'YYYY') || '¦' || coalesce(s.nume_cli, '—')
      when 'grupa'       then coalesce(s.grupa, '—')
      when 'clasa'       then coalesce(s.grupa, '—') || ' / ' || coalesce(s.clasa, '—')
      when 'subclasa'    then coalesce(s.clasa, '—') || ' / ' || coalesce(s.subclasa, '—')
      when 'product'     then coalesce(s.denumire, '—')
      else 'Összesen'
    end as label,
    case when p_inv then count(distinct (s.seria, s.nr)) else 0 end as invoices,
    sum(s.cantitate) as qty,
    sum(s.real_net) as net,
    sum(s.real_gross) as gross,
    sum(s.val_pu) as cost
  from sales_lines s
  where s.data_doc between p_from and p_to
    and (p_years is null or extract(year from s.data_doc)::int = any(p_years))
    and s.tip_doc = 'Factura'
    and (p_client is null or s.nume_cli ilike '%' || p_client || '%')
    and (p_grupa is null or s.grupa = p_grupa)
    and (p_q is null or s.denumire ilike '%' || p_q || '%')
  group by 1
  order by 1;
end $$;

grant execute on function app_stat_sales(date, date, text, text, text, text, boolean, int[]) to authenticated;
