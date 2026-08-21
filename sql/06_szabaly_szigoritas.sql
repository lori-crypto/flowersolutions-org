-- ============================================================
-- 06_szabaly_szigoritas.sql — A zárolás és a napi létszám-korlát
-- MINDENKIRE érvényes (HR/admin is), önkiszolgáló típusoknál
-- (szabadság, ünnepnap-kivét). A betegszabadság/ügyelet rögzítését
-- (HR-only típusok) a szabályok nem akadályozzák.
-- Idempotens.
-- ============================================================

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
    perform pg_advisory_xact_lock(hashtext(p_board::text || d::text));

    if exists (
      select 1 from leave_entries e
      where e.person_id = p_person and e.day = d
        and (e.part = 'egesz' or p_part = 'egesz' or e.part = p_part)
    ) then
      raise exception '% napra már van bejegyzésed.', to_char(d, 'YYYY-MM-DD');
    end if;

    -- Zárolt nap: önkiszolgáló típus (szabadság, ünnepnap-kivét) senkinek,
    -- HR-nek sem írható be. (Betegszabadság/ügyelet rögzíthető marad.)
    if t.self_service and exists (
      select 1 from blackout_periods b
      where b.board_id = p_board and d between b.from_day and b.to_day
    ) then
      raise exception 'A % nap zárolva van — erre nem írható be szabadság.', to_char(d, 'YYYY-MM-DD');
    end if;

    -- Napi létszám-korlát: mindenkire érvényes.
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

    insert into leave_entries (board_id, person_id, day, part, type_code, note, created_by)
    values (p_board, p_person, d, p_part, p_type, nullif(p_note, ''), me);
  end loop;
end $$;

grant execute on function app_leave_add(uuid, uuid, date[], text, text, text) to authenticated;
