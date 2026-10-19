-- Seat Sweeper V2 seed: synthetic employees, contracts, assets, assignments.
-- Run through setup.sh after 00_setup.sql. Tables are created if missing and
-- loaded only when EMPLOYEES is empty, so re-running never duplicates data.
-- HASH-based picks give every account the same data. Totals still grow day by
-- day as more seats pass 30 inactive days, so compare app and checks same day.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE <% lab_wh %>;
USE SCHEMA <% lab_db %>.RAW;

CREATE TABLE IF NOT EXISTS EMPLOYEES (
  emp_id        NUMBER PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  department    VARCHAR(50)  NOT NULL,
  manager_id    NUMBER,
  email         VARCHAR(120)
);
CREATE TABLE IF NOT EXISTS CONTRACTS (
  contract_id          NUMBER PRIMARY KEY,
  vendor_name          VARCHAR(100) NOT NULL,
  renewal_date         DATE,
  auto_renew           BOOLEAN
);
CREATE TABLE IF NOT EXISTS ASSETS (
  asset_id              NUMBER PRIMARY KEY,
  asset_name            VARCHAR(100) NOT NULL,
  monthly_cost_per_seat NUMBER(10,2) NOT NULL,
  asset_type            VARCHAR(20)  NOT NULL,  -- 'License' or 'Hardware'
  contract_id           NUMBER REFERENCES CONTRACTS(contract_id)
);
CREATE TABLE IF NOT EXISTS EMPLOYEE_ASSETS (
  emp_id            NUMBER NOT NULL REFERENCES EMPLOYEES(emp_id),
  asset_id          NUMBER NOT NULL REFERENCES ASSETS(asset_id),
  last_active_date  DATE,
  status            VARCHAR(20) DEFAULT 'Active',
  PRIMARY KEY (emp_id, asset_id)
);

EXECUTE IMMEDIATE $$
DECLARE
  loaded NUMBER;
BEGIN
  SELECT COUNT(*) INTO :loaded FROM EMPLOYEES;
  IF (loaded > 0) THEN
    RETURN 'Seed skipped: data already loaded.';
  END IF;

INSERT INTO EMPLOYEES
SELECT
  SEQ4() + 1 AS emp_id,
  'Employee ' || LPAD(SEQ4() + 1, 4, '0') AS name,
  'Engineering' AS department,
  NULL AS manager_id,
  'emp' || LPAD(SEQ4() + 1, 4, '0') || '@company.com' AS email
FROM TABLE(GENERATOR(ROWCOUNT => 400))
UNION ALL
SELECT
  SEQ4() + 401,
  'Employee ' || LPAD(SEQ4() + 401, 4, '0'),
  'Sales',
  NULL,
  'emp' || LPAD(SEQ4() + 401, 4, '0') || '@company.com'
FROM TABLE(GENERATOR(ROWCOUNT => 400))
UNION ALL
SELECT
  SEQ4() + 801,
  'Employee ' || LPAD(SEQ4() + 801, 4, '0'),
  'Marketing',
  NULL,
  'emp' || LPAD(SEQ4() + 801, 4, '0') || '@company.com'
FROM TABLE(GENERATOR(ROWCOUNT => 400))
UNION ALL
SELECT
  SEQ4() + 1201,
  'Employee ' || LPAD(SEQ4() + 1201, 4, '0'),
  'Finance',
  NULL,
  'emp' || LPAD(SEQ4() + 1201, 4, '0') || '@company.com'
FROM TABLE(GENERATOR(ROWCOUNT => 400))
UNION ALL
SELECT
  SEQ4() + 1601,
  'Employee ' || LPAD(SEQ4() + 1601, 4, '0'),
  'Operations',
  NULL,
  'emp' || LPAD(SEQ4() + 1601, 4, '0') || '@company.com'
FROM TABLE(GENERATOR(ROWCOUNT => 400));

-- Assign manager_id: first employee in each department is the manager (self-reference avoided).
UPDATE EMPLOYEES SET manager_id = CASE
  WHEN department = 'Engineering' THEN 1
  WHEN department = 'Sales'       THEN 401
  WHEN department = 'Marketing'   THEN 801
  WHEN department = 'Finance'     THEN 1201
  WHEN department = 'Operations'  THEN 1601
END
WHERE emp_id <> 1 AND emp_id <> 401 AND emp_id <> 801 AND emp_id <> 1201 AND emp_id <> 1601;

-- Managers have no manager_id.
UPDATE EMPLOYEES SET manager_id = NULL WHERE emp_id IN (1, 401, 801, 1201, 1601);

-- ---------------------------------------------------------------------
-- CONTRACTS: structured register metadata only.
-- Clauses enter through packaged PDFs and the document pipeline, never this seed.
-- ---------------------------------------------------------------------

