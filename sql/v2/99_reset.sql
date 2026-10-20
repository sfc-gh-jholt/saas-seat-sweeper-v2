-- Seat Sweeper lab: DELETE EVERYTHING and return the account to blank.
-- Run as ACCOUNTADMIN. This cannot be undone (Time Travel aside).
-- Default names come from names.default.env; edit below if you changed them.
--
-- Dropping the database removes everything inside it: the app service, artifact
-- repository, stages and PDFs, dynamic tables, stream, task, alert, semantic view,
-- Cortex Search service, agent, network rule, and event data scoped to the app.
-- LAB_WH and ATTENDEE_ROLE are provided by the account, so they are kept.

USE ROLE ACCOUNTADMIN;

-- Stop the app first so no new queries start mid-drop.
ALTER APPLICATION SERVICE IF EXISTS SEAT_SWEEPER_LAB.APP.SEAT_SWEEPER SUSPEND;

DROP DATABASE IF EXISTS SEAT_SWEEPER_LAB;
DROP EXTERNAL ACCESS INTEGRATION IF EXISTS SEAT_SWEEPER_BUILD_EAI;
DROP WAREHOUSE IF EXISTS SEAT_SWEEPER_WH;
DROP ROLE IF EXISTS SEAT_SWEEPER_APP;

-- Verify: every line should return 0 rows.
SHOW DATABASES LIKE 'SEAT_SWEEPER_LAB';
SHOW WAREHOUSES LIKE 'SEAT_SWEEPER_WH';
SHOW ROLES LIKE 'SEAT_SWEEPER_APP';
SHOW INTEGRATIONS LIKE 'SEAT_SWEEPER_BUILD_EAI';

-- Local files are not touched. For a truly fresh run, also delete your clone
-- (or run `git clean -fdx` inside it) so .env.local and node_modules are rebuilt.
