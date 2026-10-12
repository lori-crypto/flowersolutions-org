-- ============================================================
-- 26_penztar_ellenorzes.sql — Pénztár 4. kör: vezetői ellenőrzés.
--  • app_cash_review: lezárt nap elfogadása / visszaküldése megjegyzéssel
--  • visszaküldéskor a kolléga újra szerkesztheti és újra lezárhatja
-- Idempotens. Előfeltétel: 25.
-- ============================================================

create or replace function app_cash_review(p_day_id uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if not app_has_cap('hr') then raise exception 'Nincs jogosultság.'; end if;
  select status into st from cash_days where id = p_day_id;
  if st is null then raise exception 'Nincs ilyen zárás.'; end if;
  if p_action = 'elfogad' then
    if st not in ('lezart') then raise exception 'Csak lezárt nap fogadható el.'; end if;
    update cash_days set status = 'elfogadva', review_note = nullif(p_note,''),
      reviewed_by = app_current_person(), reviewed_at = now() where id = p_day_id;
  elsif p_action = 'visszakuld' then
    if st not in ('lezart','elfogadva') then raise exception 'Csak lezárt nap küldhető vissza.'; end if;
    if coalesce(p_note,'') = '' then raise exception 'A visszaküldéshez megjegyzés szükséges.'; end if;
    update cash_days set status = 'visszakuldve', review_note = p_note,
      reviewed_by = app_current_person(), reviewed_at = now() where id = p_day_id;
  else
    raise exception 'Ismeretlen művelet.';
  end if;
end $$;

grant execute on function app_cash_review(uuid, text, text) to authenticated;
