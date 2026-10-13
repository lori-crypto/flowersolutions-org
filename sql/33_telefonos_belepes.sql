-- ============================================================
-- 33_telefonos_belepes.sql — Belépés telefonszámmal:
-- a belépő mezőbe írt telefonszámhoz megkeressük a fiók emailjét
-- (a tényleges hitelesítés változatlanul email+jelszó).
-- Csak az email címet adja vissza, és csak pontos szám-egyezésre.
-- Idempotens. Előfeltétel: 01.
-- ============================================================

create or replace function app_login_email_for_phone(p_phone text)
returns text language sql stable security definer set search_path = public as $$
  select p.email from persons p
  where p.active
    and p.email is not null
    and p.user_id is not null
    and length(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')) >= 6
    and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')
        = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  limit 1
$$;

grant execute on function app_login_email_for_phone(text) to anon, authenticated;
