-- Read-only checks. Run only after both structured DTs have completed refresh.
-- Compare stable sources on the same calendar day as refresh; if stale, wait
-- or approve an explicit leaf refresh before diagnosing a logic mismatch.
-- Every row must show PASSED = TRUE. No date-sensitive totals are hardcoded.
USE WAREHOUSE <% lab_wh %>;

WITH source_assignments AS (
  SELECT ea.emp_id, ea.asset_id, c.contract_id,
    COALESCE(c.vendor_name, a.asset_name) AS vendor_name,
    c.contract_id IS NOT NULL AS has_contract,
    e.department, ea.status, ea.last_active_date, a.monthly_cost_per_seat
  FROM <% lab_db %>.RAW.EMPLOYEE_ASSETS ea
  JOIN <% lab_db %>.RAW.EMPLOYEES e ON e.emp_id = ea.emp_id
  JOIN <% lab_db %>.RAW.ASSETS a ON a.asset_id = ea.asset_id
  LEFT JOIN <% lab_db %>.RAW.CONTRACTS c ON c.contract_id = a.contract_id
), eligible AS (
  SELECT * FROM source_assignments
  WHERE status = 'Inactive'
    AND last_active_date <= DATEADD('day', -30, CURRENT_DATE())
    AND monthly_cost_per_seat > 0
), expected_groups AS (
  SELECT contract_id, vendor_name, has_contract, department,
    COUNT(*) AS inactive_seats, SUM(monthly_cost_per_seat) AS monthly_opportunity
  FROM eligible GROUP BY contract_id, vendor_name, has_contract, department
), v AS (SELECT * FROM <% lab_db %>.APP.V_VENDOR_OPPORTUNITY),
checks AS (
  SELECT 1 AS n, 'One row per contract/vendor/department' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM (SELECT contract_id, vendor_name, department FROM v
      GROUP BY 1, 2, 3 HAVING COUNT(*) > 1)) AS actual
  UNION ALL
  SELECT 2, 'Inactive seats match source',
    (SELECT COUNT(*) FROM eligible), (SELECT COALESCE(SUM(inactive_seats), 0) FROM v)
  UNION ALL
  SELECT 3, 'Monthly opportunity matches source',
    (SELECT COALESCE(SUM(monthly_cost_per_seat), 0) FROM eligible),
    (SELECT COALESCE(SUM(monthly_opportunity), 0) FROM v)
  UNION ALL
  SELECT 4, 'Annualized is 12 x monthly on every row', 0,
    (SELECT COUNT(*) FROM v WHERE annualized_opportunity IS NULL
      OR monthly_opportunity IS NULL OR annualized_opportunity <> monthly_opportunity * 12)
  UNION ALL
  SELECT 5, 'Unmatched and null contract links are retained',
    (SELECT COUNT(*) FROM eligible WHERE NOT has_contract),
    (SELECT COALESCE(SUM(inactive_seats), 0) FROM v WHERE NOT has_contract)
  UNION ALL
  SELECT 6, 'No nonpositive or null opportunity rows', 0,
    (SELECT COUNT(*) FROM v WHERE monthly_opportunity <= 0 OR monthly_opportunity IS NULL
      OR inactive_seats <= 0 OR inactive_seats IS NULL)
  UNION ALL
  SELECT 7, 'Source join neither loses nor multiplies assignments',
    (SELECT COUNT(*) FROM <% lab_db %>.RAW.EMPLOYEE_ASSETS),
    (SELECT COUNT(*) FROM source_assignments)
  UNION ALL
  SELECT 8, 'Enrichment retains assignment count',
    (SELECT COUNT(*) FROM source_assignments),
    (SELECT COUNT(*) FROM <% lab_db %>.APP.DT_SEAT_ASSIGNMENTS)
  UNION ALL
  SELECT 9, 'Enrichment has unique employee/asset pairs', 0,
    (SELECT COUNT(*) FROM (SELECT emp_id, asset_id FROM <% lab_db %>.APP.DT_SEAT_ASSIGNMENTS
      GROUP BY 1, 2 HAVING COUNT(*) > 1))
  UNION ALL
  SELECT 10, 'Every aggregate group matches raw calculation', 0,
    (SELECT COUNT(*) FROM expected_groups e FULL OUTER JOIN v
      ON EQUAL_NULL(e.contract_id, v.contract_id)
      AND EQUAL_NULL(e.vendor_name, v.vendor_name)
      AND EQUAL_NULL(e.department, v.department)
      AND EQUAL_NULL(e.has_contract, v.has_contract)
      WHERE NOT EQUAL_NULL(e.inactive_seats, v.inactive_seats)
         OR NOT EQUAL_NULL(e.monthly_opportunity, v.monthly_opportunity))
  UNION ALL
  SELECT 11, 'Raw employee keys are unique', 0,
    (SELECT COUNT(*) FROM (SELECT emp_id FROM <% lab_db %>.RAW.EMPLOYEES
      GROUP BY 1 HAVING COUNT(*) > 1))
  UNION ALL
  SELECT 12, 'Raw asset keys are unique', 0,
    (SELECT COUNT(*) FROM (SELECT asset_id FROM <% lab_db %>.RAW.ASSETS
      GROUP BY 1 HAVING COUNT(*) > 1))
  UNION ALL
  SELECT 13, 'Raw contract keys are unique', 0,
    (SELECT COUNT(*) FROM (SELECT contract_id FROM <% lab_db %>.RAW.CONTRACTS
      GROUP BY 1 HAVING COUNT(*) > 1))
  UNION ALL
  SELECT 14, 'Every assignment has employee and asset dimensions', 0,
    (SELECT COUNT(*) FROM <% lab_db %>.RAW.EMPLOYEE_ASSETS ea
      LEFT JOIN <% lab_db %>.RAW.EMPLOYEES e ON e.emp_id = ea.emp_id
      LEFT JOIN <% lab_db %>.RAW.ASSETS a ON a.asset_id = ea.asset_id
      WHERE e.emp_id IS NULL OR a.asset_id IS NULL)
)
SELECT check_name, expected, actual, expected = actual AS passed
FROM checks ORDER BY n;
