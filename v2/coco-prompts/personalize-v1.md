# Make one visible change after deployment one

Keep the change to the dashboard. The starter already has four KPIs, search and a missing-contract filter.

```text
In v2/starter-app, add a Monthly / Annualized toggle to the vendor opportunity chart in app/page.tsx. Use the existing monthly data and multiply by 12 for the annualized display; label it as annualized opportunity, not a forecast or realized savings. Keep all four KPI totals, details filters and department comparison unchanged. Match the existing visual style, keyboard focus and dark mode. Add tests for both toggle states. Do not change the API, authentication, app.yml, dependencies or other pages. Run tests, explicit type check and build, then show me the diff. Do not deploy yet.
```

Success: both labels and chart values change; totals do not. Save the diff as evidence. If stuck, ask CoCo to revert only the edits from this exercise after reviewing the diff; never use a destructive reset or overwrite unrelated work.

Next redeploy to the **same** service, as deployment two:

```text
Redeploy my personalized v2/starter-app to the same lab target, connection and application service as deployment one. Confirm the account, service FQN, manifest settings, passing tests/type check/build and the bounded dashboard diff; wait for approval. After approval deploy, record the service version and URL, and verify the Monthly / Annualized toggle at the same URL. Do not create another service or change grants, integrations or authentication.
```
