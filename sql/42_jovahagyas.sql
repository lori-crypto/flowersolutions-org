-- ============================================================
-- 42_jovahagyas.sql — Betelt napra beírás: JÓVÁHAGYÁSRA VÁR
--  Ha egy napon már annyian vannak távol, amennyi a tábla korlátja
--  (max_concurrent), a további beírás nem hiba, hanem „függő” lesz:
--   - leave_entries.status = 'fuggo' (a létszámba nem számít bele),
--   - Telegram-értesítés megy a jóváhagyónak „✅ Jóváhagyom / ❌ Elutasítom”
--     gombokkal (temp_config.leave_chat_id — ha üres, csak az appban látszik),
--   - a HR az appban is dönthet (app_leave_decide).
--  Elutasítva: status = 'elutasitva' (a kolléga a saját listájában látja,
--  a táblán nem jelenik meg, és ugyanarra a napra újra kérheti).
-- Idempotens. Előfeltétel: 04, 38, 39, 41.
-- ============================================================

alter table leave_entries add column if not exists status text not null default 'ok';
alter table leave_entries drop constraint if exists leave_entries_status_chk;
alter table leave_entries add constraint leave_entries_status_chk
  check (status in ('ok', 'fuggo', 'elutasitva'));
alter table leave_entries add column if not exists pending_group uuid;
alter table leave_entries add column if not exists decided_at timestamptz;
alter table leave_entries add column if not exists decided_by text;
create index if not exists leave_entries_pending_idx on leave_entries (pending_group) where pending_group is not null;

-- a jóváhagyó Telegram-beszélgetése (privát chat Lorival; /id paranccsal kérdezhető le)
alter table temp_config add column if not exists leave_chat_id text;

-- ── Ünnepnap-ellenőrzés: az elutasított bejegyzés nem számít ──────
create or replace function app_leave_holiday_check(
  p_person uuid, p_day date, p_holiday date, p_exclude uuid
) returns date language plpgsql security definer set search_path = public as $$
declare
  h date;
  prev date;
  a record;
  other date;
begin
  if exists (select 1 from holidays where day = p_day) then
    h := p_day;
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
     and x.status <> 'elutasitva'
     and (p_exclude is null or x.id <> p_exclude)
   limit 1;
  if found then
    raise exception 'A(z) % ünnepnapot ez a kolléga már kivette (%).',
      to_char(h, 'YYYY-MM-DD'), to_char(prev, 'YYYY-MM-DD');
  end if;

  select * into a from app_holiday_alt(h);
  if a.grp is not null and a.fel is not null then
    select x.holiday_day into other from leave_entries x
      cross join lateral app_holiday_alt(x.holiday_day) b
     where x.person_id = p_person and x.type_code = 'unnepnap_kivet'
       and x.holiday_day is not null and x.status <> 'elutasitva'
       and extract(year from x.holiday_day) = extract(year from h)
       and b.grp = a.grp and b.fel is not null and b.fel <> a.fel
       and (p_exclude is null or x.id <> p_exclude)
     limit 1;
    if found then
      raise exception 'Ez a kolléga % már a(z) % ünnepet vette ki (%) — a katolikus és az ortodox közül csak az egyik jár.',
        extract(year from h)::int,
        case when a.fel = 'kat' then 'ortodox' else 'katolikus' end,
        to_char(other, 'YYYY-MM-DD');
    end if;
  end if;
  return h;
end $$;
revoke execute on function app_leave_holiday_check(uuid, date, date, uuid) from public, anon;

