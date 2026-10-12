-- ============================================================
-- 29_ujranyitas.sql — Pénztár 6. kör:
--  • A LERAKAT zárásai a zárás után 5 napig újranyithatók és
--    módosíthatók a lerakati kollégák által; a boltoké nem
--    (ott csak a vezetői visszaküldés nyit újra).
--  • app_cash_save_day / close_day: megadható nap (p_day) —
--    kollégánál csak a megengedett körben, HR-nél bármikor.
--  • app_cash_day_detail: egy múltbeli nap teljes tartalma a
--    szerkesztő űrlaphoz.
-- Idempotens. Előfeltétel: 28.
-- ============================================================

-- jogosultság-segéd: szerkesztheti-e az adott napot
create or replace function app_cash_can_edit_day(p_unit uuid, p_day date)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  ukind text;
begin
  if app_has_cap('hr') then return true; end if;
  if not app_cash_member_of(p_unit) then return false; end if;
  if p_day = today then return true; end if;
  select kind into ukind from cash_units where id = p_unit;
  return ukind = 'lerakat' and p_day >= today - 5 and p_day < today;
end $$;

-- ── Nap részletei (múltbeli szerkesztéshez) ─────────────────
create or replace function app_cash_day_detail(p_unit uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d cash_days%rowtype;
begin
  if not app_cash_can_edit_day(p_unit, p_day) then raise exception 'Nincs jogosultság.'; end if;
  select * into d from cash_days where unit_id = p_unit and day = p_day;
  return jsonb_build_object(
    'day', to_jsonb(d),
    'monetar', (select coalesce(jsonb_agg(jsonb_build_object('denom', m.denom, 'qty', m.qty)), '[]'::jsonb)
                from cash_monetar m where m.day_id = d.id),
    'expenses', (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
                 from cash_expenses e where e.day_id = d.id),
    'pending', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'note', p.note)
                 order by p.created_at), '[]'::jsonb)
                from cash_pending p where p.day_id = d.id and p.day = p_day),
    'nexus', (select r.amount from cash_nexus_rev r where r.unit_id = p_unit and r.day = p_day)
  );
end $$;

-- ── Újranyitás (csak lerakat, 5 napon belül; HR bármit) ─────
create or replace function app_cash_reopen_day(p_unit uuid, p_day date)
returns void language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if not app_cash_can_edit_day(p_unit, p_day) then raise exception 'Nincs jogosultság.'; end if;
  select status into st from cash_days where unit_id = p_unit and day = p_day;
  if st is null then raise exception 'Nincs ilyen zárás.'; end if;
  if st = 'elfogadva' and not app_has_cap('hr') then
    raise exception 'Már elfogadott napot csak a vezető nyithat újra.';
  end if;
  if st = 'nyitott' then return; end if;
  update cash_days set status = 'nyitott', cash_diff = null, card_diff = null
  where unit_id = p_unit and day = p_day;
end $$;

