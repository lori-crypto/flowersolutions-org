-- ============================================================
-- 40_kerveny_sorszam.sql — Szabadság-kérvények automatikus iktatószáma
--  Minden nyomtatott kérvény (szabadság-időszak, ill. kivett ünnepnap)
--  első nyomtatáskor kap egy évenként újrainduló sorszámot + dátumot.
--  Újranyomtatáskor ugyanaz a szám marad.
-- Idempotens. Előfeltétel: 04, 39.
-- ============================================================

alter table leave_entries add column if not exists request_no   int;
alter table leave_entries add column if not exists request_date date;

create table if not exists leave_request_counter (
  year    int primary key,
  last_no int not null default 0
);
alter table leave_request_counter enable row level security;  -- csak a lenti függvény írja

create or replace function app_leave_request_no(p_ids uuid[])
returns table (request_no int, request_date date)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_current_person();
  n_all int;
  n_ok int;
  v_no int;
  v_date date;
  y int := extract(year from current_date)::int;
begin
  if me is null then
    raise exception 'A fiókodhoz nincs személy rendelve — szólj az adminnak.';
  end if;
  select count(*) into n_all from leave_entries where id = any(p_ids);
  if n_all = 0 or n_all <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'A bejegyzés nem található — frissítsd az oldalt.';
  end if;
  select count(*) into n_ok from leave_entries
   where id = any(p_ids) and type_code in ('szabadsag', 'unnepnap_kivet')
     and (person_id = me or app_has_cap('hr'));
  if n_ok <> n_all then
    raise exception 'Ehhez a bejegyzéshez nem nyomtathatsz kérvényt.';
  end if;

  perform pg_advisory_xact_lock(hashtext('leave_request_no'));

  -- ha a csoport már egy közös számot kapott → azt adjuk vissza
  if (select count(distinct e.request_no) from leave_entries e where e.id = any(p_ids)) = 1
     and not exists (select 1 from leave_entries e where e.id = any(p_ids) and e.request_no is null) then
    return query select e.request_no, e.request_date from leave_entries e where e.id = any(p_ids) limit 1;
    return;
  end if;

  insert into leave_request_counter as c (year, last_no) values (y, 1)
  on conflict (year) do update set last_no = c.last_no + 1
  returning c.last_no into v_no;
  v_date := current_date;

  update leave_entries e set request_no = v_no, request_date = v_date where e.id = any(p_ids);
  return query select v_no, v_date;
end $$;

revoke execute on function app_leave_request_no(uuid[]) from public, anon;
grant execute on function app_leave_request_no(uuid[]) to authenticated;

notify pgrst, 'reload schema';
