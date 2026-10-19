# Redeploy and use the agent in your app

```text
Perform deployment three: redeploy v2/starter-app with Ask connected to the same `lab` target and service used by deployments one and two. Confirm the target, account and role, that my dashboard personalization is preserved, no runtime egress integration was added, and tests, explicit type check and build pass; then wait for my approval. After deploying, compare the new version in DESCRIBE APPLICATION SERVICE with deployment two and give me the same app URL.
```

Open `/ask` in the deployed app (wait for it to finish starting if you see "service unavailable"). Check that real activity appears while waiting, answers stream, and Thinking expands when the API returns thinking text. Check the result table, SQL/query IDs and contract source disclosures. Stop preserves partial output but does not guarantee the upstream run stops. An interrupted or warning-bearing answer must not be marked complete. Then ask:

1. Which three vendors have the most monthly inactive seat opportunity? It should use `seat_opportunity`, and the amounts should match your dashboard.
2. What is the cancellation notice period and true-up clause for Figma Enterprise? It should use `contract_terms` and show a citation.
3. For the top two vendors by monthly opportunity, how much can we reduce seats this year without penalty? It should use both tools.
4. What are the cancellation terms for Zoom Pro? Before the arrival exercise, it should report no matching indexed PDF. Follow [Use the agent](use-agent.md) to import Zoom and ask again; afterward it must cite the synthetic PDF filename/page and quote the clause. No further app redeploy is required.

```text
Inspect my deployed app's recent logs, read-only. Find the "op":"ask" lines for my questions and show each one's correlation ID, duration, result and tools. Explain which identity called the agent.
```
