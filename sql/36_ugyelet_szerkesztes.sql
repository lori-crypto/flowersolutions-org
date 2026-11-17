-- ============================================================
-- 36_ugyelet_szerkesztes.sql — Naptár-bejegyzés MÓDOSÍTÁSA (HR)
-- A hétvégi ügyelet (és bármely más bejegyzés) szerkeszthető:
-- más kolléga, másik nap, napszak, megjegyzés — törlés és újra
-- felvétel nélkül, egy lépésben. Csak HR/admin használhatja.
-- Ugyanazok a szabályok érvényesek, mint felvételkor (ütközés,
-- zárolt nap, napi létszám-korlát) — a módosított bejegyzés
-- önmagával nem ütközik.
-- Idempotens.
-- ============================================================

create or replace function app_leave_update(
  p_id uuid, p_person uuid, p_day date, p_part text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_current_person();
  e leave_entries;
  t leave_types;
  lim int;
  cnt int;
begin
  if me is null then
    raise exception 'A fiókodhoz nincs személy rendelve — szólj az adminnak.';
  end if;
  if not app_has_cap('hr') then
    raise exception 'Bejegyzést csak a HR módosíthat.';
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
  if not exists (select 1 from persons where id = p_person) then
    raise exception 'Ismeretlen személy.';
  end if;
  select * into t from leave_types where code = e.type_code;

  perform pg_advisory_xact_lock(hashtext(e.board_id::text || p_day::text));

  -- ütközés: a kollégának arra a napra/napszakra már van MÁSIK bejegyzése
  if exists (
    select 1 from leave_entries x
    where x.id <> p_id and x.person_id = p_person and x.day = p_day
      and (x.part = 'egesz' or p_part = 'egesz' or x.part = p_part)
  ) then
    raise exception '% napra ennek a kollégának már van bejegyzése.', to_char(p_day, 'YYYY-MM-DD');
  end if;

  -- zárolt nap: önkiszolgáló típus (szabadság, ünnepnap-kivét) nem tehető rá
  if t.self_service and exists (
    select 1 from blackout_periods b
    where b.board_id = e.board_id and p_day between b.from_day and b.to_day
  ) then
    raise exception 'A % nap zárolva van — erre nem írható be szabadság.', to_char(p_day, 'YYYY-MM-DD');
  end if;

  -- napi létszám-korlát
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

  update leave_entries
     set person_id = p_person, day = p_day, part = p_part, note = nullif(p_note, '')
   where id = p_id;
end $$;

grant execute on function app_leave_update(uuid, uuid, date, text, text) to authenticated;
