-- ============================================================
-- 41_keret_szamlalo.sql — Áthozott szabadság + katolikus/ortodox ünnep-kizárás
--  1) leave_quotas.carry_over: az előző évről megmaradt szabadságnapok
--     (HR írja be; a keret = days + carry_over).
--  2) Húsvét és pünkösd: katolikus VAGY ortodox — egy kolléga egy évben
--     a kettő közül csak az egyiket veheti ki hivatalos ünnepként.
--     (A felekezetet az ünnepnap nevéből olvassuk: „(katolikus)” / „(ortodox)”.)
-- Idempotens. Előfeltétel: 04, 39.
-- ============================================================

alter table leave_quotas add column if not exists carry_over numeric(5,1) not null default 0;

-- melyik csoportba (husvet/punkosd) és felekezethez (kat/ort) tartozik egy ünnepnap
create or replace function app_holiday_alt(p_day date, out grp text, out fel text)
language sql stable security definer set search_path = public as $$
  select case when h.name_hu ilike '%húsvét%' or h.name_hu ilike '%nagypéntek%' then 'husvet'
              when h.name_hu ilike '%pünkösd%' then 'punkosd' end,
         case when h.name_hu ilike '%(katolikus)%' then 'kat'
              when h.name_hu ilike '%(ortodox)%' then 'ort' end
    from holidays h where h.day = p_day
$$;
revoke execute on function app_holiday_alt(date) from public, anon;

-- közös ellenőrzés (39-es változat + felekezeti kizárás)
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

  -- katolikus VAGY ortodox húsvét/pünkösd — ugyanabban az évben csak az egyik
  select * into a from app_holiday_alt(h);
  if a.grp is not null and a.fel is not null then
    select x.holiday_day into other from leave_entries x
      cross join lateral app_holiday_alt(x.holiday_day) b
     where x.person_id = p_person and x.type_code = 'unnepnap_kivet'
       and x.holiday_day is not null
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

notify pgrst, 'reload schema';
