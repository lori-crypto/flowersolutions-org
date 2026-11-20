-- ============================================================
-- homerseklet_demo.sql — DEMÓ adatok a Hőmérséklet menüponthoz
--
-- Mit csinál:
--  • 5 DEMO panelt és 8 szondát vesz fel a meglévő telephelyekre
--    (a valódi kiosztás szerint: 3 hűtőkamra + raktár, iroda, kisebb raktár,
--     a két bolt virágos hűtője)
--  • 7 napnyi percenkénti mérést generál (kompresszor-ciklus, ajtónyitások,
--    napi ingadozás), benne két „esemény"-nyel:
--      – 2 napja: a 3. hűtőkamra 9,6 °C-ig melegedett (lezárt, nyugtázott riasztás)
--      – 3 napja: az 1. boltban 25 perc áramszünet (lyuk a grafikonon + lezárt riasztás)
--  • percenként „élő" mérést is ír, így az áttekintő frissül és nem jön
--    „panel elhallgatott" riasztás
--
-- Telegramra NEM küld semmit (a múltbeli riasztások már lezártként kerülnek be).
-- Figyelem: a napi 8 órás összefoglalóban és az /allapot válaszban a demó
-- szondák is szerepelnek, amíg ki nem törlöd őket.
--
-- Törlés: homerseklet_demo_torles.sql (minden DEMO adatot nyomtalanul eltávolít)
-- Előfeltétel: 38_homerseklet.sql
-- ============================================================

do $$
begin
  if exists (select 1 from temp_devices where name like 'DEMO%') then
    raise exception 'A demó már be van töltve. Előbb futtasd a homerseklet_demo_torles.sql-t.';
  end if;
end $$;

-- Mesterséges mérés egy adott időpontra (szondatípus + sorszám szerint kicsit eltérő görbe)
create or replace function temp_demo_value(p_kind text, p_seed int, p_ts timestamptz)
returns numeric language plpgsql volatile set search_path = public as $$
declare
  lt timestamp := p_ts at time zone 'Europe/Bucharest';
  h  numeric := extract(hour from lt) + extract(minute from lt) / 60.0;
  m  numeric := extract(epoch from p_ts) / 60.0;
  work boolean := h >= 7 and h < 19;
  v  numeric;
begin
  v := case p_kind
    when 'hutokamra' then
      3.6 + p_seed * 0.35
      + 0.55 * sin(2 * pi() * m / (38 + p_seed * 5))                         -- kompresszor
      + case when work and (floor(m)::bigint % (95 + p_seed * 17)) < 7 then 1.1 else 0 end  -- ajtónyitás
    when 'viragos_huto' then
      5.4 + p_seed * 0.3
      + 0.7 * sin(2 * pi() * m / 47)
      + case when work then 1.4 * sin(pi() * (h - 7) / 12) else 0 end          -- nyitott eleje, nappal melegebb
    when 'raktar' then
      12.5 + p_seed * 0.8 + 2.2 * sin(2 * pi() * (h - 9) / 24)
    when 'iroda' then
      19.3 + 3.0 * greatest(0, sin(pi() * (h - 6) / 13))
    else 15 end;
  return round((v + (random() - 0.5) * 0.16)::numeric, 2);
end $$;

-- Panelek és szondák
do $$
declare
  k  bigint := (select id from temp_sites where name = 'Központ');
  b1 bigint := (select id from temp_sites where name = '1. bolt');
  b2 bigint := (select id from temp_sites where name = '2. bolt');
  d  bigint;
begin
  if k is null or b1 is null or b2 is null then
    raise exception 'Hiányzik a Központ / 1. bolt / 2. bolt telephely.';
  end if;

  insert into temp_devices (site_id, name, fw, rssi) values (k, 'DEMO – Hűtőkamrák + raktár', '1.0.0', -58) returning id into d;
  insert into temp_sensors (device_id, hw_addr, name, kind, configured, sort,
                            max_temp, max_delay_min, crit_temp, crit_delay_min, min_temp, min_delay_min) values
    (d, 'DEMO-01', 'Hűtőkamra 1', 'hutokamra', true, 1, 8, 20, 12, 5, 0.5, 15),
    (d, 'DEMO-02', 'Hűtőkamra 2', 'hutokamra', true, 2, 8, 20, 12, 5, 0.5, 15),
    (d, 'DEMO-03', 'Hűtőkamra 3', 'hutokamra', true, 3, 8, 20, 12, 5, 0.5, 15),
    (d, 'DEMO-04', 'Raktár',      'raktar',    true, 4, 30, 30, null, null, 3, 30);

  insert into temp_devices (site_id, name, fw, rssi) values (k, 'DEMO – Iroda', '1.0.0', -49) returning id into d;
  insert into temp_sensors (device_id, hw_addr, name, kind, configured, sort,
                            max_temp, max_delay_min, crit_temp, crit_delay_min, min_temp, min_delay_min) values
    (d, 'DEMO-05', 'Iroda', 'iroda', true, 5, null, null, null, null, 10, 60);

  insert into temp_devices (site_id, name, fw, rssi) values (k, 'DEMO – Kisebb raktár', '1.0.0', -71) returning id into d;
  insert into temp_sensors (device_id, hw_addr, name, kind, configured, sort,
                            max_temp, max_delay_min, crit_temp, crit_delay_min, min_temp, min_delay_min) values
    (d, 'DEMO-06', 'Kisebb raktár', 'raktar', true, 6, 30, 30, null, null, 3, 30);

  insert into temp_devices (site_id, name, fw, rssi) values (b1, 'DEMO – Bolt 1', '1.0.0', -63) returning id into d;
  insert into temp_sensors (device_id, hw_addr, name, kind, configured, sort,
                            max_temp, max_delay_min, crit_temp, crit_delay_min, min_temp, min_delay_min) values
    (d, 'DEMO-07', 'Virágos hűtő', 'viragos_huto', true, 1, 10, 30, 14, 10, 1, 15);

  insert into temp_devices (site_id, name, fw, rssi) values (b2, 'DEMO – Bolt 2', '1.0.0', -66) returning id into d;
  insert into temp_sensors (device_id, hw_addr, name, kind, configured, sort,
                            max_temp, max_delay_min, crit_temp, crit_delay_min, min_temp, min_delay_min) values
    (d, 'DEMO-08', 'Virágos hűtő', 'viragos_huto', true, 2, 10, 30, 14, 10, 1, 15);
