-- ============================================================
-- 24_casa_szinkron.sql — Pénztár 2. kör: a lerakat napi bevétele
-- a NEXUS Casa in lei naplójából (incasari_plati) automatikusan.
--  • cash_nexus_rev: szinkronizált napi összegek egységenként
--  • app_cash_context: visszaadja a mai NEXUS-összeget is
--  • app_cash_close_day: ha nincs kézi érték, a szinkronizáltat használja
--  • pg_cron: 2 óránkénti frissítés (cseréld az IDE_A_CRON_SECRET-et!)
-- Idempotens. Előfeltétel: 23.
-- ============================================================

create table if not exists cash_nexus_rev (
  unit_id   uuid not null references cash_units(id) on delete cascade,
  day       date not null,
  amount    numeric not null,
  synced_at timestamptz not null default now(),
  primary key (unit_id, day)
);

alter table cash_nexus_rev enable row level security;
drop policy if exists cnr_sel on cash_nexus_rev;
create policy cnr_sel on cash_nexus_rev for select to authenticated using (true);
-- írás csak service-kulccsal (a szinkron végpont)

-- ── Kontextus: + a mai NEXUS-bevétel ────────────────────────
create or replace function app_cash_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := app_current_person();
  today date := (now() at time zone 'Europe/Bucharest')::date;
  res jsonb;
begin
  if not (app_has_cap('penztar') or app_has_cap('hr')) then
    raise exception 'Nincs jogosultság.';
  end if;
  select jsonb_build_object(
    'today', today,
    'units', coalesce(jsonb_agg(u order by u->>'sort'), '[]'::jsonb)
  ) into res
  from (
    select jsonb_build_object(
      'id', cu.id, 'code', cu.code, 'name_hu', cu.name_hu, 'name_ro', cu.name_ro,
      'kind', cu.kind, 'sort', cu.sort,
      'nexus_today', (
        select r.amount from cash_nexus_rev r where r.unit_id = cu.id and r.day = today
      ),
      'nexus_synced_at', (
        select to_char(r.synced_at at time zone 'Europe/Bucharest', 'HH24:MI')
        from cash_nexus_rev r where r.unit_id = cu.id and r.day = today
      ),
      'today_day', (
        select to_jsonb(d) from cash_days d
        where d.unit_id = cu.id and d.day = today
      ),
      'monetar', (
        select coalesce(jsonb_agg(jsonb_build_object('denom', m.denom, 'qty', m.qty)), '[]'::jsonb)
        from cash_monetar m
        join cash_days d on d.id = m.day_id
        where d.unit_id = cu.id and d.day = today
      ),
      'expenses', (
        select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
        from cash_expenses e
        join cash_days d on d.id = e.day_id
        where d.unit_id = cu.id and d.day = today
      ),
      'history', case when cu.kind = 'lerakat' then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'day', d.day, 'status', d.status, 'counted_cash', d.counted_cash,
          'nexus_revenue', d.nexus_revenue, 'cash_diff', d.cash_diff,
          'expl_cash', d.expl_cash,
          'expenses_total', (select coalesce(sum(e.amount),0) from cash_expenses e where e.day_id = d.id),
          'closed_by_name', (select p.name from persons p where p.id = d.closed_by)
        ) order by d.day desc), '[]'::jsonb)
        from cash_days d
        where d.unit_id = cu.id and d.day >= today - 5 and d.day < today
      ) else '[]'::jsonb end
    ) as u
    from cash_units cu
    where cu.active
      and (app_has_cap('hr') or exists (
        select 1 from cash_unit_members m where m.unit_id = cu.id and m.person_id = me))
  ) s;
  return res;
end $$;

-- ── Lezárás: NEXUS-érték automatikus használata ─────────────
create or replace function app_cash_close_day(p_unit uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  d cash_days%rowtype;
  ukind text;
  exp_total numeric;
  expected numeric;
  v_cash_diff numeric;
  v_card_diff numeric;
  auto_rev numeric;
begin
  if not app_cash_member_of(p_unit) then raise exception 'Nincs jogosultság ehhez az egységhez.'; end if;
  select * into d from cash_days where unit_id = p_unit and day = today;
  if d.id is null then raise exception 'Előbb mentsd el a napot.'; end if;
  if d.status in ('lezart','elfogadva') then raise exception 'A nap már le van zárva.'; end if;
  select kind into ukind from cash_units where id = p_unit;
  select coalesce(sum(amount),0) into exp_total from cash_expenses where day_id = d.id;

  if coalesce(d.counted_cash,0) = 0 then
    raise exception 'Hiányzik a készpénz megszámolása (monetár).';
  end if;

  if ukind = 'bolt' then
    if d.z_cash is null or d.z_card is null or d.pos_settlement is null then
      raise exception 'Hiányzó Z-jelentés vagy POS érték.';
    end if;
    expected := d.z_cash - exp_total + coalesce(d.float_morning,0) - coalesce(d.float_evening,0);
    v_cash_diff := round((coalesce(d.counted_cash,0) - expected) * 100) / 100;
    v_card_diff := round((d.z_card - d.pos_settlement) * 100) / 100;
    if abs(v_card_diff) > 1 and coalesce(d.expl_card,'') = '' then
      raise exception 'A kártya-eltéréshez indoklás szükséges. / Diferența card necesită explicație.';
    end if;
  else
    if d.nexus_revenue is null then
      select amount into auto_rev from cash_nexus_rev where unit_id = p_unit and day = today;
      if auto_rev is null then
        raise exception 'Hiányzik a gép szerinti árulás értéke (NEXUS szinkron).';
      end if;
      update cash_days set nexus_revenue = auto_rev where id = d.id;
      d.nexus_revenue := auto_rev;
    end if;
    v_cash_diff := round((coalesce(d.counted_cash,0) + exp_total - d.nexus_revenue) * 100) / 100;
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

grant execute on function app_cash_context() to authenticated;
grant execute on function app_cash_close_day(uuid) to authenticated;

-- ── pg_cron: Casa-szinkron 2 óránként ───────────────────────
-- FONTOS: futtatás előtt cseréld az IDE_A_CRON_SECRET szöveget a CRON_SECRET-re!
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'sync-casa-2h') then
    perform cron.unschedule('sync-casa-2h');
  end if;
end $do$;

select cron.schedule('sync-casa-2h', '40 */2 * * *', $$
  select net.http_get(
    url := 'https://org.flowersolutions.ro/api/casa-sync?secret=IDE_A_CRON_SECRET',
    timeout_milliseconds := 300000);
$$);
