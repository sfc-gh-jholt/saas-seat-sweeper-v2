-- Seat Sweeper seed for Postgres (chunk D). Run from the repo root:
--   psql "service=SEAT_SWEEPER_PG dbname=postgres" -f sql/v2/pg/11_seed.sql
-- The CSVs are the exact rows the Snowflake seed produced, so checks match.
-- Loads only when employees is empty, so re-running never duplicates rows.

SELECT (count(*) = 0) AS empty FROM public.employees \gset
\if :empty
  BEGIN;
  \copy public.employees       FROM 'sql/v2/pg/seed/employees.csv'       WITH (FORMAT csv, HEADER true)
  \copy public.contracts       FROM 'sql/v2/pg/seed/contracts.csv'       WITH (FORMAT csv, HEADER true)
  \copy public.assets          FROM 'sql/v2/pg/seed/assets.csv'          WITH (FORMAT csv, HEADER true)
  \copy public.employee_assets FROM 'sql/v2/pg/seed/employee_assets.csv' WITH (FORMAT csv, HEADER true)
  COMMIT;
\else
  \echo 'Seed skipped: data already loaded.'
\endif

SELECT 'EMPLOYEES' AS table_name, count(*) AS row_count FROM public.employees
UNION ALL SELECT 'CONTRACTS', count(*) FROM public.contracts
UNION ALL SELECT 'ASSETS', count(*) FROM public.assets
UNION ALL SELECT 'EMPLOYEE_ASSETS', count(*) FROM public.employee_assets
UNION ALL SELECT 'SEAT_ACTIONS', count(*) FROM public.seat_actions;
