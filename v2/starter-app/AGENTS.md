# Snowflake App Runtime

This project deploys as an Application Service on Snowflake via `snow app deploy`.

## Key APPLICATION SERVICE Commands

| Command | Description |
|---------|-------------|
| `DESCRIBE APPLICATION SERVICE <name>` | View service details and configuration |
| `SHOW APPLICATION SERVICES` | List all deployed application services |
| `ALTER APPLICATION SERVICE <name> SUSPEND` | Pause the service |
| `ALTER APPLICATION SERVICE <name> RESUME` | Resume a suspended service |
| `ALTER APPLICATION SERVICE <name> UPGRADE` | Upgrade to a new version |
| `CALL SYSTEM$GET_APPLICATION_SERVICE_LOGS('<database>.<schema>.<app_name>')` | Retrieve service logs |
| `GRANT USAGE ON APPLICATION SERVICE <name> TO ROLE <role>` | Grant access to roles |

## Key CLI Commands

- `snow app deploy` — Deploy or update the application service
- `snow app events` — Stream deployment events and logs
- `snow app open` — Open the deployed app in your browser
- `snow app teardown --force` — Remove the deployed service

## Project Structure

This Next.js project configures its build and runtime in `app.yml`. Where the *deployment* configuration lives depends on the manifest layout: if `app.yml` has a top-level `version: 2` it holds both, and any `snowflake.yml` is ignored; otherwise `snowflake.yml` holds the deployment configuration and `app.yml` is build-only. The app runs on HTTPS and is accessible via the generated Application Service endpoint in Snowflake.

Note that a `version: 2` deploy applies the manifest declaratively, so `ALTER APPLICATION SERVICE ... SET` changes are reverted on the next deploy unless they are also in `app.yml`.

## Observability conventions (keep these when you change the app)

The lab's Step 7 reads the app's own telemetry. Every change must keep it working:

- **Wrap every API route** in `withObservability("<route-name>", async (req, ctx) => ...)` from `lib/observability.ts`. It writes one JSON `event:"request"` log line per request (route, status, duration_ms, user, request_id) and returns `x-request-id`.
- **Tag every query**: pass `{ queryTag: ctx.queryTag }` to `querySnowflake`. Step 7f finds app queries by `QUERY_TAG`.
- **Caller's rights**: `app.yml` sets `run.executeAsCaller: true`. Pass `callersRights: ctx.callersRights, warehouse: labWarehouse()` for queries that should run as the signed-in user, and add matching `GRANT CALLER ...` and PUBLIC grants (see `sql/v2`). Keep `ctx.callersRights`; it falls back to the owner role when no caller token is present (local dev).
- **Log errors with `logEvent({ event: "route_error", ... })`**, never return raw error text to the browser.
- **Keep** `components/client-error-reporter.tsx` mounted in `app/layout.tsx` and the `/api/client-log` route.
- Don't remove `executeAsCaller`, `LAB_WH` or the freshness ("Data as of") query.
- **Ask** (`/ask`, `app/api/ask/route.ts`, `lib/agent.ts`) calls `SEAT_SWEEPER_AGENT` over the Agent REST API with caller's rights (`buildCallerRightsToken` from the `sf-context-current-user-token` header). Keep the `withObservability("ask")` wrapper, the `"op":"ask"` correlation logs (never log questions, answers or thinking), and the `AGENT_NOT_BUILT` reply for a missing agent.

## Next Steps

For complete reference on building, developing, deploying, and operating Snowflake Apps, invoke the **snowflake-apps** skill.
