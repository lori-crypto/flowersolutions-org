-- ============================================================
-- 23_penztar.sql — Pénztár (kasszazárás) modul, 1. kör:
-- egységek, kategóriák + gyorsgombok, járművek, napi zárások
-- (monetár, Z-értékek, eltérések, indoklás-kényszer), költségek,
-- cégszintű kezdő egyenleg, jogosultságok, audit.
-- Idempotens. Előfeltétel: 01 (persons, capabilities, app_audit).
-- ============================================================

insert into capabilities (key, description) values
  ('penztar', 'Pénztár: saját egység napi zárásának kitöltése')
on conflict (key) do nothing;

-- ── Egységek ────────────────────────────────────────────────
create table if not exists cash_units (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  name_hu    text not null,
  name_ro    text,
  kind       text not null check (kind in ('bolt','lerakat')),
  nexus_cont text,
  active     boolean not null default true,
  sort       int not null default 0
);

create table if not exists cash_unit_members (
  unit_id   uuid not null references cash_units(id) on delete cascade,
  person_id uuid not null references persons(id) on delete cascade,
  primary key (unit_id, person_id)
);

-- ── Cégszintű kezdő egyenleg (egyetlen sor) ─────────────────
create table if not exists cash_settings (
  id              int primary key default 1 check (id = 1),
  opening_balance numeric not null default 0,
  opening_date    date not null default current_date
);
insert into cash_settings (id) values (1) on conflict (id) do nothing;

-- ── Járművek ────────────────────────────────────────────────
create table if not exists cash_vehicles (
  id     uuid primary key default gen_random_uuid(),
  plate  text unique not null,
  name   text,
  active boolean not null default true
);

-- ── Költségkategóriák + gyorsgombok ─────────────────────────
create table if not exists cash_categories (
  id            uuid primary key default gen_random_uuid(),
  name_hu       text not null,
  name_ro       text,
  req_vehicle   boolean not null default false,
  req_client    boolean not null default false,
  req_desc      boolean not null default false,
  req_photo     boolean not null default false,
  staff_can_use boolean not null default true,
  approved      boolean not null default true, -- kolléga által felvett: false → átnézendő
  created_by    uuid references persons(id),
  active        boolean not null default true,
  sort          int not null default 0
);

create table if not exists cash_quicklabels (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references cash_categories(id) on delete cascade,
  label       text not null
);

-- ── Napi zárások ────────────────────────────────────────────
create table if not exists cash_days (
  id             uuid primary key default gen_random_uuid(),
  unit_id        uuid not null references cash_units(id),
  day            date not null,
  status         text not null default 'nyitott'
                 check (status in ('nyitott','lezart','elfogadva','visszakuldve')),
  closed_by      uuid references persons(id),
  closed_at      timestamptz,
  float_morning  numeric,
  float_evening  numeric,
  counted_cash   numeric,          -- monetárból számolva
  z_cash         numeric,
  z_card         numeric,
  pos_settlement numeric,
  nexus_revenue  numeric,          -- lerakat: a gép szerinti árulás
  cash_diff      numeric,
  card_diff      numeric,
  expl_cash      text,
  expl_card      text,
  review_note    text,
  reviewed_by    uuid references persons(id),
  reviewed_at    timestamptz,
  unique (unit_id, day)
);

create table if not exists cash_monetar (
  day_id uuid not null references cash_days(id) on delete cascade,
  denom  numeric not null,
  qty    int not null default 0,
  primary key (day_id, denom)
);

-- ── Költség- és letét-tételek ───────────────────────────────
create table if not exists cash_expenses (
  id           uuid primary key default gen_random_uuid(),
  day_id       uuid references cash_days(id) on delete cascade,
  unit_id      uuid references cash_units(id),
  day          date not null,
  kind         text not null default 'koltseg'
               check (kind in ('koltseg','letet','korrekcio')),
  amount       numeric not null,
  category_id  uuid references cash_categories(id),
  vehicle_id   uuid references cash_vehicles(id),
  client_name  text,
  description  text,
  note         text,
  receipt_path text,
  created_by   uuid references persons(id),
  created_at   timestamptz not null default now()
);

create index if not exists cash_expenses_day_idx on cash_expenses(day);
create index if not exists cash_days_day_idx on cash_days(day);

-- ── Kiinduló adatok ─────────────────────────────────────────
insert into cash_units (code, name_hu, name_ro, kind, nexus_cont, sort) values
  ('shopping_city', 'Shopping City', 'Shopping City', 'bolt', null, 1),
  ('rovinari',      'Rovinari',      'Rovinari',      'bolt', null, 2),
  ('lerakat',       'Lerakat',       'Depozit',       'lerakat', '5311.01', 3)
