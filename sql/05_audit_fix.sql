-- ============================================================
-- 05_audit_fix.sql — app_audit: működjön id oszlop nélküli
-- táblákon is (pl. leave_quotas, ahol a kulcs person_id+year).
-- Idempotens; ez javítja az „record "new" has no field "id"” hibát.
-- ============================================================

create or replace function app_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (person_id, table_name, row_id, action, after)
    values (app_current_person(), tg_table_name, to_jsonb(new)->>'id', 'insert', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into audit_log (person_id, table_name, row_id, action, before, after)
    values (app_current_person(), tg_table_name, to_jsonb(new)->>'id', 'update', to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into audit_log (person_id, table_name, row_id, action, before)
    values (app_current_person(), tg_table_name, to_jsonb(old)->>'id', 'delete', to_jsonb(old));
    return old;
  end if;
end $$;
