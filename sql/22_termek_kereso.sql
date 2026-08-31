-- ============================================================
-- 22_termek_kereso.sql — Termék-javaslatok a BI szűrőhöz:
-- gépelés közben a beírt részletre illő termékneveket adja vissza
-- (max 60 találat). Idempotens. Előfeltétel: 11.
-- ============================================================

create or replace function app_stat_product_search(p_q text)
returns table(label text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  return query
  select s.denumire from sales_lines s
  where s.denumire ilike '%' || p_q || '%'
  group by s.denumire
  order by s.denumire
  limit 60;
end $$;

grant execute on function app_stat_product_search(text) to authenticated;
