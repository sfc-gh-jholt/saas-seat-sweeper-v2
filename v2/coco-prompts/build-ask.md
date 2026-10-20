# Ask is in the starter: review how it reaches the agent

The Ask page, its `/api/ask` route and the streaming answer renderer ship in `v2/starter-app`. Before the agent exists, Ask replies that the agent isn't built yet; once you build `SEAT_SWEEPER_AGENT` ([Build the agent](build-agent.md)), the same deployed app answers. **No redeploy is needed.**

How it works:

- `app/api/ask/route.ts` accepts JSON `{ question }` (1–500 characters), is wrapped in `withObservability("ask")`, and streams the agent's answer back as server-sent events. A missing agent (HTTP 404) returns `AGENT_NOT_BUILT`.
- `lib/agent.ts` calls the named Cortex Agent REST endpoint (`/api/v2/databases/{db}/schemas/APP/agents/SEAT_SWEEPER_AGENT:run`) with **caller's rights**: when Snowflake passes the `Sf-Context-Current-User-Token` header (`run.executeAsCaller: true` in `app.yml`), it authenticates with `buildCallerRightsToken(...)`, so the agent runs as the signed-in user. Without the header (local dev) it uses the app's own token.
- `lib/agent-stream.ts` and `components/agent-answer.tsx` parse the stream and render thinking, answer, tables, SQL/query IDs and PDF citations.
- Logs: one `"event":"request"` line per call plus `"op":"ask"` lines with the correlation ID, duration, status, tools and `callers_rights`. Questions, answers and thinking are never logged.

Review it with CoCo:

```text
Read-only: explain how v2/starter-app's Ask page reaches SEAT_SWEEPER_AGENT. Walk through app/api/ask/route.ts, lib/agent.ts and lib/agent-stream.ts: input validation, caller's-rights auth, timeout, the AGENT_NOT_BUILT path, what is logged and what is never logged. List the grants a caller's-rights agent call needs and check they exist in <LAB_DB>.
```

Optional extension (then redeploy as in [Deploy version one](deploy-v1.md)):

```text
In v2/starter-app, add suggested-question buttons to the Ask page for the three baseline questions. Keep the observability conventions in AGENTS.md, keep caller's rights, and add tests. Run tests, type check and build, then show me the diff. Do not deploy yet.
```

If your Ask files were changed and broke, restore the reference copies:

```bash
v2/checkpoints/apply_completed_ask.sh v2/starter-app           # preview
v2/checkpoints/apply_completed_ask.sh v2/starter-app --apply
```

Next: [Use Ask in your app](deploy-v2.md).
