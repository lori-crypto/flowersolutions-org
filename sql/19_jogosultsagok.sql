-- ============================================================
-- 19_jogosultsagok.sql — Jogosultság-kezelés a Kollégák oldalról:
--  • audit-napló a person_capabilities változásaira
--  • védelem: a saját 'admin' jogot nem lehet elvenni (kizárás ellen)
-- A ki/be kapcsolás magán a táblán történik (RLS: csak admin írhatja).
-- Idempotens. Előfeltétel: 01.
-- ============================================================

-- Saját admin jog törlésének tiltása (nehogy az utolsó admin kizárja magát)
create or replace function app_protect_own_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.capability = 'admin' and old.person_id = app_current_person() then
    raise exception 'A saját admin jogodat nem veheted el. / Nu îți poți retrage propriul drept de admin.';
  end if;
  return old;
end $$;

drop trigger if exists pcaps_protect_own_admin on person_capabilities;
create trigger pcaps_protect_own_admin before delete on person_capabilities
  for each row execute function app_protect_own_admin();

-- Audit: minden jogosultság-változás naplózva
drop trigger if exists pcaps_audit on person_capabilities;
create trigger pcaps_audit after insert or update or delete on person_capabilities
  for each row execute function app_audit();