INSERT INTO CONTRACTS (contract_id, vendor_name, renewal_date, auto_renew)
SELECT column1, column2, column3::DATE, column4 FROM VALUES
(1, 'GitHub Copilot Enterprise', '2026-03-15', TRUE),

(2, 'Figma Enterprise', '2026-07-01', TRUE),

(3, 'Datadog Pro', '2026-01-31', FALSE),

(4, 'Jira Cloud Enterprise', '2026-09-15', TRUE),

(5, 'Snowflake', '2026-11-01', TRUE),

(6, 'M3 MacBook Pro Hardware Pool', NULL, FALSE),

(7, 'Dell U2723QE Monitor Pool', NULL, FALSE),

(8, 'Slack Pro', '2026-05-15', TRUE),

(9, 'Notion Enterprise', '2026-08-01', TRUE),

(10, '1Password Business', '2026-06-30', TRUE);

-- ---------------------------------------------------------------------
-- ASSETS: 15 assets linked to contracts. Mix of License and Hardware.
-- ---------------------------------------------------------------------

INSERT INTO ASSETS (asset_id, asset_name, monthly_cost_per_seat, asset_type, contract_id) VALUES
(1,  'GitHub Copilot',           39.00,  'License',  1),
(2,  'Figma Full Seat',          75.00,  'License',  2),
(3,  'Figma Viewer Seat',        15.00,  'License',  2),
(4,  'Datadog Infrastructure',   15.00,  'License',  3),
(5,  'Datadog APM',               30.00,  'License',  3),
(6,  'Jira Enterprise',          14.50,  'License',  4),
(7,  'Snowflake Compute',         0.00,  'License',  5),  -- consumption-based
(8,  'M3 MacBook Pro',           0.00,  'Hardware', 6),  -- one-time cost
(9,  'Dell Monitor',              0.00,  'Hardware', 7),  -- one-time cost
(10, 'Slack Pro',                 8.75,  'License',  8),
(11, 'Notion Enterprise',        20.00,  'License',  9),
(12, '1Password Business',        7.99,  'License',  10),
(13, 'VS Code Enterprise',       0.00,   'License',  NULL),  -- free, no contract
(14, 'Zoom Pro',                  15.99, 'License',  NULL),  -- simplified
(15, 'GitHub Enterprise',        21.00,  'License',  1);  -- shares GitHub contract

-- ---------------------------------------------------------------------
-- EMPLOYEE_ASSETS: ~7,000 mappings (avg 3-4 assets per employee).
-- last_active_date spread over last 90 days; ~15% are inactive (>30 days).
-- status: Active or Inactive.
-- ---------------------------------------------------------------------

-- Assign 3-4 assets per employee using UNIFORM distribution.
-- Random sample: capture the baseline from this account rather than old totals.
INSERT INTO EMPLOYEE_ASSETS (emp_id, asset_id, last_active_date, status)
SELECT
  e.emp_id,
  a.asset_id,
  DATEADD('day', -UNIFORM(1, 90, HASH(e.emp_id, a.asset_id, 'days')), CURRENT_DATE()),
  CASE
    WHEN UNIFORM(1, 100, HASH(e.emp_id, a.asset_id, 'status')) <= 15 THEN 'Inactive'
    ELSE 'Active'
  END
FROM EMPLOYEES e
CROSS JOIN ASSETS a
WHERE UNIFORM(1, 100, HASH(e.emp_id, a.asset_id, 'pick')) <= 20  -- ~20% chance of each (emp, asset) pair existing
  AND NOT (
    a.asset_id = 8 AND e.emp_id > 1000  -- only first 1,000 employees get MacBook Pros
  )
  AND NOT (
    a.asset_id = 9 AND e.emp_id > 1200  -- only first 1,200 employees get monitors
  );

-- Ensure every employee has at least one asset (GitHub Enterprise for all).
INSERT INTO EMPLOYEE_ASSETS (emp_id, asset_id, last_active_date, status)
SELECT e.emp_id, 15, CURRENT_DATE(), 'Active'
FROM EMPLOYEES e
WHERE NOT EXISTS (
  SELECT 1 FROM EMPLOYEE_ASSETS ea WHERE ea.emp_id = e.emp_id AND ea.asset_id = 15
);


  RETURN 'Seed complete.';
END;
$$;

SELECT 'EMPLOYEES' AS table_name, COUNT(*) AS row_count FROM EMPLOYEES
UNION ALL SELECT 'CONTRACTS', COUNT(*) FROM CONTRACTS
UNION ALL SELECT 'ASSETS', COUNT(*) FROM ASSETS
UNION ALL SELECT 'EMPLOYEE_ASSETS', COUNT(*) FROM EMPLOYEE_ASSETS;
