-- ============================================================
-- 38_homerseklet.sql — Hőmérséklet-figyelő modul
--
--  • Telephelyek → panelek (ESP32) → szondák (DS18B20)
--  • A panelek percenként közvetlenül ide küldik a mérést (temp_ingest RPC,
--    eszközkulccsal — nincs Vercel-függés, nem fogy a hívási keret)
--  • Riasztás: pg_cron percenként futtatja a temp_check()-et, ami pg_net-tel
--    a Telegramnak küld. A „Láttam" gomb a /api/homerseklet/telegram végpontra fut.
--  • Napi életjel reggel 8-kor (romániai idő), 90 nap nyers adat + óránkénti
--    összesítés örökre.
--
-- Jogok:  homerseklet            — megtekintés (áttekintő, grafikon, riasztásnapló)
--         homerseklet.beallitas  — szondák elnevezése, határértékek, panelek
-- Idempotens. Előfeltétel: 01 (persons, capabilities, app_has_cap, app_audit),
-- pg_cron + pg_net (20_szinkron_utemezes.sql már bekapcsolta).
--
-- Futtatás UTÁN, egyszer (SQL Editorban, a saját értékekkel):
--   update temp_config set bot_token = '123:ABC…', chat_id = '-100…' where id = 1;
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into capabilities (key, description) values
  ('homerseklet',           'Hőmérséklet-figyelő megtekintése'),
  ('homerseklet.beallitas', 'Hőmérséklet-figyelő beállítása (szondák, határértékek, panelek)')
on conflict (key) do nothing;

-- ── Táblák ───────────────────────────────────────────────────
create table if not exists temp_sites (
  id    bigint generated always as identity primary key,
  name  text not null unique,
  sort  int not null default 0
);

create table if not exists temp_devices (
  id         bigint generated always as identity primary key,
  site_id    bigint not null references temp_sites(id),
  name       text not null,
  active     boolean not null default true,
  last_seen  timestamptz,
  rssi       int,
  fw         text,
  created_at timestamptz not null default now()
);

-- Az eszközkulcs lenyomata KÜLÖN táblában, amit a kliens sosem olvashat
create table if not exists temp_device_keys (
  device_id bigint primary key references temp_devices(id) on delete cascade,
  key_hash  text not null unique
);

create table if not exists temp_sensors (
  id             bigint generated always as identity primary key,
  device_id      bigint not null references temp_devices(id) on delete cascade,
  hw_addr        text not null,                 -- a DS18B20 egyedi azonosítója
  name           text,
  kind           text not null default 'egyeb'
                 check (kind in ('hutokamra','viragos_huto','raktar','iroda','egyeb')),
  configured     boolean not null default false, -- amíg nincs elnevezve, nem riaszt
  active         boolean not null default true,
  sort           int not null default 0,
  max_temp       numeric(5,2),  max_delay_min  int,   -- „túl meleg"
  crit_temp      numeric(5,2),  crit_delay_min int,   -- „nagyon meleg"
  min_temp       numeric(5,2),  min_delay_min  int,   -- „túl hideg"
  offline_min    int not null default 10,             -- szonda hallgat
  hyst           numeric(4,2) not null default 0.5,   -- visszaállási sáv
  cal_offset     numeric(4,2) not null default 0,     -- kalibrációs eltolás
  last_temp      numeric(5,2),
  last_at        timestamptz,
  created_at     timestamptz not null default now(),
  unique (device_id, hw_addr)
);

create table if not exists temp_readings (
  sensor_id bigint not null references temp_sensors(id) on delete cascade,
  ts        timestamptz not null,
  temp      numeric(5,2) not null,
  primary key (sensor_id, ts)
);

create table if not exists temp_readings_hourly (
  sensor_id bigint not null references temp_sensors(id) on delete cascade,
  hour      timestamptz not null,
  t_min     numeric(5,2) not null,
  t_avg     numeric(5,2) not null,
  t_max     numeric(5,2) not null,
  n         int not null,
  primary key (sensor_id, hour)
);

