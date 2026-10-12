-- ============================================================
-- 31_sofor_aznap.sql — Sofőr-pénz aznapi beérkezése:
-- a kontextus mai sofőr-listája csak a FÜGGŐ tételeket adja
-- (a már beérkezettek nem kerülhetnek vissza mentéskor), így a
-- lezárt napon az aznapi tétel is nyugtázható.
-- Idempotens. Előfeltétel: 30.
-- ============================================================

create or replace function app_cash_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := app_current_person();
  today date := (now() at time zone 'Europe/Bucharest')::date;
  res jsonb;
begin
  if not (app_has_cap('penztar') or app_has_cap('hr')) then
    raise exception 'Nincs jogosultság.';
  end if;
  select jsonb_build_object(
    'today', today,
    'units', coalesce(jsonb_agg(u order by u->>'sort'), '[]'::jsonb)
  ) into res
  from (
    select jsonb_build_object(
      'id', cu.id, 'code', cu.code, 'name_hu', cu.name_hu, 'name_ro', cu.name_ro,
      'kind', cu.kind, 'sort', cu.sort,
      'nexus_today', (
        select r.amount from cash_nexus_rev r where r.unit_id = cu.id and r.day = today
      ),
      'nexus_synced_at', (
        select to_char(r.synced_at at time zone 'Europe/Bucharest', 'HH24:MI')
        from cash_nexus_rev r where r.unit_id = cu.id and r.day = today
      ),
      'today_day', (
        select to_jsonb(d) from cash_days d
        where d.unit_id = cu.id and d.day = today
      ),
      'monetar', (
        select coalesce(jsonb_agg(jsonb_build_object('denom', m.denom, 'qty', m.qty)), '[]'::jsonb)
        from cash_monetar m
        join cash_days d on d.id = m.day_id
        where d.unit_id = cu.id and d.day = today
      ),
      'expenses', (
        select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
        from cash_expenses e
        join cash_days d on d.id = e.day_id
        where d.unit_id = cu.id and d.day = today
      ),
      'pending_today', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'amount', p.amount, 'note', p.note) order by p.created_at), '[]'::jsonb)
        from cash_pending p
        where p.unit_id = cu.id and p.day = today and p.status = 'fuggoben'
      ),
      'pending_open', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'day', p.day, 'amount', p.amount, 'note', p.note) order by p.day), '[]'::jsonb)
        from cash_pending p
        where p.unit_id = cu.id and p.status = 'fuggoben' and p.day < today
      ),
      'history', case when cu.kind = 'lerakat' then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'day', d.day, 'status', d.status, 'counted_cash', d.counted_cash,
          'nexus_revenue', d.nexus_revenue, 'cash_diff', d.cash_diff,
          'expl_cash', d.expl_cash,
          'expenses_total', (select coalesce(sum(e.amount),0) from cash_expenses e where e.day_id = d.id),
          'closed_by_name', (select p.name from persons p where p.id = d.closed_by)
        ) order by d.day desc), '[]'::jsonb)
        from cash_days d
        where d.unit_id = cu.id and d.day >= today - 5 and d.day < today
      ) else '[]'::jsonb end
    ) as u
    from cash_units cu
    where cu.active
      and (app_has_cap('hr') or exists (
        select 1 from cash_unit_members m where m.unit_id = cu.id and m.person_id = me))
  ) s;
  return res;
end $$;

grant execute on function app_cash_context() to authenticated;

-- a nap-részletező is csak a függő sofőr-tételeket adja a szerkesztőnek
create or replace function app_cash_day_detail(p_unit uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d cash_days%rowtype;
begin
  if not app_cash_can_edit_day(p_unit, p_day) then raise exception 'Nincs jogosultság.'; end if;
  select * into d from cash_days where unit_id = p_unit and day = p_day;
  return jsonb_build_object(
    'day', to_jsonb(d),
    'monetar', (select coalesce(jsonb_agg(jsonb_build_object('denom', m.denom, 'qty', m.qty)), '[]'::jsonb)
                from cash_monetar m where m.day_id = d.id),
    'expenses', (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
                 from cash_expenses e where e.day_id = d.id),
    'pending', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'note', p.note)
                 order by p.created_at), '[]'::jsonb)
                from cash_pending p
                where p.day_id = d.id and p.day = p_day and p.status = 'fuggoben'),
    'nexus', (select r.amount from cash_nexus_rev r where r.unit_id = p_unit and r.day = p_day)
  );
end $$;

grant execute on function app_cash_day_detail(uuid, date) to authenticated;
