-- ============================================================
-- 07_persons_hr.sql — A személyek kezelését a HR is végezheti
-- (eddig csak admin). Idempotens. Adminként enélkül is működik,
-- akkor kell, ha HR-képességű kolléga is kezel majd személyeket.
-- ============================================================

drop policy if exists persons_admin_write on persons;
drop policy if exists persons_hr_write on persons;
create policy persons_hr_write on persons for all to authenticated
  using (app_has_cap('hr')) with check (app_has_cap('hr'));
