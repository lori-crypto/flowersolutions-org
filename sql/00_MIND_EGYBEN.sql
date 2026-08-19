-- ============================================================
-- 01_alap.sql — Alapréteg: személyek, jogosultság, audit
-- Idempotens: újrafuttatható.
-- Futtatás: Supabase → SQL Editor
-- ============================================================

-- ── Személyek ────────────────────────────────────────────────
create table if not exists persons (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique references auth.users(id) on delete set null,
  name       text not null,
  email      text unique,
  phone      text,
  lang       text not null default 'hu' check (lang in ('hu','ro')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── Képességek (capability) ─────────────────────────────────
create table if not exists capabilities (
  key         text primary key,
  description text
);

create table if not exists person_capabilities (
  person_id  uuid not null references persons(id) on delete cascade,
  capability text not null references capabilities(key) on delete cascade,
  primary key (person_id, capability)
);

insert into capabilities (key, description) values
  ('admin',             'Teljes hozzáférés mindenhez'),
  ('tabla.szerkesztes', 'Szervezési tábla szerkesztése')
on conflict (key) do nothing;

-- ── Audit napló ──────────────────────────────────────────────
create table if not exists audit_log (
  id         bigserial primary key,
  person_id  uuid,
  at         timestamptz not null default now(),
  table_name text not null,
  row_id     text,
  action     text not null check (action in ('insert','update','delete')),
  before     jsonb,
  after      jsonb
);

-- ── Segédfüggvények ──────────────────────────────────────────
create or replace function app_current_person()
returns uuid language sql stable security definer set search_path = public as $$
  select id from persons where user_id = auth.uid()
$$;

create or replace function app_has_cap(cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from person_capabilities pc
    join persons p on p.id = pc.person_id
    where p.user_id = auth.uid()
      and p.active
      and pc.capability in (cap, 'admin')
  )
$$;

create or replace function app_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select app_has_cap('admin')
$$;

-- ── Audit trigger (generikus) ────────────────────────────────
create or replace function app_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (person_id, table_name, row_id, action, after)
    values (app_current_person(), tg_table_name, new.id::text, 'insert', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into audit_log (person_id, table_name, row_id, action, before, after)
    values (app_current_person(), tg_table_name, new.id::text, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into audit_log (person_id, table_name, row_id, action, before)
    values (app_current_person(), tg_table_name, old.id::text, 'delete', to_jsonb(old));
    return old;
  end if;
end $$;

drop trigger if exists persons_audit on persons;
create trigger persons_audit after insert or update or delete on persons
  for each row execute function app_audit();

-- ── RLS ──────────────────────────────────────────────────────
alter table persons enable row level security;
alter table capabilities enable row level security;
alter table person_capabilities enable row level security;
alter table audit_log enable row level security;

-- Minden bejelentkezett kolléga látja a személyeket (a tábla névkiírásához kell)
drop policy if exists persons_select on persons;
create policy persons_select on persons for select to authenticated using (true);

drop policy if exists persons_admin_write on persons;
create policy persons_admin_write on persons for all to authenticated
  using (app_is_admin()) with check (app_is_admin());

drop policy if exists capabilities_select on capabilities;
create policy capabilities_select on capabilities for select to authenticated using (true);

drop policy if exists capabilities_admin_write on capabilities;
create policy capabilities_admin_write on capabilities for all to authenticated
  using (app_is_admin()) with check (app_is_admin());

-- Mindenki látja a saját képességeit; admin mindet
drop policy if exists pcaps_select on person_capabilities;
create policy pcaps_select on person_capabilities for select to authenticated
  using (person_id = app_current_person() or app_is_admin());

drop policy if exists pcaps_admin_write on person_capabilities;
create policy pcaps_admin_write on person_capabilities for all to authenticated
  using (app_is_admin()) with check (app_is_admin());

-- Auditot csak admin olvas (írása trigger által, definer joggal történik)
drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select to authenticated
  using (app_is_admin());
-- ============================================================
-- 02_orgboard.sql — Szervezési tábla (Modul 1)
-- Idempotens: újrafuttatható. Előfeltétel: 01_alap.sql
-- ============================================================

-- ── A szervezet (1 sor) ─────────────────────────────────────
create table if not exists org_settings (
  id      int primary key default 1 check (id = 1),
  name    text not null default 'Flower Solutions',
  evt_hu  text,
  evt_ro  text
);

-- ── Osztálycsoportok (A: 7/1/2, B: 3/4/5/6) ─────────────────
create table if not exists ob_groups (
  id       uuid primary key default gen_random_uuid(),
  label_hu text not null,
  label_ro text,
  sort     int not null default 0
);

-- ── Osztályok ────────────────────────────────────────────────
create table if not exists ob_divisions (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references ob_groups(id) on delete restrict,
  code     text not null,            -- pl. '7', '1', '4A'
  name_hu  text not null,
  name_ro  text,
  evt_hu   text,
  evt_ro   text,
  color    text not null default '#5b5f97',
  sort     int not null default 0
);

-- ── Alosztályok ──────────────────────────────────────────────
create table if not exists ob_departments (
  id          uuid primary key default gen_random_uuid(),
  division_id uuid not null references ob_divisions(id) on delete cascade,
  code        text not null,         -- pl. '19'
  name_hu     text not null,
  name_ro     text,
  evt_hu      text,
  evt_ro      text,
  sort        int not null default 0
);

-- ── Posztok ──────────────────────────────────────────────────
-- Pontosan EGY horgonya van: alosztály VAGY osztály VAGY csoport VAGY a szervezet.
-- (vezetői posztok: ügyvezető → szervezet, csoportvezető → csoport,
--  osztályvezető → osztály, alosztályvezető és sima poszt → alosztály)
create table if not exists ob_posts (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid references ob_departments(id) on delete cascade,
  division_id   uuid references ob_divisions(id) on delete cascade,
  group_id      uuid references ob_groups(id) on delete cascade,
  org_anchor    boolean not null default false,
  lead_level    text not null default 'nincs'
                check (lead_level in ('nincs','alosztalyvezeto','osztalyvezeto','csoportvezeto','ugyvezeto')),
  name_hu       text not null,
  name_ro       text,
  evt_hu        text,
  evt_ro        text,
  sort          int not null default 0,
  constraint ob_posts_one_anchor check (
    (case when department_id is not null then 1 else 0 end) +
    (case when division_id   is not null then 1 else 0 end) +
    (case when group_id      is not null then 1 else 0 end) +
    (case when org_anchor then 1 else 0 end) = 1
  )
);

-- ── Poszt-betöltők (történetiséggel) ─────────────────────────
create table if not exists ob_post_holders (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references ob_posts(id) on delete cascade,
  person_id  uuid not null references persons(id) on delete cascade,
  valid_from date not null default current_date,
  valid_to   date   -- NULL = jelenleg is betölti
);

create index if not exists ob_post_holders_post_idx on ob_post_holders(post_id) where valid_to is null;

-- ── Audit triggerek ──────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['org_settings','ob_groups','ob_divisions','ob_departments','ob_posts','ob_post_holders']
  loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function app_audit()', t, t);
  end loop;
end $$;

-- org_settings-nek nincs uuid id-je — az app_audit new.id::text-je itt "1" lesz, rendben.

-- ── RLS ──────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['org_settings','ob_groups','ob_divisions','ob_departments','ob_posts','ob_post_holders']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_edit on %I', t, t);
    execute format($p$create policy %I_edit on %I for all to authenticated
                    using (app_has_cap('tabla.szerkesztes'))
                    with check (app_has_cap('tabla.szerkesztes'))$p$, t, t);
  end loop;
end $$;
-- ============================================================
-- 03_orgboard_seed.sql — Kiinduló struktúra (7 osztály / 21 alosztály)
-- Csak üres táblákba tölt (idempotens). A neveket a felületen írod át.
-- Előfeltétel: 02_orgboard.sql
-- ============================================================

insert into org_settings (id, name, evt_hu)
select 1, 'Flower Solutions', ''
where not exists (select 1 from org_settings);

do $$
declare
  ga uuid; gb uuid;
  d7 uuid; d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid; d6 uuid;
  div uuid;
  dep_code int;
  i int;
  div_ids uuid[];
  div_codes text[] := array['7','1','2','3','4','5','6'];
  div_names text[] := array['7. osztály','1. osztály','2. osztály','3. osztály','4. osztály','5. osztály','6. osztály'];
  div_colors text[] := array['#5b5f97','#0e7c86','#b3541e','#2e7d32','#8e3b8e','#c2851a','#1565c0'];
  -- klasszikus alosztály-számozás osztályonként:
  dep_codes int[][] := array[[19,20,21],[1,2,3],[4,5,6],[7,8,9],[10,11,12],[13,14,15],[16,17,18]];
begin
  if exists (select 1 from ob_groups) then
    return; -- már van adat, nem nyúlunk hozzá
  end if;

  insert into ob_groups (label_hu, label_ro, sort) values
    ('A-csoport', 'Grupa A', 1) returning id into ga;
  insert into ob_groups (label_hu, label_ro, sort) values
    ('B-csoport', 'Grupa B', 2) returning id into gb;

  div_ids := array[]::uuid[];
  for i in 1..7 loop
    insert into ob_divisions (group_id, code, name_hu, name_ro, color, sort)
    values (case when i <= 3 then ga else gb end,
            div_codes[i], div_names[i], 'Divizia ' || div_codes[i], div_colors[i], i)
    returning id into div;
    div_ids := div_ids || div;

    -- 3 alosztály osztályonként
    insert into ob_departments (division_id, code, name_hu, name_ro, sort)
    select div, dep_codes[i][k]::text, dep_codes[i][k] || '. alosztály',
           'Departamentul ' || dep_codes[i][k], k
    from generate_series(1,3) k;

    -- osztályvezetői poszt
    insert into ob_posts (division_id, lead_level, name_hu, name_ro, sort)
    values (div, 'osztalyvezeto', 'Osztályvezető', 'Șef de divizie', 0);
  end loop;

  -- alosztályvezetői posztok minden alosztályba
  insert into ob_posts (department_id, lead_level, name_hu, name_ro, sort)
  select id, 'alosztalyvezeto', 'Alosztályvezető', 'Șef de departament', 0 from ob_departments;

  -- csoportvezetői posztok
  insert into ob_posts (group_id, lead_level, name_hu, name_ro, sort) values
    (ga, 'csoportvezeto', 'A-csoport vezető', 'Șef grupa A', 0),
    (gb, 'csoportvezeto', 'B-csoport vezető', 'Șef grupa B', 0);

  -- ügyvezetői poszt (a szervezethez horgonyozva)
  insert into ob_posts (org_anchor, lead_level, name_hu, name_ro, sort)
  values (true, 'ugyvezeto', 'Ügyvezető', 'Director general', 0);
end $$;

-- ============================================================
-- ELSŐ ADMIN BEÁLLÍTÁSA (kézzel, miután létrehoztad a fiókod):
-- 1. Supabase → Authentication → Add user (email + jelszó)
-- 2. Futtasd (a saját email-címeddel):
--
-- insert into persons (user_id, name, email, lang)
-- select id, 'Lóri', email, 'hu' from auth.users where email = 'lori@flowersolutions.ro'
-- on conflict (user_id) do nothing;
--
-- insert into person_capabilities (person_id, capability)
-- select p.id, c.cap
-- from persons p, (values ('admin'),('tabla.szerkesztes')) c(cap)
-- where p.email = 'lori@flowersolutions.ro'
-- on conflict do nothing;
-- ============================================================
