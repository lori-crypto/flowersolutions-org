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
-- to_jsonb(...)->>'id' — így id oszlop nélküli táblákon is működik
create or replace function app_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (person_id, table_name, row_id, action, after)
    values (app_current_person(), tg_table_name, to_jsonb(new)->>'id', 'insert', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into audit_log (person_id, table_name, row_id, action, before, after)
    values (app_current_person(), tg_table_name, to_jsonb(new)->>'id', 'update', to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into audit_log (person_id, table_name, row_id, action, before)
    values (app_current_person(), tg_table_name, to_jsonb(old)->>'id', 'delete', to_jsonb(old));
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
