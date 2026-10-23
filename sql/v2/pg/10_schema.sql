-- Seat Sweeper on Snowflake Postgres (chunk C): the app's system of record.
-- Run as snowflake_admin: psql "service=seat_sweeper_pg dbname=postgres" -f sql/v2/pg/10_schema.sql
-- Safe to re-run. Every table has a primary key so the mirror replicates UPDATE and DELETE.

CREATE TABLE IF NOT EXISTS public.employees (
  emp_id      integer PRIMARY KEY,
  name        varchar(100) NOT NULL,
  department  varchar(50)  NOT NULL,
  manager_id  integer,
  email       varchar(120)
);

CREATE TABLE IF NOT EXISTS public.contracts (
  contract_id  integer PRIMARY KEY,
  vendor_name  varchar(100) NOT NULL,
  renewal_date date,
  auto_renew   boolean
);

CREATE TABLE IF NOT EXISTS public.assets (
  asset_id              integer PRIMARY KEY,
  asset_name            varchar(100)  NOT NULL,
  monthly_cost_per_seat numeric(10,2) NOT NULL,
  asset_type            varchar(20)   NOT NULL,  -- 'License' or 'Hardware'
  contract_id           integer REFERENCES public.contracts (contract_id)
);

CREATE TABLE IF NOT EXISTS public.employee_assets (
  emp_id           integer NOT NULL REFERENCES public.employees (emp_id),
  asset_id         integer NOT NULL REFERENCES public.assets (asset_id),
  last_active_date date,
  status           varchar(20) NOT NULL DEFAULT 'Active',
  PRIMARY KEY (emp_id, asset_id)
);

-- Written by the app: one row per Reclaim / Keep decision.
CREATE TABLE IF NOT EXISTS public.seat_actions (
  action_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  emp_id     integer     NOT NULL,
  asset_id   integer     NOT NULL,
  decision   varchar(10) NOT NULL CHECK (decision IN ('reclaim', 'keep')),
  note       varchar(500),
  actor      varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (emp_id, asset_id) REFERENCES public.employee_assets (emp_id, asset_id)
);
CREATE INDEX IF NOT EXISTS seat_actions_created_at ON public.seat_actions (created_at DESC);

-- Least privilege for the app's login. The managed `application` role is not used: Snowflake makes it a
-- member of snowflake_write, so it can modify and truncate every table regardless of grants here.
-- The app logs in as seat_sweeper_app instead: read the seed tables, append decisions, nothing else.
-- It is created without LOGIN; scripts/pg_setup.py sets its password and enables login.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'seat_sweeper_app') THEN
    CREATE ROLE seat_sweeper_app NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO seat_sweeper_app;
GRANT SELECT ON public.employees, public.contracts, public.assets, public.employee_assets TO seat_sweeper_app;
GRANT SELECT, INSERT ON public.seat_actions TO seat_sweeper_app;
REVOKE CREATE ON SCHEMA public FROM seat_sweeper_app;
