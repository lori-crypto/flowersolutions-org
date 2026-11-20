-- ============================================================
-- homerseklet_demo_torles.sql — a DEMÓ adatok teljes eltávolítása
-- (a homerseklet_demo.sql párja). A valódi panelekhez és mérésekhez nem nyúl.
-- ============================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'temp-demo') then
    perform cron.unschedule('temp-demo');
  end if;
end $$;

-- a demó telephely-riasztás (nincs szondához kötve)
delete from temp_alerts where ack_by like '%(demó)';

-- panelek → a szondák, mérések, összesítések és riasztások kaszkádban törlődnek
delete from temp_devices where name like 'DEMO%';

drop function if exists temp_demo_tick();
drop function if exists temp_demo_value(text, integer, timestamptz);

-- Ellenőrzés: 0 kell legyen
select count(*) as maradt_demo_panel from temp_devices where name like 'DEMO%';
