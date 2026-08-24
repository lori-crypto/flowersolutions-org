-- ============================================================
-- 13_stat_timeout.sql — Lekérdezési időkorlát emelése 30 mp-re
-- a bejelentkezett felhasználók számára (a 3 éves statisztikák
-- hideg-indítása nem fér bele az alap 8 mp-be a Micro gépen).
-- Idempotens.
-- ============================================================

alter role authenticated set statement_timeout = '30s';

-- gyorsítás: a statisztika mindig csak számlákat néz
create index if not exists sales_lines_fact_day
  on sales_lines(data_doc) where tip_doc = 'Factura';

-- a PostgREST vegye észre a beállítás-változást
notify pgrst, 'reload config';
