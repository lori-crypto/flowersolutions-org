-- ============================================================
-- 03_orgboard_seed.sql — Kiinduló struktúra (7 osztály / 21 alosztály)
-- Csak üres táblákba tölt (idempotens). A neveket a felületen írod át.
-- Előfeltétel: 02_orgboard.sql
-- ============================================================

insert into org_settings (id, name, evt_hu)
select 1, 'Flower Solutions', ''
where not exists (select 1 from org_settings);

do $$
declare
  ga uuid; gb uuid;
  d7 uuid; d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid; d6 uuid;
  div uuid;
  dep_code int;
  i int;
  div_ids uuid[];
  div_codes text[] := array['7','1','2','3','4','5','6'];
  div_names text[] := array['7. osztály','1. osztály','2. osztály','3. osztály','4. osztály','5. osztály','6. osztály'];
  div_colors text[] := array['#5b5f97','#0e7c86','#b3541e','#2e7d32','#8e3b8e','#c2851a','#1565c0'];
  -- klasszikus alosztály-számozás osztályonként:
  dep_codes int[][] := array[[19,20,21],[1,2,3],[4,5,6],[7,8,9],[10,11,12],[13,14,15],[16,17,18]];
begin
  if exists (select 1 from ob_groups) then
    return; -- már van adat, nem nyúlunk hozzá
  end if;

  insert into ob_groups (label_hu, label_ro, sort) values
    ('A-csoport', 'Grupa A', 1) returning id into ga;
  insert into ob_groups (label_hu, label_ro, sort) values
    ('B-csoport', 'Grupa B', 2) returning id into gb;

  div_ids := array[]::uuid[];
  for i in 1..7 loop
    insert into ob_divisions (group_id, code, name_hu, name_ro, color, sort)
    values (case when i <= 3 then ga else gb end,
            div_codes[i], div_names[i], 'Divizia ' || div_codes[i], div_colors[i], i)
    returning id into div;
    div_ids := div_ids || div;

    -- 3 alosztály osztályonként
    insert into ob_departments (division_id, code, name_hu, name_ro, sort)
    select div, dep_codes[i][k]::text, dep_codes[i][k] || '. alosztály',
           'Departamentul ' || dep_codes[i][k], k
    from generate_series(1,3) k;

    -- osztályvezetői poszt
    insert into ob_posts (division_id, lead_level, name_hu, name_ro, sort)
    values (div, 'osztalyvezeto', 'Osztályvezető', 'Șef de divizie', 0);
  end loop;

  -- alosztályvezetői posztok minden alosztályba
  insert into ob_posts (department_id, lead_level, name_hu, name_ro, sort)
  select id, 'alosztalyvezeto', 'Alosztályvezető', 'Șef de departament', 0 from ob_departments;

  -- csoportvezetői posztok
  insert into ob_posts (group_id, lead_level, name_hu, name_ro, sort) values
    (ga, 'csoportvezeto', 'A-csoport vezető', 'Șef grupa A', 0),
    (gb, 'csoportvezeto', 'B-csoport vezető', 'Șef grupa B', 0);

  -- ügyvezetői poszt (a szervezethez horgonyozva)
  insert into ob_posts (org_anchor, lead_level, name_hu, name_ro, sort)
  values (true, 'ugyvezeto', 'Ügyvezető', 'Director general', 0);
end $$;

-- ============================================================
-- ELSŐ ADMIN BEÁLLÍTÁSA (kézzel, miután létrehoztad a fiókod):
-- 1. Supabase → Authentication → Add user (email + jelszó)
-- 2. Futtasd (a saját email-címeddel):
--
-- insert into persons (user_id, name, email, lang)
-- select id, 'Lóri', email, 'hu' from auth.users where email = 'lori@flowersolutions.ro'
-- on conflict (user_id) do nothing;
--
-- insert into person_capabilities (person_id, capability)
-- select p.id, c.cap
-- from persons p, (values ('admin'),('tabla.szerkesztes')) c(cap)
-- where p.email = 'lori@flowersolutions.ro'
-- on conflict do nothing;
-- ============================================================
