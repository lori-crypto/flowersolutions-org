-- ============================================================
-- 08_posztleirasok.sql — Posztleírások modul (Modul 2)
-- Idempotens. Előfeltétel: 01_alap.sql, 02_orgboard.sql
-- ============================================================

insert into capabilities (key, description) values
  ('posztleiras.szerkesztes', 'Posztleírások, szószedet, ellenőrzőlapok szerkesztése')
on conflict (key) do nothing;

-- ── Hozzáférés-delegálás (ki láthat egy leírást a betöltőkön túl) ─
create table if not exists description_access (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references ob_posts(id) on delete cascade,
  person_id  uuid not null references persons(id) on delete cascade,
  granted_by uuid,
  valid_to   date,
  created_at timestamptz not null default now()
);

-- ── Olvasási jog: betöltő VAGY delegált VAGY HR/szerkesztő ──
create or replace function app_can_read_post(p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app_has_cap('hr') or app_has_cap('posztleiras.szerkesztes')
    or exists (select 1 from ob_post_holders h
               join persons p on p.id = h.person_id
               where h.post_id = p_post and h.valid_to is null and p.user_id = auth.uid())
    or exists (select 1 from description_access a
               join persons p on p.id = a.person_id
               where a.post_id = p_post and p.user_id = auth.uid()
                 and (a.valid_to is null or a.valid_to >= current_date))
$$;

-- ── Posztleírások (verziózva) ───────────────────────────────
create table if not exists post_descriptions (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references ob_posts(id) on delete cascade,
  version      int not null default 1,
  status       text not null default 'vazlat' check (status in ('vazlat','ervenyes','archiv')),
  content_hu   text not null default '',
  content_ro   text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create unique index if not exists post_desc_one_active
  on post_descriptions(post_id) where status = 'ervenyes';
create unique index if not exists post_desc_one_draft
  on post_descriptions(post_id) where status = 'vazlat';

-- ── Szószedet (globális vagy poszt-specifikus) ──────────────
create table if not exists glossary_terms (
  id         uuid primary key default gen_random_uuid(),
  term       text not null,
  def_hu     text not null,
  def_ro     text,
  example_hu text,
  example_ro text,
  post_id    uuid references ob_posts(id) on delete cascade,  -- NULL = globális
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists glossary_term_idx on glossary_terms (lower(term));

-- ── Ellenőrzőlapok ──────────────────────────────────────────
create table if not exists checksheets (
  id       uuid primary key default gen_random_uuid(),
  post_id  uuid not null references ob_posts(id) on delete cascade,
  title_hu text not null default 'Ellenőrzőlap',
  title_ro text
);
create unique index if not exists checksheet_one_per_post on checksheets(post_id);

create table if not exists checksheet_steps (
  id            uuid primary key default gen_random_uuid(),
  checksheet_id uuid not null references checksheets(id) on delete cascade,
  sort          int not null default 0,
  type          text not null default 'olvasas' check (type in ('olvasas','elmeleti','gyakorlati')),
  title_hu      text not null,
  title_ro      text,
  body_hu       text,
  body_ro       text
);
create index if not exists steps_sheet_idx on checksheet_steps(checksheet_id, sort);

create table if not exists checksheet_progress (
  id          uuid primary key default gen_random_uuid(),
  step_id     uuid not null references checksheet_steps(id) on delete cascade,
  person_id   uuid not null references persons(id) on delete cascade,
  done_at     timestamptz not null default now(),
  answer      text,          -- elméleti lépésnél kötelező
  hr_person   uuid,          -- gyakorlati lépés ellenjegyzése
  hr_at       timestamptz,
  recorded_by uuid,
  unique (step_id, person_id)
);

-- ── Lépés teljesítése (sorrend-kényszer + válasz-kényszer) ──
create or replace function app_step_done(p_step uuid, p_answer text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_current_person();
  st checksheet_steps;
  sheet checksheets;
  blocking int;
begin
  if me is null then raise exception 'A fiókodhoz nincs személy rendelve.'; end if;
  select * into st from checksheet_steps where id = p_step;
  if not found then raise exception 'Ismeretlen lépés.'; end if;
  select * into sheet from checksheets where id = st.checksheet_id;
  if not app_can_read_post(sheet.post_id) then
    raise exception 'Ehhez az ellenőrzőlaphoz nincs hozzáférésed.';
  end if;
  if st.type = 'elmeleti' and (p_answer is null or btrim(p_answer) = '') then
    raise exception 'Elméleti feladatnál kötelező a válasz beírása.';
  end if;
  -- sorrend-kényszer: minden korábbi lépés kész kell legyen,
  -- gyakorlati lépésnél HR-ellenjegyzéssel együtt
  select count(*) into blocking
  from checksheet_steps s
  left join checksheet_progress pr
    on pr.step_id = s.id and pr.person_id = me
  where s.checksheet_id = st.checksheet_id
    and (s.sort, s.id) < (st.sort, st.id)
    and (pr.id is null or (s.type = 'gyakorlati' and pr.hr_at is null));
  if blocking > 0 then
    raise exception 'Előbb az előző lépéseket kell befejezni (a gyakorlatiakat HR-ellenjegyzéssel).';
  end if;
  insert into checksheet_progress (step_id, person_id, answer, recorded_by)
  values (p_step, me, nullif(btrim(coalesce(p_answer,'')), ''), me)
  on conflict (step_id, person_id) do nothing;
end $$;

grant execute on function app_step_done(uuid, text) to authenticated;

-- ── HR-ellenjegyzés és visszavonás ──────────────────────────
create or replace function app_step_hr_sign(p_progress uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_has_cap('hr') then raise exception 'Ehhez HR-jogosultság kell.'; end if;
  update checksheet_progress
  set hr_person = app_current_person(), hr_at = now()
  where id = p_progress and hr_at is null;
end $$;

create or replace function app_step_undo(p_progress uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (app_has_cap('hr') or app_has_cap('posztleiras.szerkesztes')) then
    raise exception 'Ehhez HR vagy szerkesztői jogosultság kell.';
  end if;
  delete from checksheet_progress where id = p_progress;
end $$;

grant execute on function app_step_hr_sign(uuid) to authenticated;
grant execute on function app_step_undo(uuid) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────
alter table description_access enable row level security;
alter table post_descriptions enable row level security;
alter table glossary_terms enable row level security;
alter table checksheets enable row level security;
alter table checksheet_steps enable row level security;
alter table checksheet_progress enable row level security;

drop policy if exists da_select on description_access;
create policy da_select on description_access for select to authenticated
  using (person_id = app_current_person()
         or app_has_cap('hr') or app_has_cap('posztleiras.szerkesztes'));
drop policy if exists da_write on description_access;
create policy da_write on description_access for all to authenticated
  using (app_has_cap('hr') or app_has_cap('posztleiras.szerkesztes'))
  with check (app_has_cap('hr') or app_has_cap('posztleiras.szerkesztes'));

drop policy if exists pd_select on post_descriptions;
create policy pd_select on post_descriptions for select to authenticated
  using (app_can_read_post(post_id));
drop policy if exists pd_write on post_descriptions;
create policy pd_write on post_descriptions for all to authenticated
  using (app_has_cap('posztleiras.szerkesztes'))
  with check (app_has_cap('posztleiras.szerkesztes'));

drop policy if exists gl_select on glossary_terms;
create policy gl_select on glossary_terms for select to authenticated
  using (post_id is null or app_can_read_post(post_id));
drop policy if exists gl_write on glossary_terms;
create policy gl_write on glossary_terms for all to authenticated
  using (app_has_cap('posztleiras.szerkesztes'))
  with check (app_has_cap('posztleiras.szerkesztes'));

drop policy if exists cs_select on checksheets;
create policy cs_select on checksheets for select to authenticated
  using (app_can_read_post(post_id));
drop policy if exists cs_write on checksheets;
create policy cs_write on checksheets for all to authenticated
  using (app_has_cap('posztleiras.szerkesztes'))
  with check (app_has_cap('posztleiras.szerkesztes'));

drop policy if exists css_select on checksheet_steps;
create policy css_select on checksheet_steps for select to authenticated
  using (exists (select 1 from checksheets c
                 where c.id = checksheet_id and app_can_read_post(c.post_id)));
drop policy if exists css_write on checksheet_steps;
create policy css_write on checksheet_steps for all to authenticated
  using (app_has_cap('posztleiras.szerkesztes'))
  with check (app_has_cap('posztleiras.szerkesztes'));

drop policy if exists cp_select on checksheet_progress;
create policy cp_select on checksheet_progress for select to authenticated
  using (person_id = app_current_person()
         or app_has_cap('hr') or app_has_cap('posztleiras.szerkesztes'));
-- írás kizárólag az RPC-ken keresztül (security definer)

-- ── Audit ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['description_access','post_descriptions','glossary_terms',
                           'checksheets','checksheet_steps','checksheet_progress']
  loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function app_audit()', t, t);
  end loop;
end $$;
