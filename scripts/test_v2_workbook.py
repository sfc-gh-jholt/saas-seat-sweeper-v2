"""Offline V2 workbook, distribution and relational-semantics checks.

SQLite fixtures test the SELECT logic, not Snowflake compilation or DT refresh.
No notebook cells, shell commands or cloud calls are executed.
"""
import copy
import hashlib
from datetime import date, timedelta
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import unittest
import zipfile

from unittest.mock import patch
from deploy_lab_agent import require_fresh_agent
from validate_notebook import validate_notebook, validate_links_and_prompts

ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK = ROOT / 'v2/START_HERE.ipynb'


def notebook_text(notebook):
    return '\n'.join(''.join(cell['source']) for cell in notebook['cells'])


class AgentDeployGuardTests(unittest.TestCase):
    def test_existing_agent_rejected(self):
        with patch('deploy_lab_agent.run', return_value='[{"name":"SEAT_SWEEPER_AGENT"}]'):
            with self.assertRaisesRegex(RuntimeError, 'already exists'):
                require_fresh_agent('test', 'SEAT_SWEEPER_LAB.APP.SEAT_SWEEPER_AGENT')

    def test_missing_agent_allowed_and_errors_fail_closed(self):
        with patch('deploy_lab_agent.run', return_value='[]'):
            require_fresh_agent('test', 'SEAT_SWEEPER_LAB.APP.SEAT_SWEEPER_AGENT')
        with patch('deploy_lab_agent.run', return_value='{}'):
            with self.assertRaises(RuntimeError):
                require_fresh_agent('test', 'SEAT_SWEEPER_LAB.APP.SEAT_SWEEPER_AGENT')
        with patch('deploy_lab_agent.run', side_effect=RuntimeError('permission denied')):
            with self.assertRaises(RuntimeError):
                require_fresh_agent('test', 'SEAT_SWEEPER_LAB.APP.SEAT_SWEEPER_AGENT')


