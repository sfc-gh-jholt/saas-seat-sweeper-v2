# Build the structured dynamic-table pipeline

Stage 1 proposes; approve before CoCo creates anything. Replace angle-bracket values with your confirmed lab settings.

```text
Using my confirmed lab connection, inspect <LAB_DB>.RAW.EMPLOYEES, ASSETS, CONTRACTS and EMPLOYEE_ASSETS, including columns, row counts, unique keys and missing employee/asset references. Read the dynamic-tables skill. Plan two explicit INCREMENTAL dynamic tables: <LAB_DB>.APP.DT_SEAT_ASSIGNMENTS enriches assignments with employee department, matched contract_id, vendor name, has_contract, status, last_active_date and monthly_cost_per_seat; <LAB_DB>.APP.DT_VENDOR_OPPORTUNITY aggregates eligible assignments. Use <LAB_WH>, DOWNSTREAM for enrichment, a 1-minute target lag for the aggregate, and ON_CREATE initialization. Explain ongoing refresh costs.

Eligible means status = 'Inactive', last_active_date at least 30 days before CURRENT_DATE(), and positive monthly_cost_per_seat. Keep CURRENT_DATE in WHERE, not SELECT; do not silently use FULL/AUTO or change the business rule. Eligibility reflects the last successful refresh, not the browser's current clock.

Preserve grain (matched contract_id, vendor_name, department) and retain unmatched/null contract links with the asset name and has_contract=false. Inner-join employees/assets and left-join contracts on their IDs; validate that joins neither drop nor multiply assignments. Standard-table primary keys alone are not proof of uniqueness.

Expose the existing seven columns through a thin <LAB_DB>.APP.V_VENDOR_OPPORTUNITY view: contract_id, vendor_name, has_contract, department, inactive_seats, monthly_opportunity, annualized_opportunity (12 x monthly, not a forecast). Grant SELECT on this view to <LAB_ROLE>. Do not change the app API or semantic interface.

Show exact SQL, source checks, refresh-mode/freshness checks and recovery steps. Check for existing targets; do not overwrite them. Wait for my approval before writes. After approval, build only this plan and run sql/v2/02_check_vendor_opportunity.sql after successful refresh; report failures honestly. This is opportunity to review, not realized savings.
```

Recovery: review `sql/v2/checkpoint_vendor_opportunity.sql` before executing it. It creates fresh objects only and stops on collisions; it does not upgrade a pre-existing view. Inspect partial objects rather than dropping/replacing them. The new structured checkpoint still requires isolated live rehearsal before release; offline checks are not refresh proof.

Continue with [Build the document pipeline](build-documents.md), then [Inspect the pipeline](inspect-pipeline.md).
