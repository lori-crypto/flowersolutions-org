-- ============================================================
-- 20_szinkron_utemezes.sql — Megbízható szinkron-időzítés pg_cronnal.
-- A Vercel ingyenes csomagja a cronokat csak napi 1× futtatja, ezért a
-- 2 óránkénti frissítéseket a Supabase időzíti (pg_cron + pg_net).
--
-- FONTOS: futtatás ELŐTT cseréld ki az összes  IDE_A_CRON_SECRET  szöveget
-- a CRON_SECRET értékére (Vercel → Project → Settings → Environment Variables).
--
-- Időzítések UTC-ben (romániai idő = UTC+3 nyáron, UTC+2 télen):
--   • 2 óránként: rendelések (futó hónap) + webshop + MAI számlák
--   • éjjel 00:50 UTC: rendelések teljes 2 hónapos frissítése
--   (a teljes eladás- és webshop-szinkron éjszakai futása a Vercelen marad)
-- Idempotens: újrafuttatáskor a meglévő jobokat lecseréli.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
declare j text;
begin
  foreach j in array array['sync-orders-quick','sync-webshop-2h','sync-sales-today','sync-orders-full']
  loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $do$;

-- 2 óránként: NEXUS rendelések, csak a futó hónap (gyors)
select cron.schedule('sync-orders-quick', '10 */2 * * *', $$
  select net.http_get(
    url := 'https://org.flowersolutions.ro/api/orders-sync?quick=1&secret=IDE_A_CRON_SECRET',
    timeout_milliseconds := 120000);
$$);

-- 2 óránként: webshop előrendelések (kis adat, teljes csere)
select cron.schedule('sync-webshop-2h', '20 */2 * * *', $$
  select net.http_get(
    url := 'https://org.flowersolutions.ro/api/webshop-sync?secret=IDE_A_CRON_SECRET',
    timeout_milliseconds := 120000);
$$);

-- 2 óránként: a MAI nap számlázott eladásai (gyors)
select cron.schedule('sync-sales-today', '30 */2 * * *', $$
  select net.http_get(
    url := 'https://org.flowersolutions.ro/api/sales-sync?today=1&secret=IDE_A_CRON_SECRET',
    timeout_milliseconds := 120000);
$$);

-- éjjel: rendelések teljes (futó + előző hónap) frissítése
select cron.schedule('sync-orders-full', '50 0 * * *', $$
  select net.http_get(
    url := 'https://org.flowersolutions.ro/api/orders-sync?secret=IDE_A_CRON_SECRET',
    timeout_milliseconds := 300000);
$$);

-- Ellenőrzés: mik vannak beütemezve
select jobname, schedule from cron.job order by jobname;
