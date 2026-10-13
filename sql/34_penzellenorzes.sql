-- ============================================================
-- 34_penzellenorzes.sql — Irodai pénzellenőrzés (Edit nézete):
-- a BOLTI zárások összegeit tételenként ellenőrzi (Z-készpénz,
-- Z-kártya, POS, valós készpénz), eltérésnél megjegyzést ír,
-- és rögzíti, kinek adta át a pénzt. A lerakat kimarad.
-- Idempotens. Előfeltétel: 33.
-- ============================================================

insert into capabilities (key, description) values
  ('penz.ellenorzes', 'Bolti pénzek irodai ellenőrzése és átadás-rögzítés')
on conflict (key) do nothing;

alter table cash_days add column if not exists ver_status text
  check (ver_status in ('rendben','elteres'));
alter table cash_days add column if not exists ver_z_cash boolean not null default false;
alter table cash_days add column if not exists ver_z_card boolean not null default false;
alter table cash_days add column if not exists ver_pos boolean not null default false;
alter table cash_days add column if not exists ver_cash boolean not null default false;
alter table cash_days add column if not exists ver_note text;
alter table cash_days add column if not exists ver_by uuid references persons(id);
alter table cash_days add column if not exists ver_at timestamptz;
alter table cash_days add column if not exists handed_to uuid references persons(id);

-- jogosultság-segéd
create or replace function app_cash_office_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select app_has_cap('penz.ellenorzes') or app_has_cap('hr')
$$;

-- a kontextus RPC az irodai ellenőrnek is nyíljon meg (üres egység-listával)
create or replace function app_cash_context_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select app_has_cap('penztar') or app_has_cap('hr') or app_has_cap('penz.ellenorzes')
$$;

-- a kontextus engedje be az irodai ellenőrt is (neki üres lesz az egység-lista)
create or replace function app_cash_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := app_current_person();
  today date := (now() at time zone 'Europe/Bucharest')::date;
  res jsonb;
begin
  if not app_cash_context_allowed() then
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

-- ── Ellenőrizendő bolti zárások listája ─────────────────────
create or replace function app_cash_office_list(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_cash_office_allowed() then raise exception 'Nincs jogosultság.'; end if;
  return jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'day', d.day, 'status', d.status,
        'unit_name_hu', cu.name_hu, 'unit_name_ro', cu.name_ro,
        'closed_by_name', (select p.name from persons p where p.id = d.closed_by),
        'counted_cash', d.counted_cash, 'z_cash', d.z_cash,
        'z_card', d.z_card, 'pos_settlement', d.pos_settlement,
        'cash_diff', d.cash_diff, 'card_diff', d.card_diff,
        'expl_cash', d.expl_cash, 'expl_card', d.expl_card,
        'ver_status', d.ver_status, 'ver_z_cash', d.ver_z_cash,
        'ver_z_card', d.ver_z_card, 'ver_pos', d.ver_pos, 'ver_cash', d.ver_cash,
        'ver_note', d.ver_note, 'ver_at', to_char(d.ver_at, 'MM-DD HH24:MI'),
        'ver_by_name', (select p.name from persons p where p.id = d.ver_by),
        'handed_to', d.handed_to,
        'handed_to_name', (select p.name from persons p where p.id = d.handed_to)
      ) order by d.day desc, cu.sort)
      from cash_days d
      join cash_units cu on cu.id = d.unit_id
      where cu.kind = 'bolt'
        and d.status in ('lezart','elfogadva')
        and d.day between p_from and p_to
    ), '[]'::jsonb),
    'handover_people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
        'is_default', exists (select 1 from person_capabilities pc
                              where pc.person_id = p.id and pc.capability = 'admin'))
        order by p.name)
      from persons p
      where p.active and exists (
        select 1 from person_capabilities pc
        where pc.person_id = p.id and pc.capability in ('admin','penztar'))
    ), '[]'::jsonb)
  );
end $$;

-- ── Ellenőrzés rögzítése ────────────────────────────────────
create or replace function app_cash_office_verify(
  p_day_id uuid,
  p_z_cash boolean, p_z_card boolean, p_pos boolean, p_cash boolean,
  p_note text, p_handed uuid
) returns void language plpgsql security definer set search_path = public as $$
declare d cash_days%rowtype; ukind text; st text;
begin
  if not app_cash_office_allowed() then raise exception 'Nincs jogosultság.'; end if;
  select * into d from cash_days where id = p_day_id;
  if d.id is null then raise exception 'Nincs ilyen zárás.'; end if;
  select kind into ukind from cash_units where id = d.unit_id;
  if ukind <> 'bolt' then raise exception 'Csak bolti zárás ellenőrizhető itt.'; end if;
  if d.status not in ('lezart','elfogadva') then raise exception 'Csak lezárt nap ellenőrizhető.'; end if;
  if p_handed is null then raise exception 'Add meg, kinek adtad át a pénzt.'; end if;

  if p_z_cash and p_z_card and p_pos and p_cash then
    st := 'rendben';
  else
    if coalesce(p_note,'') = '' then
      raise exception 'Ha nem minden összeg egyezik, írd le az eltérést.';
    end if;
    st := 'elteres';
  end if;

  update cash_days set
    ver_status = st,
    ver_z_cash = p_z_cash, ver_z_card = p_z_card,
    ver_pos = p_pos, ver_cash = p_cash,
    ver_note = nullif(p_note,''),
    ver_by = app_current_person(), ver_at = now(),
    handed_to = p_handed
  where id = p_day_id;
end $$;

grant execute on function app_cash_office_allowed() to authenticated;
grant execute on function app_cash_context_allowed() to authenticated;
grant execute on function app_cash_office_list(date, date) to authenticated;
grant execute on function app_cash_office_verify(uuid, boolean, boolean, boolean, boolean, text, uuid) to authenticated;
