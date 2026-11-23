-- ============================================================
-- 43_karacsony_szilveszter.sql — Karácsonyi VAGY szilveszteri hét
--  Egy kolléga a karácsonyi és a szilveszteri hét közül csak az egyikre
--  írhatja be magát (szabadság / kivett ünnepnap — a létszámba számító típusok).
--   - Szilveszteri hét: az a hétfő–vasárnap hét, amelyikbe dec. 31. esik.
--   - Karácsonyi hét: amelyikbe dec. 25. esik; ha ez ugyanaz a hét
--     (dec. 25. hétfő), akkor az előtte lévő hét.
--   - Az ünnep NAPJÁN kivett ünnepnap (pl. dec. 25.) nem számít.
--   - A HR kivételt tehet (neki engedi), a meglévő bejegyzésekhez nem nyúl.
-- Trigger, így a beírásra, a módosításra és az ügyelet-másolásra is érvényes.
-- Idempotens. Előfeltétel: 04, 39, 42.
-- ============================================================

-- melyik ünnepi hétre esik a nap: (évad = a december éve, het = 1 karácsony / 2 szilveszter)
create or replace function app_xmas_week(p_day date, out evad int, out het int)
language plpgsql immutable set search_path = public as $$
declare y int; ny date; xm date;
begin
  foreach y in array array[extract(year from p_day)::int, extract(year from p_day)::int - 1] loop
    ny := date_trunc('week', make_date(y, 12, 31))::date;
    xm := date_trunc('week', make_date(y, 12, 25))::date;
    if xm = ny then xm := xm - 7; end if;
    if p_day between xm and xm + 6 then evad := y; het := 1; return; end if;
    if p_day between ny and ny + 6 then evad := y; het := 2; return; end if;
  end loop;
end $$;

create or replace function app_leave_xmas_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  w record;
  other date;
begin
  -- adatbázisból / szolgáltatásból (nincs bejelentkezett felhasználó) és HR: nincs korlát
  if auth.uid() is null or app_has_cap('hr') then return new; end if;
  if new.status = 'elutasitva' then return new; end if;
  if not exists (select 1 from leave_types t where t.code = new.type_code and t.limit_szamit) then
    return new;
  end if;
  if new.type_code = 'unnepnap_kivet' and new.holiday_day = new.day then return new; end if;

  select * into w from app_xmas_week(new.day);
  if w.het is null then return new; end if;

  select x.day into other
    from leave_entries x
    join leave_types t on t.code = x.type_code and t.limit_szamit
   cross join lateral app_xmas_week(x.day) xw
   where x.person_id = new.person_id and x.id <> new.id
     and x.status <> 'elutasitva'
     and not (x.type_code = 'unnepnap_kivet' and x.holiday_day = x.day)
     and xw.evad = w.evad and xw.het <> w.het
   order by x.day
   limit 1;
  if found then
    raise exception 'A karácsonyi és a szilveszteri hét közül csak az egyikre írhatod be magad — a(z) % héten már be vagy írva (%). Kivételt a HR tehet.',
      case when w.het = 1 then 'szilveszteri' else 'karácsonyi' end, to_char(other, 'YYYY-MM-DD');
  end if;
  return new;
end $$;

drop trigger if exists leave_entries_xmas on leave_entries;
create trigger leave_entries_xmas
  before insert or update of day, person_id, type_code, status on leave_entries
  for each row execute function app_leave_xmas_trg();
