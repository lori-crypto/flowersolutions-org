-- ============================================================
-- 27_sofor_ugyfel.sql — Pénztár 5. kör:
--  • Sofőrnél maradt pénz: záráskor külön tételként rögzíthető,
--    beszámít aznap egyeztetésébe, de PIROS függőben marad, amíg
--    be nem érkezik; beérkezéskor külön naplótételként könyvelődik
--    (a beérkezés napjának kasszáját nem érinti).
--  • Ügyfél-választó: NEXUS-ügyféltörzs kereső a pénztárosoknak.
-- Idempotens. Előfeltétel: 26.
-- ============================================================

-- kategória-hatókör: melyik egységtípus használhatja
alter table cash_categories add column if not exists scope text not null default 'mind'
  check (scope in ('mind','bolt','lerakat'));

create table if not exists cash_pending (
  id          uuid primary key default gen_random_uuid(),
  day_id      uuid not null references cash_days(id) on delete cascade,
  unit_id     uuid not null references cash_units(id),
  day         date not null,
  amount      numeric not null,
  note        text,
  status      text not null default 'fuggoben' check (status in ('fuggoben','beerkezett')),
  created_by  uuid references persons(id),
  created_at  timestamptz not null default now(),
  resolved_by uuid references persons(id),
  resolved_at timestamptz,
  resolved_day date
);

alter table cash_pending enable row level security;
drop policy if exists cp_hr_sel on cash_pending;
create policy cp_hr_sel on cash_pending for select to authenticated using (app_has_cap('hr'));

drop trigger if exists cash_pending_audit on cash_pending;
create trigger cash_pending_audit after insert or update or delete on cash_pending
  for each row execute function app_audit();

