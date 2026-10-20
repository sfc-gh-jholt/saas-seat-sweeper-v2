# Inspect both pipelines

Read-only. First verify successful refresh and INCREMENTAL modes. A target lag is not an exact schedule; the dashboard refresh button only refetches the view.

```text
Inspect <LAB_DB>.APP.DT_SEAT_ASSIGNMENTS and DT_VENDOR_OPPORTUNITY read-only. Report refresh_mode, scheduling state, last successful data timestamp and lag in seconds (DYNAMIC_TABLE_REFRESH_HISTORY), which is what the app shows as Data as of. Confirm enrichment feeds aggregation and V_VENDOR_OPPORTUNITY is a thin compatibility view. Run sql/v2/02_check_vendor_opportunity.sql only after both are fresh, with stable raw data and on the same calendar day as refresh. Explain any failure with source rows and propose the smallest fix to the responsible layer; do not mutate anything. Check source uniqueness, join cardinality, grain, unlinked rows, each group's amounts and annualization. Show the top five vendors and contributing departments. Never hardcode expected totals. If stale, propose a leaf refresh for approval rather than silently refreshing or changing business rules.
```

From the repository-root terminal, after the freshness check:

```bash
snow sql --connection "$LAB_CONNECTION" --role ACCOUNTADMIN -D lab_db="$LAB_DB" -D lab_wh="$LAB_WH" -f sql/v2/02_check_vendor_opportunity.sql
python3 scripts/contract_pipeline.py wait --connection "$LAB_CONNECTION" --group baseline
```

All 14 structured checks must pass. Baseline PDF readiness means ten PDFs have their expected nonempty pages; it does not yet mean Search is indexed. If either gate fails, stay here and inspect the error; do not recreate tables or seed prose as a shortcut.
