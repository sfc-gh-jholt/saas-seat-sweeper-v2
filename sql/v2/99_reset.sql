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

-- Postgres lives outside the lab database, so it must be torn down explicitly, mirror first.
-- drop_target_database also removes SEAT_SWEEPER_OPS_<suffix>. Dropping the instance deletes
-- its data permanently and stops its billing.
EXECUTE IMMEDIATE $$
BEGIN
  CALL SNOWFLAKE.POSTGRES.DROP_MIRROR(mirror_name => 'seat_sweeper_ops', drop_target_database => TRUE);
  RETURN 'mirror dropped';
EXCEPTION
  WHEN OTHER THEN RETURN 'no mirror to drop: ' || SQLERRM;
END;
$$;
DROP POSTGRES INSTANCE IF EXISTS SEAT_SWEEPER_PG;
DROP NETWORK POLICY IF EXISTS SEAT_SWEEPER_PG_POLICY;
DROP EXTERNAL ACCESS INTEGRATION IF EXISTS SEAT_SWEEPER_PG_EAI;

DROP DATABASE IF EXISTS SEAT_SWEEPER_LAB;
DROP EXTERNAL ACCESS INTEGRATION IF EXISTS SEAT_SWEEPER_BUILD_EAI;
DROP INTEGRATION IF EXISTS "Seat Sweeper";
DROP WAREHOUSE IF EXISTS SEAT_SWEEPER_WH;
DROP ROLE IF EXISTS SEAT_SWEEPER_APP;

-- Lab sign-in: the PAT and the allow-all network policy on your user, if you created them
-- with these names. A session signed in with that PAT cannot remove PATs, so if CoCo uses
-- the PAT, this reports "PAT not removed" and continues; remove the token in Snowsight
-- (your profile > Programmatic access tokens) or let it expire. Unsetting the policy
-- still stops it from signing in.
-- The policy is unset only if it is still the lab's, so a policy you set yourself is kept.
EXECUTE IMMEDIATE $$
DECLARE
  me STRING DEFAULT CURRENT_USER();
  policy STRING;
  pat_result STRING;
BEGIN
  BEGIN
    ALTER USER IDENTIFIER(:me) REMOVE PROGRAMMATIC ACCESS TOKEN SEAT_SWEEPER_LAB_PAT;
    pat_result := 'PAT removed';
  EXCEPTION
    WHEN OTHER THEN pat_result := 'PAT not removed: ' || SQLERRM;
  END;
  SHOW PARAMETERS LIKE 'NETWORK_POLICY' IN USER IDENTIFIER(:me);
  SELECT "value" INTO :policy FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
  IF (UPPER(policy) = 'SEAT_SWEEPER_LAB_ALLOW_ALL') THEN
    ALTER USER IDENTIFIER(:me) UNSET NETWORK_POLICY;
  END IF;
  DROP NETWORK POLICY IF EXISTS SEAT_SWEEPER_LAB_ALLOW_ALL;
  RETURN pat_result || '; allow-all policy removed';
END;
$$;

-- Verify: every line should return 0 rows.
SHOW DATABASES LIKE 'SEAT_SWEEPER%';
SHOW WAREHOUSES LIKE 'SEAT_SWEEPER_WH';
SHOW ROLES LIKE 'SEAT_SWEEPER_APP';
SHOW INTEGRATIONS LIKE 'SEAT_SWEEPER%';
SHOW POSTGRES INSTANCES LIKE 'SEAT_SWEEPER_PG';
SHOW NETWORK POLICIES LIKE 'SEAT_SWEEPER%';
SHOW USER PROGRAMMATIC ACCESS TOKENS;

-- Local files are not touched. For a truly fresh run, also delete your clone
-- (or run `git clean -fdx` inside it) so .env.local and node_modules are rebuilt,
-- remove the [seat_sweeper_pg] block from ~/.pg_service.conf and its ~/.pgpass lines,
-- and remove the lab PAT connection from ~/.snowflake/connections.toml (its token no longer signs in).