on conflict (code) do nothing;

insert into cash_vehicles (plate, name)
select v.plate, v.name from (values
  ('FSS03', 'FSS03'), ('FSS17', 'FSS17')
) as v(plate, name)
where not exists (select 1 from cash_vehicles cv where cv.plate = v.plate);

do $seed$
begin
  if not exists (select 1 from cash_categories) then
    insert into cash_categories (name_hu, name_ro, req_vehicle, req_client, req_desc, sort) values
      ('Autó',             'Mașină',            true,  false, true,  1),
      ('Csomagküldés',     'Expediere colet',   false, true,  false, 2),
      ('Üzemeltetés',      'Funcționare',       false, false, false, 3),
      ('Posta',            'Poștă',             false, false, false, 4),
      ('Előleg / személyi','Avans / personal',  false, false, true,  5),
      ('Egyéb',            'Altele',            false, false, true,  9);
    insert into cash_quicklabels (category_id, label)
    select c.id, l.label from cash_categories c
    join (values
      ('Autó', 'olaj'), ('Autó', 'mosás'), ('Autó', 'verificare'), ('Autó', 'parkolás'),
      ('Csomagküldés', 'busz'),
      ('Üzemeltetés', 'címkék'), ('Üzemeltetés', 'szemét'), ('Üzemeltetés', 'tisztítószer')
    ) as l(cat, label) on l.cat = c.name_hu;
  end if;
end $seed$;

-- ── RLS ─────────────────────────────────────────────────────
alter table cash_units enable row level security;
alter table cash_unit_members enable row level security;
alter table cash_settings enable row level security;
alter table cash_vehicles enable row level security;
alter table cash_categories enable row level security;
alter table cash_quicklabels enable row level security;
alter table cash_days enable row level security;
alter table cash_monetar enable row level security;
alter table cash_expenses enable row level security;

-- törzsadatok: minden bejelentkezett olvassa, admin írja
drop policy if exists cu_sel on cash_units;
create policy cu_sel on cash_units for select to authenticated using (true);
drop policy if exists cu_adm on cash_units;
create policy cu_adm on cash_units for all to authenticated
  using (app_is_admin()) with check (app_is_admin());

drop policy if exists cum_sel on cash_unit_members;
create policy cum_sel on cash_unit_members for select to authenticated
  using (person_id = app_current_person() or app_is_admin());
drop policy if exists cum_adm on cash_unit_members;
create policy cum_adm on cash_unit_members for all to authenticated
  using (app_is_admin()) with check (app_is_admin());

drop policy if exists cs_adm on cash_settings;
create policy cs_adm on cash_settings for all to authenticated
  using (app_has_cap('hr')) with check (app_is_admin());

drop policy if exists cv_sel on cash_vehicles;
create policy cv_sel on cash_vehicles for select to authenticated using (true);
drop policy if exists cv_adm on cash_vehicles;
create policy cv_adm on cash_vehicles for all to authenticated
  using (app_is_admin()) with check (app_is_admin());

drop policy if exists cc_sel on cash_categories;
create policy cc_sel on cash_categories for select to authenticated using (true);
drop policy if exists cc_adm on cash_categories;
create policy cc_adm on cash_categories for all to authenticated
  using (app_is_admin()) with check (app_is_admin());
-- kolléga új kategóriát vehet fel, de csak jóváhagyásra várót
drop policy if exists cc_staff_ins on cash_categories;
create policy cc_staff_ins on cash_categories for insert to authenticated
  with check (app_has_cap('penztar') and approved = false and created_by = app_current_person());

drop policy if exists cq_sel on cash_quicklabels;
create policy cq_sel on cash_quicklabels for select to authenticated using (true);
drop policy if exists cq_adm on cash_quicklabels;
create policy cq_adm on cash_quicklabels for all to authenticated
  using (app_is_admin()) with check (app_is_admin());

-- zárások/tételek: közvetlen olvasás admin/hr-nek; kollégák RPC-n át dolgoznak
drop policy if exists cd_adm_sel on cash_days;
create policy cd_adm_sel on cash_days for select to authenticated using (app_has_cap('hr'));
drop policy if exists cm_adm_sel on cash_monetar;
create policy cm_adm_sel on cash_monetar for select to authenticated using (app_has_cap('hr'));
drop policy if exists ce_adm_sel on cash_expenses;
create policy ce_adm_sel on cash_expenses for select to authenticated using (app_has_cap('hr'));

