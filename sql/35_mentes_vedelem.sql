-- ============================================================
-- 35_mentes_vedelem.sql — Pénztár: felülírás-védelem a napi zárás mentésénél
--
-- Előzmény: két eszköz / két fül ugyanazt a napot szerkesztette, és a
-- később mentő (elavult állapotú) fül kitörölte a másik beírását, mert a
-- mentés a teljes napot cseréli. Mostantól:
--   • cash_days.updated_at — minden módosításkor frissül (trigger)
--   • app_cash_save_day(..., p_expected) — a kliens elküldi, melyik
--     verziót látta utoljára; ha közben más mentett, a függvény
--     'STALE:' hibával visszautasítja, és a kliens a friss adatot tölti be
--     (a saját beírását piszkozatként megőrzi).
--   • a függvény jsonb-t ad vissza: {id, updated_at} — a kliens ebből
--     frissíti a saját verzióját.
-- Idempotens. Előfeltétel: 29 (p_day), 31, 34.
-- ============================================================

alter table cash_days add column if not exists updated_at timestamptz not null default now();

create or replace function cash_days_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cash_days_touch on cash_days;
create trigger cash_days_touch before update on cash_days
  for each row execute function cash_days_touch();

-- ── Mentés verzió-ellenőrzéssel ─────────────────────────────
drop function if exists app_cash_save_day(uuid, jsonb, date);
create or replace function app_cash_save_day(p_unit uuid, p_payload jsonb,
                                             p_day date default null,
                                             p_expected timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eday date := coalesce(p_day, (now() at time zone 'Europe/Bucharest')::date);
  did uuid;
  cur_ver timestamptz;
  cur_status text;
  counted numeric := 0;
  m jsonb; e jsonb; pj jsonb;
begin
  if not app_cash_can_edit_day(p_unit, eday) then raise exception 'Nincs jogosultság ehhez a naphoz.'; end if;

  select id, updated_at, status into did, cur_ver, cur_status
    from cash_days where unit_id = p_unit and day = eday for update;
  if did is null then
    insert into cash_days (unit_id, day) values (p_unit, eday) returning id, updated_at, status into did, cur_ver, cur_status;
  elsif p_expected is not null
        and abs(extract(epoch from (cur_ver - p_expected))) > 0.001 then
    -- valaki más mentett azóta, hogy ez a kliens betöltötte a napot
    raise exception 'STALE: A napot közben másik eszközön módosították. / Ziua a fost modificată între timp pe alt dispozitiv.';
  end if;
  if cur_status in ('lezart','elfogadva') then
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
  where id = did
  returning updated_at into cur_ver;

  return jsonb_build_object('id', did, 'updated_at', cur_ver);
end $$;

grant execute on function app_cash_save_day(uuid, jsonb, date, timestamptz) to authenticated;
