-- ============================================================
-- 25_penztar_naplo.sql — Pénztár 3. kör: cégszintű pénztárnapló.
--  • app_cash_balance: kezdő + pillanatnyi egyenleg
--  • app_cash_ledger: időszak tételei (zárások + vezetői tételek)
--  • app_cash_quick_add: vezetői gyorsrögzítés (letét/költség/korrekció)
--  • bizonylatok Storage bucket + szabályok
--  • admin írás-szabályok a tételekre
-- Egyenleg-logika: kezdő egyenleg + lezárt napok átadott készpénze
-- − banki letétek − vezetői költségek ± korrekciók. A zárásokhoz
-- tartozó (kasszából fizetett) költségek NEM érintik: azok már a
-- leadott készpénzen kívül vannak.
-- Idempotens. Előfeltétel: 24.
-- ============================================================

-- admin közvetlen írás a vezetői tételekhez és beállításokhoz
drop policy if exists ce_adm_write on cash_expenses;
create policy ce_adm_write on cash_expenses for all to authenticated
  using (app_is_admin()) with check (app_is_admin());

-- ── Egyenleg ────────────────────────────────────────────────
create or replace function app_cash_balance()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s cash_settings%rowtype;
  inflow numeric; outflow numeric;
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  select * into s from cash_settings where id = 1;
  select coalesce(sum(d.counted_cash),0) into inflow
  from cash_days d
  where d.status in ('lezart','elfogadva') and d.day >= s.opening_date;
  select coalesce(sum(case e.kind
           when 'letet' then e.amount
           when 'koltseg' then e.amount
           else -e.amount end),0) into outflow
  from cash_expenses e
  where e.day_id is null and e.day >= s.opening_date;
  return jsonb_build_object(
    'opening_balance', s.opening_balance,
    'opening_date', s.opening_date,
    'balance', round((s.opening_balance + inflow - outflow) * 100) / 100
  );
end $$;

-- ── Napló: időszak tételei ──────────────────────────────────
create or replace function app_cash_ledger(p_from date, p_to date)
returns table(entry_date date, etype text, unit_name text, label text,
              amount numeric, receipt_path text, who text, status text, expl text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  return query
  select d.day, 'zaras'::text,
         cu.name_hu,
         'napi zárás'::text,
         coalesce(d.counted_cash,0),
         null::text,
         (select p.name from persons p where p.id = d.closed_by),
         d.status,
         d.expl_cash
  from cash_days d join cash_units cu on cu.id = d.unit_id
  where d.day between p_from and p_to
  union all
  select e.day, e.kind,
         (select cu.name_hu from cash_units cu where cu.id = e.unit_id),
         coalesce(e.description, case e.kind when 'letet' then 'banki letét' else e.kind end),
         case e.kind when 'korrekcio' then e.amount else -e.amount end,
         e.receipt_path,
         (select p.name from persons p where p.id = e.created_by),
         null::text,
         e.note
  from cash_expenses e
  where e.day_id is null and e.day between p_from and p_to
  order by 1 desc, 2;
end $$;

-- ── Vezetői gyorsrögzítés ───────────────────────────────────
create or replace function app_cash_quick_add(
  p_day date, p_kind text, p_amount numeric,
  p_unit uuid default null, p_category uuid default null,
  p_vehicle uuid default null, p_client text default null,
  p_desc text default null, p_note text default null,
  p_receipt text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  if p_kind not in ('letet','koltseg','korrekcio') then raise exception 'Ismeretlen típus.'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Hiányzó összeg.'; end if;
  insert into cash_expenses (day_id, unit_id, day, kind, amount, category_id,
                             vehicle_id, client_name, description, note,
                             receipt_path, created_by)
  values (null, p_unit, p_day, p_kind, p_amount, p_category,
          p_vehicle, nullif(p_client,''), nullif(p_desc,''), nullif(p_note,''),
          nullif(p_receipt,''), app_current_person())
  returning id into rid;
  return rid;
end $$;

grant execute on function app_cash_balance() to authenticated;
grant execute on function app_cash_ledger(date, date) to authenticated;
grant execute on function app_cash_quick_add(date, text, numeric, uuid, uuid, uuid, text, text, text, text) to authenticated;

-- ── Bizonylatok tárolása (Storage) ──────────────────────────
insert into storage.buckets (id, name, public)
values ('bizonylatok', 'bizonylatok', false)
on conflict (id) do nothing;

drop policy if exists bizonylat_hr_all on storage.objects;
create policy bizonylat_hr_all on storage.objects for all to authenticated
  using (bucket_id = 'bizonylatok' and app_has_cap('hr'))
  with check (bucket_id = 'bizonylatok' and app_has_cap('hr'));
