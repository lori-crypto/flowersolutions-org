-- ============================================================
-- 32_modul_jogok.sql — Modul-szintű megtekintési jogok:
-- mindenki csak a nála bepipált modulokat látja.
--  • Új jogok: tabla (szervezési tábla), szabadsag, posztleiras
--  • A meglévő AKTÍV kollégák automatikusan megkapják mindhármat,
--    hogy senki ne essen ki — utána pipával szűkíthető.
-- Idempotens. Előfeltétel: 01.
-- ============================================================

insert into capabilities (key, description) values
  ('tabla',       'Szervezési tábla megtekintése'),
  ('szabadsag',   'Szabadságos tábla használata'),
  ('posztleiras', 'Posztleírások megtekintése')
on conflict (key) do nothing;

insert into person_capabilities (person_id, capability)
select p.id, c.key
from persons p
cross join (values ('tabla'), ('szabadsag'), ('posztleiras')) as c(key)
where p.active
  and not exists (
    select 1 from person_capabilities pc
    where pc.person_id = p.id and pc.capability = c.key
  );

-- Ellenőrzés: ki mit kapott
select p.name, array_agg(pc.capability order by pc.capability) as jogok
from persons p join person_capabilities pc on pc.person_id = p.id
group by p.name order by p.name;
