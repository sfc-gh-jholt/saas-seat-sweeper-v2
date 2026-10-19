# Build the agent

First finish [Build the document pipeline](build-documents.md). Confirm ten PDFs are parsed before creating Search:

```bash
python3 scripts/contract_pipeline.py wait --connection "$LAB_CONNECTION" --group baseline
snow sql --connection "$LAB_CONNECTION" -D lab_db="$LAB_DB" -D lab_wh="$LAB_WH" -D lab_role="$LAB_ROLE" -f sql/v2/03_agent_tools.sql
python3 scripts/contract_pipeline.py wait --connection "$LAB_CONNECTION" --group baseline --search
sql/v2/deploy_agent.sh "$LAB_CONNECTION"
python3 scripts/contract_pipeline.py resume --connection "$LAB_CONNECTION" --group baseline
```

This creates the semantic view over your opportunity view, `CONTRACT_PDF_SEARCH` over PDF-derived pages, and `SEAT_SWEEPER_AGENT`. The app role receives access. Rehearsal uses the explicit names-file override; updating an existing lab agent uses `deploy_agent.sh <connection> <names-file> --update` to snapshot, save and publish the change. Never point a fresh deployment at an unrelated agent.

```text
Inspect what I built in <LAB_DB>.APP, read-only: SEAT_SWEEPER_SV, CONTRACT_PDF_SEARCH, and SEAT_SWEEPER_AGENT. Show their source objects and tool routing. Confirm Search reads DT_CONTRACT_PDF_PAGES rather than RAW.CONTRACTS text. Explain the difference between a linked contract-register row and an indexed PDF. Check app-role access and show one retrieved filename/page/quote.
```

Next: [Use the agent](use-agent.md).
