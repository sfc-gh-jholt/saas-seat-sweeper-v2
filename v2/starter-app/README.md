# Seat Sweeper starter app

Follow the [participant workbook](../START_HERE.ipynb). Deploy this starter unchanged first; personalize it only after deployment one. Ask is deliberately a placeholder until the integration exercise.

## Keep the supplied foundation

- `app/page.tsx` and `app/opportunity.css`: dashboard, four KPIs, comparisons and review lists.
- `app/api/opportunity/route.ts`: server-side query of `LAB_DB.APP.V_VENDOR_OPPORTUNITY`.
- `lib/opportunity-summary.ts`: client aggregation and filtering.
- `lib/snowflake.ts` and `lib/sar-sdk/`: existing server-side authentication, SQL and REST helpers. Do not recreate or expose credentials.
- `app.yml`: version-2 manifest, with one `lab` target. Do not generate `snowflake.yml` or add another target for this lab.
- `next.config.mjs`: standalone build and explicit workspace-root pin; preserve both.
- `../checkpoints/completed-ask/`: supplied Agent streaming parser, renderer, route and tests. Do not use SQL as an Ask fallback.

React Query, UI components, dark mode and Markdown rendering dependencies are already installed. Personalization should not add dependencies, change authentication or replace the app. The dashboard uses real API data; mocked data belongs only in tests.

## Local checks

From this app directory:

```bash
npm ci
npm test
npm exec -- tsc --noEmit
npm run build
```

Build alone does not type-check. `__tests__/opportunity.test.tsx` checks dashboard behavior; `__tests__/api/opportunity.test.ts` checks the route; `__tests__/lib/snowflake.test.ts` checks the auth/query helpers.

For local preview, set the named connection and namespace explicitly (using the terminal settings from the workbook):

```bash
SNOWFLAKE_CONNECTION_NAME="$LAB_CONNECTION" LAB_DB="$LAB_DB" SNOWFLAKE_WAREHOUSE="$LAB_WH" SNOWFLAKE_DATABASE="$LAB_DB" SNOWFLAKE_SCHEMA=APP SNOWFLAKE_ROLE=ACCOUNTADMIN npm run dev
```

Read the actual URL from the server output. An agent launching the dev server should run it in the background. If your approved connection cannot authenticate locally, diagnose it rather than adding credentials to source or falling back to another account. Do not run `.next/standalone/server.js` for local preview; use `npm run dev`, or `npm run start` after building.

Check the homepage, `/api/opportunity`, and static chunks; reconcile totals against a fresh pipeline snapshot. Watch for failed compilation or HTTP 500 responses. A local preview is not proof the deployed service identity has access.

## Deployment and Ask

Use the workbook's approval-gated deployment prompts and the `snowflake-apps` skill. Confirm the same `lab` target and service at each deployment. Preserve the build integration and manifest rather than generating new ones.

The completed Ask checkpoint uses `getRestApiAuthHeader()` and `getSnowflakeBaseUrl()` on the server for the named Agent endpoint. No PAT, browser credentials, alternate API or direct-SQL chatbot fallback. Local mocked tests do not replace live deployed tests.

The checkpoint preview lists every overwritten integration file. It does not replace this manifest, the dependency lockfile or your dashboard customization. Run tests, explicit type checking and build again before deployment three.