-- ── Ügyfél-kereső (NEXUS-törzs a sales_lines-ból) ───────────
create or replace function app_cash_clients(p_q text)
returns table(label text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (app_has_cap('penztar') or app_has_cap('hr')) then
    raise exception 'Nincs jogosultság.';
  end if;
  return query
  select s.nume_cli from sales_lines s
  where s.nume_cli ilike '%' || p_q || '%'
  group by s.nume_cli
  order by s.nume_cli
  limit 40;
end $$;

-- ── Kontextus: + mai és függő sofőr-tételek ─────────────────
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
        where p.unit_id = cu.id and p.day = today
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

-- ── Mentés: + sofőr-tételek cseréje ─────────────────────────
create or replace function app_cash_save_day(p_unit uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  did uuid;
  counted numeric := 0;
  m jsonb; e jsonb; pj jsonb;
begin
  if not app_cash_member_of(p_unit) then raise exception 'Nincs jogosultság ehhez az egységhez.'; end if;

  select id into did from cash_days where unit_id = p_unit and day = today;
  if did is null then
    insert into cash_days (unit_id, day) values (p_unit, today) returning id into did;
  end if;
  if (select status from cash_days where id = did) in ('lezart','elfogadva') then
    raise exception 'A nap már le van zárva.';
  end if;

  delete from cash_monetar where day_id = did;
  for m in select * from jsonb_array_elements(coalesce(p_payload->'monetar', '[]'::jsonb)) loop
    if coalesce((m->>'qty')::int, 0) > 0 then
      insert into cash_monetar (day_id, denom, qty)
      values (did, (m->>'denom')::numeric, (m->>'qty')::int);
      counted := counted + (m->>'denom')::numeric * (m->>'qty')::int;
    end if;
  end loop;

  delete from cash_expenses where day_id = did;
  for e in select * from jsonb_array_elements(coalesce(p_payload->'expenses', '[]'::jsonb)) loop
    insert into cash_expenses (day_id, unit_id, day, kind, amount, category_id,
                               vehicle_id, client_name, description, created_by)
    values (did, p_unit, today, 'koltseg',
            (e->>'amount')::numeric,
            nullif(e->>'category_id','')::uuid,
            nullif(e->>'vehicle_id','')::uuid,
            nullif(e->>'client_name',''),
            nullif(e->>'description',''),
            app_current_person());
  end loop;

  -- mai sofőr-tételek cseréje (a korábbi napok függő tételeihez nem nyúlunk)
  delete from cash_pending where day_id = did and day = today;
  for pj in select * from jsonb_array_elements(coalesce(p_payload->'pending', '[]'::jsonb)) loop
    if coalesce((pj->>'amount')::numeric, 0) <> 0 then
      insert into cash_pending (day_id, unit_id, day, amount, note, created_by)
      values (did, p_unit, today, (pj->>'amount')::numeric,
              nullif(pj->>'note',''), app_current_person());
    end if;
  end loop;

  update cash_days set
    float_morning  = nullif(p_payload->>'float_morning','')::numeric,
    float_evening  = nullif(p_payload->>'float_evening','')::numeric,
    counted_cash   = counted,
    z_cash         = nullif(p_payload->>'z_cash','')::numeric,
    z_card         = nullif(p_payload->>'z_card','')::numeric,
    pos_settlement = nullif(p_payload->>'pos_settlement','')::numeric,
    nexus_revenue  = coalesce(nullif(p_payload->>'nexus_revenue','')::numeric, nexus_revenue),
    expl_cash      = nullif(p_payload->>'expl_cash',''),
    expl_card      = nullif(p_payload->>'expl_card',''),
    status         = case when status = 'visszakuldve' then 'nyitott' else status end
  where id = did;

  return did;
end $$;

-- ── Lezárás: a sofőr-tételek beszámítanak az egyeztetésbe ───
create or replace function app_cash_close_day(p_unit uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  d cash_days%rowtype;
  ukind text;
  exp_total numeric;
  pend_total numeric;
  expected numeric;
  v_cash_diff numeric;
  v_card_diff numeric;
  auto_rev numeric;
begin
  if not app_cash_member_of(p_unit) then raise exception 'Nincs jogosultság ehhez az egységhez.'; end if;
  select * into d from cash_days where unit_id = p_unit and day = today;
  if d.id is null then raise exception 'Előbb mentsd el a napot.'; end if;
  if d.status in ('lezart','elfogadva') then raise exception 'A nap már le van zárva.'; end if;
  select kind into ukind from cash_units where id = p_unit;
  select coalesce(sum(amount),0) into exp_total from cash_expenses where day_id = d.id;
  select coalesce(sum(amount),0) into pend_total from cash_pending where day_id = d.id and day = today;

  if coalesce(d.counted_cash,0) = 0 and pend_total = 0 then
    raise exception 'Hiányzik a készpénz megszámolása (monetár).';
  end if;

  if ukind = 'bolt' then
    if d.z_cash is null or d.z_card is null or d.pos_settlement is null then
      raise exception 'Hiányzó Z-jelentés vagy POS érték.';
    end if;
    expected := d.z_cash - exp_total + coalesce(d.float_morning,0) - coalesce(d.float_evening,0);
    v_cash_diff := round((coalesce(d.counted_cash,0) + pend_total - expected) * 100) / 100;
    v_card_diff := round((d.z_card - d.pos_settlement) * 100) / 100;
    if abs(v_card_diff) > 1 and coalesce(d.expl_card,'') = '' then
      raise exception 'A kártya-eltéréshez indoklás szükséges. / Diferența card necesită explicație.';
    end if;
  else
    if d.nexus_revenue is null then
      select amount into auto_rev from cash_nexus_rev where unit_id = p_unit and day = today;
      if auto_rev is null then
        raise exception 'Hiányzik a gép szerinti árulás értéke (NEXUS szinkron).';
      end if;
      update cash_days set nexus_revenue = auto_rev where id = d.id;
      d.nexus_revenue := auto_rev;
    end if;
    v_cash_diff := round((coalesce(d.counted_cash,0) + exp_total + pend_total - d.nexus_revenue) * 100) / 100;
    v_card_diff := null;
  end if;

  if abs(coalesce(v_cash_diff,0)) > 1 and coalesce(d.expl_cash,'') = '' then
    raise exception 'A készpénz-eltéréshez indoklás szükséges. / Diferența de numerar necesită explicație.';
  end if;

  update cash_days set
    status = 'lezart', closed_by = app_current_person(), closed_at = now(),
    cash_diff = v_cash_diff, card_diff = v_card_diff
  where id = d.id;

  return jsonb_build_object('cash_diff', v_cash_diff, 'card_diff', v_card_diff);
end $$;

-- ── Sofőr-pénz beérkezett ───────────────────────────────────
create or replace function app_cash_pending_resolve(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  u uuid;
begin
  select unit_id into u from cash_pending where id = p_id and status = 'fuggoben';
  if u is null then raise exception 'Nincs ilyen függő tétel.'; end if;
  if not app_cash_member_of(u) then raise exception 'Nincs jogosultság.'; end if;
  update cash_pending set status = 'beerkezett',
    resolved_by = app_current_person(), resolved_at = now(), resolved_day = today
  where id = p_id;
end $$;

-- ── Egyenleg: + beérkezett sofőr-pénzek ─────────────────────
create or replace function app_cash_balance()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s cash_settings%rowtype;
  inflow numeric; outflow numeric; pend_in numeric; pend_open numeric;
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  select * into s from cash_settings where id = 1;
  select coalesce(sum(d.counted_cash),0) into inflow
  from cash_days d
  where d.status in ('lezart','elfogadva') and d.day >= s.opening_date;
  select coalesce(sum(case e.kind
           when 'letet' then e.amount
           when 'koltseg' then e.amount
           else -e.amount end),0) into outflow
  from cash_expenses e
  where e.day_id is null and e.day >= s.opening_date;
  select coalesce(sum(p.amount),0) into pend_in
  from cash_pending p
  where p.status = 'beerkezett' and p.resolved_day >= s.opening_date;
  select coalesce(sum(p.amount),0) into pend_open
  from cash_pending p where p.status = 'fuggoben';
  return jsonb_build_object(
    'opening_balance', s.opening_balance,
    'opening_date', s.opening_date,
    'balance', round((s.opening_balance + inflow + pend_in - outflow) * 100) / 100,
    'pending_open', pend_open
  );
end $$;

-- ── Napló: + sofőr-tételek ──────────────────────────────────
create or replace function app_cash_ledger(p_from date, p_to date)
returns table(entry_date date, etype text, unit_name text, label text,
              amount numeric, receipt_path text, who text, status text, expl text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  return query
  select d.day, 'zaras'::text, cu.name_hu, 'napi zárás'::text,
         coalesce(d.counted_cash,0), null::text,
         (select p.name from persons p where p.id = d.closed_by),
         d.status, d.expl_cash
  from cash_days d join cash_units cu on cu.id = d.unit_id
  where d.day between p_from and p_to
  union all
  select e.day, e.kind,
         (select cu.name_hu from cash_units cu where cu.id = e.unit_id),
         coalesce(e.description, case e.kind when 'letet' then 'banki letét' else e.kind end),
         case e.kind when 'korrekcio' then e.amount else -e.amount end,
         e.receipt_path,
         (select p.name from persons p where p.id = e.created_by),
         null::text, e.note
  from cash_expenses e
  where e.day_id is null and e.day between p_from and p_to
  union all
  select pp.resolved_day, 'sofor'::text,
         (select cu.name_hu from cash_units cu where cu.id = pp.unit_id),
         coalesce('sofőr-pénz beérkezett (' || to_char(pp.day, 'MM.DD') || ')', 'sofőr-pénz'),
         pp.amount, null::text,
         (select p.name from persons p where p.id = pp.resolved_by),
         'beerkezett'::text, pp.note
  from cash_pending pp
  where pp.status = 'beerkezett' and pp.resolved_day between p_from and p_to
  order by 1 desc, 2;
end $$;

grant execute on function app_cash_clients(text) to authenticated;
grant execute on function app_cash_context() to authenticated;
grant execute on function app_cash_save_day(uuid, jsonb) to authenticated;
grant execute on function app_cash_close_day(uuid) to authenticated;
grant execute on function app_cash_pending_resolve(uuid) to authenticated;
grant execute on function app_cash_balance() to authenticated;
grant execute on function app_cash_ledger(date, date) to authenticated;
