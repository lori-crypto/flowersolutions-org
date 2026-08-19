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
