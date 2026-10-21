-- Seat Sweeper on Postgres, chunk F: let the deployed app reach the Postgres instance.
-- Run through setup.sh (fills <% %> names). Needs the instance host.
-- Two directions:
--   Postgres side: open to any IP. Lab choice: attendee IPs change and venue networks vary.
--     Access still needs the Postgres password and TLS. Narrow VALUE_LIST for anything real.
--   App side: the app may connect out only to this instance on 5432.

USE ROLE ACCOUNTADMIN;

-- Postgres ingress: any IPv4 address (psql from anywhere, and the app's Snowflake egress).
-- Rules are created once, then ALTERed: an attached rule cannot be replaced, so CREATE OR REPLACE
-- would fail on every re-run.
CREATE NETWORK RULE IF NOT EXISTS <% lab_db %>.GOVERNANCE.PG_INGRESS_ANY
  TYPE = IPV4 MODE = POSTGRES_INGRESS VALUE_LIST = ('0.0.0.0/0')
  COMMENT = 'Lab only: any IP; password + TLS still required';
ALTER NETWORK RULE <% lab_db %>.GOVERNANCE.PG_INGRESS_ANY SET VALUE_LIST = ('0.0.0.0/0');
CREATE NETWORK POLICY IF NOT EXISTS SEAT_SWEEPER_PG_POLICY
  ALLOWED_NETWORK_RULE_LIST = ('<% lab_db %>.GOVERNANCE.PG_INGRESS_ANY')
  COMMENT = 'Seat Sweeper Postgres ingress (open, lab only)';
ALTER NETWORK POLICY SEAT_SWEEPER_PG_POLICY SET
  ALLOWED_NETWORK_RULE_LIST = ('<% lab_db %>.GOVERNANCE.PG_INGRESS_ANY');
DROP NETWORK RULE IF EXISTS <% lab_db %>.GOVERNANCE.PG_INGRESS_OPERATOR;
DROP NETWORK RULE IF EXISTS <% lab_db %>.GOVERNANCE.PG_INGRESS_SNOWFLAKE;
ALTER POSTGRES INSTANCE <% pg_instance %> SET NETWORK_POLICY = 'SEAT_SWEEPER_PG_POLICY';

-- App egress: only this host and port. ALTER keeps the rule current if the host ever changes.
CREATE NETWORK RULE IF NOT EXISTS <% lab_db %>.GOVERNANCE.PG_EGRESS
  MODE = EGRESS TYPE = HOST_PORT VALUE_LIST = ('<% pg_host %>:5432')
  COMMENT = 'Seat Sweeper app to its Postgres instance';
ALTER NETWORK RULE <% lab_db %>.GOVERNANCE.PG_EGRESS SET VALUE_LIST = ('<% pg_host %>:5432');
CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS SEAT_SWEEPER_PG_EAI
  ALLOWED_NETWORK_RULES = (<% lab_db %>.GOVERNANCE.PG_EGRESS) ENABLED = TRUE
  COMMENT = 'Seat Sweeper runtime egress to Postgres only';
GRANT USAGE ON INTEGRATION SEAT_SWEEPER_PG_EAI TO ROLE <% lab_role %>;
-- The app's secrets live in GOVERNANCE; the role needs schema usage to resolve them at deploy.
GRANT USAGE ON SCHEMA <% lab_db %>.GOVERNANCE TO ROLE <% lab_role %>;

-- The app's Postgres login (secret PG_APP_LOGIN) is created by scripts/pg_setup.py secret,
-- which reads the generated password from ~/.pgpass so it is never typed or printed.

SELECT 'Postgres access ready' AS status, '<% pg_host %>' AS pg_host;