-- ── Telegram-értesítés egy függő kérésről ──────────────────────
create or replace function app_leave_notify(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c temp_config;
  txt text;
  body jsonb;
begin
  select * into c from temp_config where id = 1;
  if c.bot_token is null or c.leave_chat_id is null then return; end if;
  select '🗓 <b>Jóváhagyásra vár</b> (betelt a létszám)' || chr(10) ||
         '<b>' || temp_html(p.name) || '</b> · ' || temp_html(b.name_hu) || chr(10) ||
         temp_html(t.name_hu) || ': ' ||
         string_agg(to_char(e.day, 'YYYY.MM.DD') ||
                    case e.part when 'de' then ' (½ DE)' when 'du' then ' (½ DU)' else '' end, ', ' order by e.day) ||
         coalesce(chr(10) || '<i>' || temp_html(max(e.note)) || '</i>', '') || chr(10) ||
         'Aznap már távol: ' || coalesce((
           select string_agg(distinct p2.name, ', ')
             from leave_entries x join persons p2 on p2.id = x.person_id
             join leave_types tt on tt.code = x.type_code
            where x.board_id = b.id and x.status = 'ok' and tt.limit_szamit
              and x.day in (select day from leave_entries where pending_group = p_group)), '—')
    into txt
    from leave_entries e
    join persons p on p.id = e.person_id
    join leave_boards b on b.id = e.board_id
    join leave_types t on t.code = e.type_code
   where e.pending_group = p_group and e.status = 'fuggo'
   group by p.name, b.id, b.name_hu, t.name_hu;
  if txt is null then return; end if;
  body := jsonb_build_object('chat_id', c.leave_chat_id, 'text', txt, 'parse_mode', 'HTML',
    'reply_markup', jsonb_build_object('inline_keyboard', jsonb_build_array(jsonb_build_array(
      jsonb_build_object('text', '✅ Jóváhagyom', 'callback_data', 'lv:ok:' || p_group),
      jsonb_build_object('text', '❌ Elutasítom', 'callback_data', 'lv:no:' || p_group)))));
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || c.bot_token || '/sendMessage',
    body := body,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end $$;
revoke execute on function app_leave_notify(uuid) from public, anon, authenticated;

-- ── Felvétel: betelt napra → függő ─────────────────────────────
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
  st text;
  grp uuid := null;
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

    -- korábban elutasított kérés ugyanarra a napra: helyet ad az újnak
    delete from leave_entries e
     where e.person_id = p_person and e.day = d and e.status = 'elutasitva';

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

    st := 'ok';
    if t.limit_szamit then
      select count(distinct e.person_id) into cnt
      from leave_entries e
      join leave_types tt on tt.code = e.type_code
      where e.board_id = p_board and e.day = d and e.status = 'ok'
        and tt.limit_szamit and e.person_id <> p_person;
      if cnt >= lim then
        st := 'fuggo';                       -- betelt: jóváhagyásra vár
        if grp is null then grp := gen_random_uuid(); end if;
      end if;
    end if;

    h := null;
    if p_type = 'unnepnap_kivet' then
      h := app_leave_holiday_check(p_person, d, p_holiday, null);
    end if;

    insert into leave_entries (board_id, person_id, day, part, type_code, note, created_by, holiday_day,
                               status, pending_group)
    values (p_board, p_person, d, p_part, p_type, nullif(p_note, ''), me, h,
            st, case when st = 'fuggo' then grp end);
  end loop;

  if grp is not null then perform app_leave_notify(grp); end if;
end $$;
grant execute on function app_leave_add(uuid, uuid, date[], text, text, text, date) to authenticated;

-- ── Módosítás: betelt napra áttéve → függő ─────────────────────
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
  st text;
  grp uuid;
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

  delete from leave_entries x
   where x.id <> p_id and x.person_id = p_person and x.day = p_day and x.status = 'elutasitva';

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

  st := case when e.status = 'elutasitva' then 'ok' else e.status end;
  grp := e.pending_group;
  if t.limit_szamit then
    select coalesce((select value::int from leave_rules
                     where board_id = e.board_id and key = 'max_concurrent'), 2) into lim;
    select count(distinct x.person_id) into cnt
    from leave_entries x
    join leave_types tt on tt.code = x.type_code
    where x.board_id = e.board_id and x.day = p_day and x.status = 'ok'
      and tt.limit_szamit and x.id <> p_id and x.person_id <> p_person;
    if cnt >= lim then
      -- ha a nap vagy a napszak változott, vagy eddig nem volt függő → új kérés
      if e.status <> 'fuggo' or e.day <> p_day or e.part <> p_part then
        st := 'fuggo'; grp := gen_random_uuid();
      end if;
    elsif e.status = 'fuggo' then
      st := 'ok'; grp := null;              -- közben felszabadult hely
    end if;
  end if;

  h := e.holiday_day;
  if e.type_code = 'unnepnap_kivet' then
    h := app_leave_holiday_check(p_person, p_day, coalesce(p_holiday, e.holiday_day), p_id);
  end if;

  update leave_entries
     set person_id = p_person, day = p_day, part = p_part, note = nullif(p_note, ''),
         holiday_day = h, status = st, pending_group = case when st = 'fuggo' then grp end,
         decided_at = null, decided_by = null
   where id = p_id;

  if st = 'fuggo' and grp is distinct from e.pending_group then perform app_leave_notify(grp); end if;
end $$;
grant execute on function app_leave_update(uuid, uuid, date, text, text, date) to authenticated;

-- ── Döntés ─────────────────────────────────────────────────────
-- belső mag (a Telegram-webhook a service kulccsal hívja)
create or replace function app_leave_decide_core(p_group uuid, p_ok boolean, p_by text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update leave_entries
     set status = case when p_ok then 'ok' else 'elutasitva' end,
         decided_at = now(), decided_by = p_by
   where pending_group = p_group and status = 'fuggo';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app_leave_decide_core(uuid, boolean, text) from public, anon, authenticated;
grant execute on function app_leave_decide_core(uuid, boolean, text) to service_role;

-- az appból: csak HR
create or replace function app_leave_decide(p_group uuid, p_ok boolean)
returns int language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if not app_has_cap('hr') then
    raise exception 'Jóváhagyni csak a HR tud.';
  end if;
  select name into who from persons where id = app_current_person();
  return app_leave_decide_core(p_group, p_ok, coalesce(who, 'HR'));
end $$;
revoke execute on function app_leave_decide(uuid, boolean) from public, anon;
grant execute on function app_leave_decide(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
