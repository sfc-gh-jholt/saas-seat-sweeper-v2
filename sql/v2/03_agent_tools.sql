-- Seat Sweeper V2 agent tools: semantic view (Cortex Analyst) and Cortex Search.
-- Run after the pipeline view exists and passes its checks.
--   snow sql --connection <conn> -D lab_db=<db> -D lab_wh=<wh> -D lab_role=<role> -f sql/v2/03_agent_tools.sql
-- Then deploy the agent spec: see agent/README in v2/.
-- Safe to re-run (IF NOT EXISTS). Search uses warehouse credits while it builds and refreshes.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE <% lab_wh %>;

-- Structured tool: business names over the attendee-built view plus contract terms metadata.
CREATE SEMANTIC VIEW IF NOT EXISTS <% lab_db %>.APP.SEAT_SWEEPER_SV
  TABLES (
    opportunity AS <% lab_db %>.APP.V_VENDOR_OPPORTUNITY
      COMMENT = 'Inactive paid seats (30+ days) by vendor contract and department. Opportunity to review, not realized savings.',
    contracts AS <% lab_db %>.RAW.CONTRACTS
      PRIMARY KEY (contract_id)
      COMMENT = 'Vendor contracts with renewal dates and auto-renew flags.'
  )
  RELATIONSHIPS (
    opportunity_to_contract AS opportunity (contract_id) REFERENCES contracts (contract_id)
  )
  FACTS (
    opportunity.inactive_seats AS inactive_seats,
    opportunity.monthly_opportunity AS monthly_opportunity
  )
  DIMENSIONS (
    opportunity.vendor_name AS vendor_name
      WITH SYNONYMS = ('vendor', 'tool', 'product')
      COMMENT = 'Vendor contract name, or the asset name when the seat has no contract.',
    opportunity.department AS department
      WITH SYNONYMS = ('team', 'org'),
    opportunity.has_contract AS has_contract
      COMMENT = 'False when the seat has no linked structured contract-register row. This does not indicate whether a PDF is indexed.',
    contracts.renewal_date AS renewal_date,
    contracts.auto_renew AS auto_renew
  )
  METRICS (
    opportunity.total_inactive_seats AS SUM(opportunity.inactive_seats)
      COMMENT = 'Number of inactive paid seats.',
    opportunity.total_monthly_opportunity AS SUM(opportunity.monthly_opportunity)
      WITH SYNONYMS = ('monthly savings opportunity', 'monthly waste')
      COMMENT = 'Monthly cost of inactive paid seats. Opportunity, not realized savings.',
    opportunity.total_annualized_opportunity AS SUM(opportunity.monthly_opportunity) * 12
      COMMENT = 'Monthly opportunity x 12.'
  )
  COMMENT = 'Seat Sweeper: inactive seat opportunity by vendor and department.';

-- Unstructured tool: imported and parsed PDF pages only.
-- Require document readiness before running this file; never replace an existing service to force freshness.
CREATE CORTEX SEARCH SERVICE IF NOT EXISTS <% lab_db %>.APP.CONTRACT_PDF_SEARCH
  ON content
  ATTRIBUTES vendor_name, relative_path, page_number
  WAREHOUSE = <% lab_wh %>
  TARGET_LAG = '1 minute'
  COMMENT = 'seat-sweeper-contract-pdf-v1'
AS (
  SELECT source_id, source_title, vendor_name, relative_path, page_number, content
  FROM <% lab_db %>.APP.DT_CONTRACT_PDF_PAGES
);

GRANT SELECT, REFERENCES ON SEMANTIC VIEW <% lab_db %>.APP.SEAT_SWEEPER_SV TO ROLE <% lab_role %>;
GRANT USAGE ON CORTEX SEARCH SERVICE <% lab_db %>.APP.CONTRACT_PDF_SEARCH TO ROLE <% lab_role %>;
-- Caller's rights for Ask: the signed-in user's own access (PUBLIC; synthetic data) and caller
-- grants so the app may use these tools on their behalf. Agent grants: scripts/deploy_lab_agent.py.
GRANT SELECT, REFERENCES ON SEMANTIC VIEW <% lab_db %>.APP.SEAT_SWEEPER_SV TO ROLE PUBLIC;
GRANT USAGE ON CORTEX SEARCH SERVICE <% lab_db %>.APP.CONTRACT_PDF_SEARCH TO ROLE PUBLIC;
GRANT CALLER SELECT, REFERENCES ON SEMANTIC VIEW <% lab_db %>.APP.SEAT_SWEEPER_SV TO ROLE <% lab_role %>;
GRANT CALLER USAGE ON CORTEX SEARCH SERVICE <% lab_db %>.APP.CONTRACT_PDF_SEARCH TO ROLE <% lab_role %>;