end $$;

-- 7 nap percenkénti mérés (~80 ezer sor)
insert into temp_readings (sensor_id, ts, temp)
select s.id, ts, temp_demo_value(s.kind, s.sort, ts)
  from temp_sensors s
  join temp_devices d on d.id = s.device_id and d.name like 'DEMO%'
 cross join generate_series(date_trunc('minute', now()) - interval '7 days',
                            date_trunc('minute', now()), interval '1 minute') as ts
on conflict do nothing;

-- Események + a hozzájuk tartozó (lezárt) riasztások
do $$
declare
  k3  bigint := (select id from temp_sensors where hw_addr = 'DEMO-03');
  bs  bigint := (select id from temp_sensors where hw_addr = 'DEMO-07');
  b1  bigint := (select id from temp_sites where name = '1. bolt');
  t0  timestamptz := date_trunc('hour', now() - interval '2 days') - interval '3 hours';  -- 3. kamra melegedés kezdete
  p0  timestamptz := date_trunc('hour', now() - interval '3 days') + interval '20 minutes'; -- 1. bolt áramszünet
begin
  -- 3. hűtőkamra: 100 perc alatt 4 → 9,6 °C, majd 60 perc alatt vissza (pl. nyitva maradt ajtó)
  update temp_readings r set temp = round((
      case when r.ts < t0 + interval '100 minutes'
           then 4.0 + 5.6 * extract(epoch from r.ts - t0) / 6000
           else 9.6 - 5.6 * extract(epoch from r.ts - t0 - interval '100 minutes') / 3600 end
      + (random() - 0.5) * 0.12)::numeric, 2)
   where r.sensor_id = k3 and r.ts >= t0 and r.ts < t0 + interval '160 minutes';

  insert into temp_alerts (kind, sensor_id, started_at, notified_at, ack_at, ack_by, resolved_at, peak_temp, threshold)
  values ('high', k3, t0 + interval '71 minutes', t0 + interval '91 minutes', t0 + interval '97 minutes',
          'Kovacs Lorand (demó)', t0 + interval '123 minutes', 9.6, 8);

  -- 1. bolt: 25 perc áramszünet → nincs mérés, lezárt telephely-riasztás
  delete from temp_readings where sensor_id = bs and ts >= p0 and ts < p0 + interval '25 minutes';
  insert into temp_alerts (kind, site_id, started_at, notified_at, ack_at, ack_by, resolved_at)
  values ('site_offline', b1, p0, p0 + interval '5 minutes', p0 + interval '9 minutes',
          'Kovacs Lorand (demó)', p0 + interval '26 minutes');
end $$;

-- Utolsó érték a kártyákra, panelek „élnek"
update temp_sensors s
   set last_temp = r.temp, last_at = r.ts
  from (select distinct on (sensor_id) sensor_id, ts, temp from temp_readings
         where sensor_id in (select x.id from temp_sensors x join temp_devices d on d.id = x.device_id
                              where d.name like 'DEMO%')
         order by sensor_id, ts desc) r
 where r.sensor_id = s.id;
update temp_devices set last_seen = now() where name like 'DEMO%';

-- Óránkénti összesítés a hosszabb grafikonokhoz
select temp_maintain();

-- Percenkénti „élő" demó-mérés
create or replace function temp_demo_tick() returns void
language plpgsql security definer set search_path = public as $$
declare t timestamptz := date_trunc('minute', now());
begin
  insert into temp_readings (sensor_id, ts, temp)
  select s.id, t, temp_demo_value(s.kind, s.sort, t)
    from temp_sensors s join temp_devices d on d.id = s.device_id
   where d.name like 'DEMO%'
  on conflict do nothing;
  update temp_sensors s set last_temp = r.temp, last_at = r.ts
    from temp_readings r
   where r.sensor_id = s.id and r.ts = t
     and s.device_id in (select id from temp_devices where name like 'DEMO%');
  update temp_devices set last_seen = now() where name like 'DEMO%';
end $$;

revoke all on function temp_demo_value(text, integer, timestamptz) from public, anon, authenticated;
revoke all on function temp_demo_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'temp-demo') then perform cron.unschedule('temp-demo'); end if;
end $$;
select cron.schedule('temp-demo', '* * * * *', $$ select temp_demo_tick(); $$);

-- Ellenőrzés
select st.name as telephely, s.name as szonda, s.last_temp, count(r.*) as meres
  from temp_sensors s join temp_devices d on d.id = s.device_id join temp_sites st on st.id = d.site_id
  left join temp_readings r on r.sensor_id = s.id
 where d.name like 'DEMO%'
 group by st.name, st.sort, s.name, s.sort, s.last_temp order by st.sort, s.sort;
