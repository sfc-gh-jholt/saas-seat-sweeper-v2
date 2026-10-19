-- Seat Sweeper V2 lab setup for one attendee account (ACCOUNTADMIN).
-- Run through setup.sh, which fills the <% %> names from a names file.
-- Safe to re-run: every statement is IF NOT EXISTS or an idempotent grant.
-- Nothing is replaced or dropped.

USE ROLE ACCOUNTADMIN;

CREATE DATABASE IF NOT EXISTS <% lab_db %>
  COMMENT = 'Seat Sweeper lab: synthetic data, pipeline, app and agent';
CREATE SCHEMA IF NOT EXISTS <% lab_db %>.RAW COMMENT = 'Synthetic source tables';
CREATE SCHEMA IF NOT EXISTS <% lab_db %>.APP COMMENT = 'Pipeline views, app service, AI objects';
CREATE SCHEMA IF NOT EXISTS <% lab_db %>.GOVERNANCE COMMENT = 'Network rules';

CREATE WAREHOUSE IF NOT EXISTS <% lab_wh %>
  WAREHOUSE_SIZE = 'XSMALL' AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Seat Sweeper lab SQL compute';

-- One role owns and runs the app. Attendees use ACCOUNTADMIN, which inherits it.
CREATE ROLE IF NOT EXISTS <% lab_role %> COMMENT = 'Seat Sweeper app: deploys and runs the app';
GRANT ROLE <% lab_role %> TO ROLE ACCOUNTADMIN;
GRANT USAGE ON WAREHOUSE <% lab_wh %> TO ROLE <% lab_role %>;
GRANT USAGE ON DATABASE <% lab_db %> TO ROLE <% lab_role %>;
GRANT USAGE ON SCHEMA <% lab_db %>.RAW TO ROLE <% lab_role %>;
GRANT USAGE ON SCHEMA <% lab_db %>.APP TO ROLE <% lab_role %>;
GRANT CREATE APPLICATION SERVICE, CREATE ARTIFACT REPOSITORY, CREATE STAGE
  ON SCHEMA <% lab_db %>.APP TO ROLE <% lab_role %>;
GRANT SELECT ON ALL TABLES IN SCHEMA <% lab_db %>.RAW TO ROLE <% lab_role %>;
GRANT SELECT ON FUTURE TABLES IN SCHEMA <% lab_db %>.RAW TO ROLE <% lab_role %>;
GRANT SELECT ON ALL VIEWS IN SCHEMA <% lab_db %>.APP TO ROLE <% lab_role %>;
GRANT SELECT ON FUTURE VIEWS IN SCHEMA <% lab_db %>.APP TO ROLE <% lab_role %>;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE <% lab_role %>;

-- Build-time egress only (npm install during the remote build).
CREATE NETWORK RULE IF NOT EXISTS <% lab_db %>.GOVERNANCE.BUILD_EGRESS
  MODE = EGRESS TYPE = HOST_PORT VALUE_LIST = ('registry.npmjs.org:443')
  COMMENT = 'Seat Sweeper build-only npm access';
CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS <% lab_build_eai %>
  ALLOWED_NETWORK_RULES = (<% lab_db %>.GOVERNANCE.BUILD_EGRESS) ENABLED = TRUE
  COMMENT = 'Seat Sweeper build egress only';
GRANT USAGE ON INTEGRATION <% lab_build_eai %> TO ROLE <% lab_role %>;

SELECT 'Setup complete' AS status, '<% lab_db %>' AS database_name,
  '<% lab_wh %>' AS warehouse, '<% lab_role %>' AS app_role, '<% lab_build_eai %>' AS build_eai;
