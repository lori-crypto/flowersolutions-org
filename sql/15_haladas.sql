-- ============================================================
-- 15_haladas.sql — „Haladás" ösztönző mutatók: év/hónap/hét
-- az idei érték vs tavaly ugyaneddig vs tavalyi teljes.
-- A hét a SZÁLLÍTÁSI NAPPAL kezdődik (webshop_cycles; általában
-- szerda, néha csütörtök), és a következő szállítási nap előtti
-- napig tart. A tavalyi párja pontosan 364 nappal korábbi,
-- ugyanolyan hosszú időszak (a hétköznapok fedik egymást).
-- Ha nincs ciklus-adat, hétfői hétre esik vissza.
-- Idempotens. Előfeltétel: 09, 10.
-- ============================================================

create or replace function app_stat_progress()
returns table(k text, cur_from date, cur_to date, prev_from date, prev_same_to date,
              prev_full_to date, cur numeric, prev_same numeric, prev_full numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  y_start date := date_trunc('year', today)::date;
  m_start date := date_trunc('month', today)::date;
  w_start date := date_trunc('week', today)::date;   -- hétfő
  ly_date date := (today - interval '1 year')::date;
  ly_y_start date := date_trunc('year', ly_date)::date;
  ly_y_end date := (date_trunc('year', ly_date) + interval '1 year - 1 day')::date;
  ly_m_start date := date_trunc('month', ly_date)::date;
  ly_m_end date := (date_trunc('month', ly_date) + interval '1 month - 1 day')::date;
  ly_m_same date := least((ly_m_start + (today - m_start))::date, ly_m_end);
  w_end_full date;
  lw_start date;
  lw_same date;
  lw_end date;
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;

  -- a cég hete: az utolsó szállítási naptól a következő előtti napig
  select max(c.delivery_date) into w_start
  from webshop_cycles c where c.delivery_date <= today;
  if w_start is null then w_start := date_trunc('week', today)::date; end if;
  select min(c.delivery_date) - 1 into w_end_full
  from webshop_cycles c where c.delivery_date > w_start;
  if w_end_full is null then w_end_full := w_start + 6; end if;

  -- A TAVALYI hét határait a tavalyi TÉNYLEGES szállítási napok adják.
  -- A szállítási napot a forgalmi csúcs jelzi (azon a napon sokszoros a
  -- számlázás): a -364 nap ±3 napos környezetében a legnagyobb forgalmú nap
  -- a hét kezdete; a következő csúcsnap (4-10 nappal később) előestéje a vége.
  select s.data_doc into lw_start from sales_lines s
  where s.tip_doc = 'Factura'
    and s.data_doc between (w_start - 367) and (w_start - 361)
  group by s.data_doc order by sum(s.real_net) desc limit 1;
  if lw_start is null then lw_start := w_start - 364; end if;

  select s.data_doc - 1 into lw_end from sales_lines s
  where s.tip_doc = 'Factura'
    and s.data_doc between (lw_start + 4) and (lw_start + 10)
  group by s.data_doc order by sum(s.real_net) desc limit 1;
  if lw_end is null then lw_end := lw_start + (w_end_full - w_start); end if;

  lw_same := least(lw_start + (today - w_start), lw_end);
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
  select 'week', w_start, today, lw_start, lw_same, lw_end,
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between w_start and today),
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between lw_start and lw_same),
    (select coalesce(sum(s.real_net),0) from sales_lines s
      where s.tip_doc='Factura' and s.data_doc between lw_start and lw_end);
end $$;

grant execute on function app_stat_progress() to authenticated;
