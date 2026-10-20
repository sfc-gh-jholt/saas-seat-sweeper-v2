# Seat Sweeper: participant workbook

**Open [START_HERE.ipynb](START_HERE.ipynb) in CoCo Desktop.** This repository contains only the V2 data, dynamic tables, app and agent workshop.

## Get the kit

```bash
git clone https://github.com/sfc-gh-jholt/saas-seat-sweeper-v2.git
cd saas-seat-sweeper-v2
git rev-parse HEAD
coco .
```

Record the commit. For a facilitated workshop, use the supplied revision (`git checkout --detach <approved-commit>`) before starting. Open `v2/START_HERE.ipynb`. If `coco` is unavailable, open the folder in CoCo Desktop or install its command through the Command Palette.

## Prerequisites

- Fresh participant Snowflake account with ACCOUNTADMIN and a named CLI connection to that account.
- CoCo Desktop with a local Python 3.10+ kernel; this is not a Snowsight runtime notebook.
- Git, Node.js 22 LTS/npm, Snowflake CLI with `snow app` and `app.yml` v2 support (tested with 3.29.0), and `cortex agent-studio` for the agent helper.
- Account availability and permission for app builds, Cortex parsing, Search and Agent services.
- Terminal commands run from the repository root. Notebook variables do not set terminal environment variables.

## Sequence (180-minute target)

| Minutes | Exercise |
|---|---|
| 0–15 | Clone, preflight, connect and confirm account |
| 15–30 | Deploy starting data and stage baseline PDFs |
| 30–60 | Build structured and document dynamic tables; inspect |
| 60–80 | Deploy unchanged starter |
| 80–95 | Make a visible change and redeploy the same service |
| 95–105 | Break |
| 105–125 | Build and directly test the named agent |
| 125–155 | Use Ask (already in the starter; no redeploy) and review how it reaches the agent |
| 155–170 | Import Zoom and verify a cited answer |
| 170–180 | Review evidence, costs and retention |

These are allocations, not measured timings. PDF arrival needs no fourth deployment. All [canonical prompts](coco-prompts/build-pipeline.md) are embedded in the notebook. Checkpoints are reviewed recovery paths, not automatic prerequisites.

## Safety and cost

Use `SEAT_SWEEPER_LAB`, `SEAT_SWEEPER_WH` and `SEAT_SWEEPER_APP` in your own account. Review writes before approving them. Setup, DT refreshes, document parsing, Search, Agent calls and app deployments can incur charges.

Missing register linkage does not imply missing PDF evidence. Documents are synthetic. Zoom arrival changes document availability, not structured linkage or prices.

The PDF pause helper suspends its task and two PDF DTs only. Structured DTs, Search, the app and storage require separate retention decisions. Do not delete objects or overwrite files as a recovery shortcut.

## Offline validation

```bash
python3 scripts/validate_notebook.py
python3 -m unittest discover -s scripts -p 'test_*.py' -v
npm --prefix v2/starter-app ci
npm --prefix v2/starter-app test
(cd v2/starter-app && npm exec -- tsc --noEmit)
npm --prefix v2/starter-app run build
```

The optional archive packager needs PyYAML; PDF regeneration needs ReportLab. Neither is needed to run the participant notebook or use the supplied PDFs. Packaging validates notebook links/prompts and PDF hashes; rerun tests after packaging to validate the extracted kit too.

**Live validation pending:** the enrichment DDL compiled against existing source schemas without execution. The new structured pipeline still needs creation, refresh and reconciliation in an approved isolated account. SQLite fixtures test relational logic, not Snowflake incremental behavior. Full fresh-account execution and two timed rehearsals remain release-readiness gates; publishing this kit does not complete them.