create table if not exists temp_alerts (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in
               ('high','critical','low','sensor_fault','device_offline','site_offline')),
  sensor_id    bigint references temp_sensors(id) on delete cascade,
  device_id    bigint references temp_devices(id) on delete cascade,
  site_id      bigint references temp_sites(id) on delete cascade,
  started_at   timestamptz not null default now(),
  notified_at  timestamptz,
  ack_at       timestamptz,
  ack_by       text,
  resolved_at  timestamptz,
  peak_temp    numeric(5,2),
  threshold    numeric(5,2)
);
create index if not exists temp_alerts_open on temp_alerts (kind) where resolved_at is null;
create index if not exists temp_alerts_started on temp_alerts (started_at desc);
create unique index if not exists temp_alerts_one_open on temp_alerts
  (kind, coalesce(sensor_id,0), coalesce(device_id,0), coalesce(site_id,0))
  where resolved_at is null;

-- Egysoros beállítás. A bot-kulcs csak itt van, a kliens nem látja.
create table if not exists temp_config (
  id                 int primary key default 1 check (id = 1),
  bot_token          text,
  chat_id            text,
  webhook_secret     text not null default replace(gen_random_uuid()::text,'-',''),
  site_offline_min   int not null default 5,
  device_offline_min int not null default 10,
  remind_min         int not null default 30,
  last_check_at      timestamptz,
  last_daily         date
);
insert into temp_config (id) values (1) on conflict (id) do nothing;

-- Kiinduló telephelyek
insert into temp_sites (name, sort) values ('Központ', 1), ('1. bolt', 2), ('2. bolt', 3)
on conflict (name) do nothing;

-- ── Audit (csak a beállítás-változásokra, a percenkénti mérésre nem) ──
drop trigger if exists temp_sites_audit on temp_sites;
create trigger temp_sites_audit after insert or update or delete on temp_sites
  for each row execute function app_audit();
drop trigger if exists temp_devices_audit on temp_devices;
create trigger temp_devices_audit after insert or delete or update of site_id, name, active on temp_devices
  for each row execute function app_audit();
drop trigger if exists temp_sensors_audit on temp_sensors;
create trigger temp_sensors_audit after delete or update of
  name, kind, configured, active, sort, max_temp, max_delay_min, crit_temp, crit_delay_min,
  min_temp, min_delay_min, offline_min, hyst, cal_offset, device_id on temp_sensors
  for each row execute function app_audit();

-- ── RLS ──────────────────────────────────────────────────────
alter table temp_sites           enable row level security;
alter table temp_devices         enable row level security;
alter table temp_device_keys     enable row level security;
alter table temp_sensors         enable row level security;
alter table temp_readings        enable row level security;
alter table temp_readings_hourly enable row level security;
alter table temp_alerts          enable row level security;
alter table temp_config          enable row level security;
-- temp_device_keys és temp_config: szándékosan NINCS policy → kliensről elérhetetlen

do $do$
declare t text;
begin
  foreach t in array array['temp_sites','temp_devices','temp_sensors',
                           'temp_readings','temp_readings_hourly','temp_alerts']
  loop
    execute format('drop policy if exists %1$s_sel on %1$s', t);
    execute format($p$create policy %1$s_sel on %1$s for select to authenticated
                     using (app_has_cap('homerseklet') or app_has_cap('homerseklet.beallitas'))$p$, t);
  end loop;
  foreach t in array array['temp_sites','temp_devices','temp_sensors']
  loop
    execute format('drop policy if exists %1$s_adm on %1$s', t);
    execute format($p$create policy %1$s_adm on %1$s for all to authenticated
                     using (app_has_cap('homerseklet.beallitas'))
                     with check (app_has_cap('homerseklet.beallitas'))$p$, t);
  end loop;
end $do$;

