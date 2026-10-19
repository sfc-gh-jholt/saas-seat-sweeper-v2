import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from contract_pipeline import CONTRACTS, ROOT, Pipeline, literal, manifest_rows, names_from


class ContractPipelineTests(unittest.TestCase):
    def test_manifest_baseline_and_arrival(self):
        self.assertEqual(len(manifest_rows('baseline')), 10)
        arrival = manifest_rows('new-arrival')
        self.assertEqual(arrival[0]['vendor'], 'Zoom Pro')
        self.assertIsNone(arrival[0]['contract_id'])
        self.assertEqual(sum(r['expected_pages'] for r in manifest_rows('all')), 11)

    def test_no_clauses_in_runtime_manifest(self):
        for row in manifest_rows('all'):
            self.assertNotIn('clauses', row)
            self.assertNotIn('content', row)

    def test_names_reject_executable_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'names.env'
            path.write_text('lab_db=$(touch bad)\n')
            with self.assertRaises(ValueError):
                names_from(path)

    def test_literal_escapes_quotes(self):
        self.assertEqual(literal("vendor's"), "'vendor''s'")
        self.assertEqual(literal(None), 'NULL')

    def test_checkpoint_statement_boundary(self):
        instance = Pipeline('test', names_from(ROOT / 'sql/v2/names.default.env'))
        with patch.object(instance, 'guard', return_value=False), patch.object(instance, 'sql', return_value=[]) as execute, patch.object(instance, 'check_modes'):
            instance.build()
            self.assertEqual(execute.call_count, 7)
            self.assertTrue(all(call.args[0].startswith('CREATE ') for call in execute.call_args_list))

    def test_landing_only_creates_stage_manifest(self):
        instance = Pipeline('test', names_from(ROOT / 'sql/v2/names.default.env'))
        with patch.object(instance, 'guard', return_value=False), patch.object(instance, 'sql', return_value=[]) as execute:
            instance.build(landing=True)
            self.assertEqual(execute.call_count, 2)

    def test_build_rerun_does_not_replace(self):
        instance = Pipeline('test', names_from(ROOT / 'sql/v2/names.default.env'))
        with patch.object(instance, 'guard', return_value=True), patch.object(instance, 'verify_definition'), patch.object(instance, 'sql') as execute, patch.object(instance, 'check_modes'):
            instance.build()
            execute.assert_not_called()

    def test_wrong_modes_block(self):
        instance = Pipeline('test', names_from(ROOT / 'sql/v2/names.default.env'))
        with patch.object(instance, 'sql', return_value=[{'name':'DT_CONTRACT_PDF_PARSED', 'refresh_mode':'FULL'}]):
            with self.assertRaises(RuntimeError):
                instance.check_modes()

    def test_unmanaged_collision_blocked(self):
        instance = Pipeline('test', names_from(ROOT / 'sql/v2/names.default.env'))
        with patch.object(instance, 'sql', return_value=[{'name':'CONTRACT_PDF_STAGE', 'owner':'ACCOUNTADMIN', 'comment':'other'}]):
            with self.assertRaises(RuntimeError):
                instance.guard('STAGE', 'SEAT_SWEEPER_LAB.RAW.CONTRACT_PDF_STAGE')

    def test_metadata_only_seed(self):
        seed = (ROOT / 'sql/v2/01_seed.sql').read_text()
        self.assertNotIn('contract_terms_text', seed)
        self.assertNotIn('Cancellation requires', seed)

    def test_json_null_and_page_number(self):
        sql = (ROOT / 'sql/v2/04_document_pipeline.sql').read_text()
        self.assertIn('parse_result:error::VARCHAR IS NULL', sql)
        self.assertIn('page.value:index::INT + 1', sql)
        self.assertEqual(sql.count('REFRESH_MODE = INCREMENTAL'), 2)
        self.assertNotIn('CREATE OR REPLACE', sql)


if __name__ == '__main__':
    unittest.main()