-- ── Mentés megadott napra ───────────────────────────────────
drop function if exists app_cash_save_day(uuid, jsonb);
create or replace function app_cash_save_day(p_unit uuid, p_payload jsonb, p_day date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  eday date := coalesce(p_day, (now() at time zone 'Europe/Bucharest')::date);
  did uuid;
  counted numeric := 0;
  m jsonb; e jsonb; pj jsonb;
begin
  if not app_cash_can_edit_day(p_unit, eday) then raise exception 'Nincs jogosultság ehhez a naphoz.'; end if;

  select id into did from cash_days where unit_id = p_unit and day = eday;
  if did is null then
    insert into cash_days (unit_id, day) values (p_unit, eday) returning id into did;
  end if;
  if (select status from cash_days where id = did) in ('lezart','elfogadva') then
    raise exception 'A nap le van zárva — előbb nyisd meg újra.';
  end if;

  delete from cash_monetar where day_id = did;
  for m in select * from jsonb_array_elements(coalesce(p_payload->'monetar', '[]'::jsonb)) loop
    if coalesce((m->>'qty')::int, 0) > 0 then
      insert into cash_monetar (day_id, denom, qty)
      values (did, (m->>'denom')::numeric, (m->>'qty')::int);
      counted := counted + (m->>'denom')::numeric * (m->>'qty')::int;
    end if;
  end loop;

  delete from cash_expenses where day_id = did;
  for e in select * from jsonb_array_elements(coalesce(p_payload->'expenses', '[]'::jsonb)) loop
    insert into cash_expenses (day_id, unit_id, day, kind, amount, category_id,
                               vehicle_id, client_name, description, created_by)
    values (did, p_unit, eday, 'koltseg',
            (e->>'amount')::numeric,
            nullif(e->>'category_id','')::uuid,
            nullif(e->>'vehicle_id','')::uuid,
            nullif(e->>'client_name',''),
            nullif(e->>'description',''),
            app_current_person());
  end loop;

  -- a nap sofőr-tételeinek cseréje: csak a még függőben lévőket cseréljük,
  -- a már beérkezettekhez nem nyúlunk
  delete from cash_pending where day_id = did and day = eday and status = 'fuggoben';
  for pj in select * from jsonb_array_elements(coalesce(p_payload->'pending', '[]'::jsonb)) loop
    if coalesce((pj->>'amount')::numeric, 0) <> 0 then
      insert into cash_pending (day_id, unit_id, day, amount, note, created_by)
      values (did, p_unit, eday, (pj->>'amount')::numeric,
              nullif(pj->>'note',''), app_current_person());
    end if;
  end loop;

  update cash_days set
    float_morning  = nullif(p_payload->>'float_morning','')::numeric,
    float_evening  = nullif(p_payload->>'float_evening','')::numeric,
    counted_cash   = counted,
    z_cash         = nullif(p_payload->>'z_cash','')::numeric,
    z_card         = nullif(p_payload->>'z_card','')::numeric,
    pos_settlement = nullif(p_payload->>'pos_settlement','')::numeric,
    nexus_revenue  = coalesce(nullif(p_payload->>'nexus_revenue','')::numeric, nexus_revenue),
    expl_cash      = nullif(p_payload->>'expl_cash',''),
    expl_card      = nullif(p_payload->>'expl_card',''),
    status         = case when status = 'visszakuldve' then 'nyitott' else status end
  where id = did;

  return did;
end $$;

-- ── Lezárás megadott napra ──────────────────────────────────
drop function if exists app_cash_close_day(uuid);
create or replace function app_cash_close_day(p_unit uuid, p_day date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eday date := coalesce(p_day, (now() at time zone 'Europe/Bucharest')::date);
  d cash_days%rowtype;
  ukind text;
  exp_total numeric;
  pend_total numeric;
  expected numeric;
  v_cash_diff numeric;
  v_card_diff numeric;
  auto_rev numeric;
begin
  if not app_cash_can_edit_day(p_unit, eday) then raise exception 'Nincs jogosultság ehhez a naphoz.'; end if;
  select * into d from cash_days where unit_id = p_unit and day = eday;
  if d.id is null then raise exception 'Előbb mentsd el a napot.'; end if;
  if d.status in ('lezart','elfogadva') then raise exception 'A nap már le van zárva.'; end if;
  select kind into ukind from cash_units where id = p_unit;
  select coalesce(sum(amount),0) into exp_total from cash_expenses where day_id = d.id;
  select coalesce(sum(amount),0) into pend_total from cash_pending where day_id = d.id and day = eday;

  if coalesce(d.counted_cash,0) = 0 and pend_total = 0 then
    raise exception 'Hiányzik a készpénz megszámolása (monetár).';
  end if;

  if ukind = 'bolt' then
    if d.z_cash is null or d.z_card is null or d.pos_settlement is null then
      raise exception 'Hiányzó Z-jelentés vagy POS érték.';
    end if;
    expected := d.z_cash - exp_total + coalesce(d.float_morning,0) - coalesce(d.float_evening,0);
    v_cash_diff := round((coalesce(d.counted_cash,0) + pend_total - expected) * 100) / 100;
    v_card_diff := round((d.z_card - d.pos_settlement) * 100) / 100;
    if abs(v_card_diff) > 1 and coalesce(d.expl_card,'') = '' then
      raise exception 'A kártya-eltéréshez indoklás szükséges. / Diferența card necesită explicație.';
    end if;
  else
    if d.nexus_revenue is null then
      select amount into auto_rev from cash_nexus_rev where unit_id = p_unit and day = eday;
      if auto_rev is null then
        raise exception 'Hiányzik a gép szerinti árulás értéke (NEXUS szinkron).';
      end if;
      update cash_days set nexus_revenue = auto_rev where id = d.id;
      d.nexus_revenue := auto_rev;
    end if;
    v_cash_diff := round((coalesce(d.counted_cash,0) + exp_total + pend_total - d.nexus_revenue) * 100) / 100;
    v_card_diff := null;
  end if;

  if abs(coalesce(v_cash_diff,0)) > 1 and coalesce(d.expl_cash,'') = '' then
    raise exception 'A készpénz-eltéréshez indoklás szükséges. / Diferența de numerar necesită explicație.';
  end if;

  update cash_days set
    status = 'lezart', closed_by = app_current_person(), closed_at = now(),
    cash_diff = v_cash_diff, card_diff = v_card_diff
  where id = d.id;

  return jsonb_build_object('cash_diff', v_cash_diff, 'card_diff', v_card_diff);
end $$;

grant execute on function app_cash_can_edit_day(uuid, date) to authenticated;
grant execute on function app_cash_day_detail(uuid, date) to authenticated;
grant execute on function app_cash_reopen_day(uuid, date) to authenticated;
grant execute on function app_cash_save_day(uuid, jsonb, date) to authenticated;
grant execute on function app_cash_close_day(uuid, date) to authenticated;
