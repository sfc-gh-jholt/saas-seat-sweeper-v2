# Use the agent

Ask the agent directly before you wire it into the app. Each question should use a different tool path.

```text
Using my lab connection, run these four questions against <LAB_DB>.APP.SEAT_SWEEPER_AGENT, one at a time, and for each show the answer, which tools it called, and any SQL it generated:
1. Which three vendors have the most monthly inactive seat opportunity?
2. What is the cancellation notice period and true-up clause for Figma Enterprise?
3. For the top two vendors by monthly opportunity, how much can we reduce seats this year without penalty?
4. What are the cancellation terms for Zoom Pro?
Then check answer 1 against V_VENDOR_OPPORTUNITY with a read-only query.
```

What good looks like:
- 1 uses `seat_opportunity` and its amounts match your view.
- 2 uses `contract_terms` and quotes the clause with PDF filename/page.
- 3 uses both tools; missing seat-reduction language stays unknown. A cancellation notice does not automatically govern reductions.
- 4 says no matching indexed PDF was found, not that no agreement exists.

## A new PDF changes the answer

After Ask is connected and deployed, ask the Zoom question in the app. Then import the held-out PDF through the same pipeline:

```bash
python3 scripts/contract_pipeline.py import --connection "$LAB_CONNECTION" --group new-arrival --search
```

Wait for `Ready` (parsed pages **and** Search verified), then ask the identical question again. The answer must identify the synthetic Zoom agreement and cite `zoom-pro.pdf`, page 1. Its fictional cancellation notice is 30 calendar days; its separate reduction notice is 10 days with a five-seat minimum. Open the PDF and verify the quote. These are workshop terms, not actual Zoom policies.

No app redeployment, agent rebuild, or manual text INSERT is needed. Zoom still has no linked structured contract-register row; document arrival is not registry reconciliation. On later runs Zoom is already indexed: report that fact, do not delete evidence to manufacture a before state.
