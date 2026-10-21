-- Seat Sweeper on Postgres, chunk E: stable OPS views over the Postgres mirror.
-- Run after the mirror's tables are all REPLICATING:
--   CALL SNOWFLAKE.POSTGRES.LIST_MIRRORED_TABLES('<mirror name>');
-- The mirror target database gets a new suffix every run (a dropped name cannot be reused),
-- so only this file names it. DTs, checks and the semantic view read <% lab_db %>.OPS.* only.
--   snow sql --connection <conn> -D lab_db=<db> -D lab_role=<role> -D mirror_db=<db> -f sql/v2/05_ops_views.sql
-- Views read the mirror's base tables, not the $LIVE views. CHANGE_TRACKING lets downstream
-- DTs refresh INCREMENTAL; set REFRESH_MODE = INCREMENTAL explicitly (AUTO picks FULL for joins).

USE ROLE ACCOUNTADMIN;

CREATE SCHEMA IF NOT EXISTS <% lab_db %>.OPS COMMENT = 'Stable names over the Postgres mirror';

CREATE OR REPLACE VIEW <% lab_db %>.OPS.EMPLOYEES CHANGE_TRACKING = TRUE
  AS SELECT * FROM <% mirror_db %>.PUBLIC.EMPLOYEES;
CREATE OR REPLACE VIEW <% lab_db %>.OPS.CONTRACTS CHANGE_TRACKING = TRUE
  AS SELECT * FROM <% mirror_db %>.PUBLIC.CONTRACTS;
CREATE OR REPLACE VIEW <% lab_db %>.OPS.ASSETS CHANGE_TRACKING = TRUE
  AS SELECT * FROM <% mirror_db %>.PUBLIC.ASSETS;
CREATE OR REPLACE VIEW <% lab_db %>.OPS.EMPLOYEE_ASSETS CHANGE_TRACKING = TRUE
  AS SELECT * FROM <% mirror_db %>.PUBLIC.EMPLOYEE_ASSETS;
CREATE OR REPLACE VIEW <% lab_db %>.OPS.SEAT_ACTIONS CHANGE_TRACKING = TRUE
  AS SELECT * FROM <% mirror_db %>.PUBLIC.SEAT_ACTIONS;

-- Same access shape as RAW: the app role reads directly, and PUBLIC covers caller's rights
-- (the semantic view joins OPS.CONTRACTS as the signed-in user).
GRANT USAGE ON SCHEMA <% lab_db %>.OPS TO ROLE <% lab_role %>;
GRANT USAGE ON SCHEMA <% lab_db %>.OPS TO ROLE PUBLIC;
GRANT SELECT ON ALL VIEWS IN SCHEMA <% lab_db %>.OPS TO ROLE <% lab_role %>;
GRANT SELECT ON ALL VIEWS IN SCHEMA <% lab_db %>.OPS TO ROLE PUBLIC;

SELECT 'EMPLOYEES' AS view_name, COUNT(*) AS row_count FROM <% lab_db %>.OPS.EMPLOYEES
UNION ALL SELECT 'CONTRACTS', COUNT(*) FROM <% lab_db %>.OPS.CONTRACTS
UNION ALL SELECT 'ASSETS', COUNT(*) FROM <% lab_db %>.OPS.ASSETS
UNION ALL SELECT 'EMPLOYEE_ASSETS', COUNT(*) FROM <% lab_db %>.OPS.EMPLOYEE_ASSETS
UNION ALL SELECT 'SEAT_ACTIONS', COUNT(*) FROM <% lab_db %>.OPS.SEAT_ACTIONS;
