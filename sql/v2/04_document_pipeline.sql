-- Checkpoint: PDF-only incremental document pipeline. Run via scripts/contract_pipeline.py build.
-- Each statement is guarded and checked by the helper before creation; no OR REPLACE.
CREATE STAGE IF NOT EXISTS <% lab_db %>.RAW.CONTRACT_PDF_STAGE
  DIRECTORY = (ENABLE = TRUE)
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
  COMMENT = 'seat-sweeper-contract-pdf-v1';

CREATE TABLE IF NOT EXISTS <% lab_db %>.RAW.CONTRACT_PDF_MANIFEST (
  relative_path VARCHAR NOT NULL, document_id VARCHAR NOT NULL, vendor_name VARCHAR NOT NULL,
  version NUMBER NOT NULL, contract_id NUMBER, expected_pages NUMBER NOT NULL,
  sha256 VARCHAR NOT NULL, file_size NUMBER NOT NULL
) COMMENT = 'seat-sweeper-contract-pdf-v1';

CREATE TABLE IF NOT EXISTS <% lab_db %>.RAW.CONTRACT_PDF_FILE_LOG (
  relative_path VARCHAR NOT NULL, document_id VARCHAR NOT NULL, vendor_name VARCHAR NOT NULL,
  version NUMBER NOT NULL, contract_id NUMBER, expected_pages NUMBER NOT NULL,
  sha256 VARCHAR NOT NULL, file_size NUMBER NOT NULL,
  ingested_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
) CHANGE_TRACKING = TRUE COMMENT = 'seat-sweeper-contract-pdf-v1';

CREATE STREAM IF NOT EXISTS <% lab_db %>.RAW.CONTRACT_PDF_STAGE_STREAM
  ON STAGE <% lab_db %>.RAW.CONTRACT_PDF_STAGE
  COMMENT = 'seat-sweeper-contract-pdf-v1';

CREATE TASK IF NOT EXISTS <% lab_db %>.RAW.CONTRACT_PDF_INGEST_TASK
  WAREHOUSE = <% lab_wh %>
  SCHEDULE = '5 MINUTE'
  USER_TASK_TIMEOUT_MS = 60000
  COMMENT = 'seat-sweeper-contract-pdf-v1'
  WHEN SYSTEM$STREAM_HAS_DATA('<% lab_db %>.RAW.CONTRACT_PDF_STAGE_STREAM')
AS
  MERGE INTO <% lab_db %>.RAW.CONTRACT_PDF_FILE_LOG dest
  USING (
    SELECT DISTINCT m.*
    FROM <% lab_db %>.RAW.CONTRACT_PDF_STAGE_STREAM changes
    JOIN <% lab_db %>.RAW.CONTRACT_PDF_MANIFEST m ON m.relative_path = changes.relative_path
    WHERE changes.METADATA$ACTION = 'INSERT' AND changes.size = m.file_size
      AND changes.relative_path ILIKE '%.pdf'
  ) src ON dest.relative_path = src.relative_path
  WHEN NOT MATCHED THEN INSERT
    (relative_path, document_id, vendor_name, version, contract_id, expected_pages, sha256, file_size)
  VALUES
    (src.relative_path, src.document_id, src.vendor_name, src.version, src.contract_id, src.expected_pages, src.sha256, src.file_size);

CREATE DYNAMIC TABLE IF NOT EXISTS <% lab_db %>.APP.DT_CONTRACT_PDF_PARSED
  TARGET_LAG = DOWNSTREAM WAREHOUSE = <% lab_wh %>
  REFRESH_MODE = INCREMENTAL INITIALIZE = ON_SCHEDULE
  COMMENT = 'seat-sweeper-contract-pdf-v1'
AS SELECT relative_path, document_id, vendor_name, version, contract_id,
          expected_pages, sha256, ingested_at,
          AI_PARSE_DOCUMENT(
            TO_FILE('@<% lab_db %>.RAW.CONTRACT_PDF_STAGE', relative_path),
            {'mode':'LAYOUT', 'page_split':TRUE}, TRUE
          ) AS parse_result
FROM <% lab_db %>.RAW.CONTRACT_PDF_FILE_LOG;

CREATE DYNAMIC TABLE IF NOT EXISTS <% lab_db %>.APP.DT_CONTRACT_PDF_PAGES
  TARGET_LAG = '1 minute' WAREHOUSE = <% lab_wh %>
  REFRESH_MODE = INCREMENTAL INITIALIZE = ON_SCHEDULE
  COMMENT = 'seat-sweeper-contract-pdf-v1'
AS SELECT p.relative_path, p.document_id, p.vendor_name, p.version, p.contract_id,
          p.sha256, p.ingested_at,
          page.value:index::INT + 1 AS page_number,
          p.document_id || ':v' || p.version || ':p' || (page.value:index::INT + 1) AS source_id,
          p.vendor_name || ' - ' || SPLIT_PART(p.relative_path, '/', -1) || ' - p. ' || (page.value:index::INT + 1) AS source_title,
          'Synthetic workshop agreement. Vendor: ' || p.vendor_name || '\nFile: ' || p.relative_path || '\nPage: ' || (page.value:index::INT + 1) || '\n' || page.value:content::VARCHAR AS content
FROM <% lab_db %>.APP.DT_CONTRACT_PDF_PARSED p,
     LATERAL FLATTEN(INPUT => p.parse_result:value:pages) page
WHERE p.parse_result:error::VARCHAR IS NULL AND LENGTH(TRIM(page.value:content::VARCHAR)) > 0;