-- ── Segédfüggvények (szövegek) ───────────────────────────────
create or replace function temp_html(t text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(t,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

create or replace function temp_hm(ts timestamptz) returns text
language sql stable as $$
  select to_char(ts at time zone 'Europe/Bucharest', 'HH24:MI')
$$;

create or replace function temp_dur(i interval) returns text
language sql immutable as $$
  select case
    when i < interval '1 hour' then greatest(1, floor(extract(epoch from i)/60))::int || ' perc'
    when i < interval '1 day'  then floor(extract(epoch from i)/3600)::int || ' óra '
                                    || (floor(extract(epoch from i)/60)::int % 60) || ' perc'
    else floor(extract(epoch from i)/86400)::int || ' nap '
         || (floor(extract(epoch from i)/3600)::int % 24) || ' óra'
  end
$$;

create or replace function temp_fmt(v numeric) returns text
language sql immutable as $$
  select case when v is null then '–' else replace(to_char(v, 'FM990.0'), '.', ',') || ' °C' end
$$;

-- Egy riasztás leírása (első üzenet és emlékeztető is ezt használja)
create or replace function temp_alert_text(p_id bigint) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  a temp_alerts; se temp_sensors; d temp_devices; st temp_sites; lbl text; ndev int;
begin
  select * into a from temp_alerts where id = p_id;
  if a.sensor_id is not null then
    select * into se from temp_sensors where id = a.sensor_id;
    select * into d  from temp_devices where id = se.device_id;
    select * into st from temp_sites   where id = d.site_id;
    lbl := '<b>' || temp_html(st.name) || ' / ' || temp_html(coalesce(se.name, se.hw_addr)) || '</b>';
  elsif a.device_id is not null then
    select * into d  from temp_devices where id = a.device_id;
    select * into st from temp_sites   where id = d.site_id;
    lbl := '<b>' || temp_html(st.name) || ' / ' || temp_html(d.name) || '</b>';
  else
    select * into st from temp_sites where id = a.site_id;
    lbl := '<b>' || temp_html(st.name) || '</b>';
    select count(*) into ndev from temp_devices where site_id = st.id and active;
  end if;

  return case a.kind
    when 'high' then '🔴 <b>TÚL MELEG</b> — ' || lbl || E'\n'
      || 'Most: ' || temp_fmt(se.last_temp) || ' (határ: ' || temp_fmt(a.threshold) || ')' || E'\n'
      || 'Felette ' || temp_dur(now() - a.started_at) || ' óta.'
    when 'critical' then '🚨 <b>NAGYON MELEG</b> — ' || lbl || E'\n'
      || 'Most: ' || temp_fmt(se.last_temp) || ' (határ: ' || temp_fmt(a.threshold) || ')' || E'\n'
      || 'Felette ' || temp_dur(now() - a.started_at) || ' óta. Azonnal nézd meg!'
    when 'low' then '🔵 <b>TÚL HIDEG</b> — ' || lbl || E'\n'
      || 'Most: ' || temp_fmt(se.last_temp) || ' (határ: ' || temp_fmt(a.threshold) || ')' || E'\n'
      || 'Alatta ' || temp_dur(now() - a.started_at) || ' óta. Fagyveszély!'
    when 'sensor_fault' then '⚠️ <b>Szonda nem ad adatot</b> — ' || lbl || E'\n'
      || 'Utolsó mérés: ' || coalesce(temp_hm(se.last_at), 'még nem volt')
      || '. Ellenőrizd a szonda kábelét és csatlakozóját.'
    when 'device_offline' then '⚠️ <b>Panel elhallgatott</b> — ' || lbl || E'\n'
      || 'Utolsó adat: ' || coalesce(temp_hm(d.last_seen), '–')
      || '. Ellenőrizd az áramot (töltő) és a Wi-Fit.'
    when 'site_offline' then '⚡ <b>Nincs adat</b> — ' || lbl || E'\n'
      || 'Egyik panel sem jelentkezik ' || temp_dur(now() - a.started_at) || ' óta. '
      || case when ndev > 1
              then 'Valószínűleg áramszünet vagy internetkimaradás.'
              else 'Áramszünet, internetkimaradás vagy eszközhiba — érdemes odatelefonálni.' end
  end;
end $$;

-- Rövid címke a „rendben" üzenethez
create or replace function temp_alert_label(p_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select case
    when a.sensor_id is not null then
      (select '<b>' || temp_html(st.name) || ' / ' || temp_html(coalesce(se.name, se.hw_addr)) || '</b>'
         from temp_sensors se join temp_devices d on d.id = se.device_id
         join temp_sites st on st.id = d.site_id where se.id = a.sensor_id)
    when a.device_id is not null then
      (select '<b>' || temp_html(st.name) || ' / ' || temp_html(d.name) || '</b>'
         from temp_devices d join temp_sites st on st.id = d.site_id where d.id = a.device_id)
    else (select '<b>' || temp_html(st.name) || '</b>' from temp_sites st where st.id = a.site_id)
  end
  from temp_alerts a where a.id = p_id
$$;

-- ── Telegram-küldés (pg_net, aszinkron) ──────────────────────
create or replace function temp_send(p_text text, p_alert_id bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare c temp_config; body jsonb;
begin
  select * into c from temp_config where id = 1;
  if c.bot_token is null or c.chat_id is null then return; end if;
  body := jsonb_build_object('chat_id', c.chat_id, 'text', p_text,
                             'parse_mode', 'HTML', 'disable_web_page_preview', true);
  if p_alert_id is not null then
    body := body || jsonb_build_object('reply_markup', jsonb_build_object('inline_keyboard',
      jsonb_build_array(jsonb_build_array(
        jsonb_build_object('text', '✅ Láttam', 'callback_data', 'ack:' || p_alert_id)))));
    update temp_alerts set notified_at = now() where id = p_alert_id;
  end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || c.bot_token || '/sendMessage',
    body := body,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end $$;

-- Riasztás nyitása (ha még nincs nyitott ugyanilyen) + üzenet
create or replace function temp_open(p_kind text, p_sensor bigint, p_device bigint, p_site bigint,
                                     p_started timestamptz, p_peak numeric, p_thr numeric)
returns void language plpgsql security definer set search_path = public as $$
declare aid bigint;
begin
  insert into temp_alerts (kind, sensor_id, device_id, site_id, started_at, peak_temp, threshold)
  values (p_kind, p_sensor, p_device, p_site, p_started, p_peak, p_thr)
  on conflict do nothing
  returning id into aid;
  if aid is not null then
    perform temp_send(temp_alert_text(aid), aid);
  end if;
end $$;

-- Riasztás zárása + „rendben" üzenet
create or replace function temp_close(p_kind text, p_sensor bigint, p_device bigint, p_site bigint,
                                      p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  for a in
    update temp_alerts set resolved_at = now()
     where kind = p_kind and resolved_at is null
       and coalesce(sensor_id,0) = coalesce(p_sensor,0)
       and coalesce(device_id,0) = coalesce(p_device,0)
       and coalesce(site_id,0)   = coalesce(p_site,0)
    returning id, started_at
  loop
    perform temp_send('✅ <b>Rendben</b> — ' || temp_alert_label(a.id) || E'\n'
      || coalesce(p_note || E'\n', '')
      || 'A gond ' || temp_dur(now() - a.started_at) || ' ideig tartott.');
  end loop;
end $$;

-- Egy határérték kiértékelése egy szondára
--   p_above = true: „felette van folyamatosan p_delay percig" (meleg)
--   p_above = false: „alatta van folyamatosan p_delay percig" (hideg)
create or replace function temp_eval(p_sensor bigint, p_kind text, p_thr numeric, p_delay int,
                                     p_above boolean, p_hyst numeric, p_last numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_open bigint; v_ext numeric; v_n int;
begin
  select id into v_open from temp_alerts
   where kind = p_kind and sensor_id = p_sensor and resolved_at is null;

  if p_thr is null or p_delay is null then
    -- a határt kikapcsolták: nyitott riasztás csendben lezárul
    update temp_alerts set resolved_at = now() where id = v_open;
    return;
  end if;

  if v_open is null then
    select case when p_above then min(temp) else max(temp) end, count(*)
      into v_ext, v_n
      from temp_readings
     where sensor_id = p_sensor and ts > now() - make_interval(mins => p_delay);
    -- legalább az ablak 60%-ában legyen mérés, különben nem döntünk
    if v_n >= greatest(1, floor(p_delay * 0.6)::int)
       and ((p_above and v_ext > p_thr) or (not p_above and v_ext < p_thr)) then
      perform temp_open(p_kind, p_sensor, null, null,
                        now() - make_interval(mins => p_delay), p_last, p_thr);
    end if;
  else
    update temp_alerts
       set peak_temp = case when p_above then greatest(peak_temp, p_last)
                            else least(peak_temp, p_last) end
     where id = v_open;
    select case when p_above then max(temp) else min(temp) end, count(*)
      into v_ext, v_n
      from temp_readings
     where sensor_id = p_sensor and ts > now() - interval '5 minutes';
    if v_n >= 3 and ((p_above and v_ext < p_thr - p_hyst)
                  or (not p_above and v_ext > p_thr + p_hyst)) then
      perform temp_close(p_kind, p_sensor, null, null, 'Most: ' || temp_fmt(p_last));
    end if;
  end if;
end $$;

-- ── A percenkénti ellenőrzés ─────────────────────────────────
create or replace function temp_check() returns void
language plpgsql security definer set search_path = public as $$
declare c temp_config; r record; nowt timestamptz := now();
begin
  if not pg_try_advisory_xact_lock(hashtext('temp_check')) then return; end if;
  select * into c from temp_config where id = 1;
  update temp_config set last_check_at = nowt where id = 1;

  -- 1) Telephely: egyik panel sem jelentkezik
  for r in
    select s.id, max(d.last_seen) as last_seen
      from temp_sites s join temp_devices d on d.site_id = s.id and d.active
     group by s.id
  loop
    continue when r.last_seen is null;            -- még nincs felszerelve
    if r.last_seen < nowt - make_interval(mins => c.site_offline_min) then
      perform temp_open('site_offline', null, null, r.id, r.last_seen, null, null);
    else
      perform temp_close('site_offline', null, null, r.id);
    end if;
  end loop;

  -- 2) Panel elhallgatott (ha az egész telephely nem esett ki)
  for r in
    select d.id, d.site_id, d.last_seen from temp_devices d
     where d.active and d.last_seen is not null
  loop
    if r.last_seen < nowt - make_interval(mins => c.device_offline_min) then
      if not exists (select 1 from temp_alerts where kind = 'site_offline'
                       and site_id = r.site_id and resolved_at is null) then
        perform temp_open('device_offline', null, r.id, null, r.last_seen, null, null);
      end if;
    else
      perform temp_close('device_offline', null, r.id, null);
    end if;
  end loop;

  -- 3) Szondák (csak elnevezett, aktív szonda, élő panelen)
  for r in
    select se.*, d.last_seen as dev_seen
      from temp_sensors se join temp_devices d on d.id = se.device_id
     where se.active and se.configured and d.active
  loop
    continue when r.dev_seen is null or r.dev_seen < nowt - interval '3 minutes';

    if r.last_at is null or r.last_at < nowt - make_interval(mins => r.offline_min) then
      perform temp_open('sensor_fault', r.id, null, null, coalesce(r.last_at, nowt), null, null);
      continue;
    else
      perform temp_close('sensor_fault', r.id, null, null);
    end if;

    perform temp_eval(r.id, 'high',     r.max_temp,  r.max_delay_min,  true,  r.hyst, r.last_temp);
    perform temp_eval(r.id, 'critical', r.crit_temp, r.crit_delay_min, true,  r.hyst, r.last_temp);
    perform temp_eval(r.id, 'low',      r.min_temp,  r.min_delay_min,  false, r.hyst, r.last_temp);
  end loop;

  -- 4) Emlékeztető a nem nyugtázott, nyitott riasztásokról
  for r in
    select id from temp_alerts
     where resolved_at is null and ack_at is null
       and notified_at < nowt - make_interval(mins => c.remind_min)
  loop
    perform temp_send('⏰ <i>Emlékeztető</i>' || E'\n' || temp_alert_text(r.id), r.id);
  end loop;
end $$;

-- ── Összefoglaló szöveg (napi életjel és /allapot) ───────────
create or replace function temp_summary_text(p_title text) returns text
language plpgsql stable security definer set search_path = public as $$
declare txt text := p_title; s record; se record; nopen int; mn numeric; mx numeric;
begin
  for s in select * from temp_sites order by sort, name loop
    if not exists (select 1 from temp_devices where site_id = s.id and active) then continue; end if;
    txt := txt || E'\n\n<b>' || temp_html(s.name) || '</b>';
    for se in
      select x.* from temp_sensors x join temp_devices d on d.id = x.device_id
       where d.site_id = s.id and x.active and x.configured and d.active
       order by x.sort, x.name
    loop
      select min(temp), max(temp) into mn, mx from temp_readings
       where sensor_id = se.id and ts > now() - interval '24 hours';
      txt := txt || E'\n• ' || temp_html(se.name) || ': ' || temp_fmt(se.last_temp)
          || case when se.last_at < now() - interval '10 minutes' then ' (régi: ' || temp_hm(se.last_at) || ')' else '' end
          || '  <i>24 ó: ' || temp_fmt(mn) || ' … ' || temp_fmt(mx) || '</i>'
          || case when exists (select 1 from temp_alerts where sensor_id = se.id and resolved_at is null)
                  then ' ⚠️' else '' end;
    end loop;
  end loop;
  select count(*) into nopen from temp_alerts where resolved_at is null;
  txt := txt || E'\n\n' || case when nopen = 0 then '✅ Nincs nyitott riasztás.'
                               else '⚠️ Nyitott riasztás: ' || nopen end;
  return txt;
end $$;

-- Napi életjel: óránként fut, de csak reggel 8-kor (romániai idő) küld, naponta egyszer.
-- Ha egy reggel NEM jön meg, maga a figyelőrendszer áll.
create or replace function temp_daily(p_force boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare c temp_config; today date := (now() at time zone 'Europe/Bucharest')::date;
begin
  select * into c from temp_config where id = 1;
  if not p_force then
    if extract(hour from now() at time zone 'Europe/Bucharest') <> 8 then return; end if;
    if c.last_daily = today then return; end if;
  end if;
  update temp_config set last_daily = today where id = 1;
  perform temp_send(temp_summary_text('☀️ <b>Napi összefoglaló</b> — ' || to_char(today, 'YYYY.MM.DD.')));
end $$;

-- Éjszakai karbantartás: óránkénti összesítés + 90 napnál régebbi nyers adat törlése
create or replace function temp_maintain() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into temp_readings_hourly (sensor_id, hour, t_min, t_avg, t_max, n)
  select sensor_id, date_trunc('hour', ts), min(temp), round(avg(temp), 2), max(temp), count(*)
    from temp_readings
   where ts >= now() - interval '7 days' and ts < date_trunc('hour', now())
   group by 1, 2
  on conflict (sensor_id, hour) do update
    set t_min = excluded.t_min, t_avg = excluded.t_avg, t_max = excluded.t_max, n = excluded.n;
  delete from temp_readings where ts < now() - interval '90 days';
end $$;

-- ── Beküldés a panelekről (anon kulccsal hívható, eszközkulccsal védve) ──
-- p_readings: [{"a":"28FF…","t":4.25,"ts":1763400000}, …]  (ts opcionális, unix mp;
-- a panel internet-kimaradás után így pótolja a tárolt méréseket)
create or replace function temp_ingest(p_key text, p_readings jsonb,
                                       p_rssi int default null, p_fw text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare dev temp_devices; x jsonb; v_addr text; v_t numeric; v_ts timestamptz;
        v_sensor bigint; v_off numeric; n int := 0;
begin
  select d.* into dev from temp_devices d join temp_device_keys k on k.device_id = d.id
   where k.key_hash = encode(sha256(convert_to(coalesce(p_key,''), 'UTF8')), 'hex');
  if dev.id is null or not dev.active then
    return jsonb_build_object('ok', false, 'error', 'unknown_device');
  end if;
  if jsonb_typeof(p_readings) <> 'array' or jsonb_array_length(p_readings) > 600 then
    return jsonb_build_object('ok', false, 'error', 'bad_payload');
  end if;

  update temp_devices set last_seen = now(), rssi = coalesce(p_rssi, rssi), fw = coalesce(p_fw, fw)
   where id = dev.id;

  for x in select * from jsonb_array_elements(p_readings) loop
    v_addr := left(x->>'a', 32);
    begin v_t := (x->>'t')::numeric; exception when others then v_t := null; end;
    continue when v_addr is null or v_t is null or v_t < -55 or v_t > 125;
    v_ts := now();
    if x ? 'ts' then
      begin v_ts := to_timestamp((x->>'ts')::double precision);
      exception when others then v_ts := now(); end;
      if v_ts > now() + interval '5 minutes' or v_ts < now() - interval '3 days' then v_ts := now(); end if;
    end if;
    v_ts := date_trunc('second', v_ts);

    insert into temp_sensors (device_id, hw_addr) values (dev.id, v_addr)
    on conflict (device_id, hw_addr) do nothing;
    select id, cal_offset into v_sensor, v_off from temp_sensors
     where device_id = dev.id and hw_addr = v_addr;
    v_t := round(v_t + v_off, 2);

    insert into temp_readings (sensor_id, ts, temp) values (v_sensor, v_ts, v_t)
    on conflict do nothing;
    update temp_sensors set last_temp = v_t, last_at = v_ts
     where id = v_sensor and (last_at is null or last_at <= v_ts);
    n := n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'stored', n, 'server_time', extract(epoch from now())::bigint);
end $$;

-- ── Kliens-RPC-k ─────────────────────────────────────────────
-- Új panel: visszaadja az eszközkulcsot (csak most látszik, utána csak újragenerálható)
create or replace function temp_device_new(p_site bigint, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_key text := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
begin
  if not app_has_cap('homerseklet.beallitas') then raise exception 'Nincs jogosultság.'; end if;
  insert into temp_devices (site_id, name) values (p_site, trim(p_name)) returning id into v_id;
  insert into temp_device_keys (device_id, key_hash)
  values (v_id, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'));
  return v_key;
end $$;

create or replace function temp_device_rekey(p_device bigint) returns text
language plpgsql security definer set search_path = public as $$
declare v_key text := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
begin
  if not app_has_cap('homerseklet.beallitas') then raise exception 'Nincs jogosultság.'; end if;
  insert into temp_device_keys (device_id, key_hash)
  values (p_device, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'))
  on conflict (device_id) do update set key_hash = excluded.key_hash;
  return v_key;
end $$;

-- Nyugtázás a felületről
create or replace function temp_ack(p_alert bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_has_cap('homerseklet') then raise exception 'Nincs jogosultság.'; end if;
  update temp_alerts
     set ack_at = now(), ack_by = (select name from persons where id = app_current_person())
   where id = p_alert and ack_at is null;
end $$;

-- Grafikon-adat: a kért időszakhoz illő felbontás (max. ~1500 pont)
create or replace function temp_series(p_sensor bigint, p_from timestamptz, p_to timestamptz)
returns table (ts timestamptz, t_min numeric, t_avg numeric, t_max numeric)
language plpgsql stable security invoker set search_path = public as $$
declare span interval := p_to - p_from; b interval; first_raw timestamptz;
begin
  b := case when span <= interval '36 hours' then interval '1 minute'
            when span <= interval '8 days'   then interval '10 minutes'
            when span <= interval '45 days'  then interval '1 hour'
            when span <= interval '400 days' then interval '6 hours'
            else interval '1 day' end;
  select min(r.ts) into first_raw from temp_readings r where r.sensor_id = p_sensor;
  return query
    select date_bin(b, r.ts, timestamptz '2000-01-01'), min(r.temp), round(avg(r.temp), 2), max(r.temp)
      from temp_readings r
     where r.sensor_id = p_sensor and r.ts >= p_from and r.ts < p_to
     group by 1
    union all
    select date_bin(b, h.hour, timestamptz '2000-01-01'), min(h.t_min),
           round(sum(h.t_avg * h.n) / nullif(sum(h.n), 0), 2), max(h.t_max)
      from temp_readings_hourly h
     where h.sensor_id = p_sensor and h.hour >= p_from and h.hour < p_to
       and h.hour < coalesce(first_raw, 'infinity')
     group by 1
    order by 1;
end $$;

-- 24 órás min/max minden szondára (áttekintő kártyák)
create or replace function temp_minmax24() returns table (sensor_id bigint, t_min numeric, t_max numeric)
language sql stable security invoker set search_path = public as $$
  select r.sensor_id, min(r.temp), max(r.temp) from temp_readings r
   where r.ts > now() - interval '24 hours' group by 1
$$;

-- Állapot a második ellenőrnek (helyi printszerver): csak két időbélyeg, semmi más
create or replace function temp_health() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'last_ingest', (select extract(epoch from max(last_seen))::bigint from temp_devices where active),
    'last_check',  (select extract(epoch from last_check_at)::bigint from temp_config where id = 1),
    'now',         extract(epoch from now())::bigint)
$$;

-- ── Jogok a függvényekre ─────────────────────────────────────
-- A Supabase alapból mindenkinek ad futtatási jogot — a belső függvényeket elzárjuk,
-- különben bárki Telegram-üzenetet küldethetne.
do $do$
declare f text;
begin
  foreach f in array array[
    'temp_alert_text(bigint)', 'temp_alert_label(bigint)', 'temp_send(text, bigint)',
    'temp_open(text, bigint, bigint, bigint, timestamptz, numeric, numeric)',
    'temp_close(text, bigint, bigint, bigint, text)',
    'temp_eval(bigint, text, numeric, integer, boolean, numeric, numeric)',
    'temp_check()', 'temp_summary_text(text)', 'temp_daily(boolean)', 'temp_maintain()',
    'temp_device_new(bigint, text)', 'temp_device_rekey(bigint)', 'temp_ack(bigint)',
    'temp_series(bigint, timestamptz, timestamptz)', 'temp_minmax24()',
    'temp_ingest(text, jsonb, integer, text)', 'temp_health()']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $do$;

grant execute on function temp_ingest(text, jsonb, integer, text) to anon, authenticated;
grant execute on function temp_health() to anon, authenticated;
grant execute on function temp_device_new(bigint, text) to authenticated;
grant execute on function temp_device_rekey(bigint) to authenticated;
grant execute on function temp_ack(bigint) to authenticated;
grant execute on function temp_series(bigint, timestamptz, timestamptz) to authenticated;
grant execute on function temp_minmax24() to authenticated;

-- ── Ütemezés ─────────────────────────────────────────────────
do $do$
declare j text;
begin
  foreach j in array array['temp-check','temp-daily','temp-maintain'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $do$;

select cron.schedule('temp-check',    '* * * * *',  $$ select temp_check(); $$);
select cron.schedule('temp-daily',    '0 * * * *',  $$ select temp_daily(); $$);
select cron.schedule('temp-maintain', '15 2 * * *', $$ select temp_maintain(); $$);

-- Ellenőrzés
select jobname, schedule from cron.job where jobname like 'temp-%' order by jobname;
