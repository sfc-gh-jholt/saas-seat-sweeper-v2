-- RECOVERY CHECKPOINT: fresh objects only, after participant approval.
-- If any target exists, STOP and inspect its definition. Do not replace a live
-- view or drop a partial pipeline just to run this file again.
-- Run from repository root with explicit lab_db, lab_wh and lab_role variables.
-- Creates two incremental DTs and the existing seven-column app interface.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE <% lab_wh %>;

CREATE DYNAMIC TABLE <% lab_db %>.APP.DT_SEAT_ASSIGNMENTS
  TARGET_LAG = DOWNSTREAM
  WAREHOUSE = <% lab_wh %>
  REFRESH_MODE = INCREMENTAL
  INITIALIZE = ON_CREATE
  COMMENT = 'seat-sweeper-structured-v2: enriched assignments; no eligibility filter'
AS
SELECT
  ea.emp_id,
  ea.asset_id,
  c.contract_id,
  COALESCE(c.vendor_name, a.asset_name) AS vendor_name,
  c.contract_id IS NOT NULL AS has_contract,
  e.department,
  ea.status,
  ea.last_active_date,
  a.monthly_cost_per_seat
FROM <% lab_db %>.RAW.EMPLOYEE_ASSETS ea
JOIN <% lab_db %>.RAW.EMPLOYEES e ON e.emp_id = ea.emp_id
JOIN <% lab_db %>.RAW.ASSETS a ON a.asset_id = ea.asset_id
LEFT JOIN <% lab_db %>.RAW.CONTRACTS c ON c.contract_id = a.contract_id;

-- CURRENT_DATE stays in WHERE, not SELECT. Eligibility advances at refresh
-- time even as the source dates age. TARGET_LAG is a freshness target, not cron.
CREATE DYNAMIC TABLE <% lab_db %>.APP.DT_VENDOR_OPPORTUNITY
  TARGET_LAG = '1 minute'
  WAREHOUSE = <% lab_wh %>
  REFRESH_MODE = INCREMENTAL
  INITIALIZE = ON_CREATE
  COMMENT = 'seat-sweeper-structured-v2: inactive paid opportunity by contract/vendor/department'
AS
SELECT
  contract_id,
  vendor_name,
  has_contract,
  department,
  COUNT(*) AS inactive_seats,
  SUM(monthly_cost_per_seat) AS monthly_opportunity
FROM <% lab_db %>.APP.DT_SEAT_ASSIGNMENTS
WHERE status = 'Inactive'
  AND last_active_date <= DATEADD('day', -30, CURRENT_DATE())
  AND monthly_cost_per_seat > 0
GROUP BY contract_id, vendor_name, has_contract, department;

CREATE VIEW <% lab_db %>.APP.V_VENDOR_OPPORTUNITY
  COMMENT = 'seat-sweeper-structured-v2: app and semantic view interface; not realized savings'
AS
SELECT contract_id, vendor_name, has_contract, department, inactive_seats,
       monthly_opportunity, monthly_opportunity * 12 AS annualized_opportunity
FROM <% lab_db %>.APP.DT_VENDOR_OPPORTUNITY;

GRANT SELECT ON VIEW <% lab_db %>.APP.V_VENDOR_OPPORTUNITY TO ROLE <% lab_role %>;

SHOW DYNAMIC TABLES IN SCHEMA <% lab_db %>.APP;