class WorkbookTests(unittest.TestCase):
    def test_notebook_links_and_all_canonical_prompt_blocks(self):
        notebook = validate_notebook(NOTEBOOK.read_bytes())
        validate_links_and_prompts(notebook, ROOT, ROOT / 'v2')
        text = notebook_text(notebook)
        markers = re.findall(r'<!-- prompt: (\S+) -->', text)
        expected = []
        for path in sorted((ROOT / 'v2/coco-prompts').glob('*.md')):
            blocks = re.findall(r'```text\n(.*?)\n```', path.read_text(), re.S)
            expected.extend(f'coco-prompts/{path.name}#{index + 1}' for index in range(len(blocks)))
        self.assertCountEqual(markers, expected)
        self.assertEqual(len(markers), len(set(markers)))
        positions = [text.index(f'## {step}. ') for step in range(1, 12)]
        self.assertEqual(positions, sorted(positions))
        for phrase in ['deployment one', 'deployment two', 'deployment three',
                       'no app redeploy', '14 structured checks', 'same service',
                       'staged, parsed, and indexed', 'cortex agent-studio --help']:
            self.assertIn(phrase, text)
        self.assertNotIn('%%sql', text)
        self.assertNotIn('three KPI', text)
        self.assertNotRegex(text, r'/(?:Users|home)/')

    def test_code_cells_remain_local_and_nonmutating(self):
        notebook = validate_notebook(NOTEBOOK.read_bytes())
        code = '\n'.join(''.join(cell['source']) for cell in notebook['cells'] if cell['cell_type'] == 'code')
        self.assertNotRegex(code, r'subprocess|os\.system|\.write_text|\.write_bytes|shell=True|pip install|session\.sql')
        self.assertIn('shlex.quote', code)
        self.assertIn("manifest_rows']('all')", code)
        self.assertIn('REPLACE_WITH_YOUR_NAMED_CONNECTION', code)

    def test_all_command_paths_exist(self):
        text = notebook_text(validate_notebook(NOTEBOOK.read_bytes()))
        for path in re.findall(r'(?:bash|python3|-f) ((?:scripts|sql|v2)/[\w./-]+)', text):
            self.assertTrue((ROOT / path).is_file(), path)

    def test_validator_keeps_legacy_single_block_behavior(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prompts = root / 'coco-prompts'
            prompts.mkdir()
            path = prompts / 'test.md'
            path.write_text('```text\nfirst\n```\n')
            notebook = {'cells': [{'cell_type': 'markdown', 'source':
                         '<!-- prompt: coco-prompts/test.md -->\n```text\nfirst\n```'}]}
            validate_links_and_prompts(notebook, root)
            path.write_text('```text\nfirst\n```\n```text\nsecond\n```')
            with self.assertRaises(ValueError):
                validate_links_and_prompts(notebook, root)
            notebook['cells'][0]['source'] = '<!-- prompt: coco-prompts/test.md#2 -->\n```text\nsecond\n```'
            validate_links_and_prompts(notebook, root)
            for marker in ['test.md#0', 'test.md#3', 'test.md#bad', '../../outside.md#1']:
                notebook['cells'][0]['source'] = f'<!-- prompt: coco-prompts/{marker} -->\n```text\nsecond\n```'
                with self.assertRaises(ValueError):
                    validate_links_and_prompts(notebook, root)

    def test_packaged_workbook_is_self_contained(self):
        archive_path = ROOT / 'dist/seat-sweeper-v2.zip'
        if not archive_path.is_file():
            self.skipTest('Build participant archive to check clean distribution')
        with tempfile.TemporaryDirectory() as directory, zipfile.ZipFile(archive_path) as archive:
            destination = Path(directory)
            for name in archive.namelist():
                self.assertTrue((destination / name).resolve().is_relative_to(destination.resolve()))
            archive.extractall(destination)
            kit = destination / 'seat-sweeper'
            manifest = json.loads((kit / 'package-manifest.json').read_text())
            for name, digest in manifest.items():
                self.assertEqual(hashlib.sha256((kit / name).read_bytes()).hexdigest(), digest, name)
            notebook = validate_notebook((kit / 'v2/START_HERE.ipynb').read_bytes())
            validate_links_and_prompts(notebook, kit, kit / 'v2')
            self.assertEqual(len(list((kit / 'v2/contracts').rglob('*.pdf'))), 11)
            self.assertNotIn('rehearsal:', (kit / 'v2/starter-app/app.yml').read_text())
            for name in ['validate_notebook.py', 'contract_pipeline.py', 'deploy_lab_agent.py']:
                self.assertTrue((kit / 'scripts' / name).is_file())

    def test_bad_prompt_and_link_fail_closed(self):
        original = validate_notebook(NOTEBOOK.read_bytes())
        for source in ['[outside](../../outside.md)', '[missing](absent.md)',
                       '<!-- prompt: coco-prompts/build-pipeline.md#1 -->\n```text\ndrift\n```',
                       '<!-- prompt: broken -->']:
            notebook = copy.deepcopy(original)
            notebook['cells'][0]['source'] = source
            with self.subTest(source=source), self.assertRaises(ValueError):
                validate_links_and_prompts(notebook, ROOT, ROOT / 'v2')


class StructuredPipelineTests(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(':memory:')
        self.addCleanup(self.connection.close)
        self.connection.create_function('DATEADD', 3,
            lambda unit, days, value: (date.fromisoformat(value) + timedelta(days=days)).isoformat())
        self.connection.create_function('EQUAL_NULL', 2, lambda left, right: left == right)
        self.connection.executescript('''
            CREATE TABLE EMPLOYEES(emp_id INTEGER, department TEXT);
            CREATE TABLE ASSETS(asset_id INTEGER, asset_name TEXT, monthly_cost_per_seat NUMERIC, contract_id INTEGER);
            CREATE TABLE CONTRACTS(contract_id INTEGER, vendor_name TEXT);
            CREATE TABLE EMPLOYEE_ASSETS(emp_id INTEGER, asset_id INTEGER, status TEXT, last_active_date TEXT);
            INSERT INTO EMPLOYEES VALUES(1, 'Engineering'), (2, 'Sales');
            INSERT INTO CONTRACTS VALUES(10, 'Same Vendor'), (11, 'Same Vendor');
            INSERT INTO ASSETS VALUES(1,'First',20,10),(2,'Second',30,11),
              (3,'Unmatched',5,999),(4,'No Link',7,NULL),(5,'Free',0,NULL),(6,'Negative',-1,NULL);
            INSERT INTO EMPLOYEE_ASSETS VALUES
              (1,1,'Inactive','2026-09-19'), (1,2,'Inactive','2026-09-01'),
              (1,3,'Inactive','2026-09-01'), (1,4,'Inactive','2026-09-01'),
              (1,5,'Inactive','2026-09-01'), (1,6,'Inactive','2026-09-01'),
              (2,1,'Inactive','2026-09-20'), (2,2,'Active','2026-09-01'),
              (2,3,'Inactive',NULL), (2,4,'Inactive','2026-11-01');
        ''')
        self.checkpoint = (ROOT / 'sql/v2/checkpoint_vendor_opportunity.sql').read_text()

    @staticmethod
    def local_sql(sql):
        return sql.replace('<% lab_db %>.RAW.', '').replace('<% lab_db %>.APP.', '').replace('CURRENT_DATE()', "'2026-10-19'")

    def build(self):
        for name, query in re.findall(r'CREATE (?:DYNAMIC TABLE|VIEW) <% lab_db %>\.APP\.(\w+).*?\nAS\n(.*?);', self.checkpoint, re.S):
            self.connection.execute(f'CREATE TABLE {name} AS ' + self.local_sql(query))

    def checks(self):
        sql = (ROOT / 'sql/v2/02_check_vendor_opportunity.sql').read_text()
        return self.connection.execute(self.local_sql(sql[sql.index('WITH source_assignments'):])).fetchall()

    def test_boundaries_grain_unlinked_and_annualization(self):
        self.build()
        rows = self.connection.execute('SELECT * FROM V_VENDOR_OPPORTUNITY').fetchall()
        self.assertEqual(len(rows), 4)
        self.assertEqual(sum(row[4] for row in rows), 4)
        self.assertEqual(sum(row[5] for row in rows), 62)
        self.assertEqual(sum(row[6] for row in rows), 744)
        self.assertEqual(sum(row[4] for row in rows if not row[2]), 2)
        results = self.checks()
        self.assertEqual(len(results), 14)
        self.assertTrue(all(row[3] for row in results), results)

    def test_empty_eligibility_is_valid_zero(self):
        self.connection.execute("UPDATE EMPLOYEE_ASSETS SET status='Active'")
        self.build()
        self.assertTrue(all(row[3] for row in self.checks()))

    def test_duplicate_dimensions_and_orphans_detected(self):
        self.connection.execute("INSERT INTO EMPLOYEES VALUES(1,'Engineering')")
        self.connection.execute("INSERT INTO EMPLOYEE_ASSETS VALUES(99,1,'Inactive','2026-09-01')")
        self.build()
        failed = [row[0] for row in self.checks() if not row[3]]
        self.assertIn('Raw employee keys are unique', failed)
        self.assertIn('Enrichment has unique employee/asset pairs', failed)
        self.assertIn('Every assignment has employee and asset dimensions', failed)

    def test_matching_grand_total_cannot_hide_wrong_groups(self):
        self.build()
        self.connection.execute('UPDATE V_VENDOR_OPPORTUNITY SET monthly_opportunity=monthly_opportunity+1 WHERE contract_id=10')
        self.connection.execute('UPDATE V_VENDOR_OPPORTUNITY SET monthly_opportunity=monthly_opportunity-1 WHERE contract_id=11')
        results = {row[0]: row[3] for row in self.checks()}
        self.assertTrue(results['Monthly opportunity matches source'])
        self.assertFalse(results['Every aggregate group matches raw calculation'])

    def test_explicit_incremental_and_no_replacement(self):
        self.assertEqual(self.checkpoint.count('REFRESH_MODE = INCREMENTAL'), 2)
        self.assertNotIn('CREATE OR REPLACE', self.checkpoint)
        self.assertNotIn('IF NOT EXISTS', self.checkpoint)
        self.assertIn('TARGET_LAG = DOWNSTREAM', self.checkpoint)
        self.assertIn("TARGET_LAG = '1 minute'", self.checkpoint)
        self.assertIn('monthly_opportunity * 12 AS annualized_opportunity', self.checkpoint)


if __name__ == '__main__':
    unittest.main()
