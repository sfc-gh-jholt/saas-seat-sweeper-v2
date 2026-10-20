# Use the agent in your app

Ask is already in the deployed starter, so **no redeploy is needed** once `SEAT_SWEEPER_AGENT` exists. Confirm first:

```text
Read-only: confirm SEAT_SWEEPER_AGENT exists in <LAB_DB>.APP, that role SEAT_SWEEPER_APP has USAGE and CALLER USAGE on it and CALLER grants on SEAT_SWEEPER_SV and CONTRACT_PDF_SEARCH, that PUBLIC can use all three, and that the running app version's app.yml still has run.executeAsCaller: true. Give me the app URL.
```

Open `/ask` in the deployed app (wait for it to finish starting if you see "service unavailable"). Check that real activity appears while waiting, answers stream, and Thinking expands when the API returns thinking text. Check the result table, SQL/query IDs and contract source disclosures. Stop preserves partial output but does not guarantee the upstream run stops. An interrupted or warning-bearing answer must not be marked complete. Then ask:

1. Which three vendors have the most monthly inactive seat opportunity? It should use `seat_opportunity`, and the amounts should match your dashboard.
2. What is the cancellation notice period and true-up clause for Figma Enterprise? It should use `contract_terms` and show a citation.
3. For the top two vendors by monthly opportunity, how much can we reduce seats this year without penalty? It should use both tools.
4. What are the cancellation terms for Zoom Pro? Before the arrival exercise, it should report no matching indexed PDF. Follow [Use the agent](use-agent.md) to import Zoom and ask again; afterward it must cite the synthetic PDF filename/page and quote the clause. No further app redeploy is required.

```text
Inspect my deployed app's recent logs, read-only. Find the "op":"ask" lines for my questions and show each one's correlation ID, duration, result and tools. Explain which identity called the agent (callers_rights in the log line, and user_name in query history).
```
