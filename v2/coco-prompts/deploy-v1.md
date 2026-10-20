# Deploy version one

```text
Deploy v2/starter-app to my lab account with the default `lab` target in app.yml, using my lab connection (pass it with --connection) and role SEAT_SWEEPER_APP. Use snow app deploy. First confirm the account, role, database SEAT_SWEEPER_LAB, warehouse and build integration match what setup created, that app.yml has run.executeAsCaller: true and the caller grants from setup exist, and that tests, type check and build pass. Show me those settings and wait for my approval. After deploying, record the deploy time, the service version from DESCRIBE APPLICATION SERVICE, and the URL. Then open the app once and confirm a JSON "event":"request" log line with callers_rights true and a query whose QUERY_TAG contains "app":"seat_sweeper". Don't create new integrations or change grants.
```

Open the URL and check the totals match the pipeline checks you ran.

```text
Inspect my deployed Seat Sweeper app: show its status, version, warehouse and recent logs, and explain which identity reads V_VENDOR_OPPORTUNITY (caller's rights: the signed-in user) and which reads refresh history (the app's service user). Use the QUERY_TAG to find the app's queries. Read-only.
```
