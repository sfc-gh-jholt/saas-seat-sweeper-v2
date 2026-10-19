# Seat Sweeper V2

**Start with [the participant workbook](v2/START_HERE.ipynb) in CoCo Desktop.**

A focused workshop: load synthetic data and PDFs, build dynamic tables, deploy a Next.js starter, personalize and redeploy it, test a named Cortex Agent, connect Ask, then import a new PDF without redeploying the app.

```bash
git clone https://github.com/sfc-gh-jholt/saas-seat-sweeper-v2.git
cd saas-seat-sweeper-v2
coco .
```

Open `v2/START_HERE.ipynb`. If `coco` is not on PATH, open this folder in CoCo Desktop or use its Command Palette to install the command. Record `git rev-parse HEAD` before starting; use a facilitator-supplied revision when running as a group.

## Requirements

Fresh Snowflake account with ACCOUNTADMIN, CoCo Desktop with a local Python 3.10+ kernel, Git, Node.js 22 LTS/npm, Snowflake CLI supporting `snow app` and `app.yml` v2 (tested with 3.29.0), and `cortex agent-studio`. Configure a named connection to **your** account; the workbook checks identity before writes.

See [prerequisites and agenda](v2/README.md). All terminal commands start at the repository root unless stated otherwise.

## What is included

- `v2/START_HERE.ipynb`: participant journey with embedded CoCo prompts.
- `v2/starter-app/`: opportunity dashboard and Ask placeholder.
- `v2/checkpoints/`: completed Ask integration recovery files.
- `v2/contracts/`: ten baseline synthetic PDFs and held-out Zoom PDF.
- `sql/v2/`: setup, seed, structured/document pipelines and agent tool definitions.
- `scripts/`: required helpers and offline validation.

No legacy workshop, rehearsal target, credentials or generated deployment artifacts are included.

**Validation status:** offline checks and starter builds pass. Full fresh-account execution, live validation of the new structured dynamic tables, and timed end-to-end rehearsals remain pending. This is a published rehearsal kit, not a claim of production or workshop release readiness.

Setup, refreshes, parsing, Search, Agent calls and app deployments can incur charges. All agreements and business data are synthetic. Review each proposed write; retain or clean up only your own lab resources.