-- ── Audit ───────────────────────────────────────────────────
drop trigger if exists cash_days_audit on cash_days;
create trigger cash_days_audit after insert or update or delete on cash_days
  for each row execute function app_audit();
drop trigger if exists cash_expenses_audit on cash_expenses;
create trigger cash_expenses_audit after insert or update or delete on cash_expenses
  for each row execute function app_audit();
drop trigger if exists cash_categories_audit on cash_categories;
create trigger cash_categories_audit after insert or update or delete on cash_categories
  for each row execute function app_audit();
drop trigger if exists cash_settings_audit on cash_settings;
create trigger cash_settings_audit after update on cash_settings
  for each row execute function app_audit();

-- ── Segéd: tagja-e az egységnek ─────────────────────────────
create or replace function app_cash_member_of(p_unit uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cash_unit_members m
    where m.unit_id = p_unit and m.person_id = app_current_person()
  ) or app_has_cap('hr')
$$;

-- ── Kontextus a kitöltő felületnek ──────────────────────────
-- A kolléga egységei + a mai zárás állapota + lerakatnál az
-- utolsó 5 nap összefoglalója (boltos kolléga előzményt nem lát).
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

-- ── Napi zárás mentése (piszkozat) ──────────────────────────
create or replace function app_cash_save_day(p_unit uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  did uuid;
  counted numeric := 0;
  m jsonb; e jsonb;
begin
  if not app_cash_member_of(p_unit) then raise exception 'Nincs jogosultság ehhez az egységhez.'; end if;

  select id into did from cash_days where unit_id = p_unit and day = today;
  if did is null then
    insert into cash_days (unit_id, day) values (p_unit, today) returning id into did;
  end if;
  if (select status from cash_days where id = did) in ('lezart','elfogadva') then
    raise exception 'A nap már le van zárva.';
  end if;

  -- monetár csere + összeg
  delete from cash_monetar where day_id = did;
  for m in select * from jsonb_array_elements(coalesce(p_payload->'monetar', '[]'::jsonb)) loop
    if coalesce((m->>'qty')::int, 0) > 0 then
      insert into cash_monetar (day_id, denom, qty)
      values (did, (m->>'denom')::numeric, (m->>'qty')::int);
      counted := counted + (m->>'denom')::numeric * (m->>'qty')::int;
    end if;
  end loop;

  -- napi költségek cseréje
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

-- ── Napi zárás lezárása (ellenőrzésekkel) ───────────────────
create or replace function app_cash_close_day(p_unit uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  d cash_days%rowtype;
  ukind text;
  exp_total numeric;
  expected numeric;
  v_cash_diff numeric;
  v_card_diff numeric;
begin
  if not app_cash_member_of(p_unit) then raise exception 'Nincs jogosultság ehhez az egységhez.'; end if;
  select * into d from cash_days where unit_id = p_unit and day = today;
  if d.id is null then raise exception 'Előbb mentsd el a napot.'; end if;
  if d.status in ('lezart','elfogadva') then raise exception 'A nap már le van zárva.'; end if;
  select kind into ukind from cash_units where id = p_unit;
  select coalesce(sum(amount),0) into exp_total from cash_expenses where day_id = d.id;

  if coalesce(d.counted_cash,0) = 0 then
    raise exception 'Hiányzik a készpénz megszámolása (monetár).';
  end if;

  if ukind = 'bolt' then
    if d.z_cash is null or d.z_card is null or d.pos_settlement is null then
      raise exception 'Hiányzó Z-jelentés vagy POS érték.';
    end if;
    expected := d.z_cash - exp_total + coalesce(d.float_morning,0) - coalesce(d.float_evening,0);
    v_cash_diff := round((coalesce(d.counted_cash,0) - expected) * 100) / 100;
    v_card_diff := round((d.z_card - d.pos_settlement) * 100) / 100;
    if abs(v_card_diff) > 1 and coalesce(d.expl_card,'') = '' then
      raise exception 'A kártya-eltéréshez indoklás szükséges. / Diferența card necesită explicație.';
    end if;
  else
    if d.nexus_revenue is null then
      raise exception 'Hiányzik a gép szerinti árulás értéke.';
    end if;
    v_cash_diff := round((coalesce(d.counted_cash,0) + exp_total - d.nexus_revenue) * 100) / 100;
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

grant execute on function app_cash_member_of(uuid) to authenticated;
grant execute on function app_cash_context() to authenticated;
grant execute on function app_cash_save_day(uuid, jsonb) to authenticated;
grant execute on function app_cash_close_day(uuid) to authenticated;
