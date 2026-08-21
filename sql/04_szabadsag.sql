-- ============================================================
-- 04_szabadsag.sql — Szabadságos tábla (Modul 3)
-- Idempotens. Előfeltétel: 01_alap.sql
-- ============================================================

-- ── Táblák (egységek): Lerakat, Virágüzlet 1, Virágüzlet 2 ──
create table if not exists leave_boards (
  id      uuid primary key default gen_random_uuid(),
  name_hu text not null,
  name_ro text,
  sort    int not null default 0
);

create table if not exists board_members (
  person_id uuid not null references persons(id) on delete cascade,
  board_id  uuid not null references leave_boards(id) on delete cascade,
  primary key (person_id, board_id)
);

-- ── Bejegyzés-típusok (a falitábla színmagyarázata) ─────────
create table if not exists leave_types (
  code          text primary key,
  name_hu       text not null,
  name_ro       text,
  color         text not null default '#2f6fed',
  counts_quota  boolean not null default false,  -- fogyasztja-e az éves keretet
  self_service  boolean not null default false,  -- kolléga maga beírhatja-e
  limit_szamit  boolean not null default false,  -- beleszámít-e a napi létszám-korlátba
  sort          int not null default 0
);

insert into leave_types (code, name_hu, name_ro, color, counts_quota, self_service, limit_szamit, sort) values
  ('szabadsag',      'Betervezett szabadság',  'Concediu planificat',      '#2f6fed', true,  true,  true,  1),
  ('unnepnap_kivet', 'Kivett állami ünnepnap', 'Zi liberă recuperată',     '#2e7d32', false, true,  true,  2),
  ('betegszabadsag', 'Betegszabadság',         'Concediu medical',         '#8e3b8e', false, false, false, 3),
  ('ugyelet',        'Hétvégi ügyelet',        'Serviciu de weekend',      '#c0392b', false, false, false, 4)
on conflict (code) do nothing;

