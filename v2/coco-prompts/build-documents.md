# Build the document pipeline

Setup imported ten real, synthetic PDFs into `<LAB_DB>.RAW.CONTRACT_PDF_STAGE`; it did not seed clause text. Open `v2/contracts/baseline/figma-enterprise-v1.pdf` before building. Keep `new-arrival/zoom-pro.pdf` out until the arrival exercise.

Use the existing pipeline segment (about 15 minutes), not an extra module:

```text
Read sql/v2/04_document_pipeline.sql and scripts/contract_pipeline.py. Using my lab connection, propose a PDF-only pipeline in <LAB_DB>: stage directory stream -> ingest task -> file log -> INCREMENTAL parsing -> INCREMENTAL pages. Preserve document identity, filename, vendor and one-based page numbers. Use AI_PARSE_DOCUMENT and the existing <LAB_WH>. Do not insert contract prose or overwrite stage files. Show objects, costs and checks; wait for approval. The existing seat-opportunity view stays unchanged.
```

After approval, CoCo builds it. The tested checkpoint is:

```bash
python3 scripts/contract_pipeline.py build --connection "$LAB_CONNECTION"
python3 scripts/contract_pipeline.py backlog --connection "$LAB_CONNECTION"
python3 scripts/contract_pipeline.py import --connection "$LAB_CONNECTION" --group baseline
```

The backlog step handles PDFs uploaded before the stream existed. Import verifies unchanged bytes, refreshes the directory, invokes the same task, and waits for actual parsed-page coverage. It never bypasses parsing with seeded text. The task stays suspended until Search is ready.

Use the supplied default participant names; no maintainer names file is included. Review [current parsing rates](https://docs.snowflake.com/en/user-guide/cost-understanding-overall#service-type) before execution.

```text
Inspect the pipeline read-only. Confirm both dynamic tables are INCREMENTAL, every baseline PDF has its expected nonempty page, and no parse error is hidden. Compare Figma's parsed clause with the original PDF. Explain why staged, parsed, and indexed are three different readiness states.
```

If readiness times out, inspect task/DT history. Do not rebuild all tables, overwrite PDFs, or load text as a shortcut. Proceed to [Build the agent](build-agent.md) only after the ten PDFs are parsed.
