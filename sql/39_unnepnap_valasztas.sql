-- ============================================================
-- 39_unnepnap_valasztas.sql — Kivett állami ünnepnap: MELYIK ünnep?
--  A cég ünnepnapon nem mindig zár be, ezért a kollégák az ünnepet
--  más napon veszik ki. Ilyenkor kötelező megadni, melyik ünnepnap
--  helyett veszik ki (leave_entries.holiday_day).
--  - Ha a bejegyzés napja maga az ünnepnap → automatikusan az.
--  - Más napon → kötelező kiválasztani, és létező ünnepnap kell legyen.
--  - Ugyanazt az ünnepnapot egy kolléga csak egyszer veheti ki.
-- Idempotens. Előfeltétel: 04, 36, 37.
-- ============================================================

alter table leave_entries add column if not exists holiday_day date;

-- a már bent lévő, ünnepnapra eső „kivett ünnepnap” bejegyzések kitöltése
update leave_entries e set holiday_day = e.day
 where e.type_code = 'unnepnap_kivet' and e.holiday_day is null
   and exists (select 1 from holidays h where h.day = e.day);

-- közös ellenőrzés: visszaadja, melyik ünnepnaphoz tartozik a bejegyzés
create or replace function app_leave_holiday_check(
  p_person uuid, p_day date, p_holiday date, p_exclude uuid
) returns date language plpgsql security definer set search_path = public as $$
declare
  h date;
  prev date;
begin
  if exists (select 1 from holidays where day = p_day) then
    h := p_day;                       -- magán az ünnepnapon veszi ki
  else
    h := p_holiday;
    if h is null then
      raise exception 'Válaszd ki, melyik ünnepnap helyett veszed ki a(z) % napot.', to_char(p_day, 'YYYY-MM-DD');
    end if;
    if not exists (select 1 from holidays where day = h) then
      raise exception 'A kiválasztott nap (%) nem ünnepnap.', to_char(h, 'YYYY-MM-DD');
    end if;
  end if;

  select x.day into prev from leave_entries x
   where x.person_id = p_person and x.holiday_day = h and x.day <> p_day
     and (p_exclude is null or x.id <> p_exclude)
   limit 1;
  if found then
    raise exception 'A(z) % ünnepnapot ez a kolléga már kivette (%).',
      to_char(h, 'YYYY-MM-DD'), to_char(prev, 'YYYY-MM-DD');
  end if;
  return h;
end $$;

revoke execute on function app_leave_holiday_check(uuid, date, date, uuid) from public, anon;

-- ── Felvétel (új paraméter: p_holiday) ──────────────────────
drop function if exists app_leave_add(uuid, uuid, date[], text, text, text);

create or replace function app_leave_add(
  p_board uuid, p_person uuid, p_days date[], p_part text, p_type text, p_note text,
  p_holiday date default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_current_person();
  priv boolean := app_has_cap('hr') or (p_type = 'ugyelet' and app_has_cap('szabadsag.ugyelet'));
  t leave_types;
  d date;
  lim int;
  cnt int;
  h date;
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
    perform pg_advisory_xact_lock(hashtext(p_board::text || d::text));

    if exists (
      select 1 from leave_entries e
      where e.person_id = p_person and e.day = d
        and (e.part = 'egesz' or p_part = 'egesz' or e.part = p_part)
    ) then
      raise exception '% napra már van bejegyzés ennél a kollégánál.', to_char(d, 'YYYY-MM-DD');
    end if;

    if t.self_service and exists (
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

    h := null;
    if p_type = 'unnepnap_kivet' then
      h := app_leave_holiday_check(p_person, d, p_holiday, null);
    end if;

    insert into leave_entries (board_id, person_id, day, part, type_code, note, created_by, holiday_day)
    values (p_board, p_person, d, p_part, p_type, nullif(p_note, ''), me, h);
  end loop;
end $$;

grant execute on function app_leave_add(uuid, uuid, date[], text, text, text, date) to authenticated;

-- ── Módosítás (új paraméter: p_holiday) ─────────────────────
drop function if exists app_leave_update(uuid, uuid, date, text, text);

create or replace function app_leave_update(
  p_id uuid, p_person uuid, p_day date, p_part text, p_note text,
  p_holiday date default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_current_person();
  priv boolean;
  e leave_entries;
  t leave_types;
  lim int;
  cnt int;
  h date;
begin
  if me is null then
    raise exception 'A fiókodhoz nincs személy rendelve — szólj az adminnak.';
  end if;
  if p_part not in ('egesz','de','du') then
    raise exception 'Érvénytelen napszak.';
  end if;
  if p_day is null then
    raise exception 'Hiányzik a nap.';
  end if;

  select * into e from leave_entries where id = p_id for update;
  if not found then
    raise exception 'A bejegyzés már nem létezik — frissítsd az oldalt.';
  end if;
  select * into t from leave_types where code = e.type_code;
  priv := app_has_cap('hr') or (e.type_code = 'ugyelet' and app_has_cap('szabadsag.ugyelet'));

  if not priv then
    if e.person_id <> me then raise exception 'Csak a saját bejegyzésedet módosíthatod.'; end if;
    if p_person <> me then raise exception 'A bejegyzést nem írhatod át másik kollégára.'; end if;
    if not t.self_service then raise exception 'Ezt a bejegyzést csak a HR kezelheti.'; end if;
    if e.day < current_date or p_day < current_date then
      raise exception 'Múltbeli napot csak a HR módosíthat.';
    end if;
  end if;
  if not exists (select 1 from persons where id = p_person) then
    raise exception 'Ismeretlen személy.';
  end if;

  perform pg_advisory_xact_lock(hashtext(e.board_id::text || p_day::text));

  if exists (
    select 1 from leave_entries x
    where x.id <> p_id and x.person_id = p_person and x.day = p_day
      and (x.part = 'egesz' or p_part = 'egesz' or x.part = p_part)
  ) then
    raise exception '% napra már van bejegyzés ennél a kollégánál.', to_char(p_day, 'YYYY-MM-DD');
  end if;

  if t.self_service and exists (
    select 1 from blackout_periods b
    where b.board_id = e.board_id and p_day between b.from_day and b.to_day
  ) then
    raise exception 'A % nap zárolva van — erre nem írható be szabadság.', to_char(p_day, 'YYYY-MM-DD');
  end if;

  if t.limit_szamit then
    select coalesce((select value::int from leave_rules
                     where board_id = e.board_id and key = 'max_concurrent'), 2) into lim;
    select count(distinct x.person_id) into cnt
    from leave_entries x
    join leave_types tt on tt.code = x.type_code
    where x.board_id = e.board_id and x.day = p_day
      and tt.limit_szamit and x.id <> p_id and x.person_id <> p_person;
    if cnt >= lim then
      raise exception 'A % napra már betelt a létszám (legfeljebb % fő lehet távol).', to_char(p_day, 'YYYY-MM-DD'), lim;
    end if;
  end if;

  h := e.holiday_day;
  if e.type_code = 'unnepnap_kivet' then
    h := app_leave_holiday_check(p_person, p_day, coalesce(p_holiday, e.holiday_day), p_id);
  end if;

  update leave_entries
     set person_id = p_person, day = p_day, part = p_part, note = nullif(p_note, ''),
         holiday_day = h
   where id = p_id;
end $$;

grant execute on function app_leave_update(uuid, uuid, date, text, text, date) to authenticated;

notify pgrst, 'reload schema';