-- ── Bejegyzések (napi granularitás, fél nap támogatással) ───
create table if not exists leave_entries (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references leave_boards(id) on delete cascade,
  person_id  uuid not null references persons(id) on delete cascade,
  day        date not null,
  part       text not null default 'egesz' check (part in ('egesz','de','du')),
  type_code  text not null references leave_types(code),
  note       text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists leave_entries_person_day_part
  on leave_entries(person_id, day, part);
create index if not exists leave_entries_board_day on leave_entries(board_id, day);

-- ── Zárolt időszakok (piros vonalak) ────────────────────────
create table if not exists blackout_periods (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references leave_boards(id) on delete cascade,
  from_day   date not null,
  to_day     date not null,
  reason     text,
  created_by uuid,
  check (to_day >= from_day)
);

-- ── Szabályok (táblánként állítható) ────────────────────────
create table if not exists leave_rules (
  board_id uuid not null references leave_boards(id) on delete cascade,
  key      text not null,
  value    text not null,
  primary key (board_id, key)
);

-- ── Éves keretek (fél napos pontosság) ──────────────────────
create table if not exists leave_quotas (
  person_id uuid not null references persons(id) on delete cascade,
  year      int not null,
  days      numeric(5,1) not null default 0,
  primary key (person_id, year)
);

-- ── Ünnepnapok (RO) ─────────────────────────────────────────
create table if not exists holidays (
  day     date primary key,
  name_hu text not null,
  name_ro text
);

insert into holidays (day, name_hu, name_ro) values
  ('2027-01-01','Újév','Anul Nou'),
  ('2027-01-02','Újév másnapja','A doua zi de Anul Nou'),
  ('2027-01-06','Vízkereszt','Boboteaza'),
  ('2027-01-07','Keresztelő Szt. János','Sfântul Ioan Botezătorul'),
  ('2027-01-24','Az egyesülés napja','Ziua Unirii Principatelor'),
  ('2027-04-30','Nagypéntek (ortodox)','Vinerea Mare'),
  ('2027-05-01','A munka ünnepe','Ziua Muncii'),
  ('2027-05-02','Húsvét (ortodox)','Paștele'),
  ('2027-05-03','Húsvéthétfő (ortodox)','A doua zi de Paște'),
  ('2027-06-01','Gyermeknap','Ziua Copilului'),
  ('2027-06-20','Pünkösd (ortodox)','Rusaliile'),
  ('2027-06-21','Pünkösdhétfő (ortodox)','A doua zi de Rusalii'),
  ('2027-08-15','Nagyboldogasszony','Adormirea Maicii Domnului'),
  ('2027-11-30','Szt. András','Sfântul Andrei'),
  ('2027-12-01','Románia nemzeti ünnepe','Ziua Națională'),
  ('2027-12-25','Karácsony','Crăciunul'),
  ('2027-12-26','Karácsony másnapja','A doua zi de Crăciun'),
  -- katolikus ünnepek
  ('2027-03-26','Nagypéntek (katolikus)','Vinerea Mare (catolică)'),
  ('2027-03-28','Húsvét (katolikus)','Paștele catolic'),
  ('2027-03-29','Húsvéthétfő (katolikus)','A doua zi de Paște (catolic)'),
  ('2027-05-16','Pünkösd (katolikus)','Rusaliile catolice'),
  ('2027-05-17','Pünkösdhétfő (katolikus)','A doua zi de Rusalii (catolic)')
on conflict (day) do nothing;

-- ── HR képesség ─────────────────────────────────────────────
insert into capabilities (key, description) values
  ('hr', 'HR: szabadságok kezelése, ellenjegyzés, minden posztleírás olvasása')
on conflict (key) do nothing;

-- ── Kiinduló táblák + szabály ───────────────────────────────
do $$
begin
  if not exists (select 1 from leave_boards) then
    insert into leave_boards (name_hu, name_ro, sort) values
      ('Lerakat',      'Depozit',     1),
      ('Virágüzlet 1', 'Florăria 1',  2),
      ('Virágüzlet 2', 'Florăria 2',  3);
    insert into leave_rules (board_id, key, value)
      select id, 'max_concurrent', '2' from leave_boards;
  end if;
end $$;

-- ── Beíró RPC: minden szabály itt érvényesül (versenybiztos) ─
create or replace function app_leave_add(
  p_board uuid, p_person uuid, p_days date[], p_part text, p_type text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_current_person();
  priv boolean := app_has_cap('hr');
  t leave_types;
  d date;
  lim int;
  cnt int;
begin
  if me is null then
    raise exception 'A fiókodhoz nincs személy rendelve — szólj az adminnak.';
  end if;
  if not priv and me <> p_person then
    raise exception 'Csak saját magadnak írhatsz be szabadságot.';
  end if;
  if p_part not in ('egesz','de','du') then
    raise exception 'Érvénytelen napszak.';
  end if;
  select * into t from leave_types where code = p_type;
  if not found then raise exception 'Ismeretlen típus.'; end if;
  if not priv and not t.self_service then
    raise exception 'Ezt a típust csak a HR rögzítheti.';
  end if;
  if not priv and not exists (
    select 1 from board_members where person_id = p_person and board_id = p_board
  ) then
    raise exception 'Nem vagy hozzárendelve ehhez a táblához — szólj az adminnak.';
  end if;
  select coalesce((select value::int from leave_rules
                   where board_id = p_board and key = 'max_concurrent'), 2) into lim;

  foreach d in array p_days loop
    -- versenybiztos zár: ugyanarra a tábla+napra egyszerre egy tranzakció fut
    perform pg_advisory_xact_lock(hashtext(p_board::text || d::text));

    if exists (
      select 1 from leave_entries e
      where e.person_id = p_person and e.day = d
        and (e.part = 'egesz' or p_part = 'egesz' or e.part = p_part)
    ) then
      raise exception '% napra már van bejegyzésed.', to_char(d, 'YYYY-MM-DD');
    end if;

    if not priv then
      if exists (
        select 1 from blackout_periods b
        where b.board_id = p_board and d between b.from_day and b.to_day
      ) then
        raise exception 'A % nap zárolva van — erre nem írható be szabadság.', to_char(d, 'YYYY-MM-DD');
      end if;
      if t.limit_szamit then
        select count(distinct e.person_id) into cnt
        from leave_entries e
        join leave_types tt on tt.code = e.type_code
        where e.board_id = p_board and e.day = d
          and tt.limit_szamit and e.person_id <> p_person;
        if cnt >= lim then
          raise exception 'A % napra már betelt a létszám (legfeljebb % fő lehet távol).', to_char(d, 'YYYY-MM-DD'), lim;
        end if;
      end if;
    end if;

    insert into leave_entries (board_id, person_id, day, part, type_code, note, created_by)
    values (p_board, p_person, d, p_part, p_type, nullif(p_note, ''), me);
  end loop;
end $$;

grant execute on function app_leave_add(uuid, uuid, date[], text, text, text) to authenticated;

-- ── Törlő RPC ───────────────────────────────────────────────
create or replace function app_leave_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_current_person();
  priv boolean := app_has_cap('hr');
  e leave_entries;
  t leave_types;
begin
  select * into e from leave_entries where id = p_id;
  if not found then return; end if;
  select * into t from leave_types where code = e.type_code;
  if not priv then
    if e.person_id <> me then raise exception 'Csak a saját bejegyzésedet törölheted.'; end if;
    if e.day < current_date then raise exception 'Múltbeli bejegyzést csak a HR módosíthat.'; end if;
    if not t.self_service then raise exception 'Ezt a bejegyzést csak a HR kezelheti.'; end if;
  end if;
  delete from leave_entries where id = p_id;
end $$;

grant execute on function app_leave_delete(uuid) to authenticated;

-- ── Audit + RLS ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['leave_boards','board_members','leave_types','leave_entries',
                           'blackout_periods','leave_rules','leave_quotas','holidays']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_hr_write on %I', t, t);
    execute format($p$create policy %I_hr_write on %I for all to authenticated
                    using (app_has_cap('hr')) with check (app_has_cap('hr'))$p$, t, t);
  end loop;
end $$;

-- audit trigger a lényeges táblákra (board_members-nek nincs egyoszlopos id-je)
do $$
declare t text;
begin
  foreach t in array array['leave_boards','leave_entries','blackout_periods','leave_quotas']
  loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function app_audit()', t, t);
  end loop;
end $$;
