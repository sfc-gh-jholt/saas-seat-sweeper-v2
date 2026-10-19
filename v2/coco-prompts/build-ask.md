# Version two: connect Ask to the agent

This is the main build exercise. CoCo connects the Agent API and builds the Ask experience; you review it. The streaming parser and evidence renderer are supplied in `v2/checkpoints/completed-ask/lib/agent-stream.ts` and `components/agent-answer.tsx` so you do not have to implement SSE. Markdown dependencies are already in the starter.

Stage 1, plan:

```text
In v2/starter-app, plan how to turn the Ask placeholder (app/ask/page.tsx) into a working page backed by my SEAT_SWEEPER_AGENT in <LAB_DB>.APP. Read lib/snowflake.ts and the snowflake-apps skill first.

Requirements:
- A server route POST /api/ask accepts JSON { question }, 1-500 characters, and rejects anything else with 400.
- It calls the named Cortex Agent REST endpoint (/api/v2/databases/{db}/schemas/APP/agents/SEAT_SWEEPER_AGENT:run) with stream: true and Accept: text/event-stream. Reuse the supplied streaming parser/projection and evidence renderer; do not build another parser or use SQL as a fallback.
- Auth uses the app's service token via getRestApiAuthHeader() and the host from getSnowflakeBaseUrl(), with the OAUTH token-type header. No PAT, no secrets, nothing from the browser decides the URL.
- Timeout, safe errors with a correlation ID, and never pass the upstream error body to the browser.
- Show real API activity and elapsed time, a collapsed Thinking panel for API-provided thinking (not signatures), streaming Markdown answers, result tables, PDF citations with filename/page in the source title and quoted excerpts, SQL/query IDs and warnings. No fabricated progress steps. One question at a time. Stop preserves partial output and explains that the upstream agent may still run. Missing completion evidence must remain incomplete.
- Mocked tests for success, bad input, upstream 401, timeout, malformed or interrupted streams, duplicate final events and safe Markdown rendering. Do not log question, answer, thinking or credentials.
- Don't change app.yml, dependencies, the dashboard or /api/opportunity.

Propose the files and tests, then wait for my approval.
```

Stage 2, after you approve:

```text
Implement the plan. Run the type check, tests and build and show me the diff. Don't deploy. Local testing of the live agent needs an OAuth connection, so rely on the mocked tests here; we'll test live after deploying.
```

Behind or stuck? Apply the checkpoint, then re-run the gates:

```bash
v2/checkpoints/apply_completed_ask.sh v2/starter-app           # preview
v2/checkpoints/apply_completed_ask.sh v2/starter-app --apply
```

Next: [Redeploy and use the agent in your app](deploy-v2.md).
