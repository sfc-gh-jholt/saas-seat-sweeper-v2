"""Import immutable workshop PDFs and operate their incremental pipeline.

Uses the installed Snowflake CLI and Python standard library only.
Run --help for commands. No credentials are read or printed by this script.
"""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / 'v2' / 'contracts'
MARKER = 'seat-sweeper-contract-pdf-v1'


def names_from(path):
    names = {}
    for line in Path(path).read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, value = line.split('=', 1)
        if key not in {'lab_db', 'lab_wh', 'lab_role', 'lab_build_eai'} or not re.fullmatch(r'[A-Z][A-Z0-9_]*', value):
            raise ValueError('Invalid names file entry: ' + key)
        if key in names:
            raise ValueError('Duplicate names file entry: ' + key)
        names[key] = value
    if not {'lab_db', 'lab_wh', 'lab_role'} <= names.keys():
        raise ValueError('Names file missing required identifiers')
    return names


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def manifest_rows(group):
    rows = json.loads((CONTRACTS / 'manifest.json').read_text())
    selected = [row for row in rows if group == 'all' or row['group'] == group]
    paths = set()
    for row in selected:
        path = (CONTRACTS / row['relative_path']).resolve()
        if (not path.is_relative_to(CONTRACTS.resolve()) or path.suffix != '.pdf'
                or not re.fullmatch(r'(baseline|new-arrival)/[a-z0-9-]+\.pdf', row['relative_path'])
                or row['relative_path'] in paths):
            raise ValueError('Invalid or duplicate PDF path')
        paths.add(row['relative_path'])
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != row['sha256'] or len(data) != row['size_bytes']:
            raise ValueError('PDF differs from manifest: ' + str(path))
    if not selected:
        raise ValueError('No documents selected')
    return selected


class Pipeline:
    def __init__(self, connection, names):
        self.names = names
        self.db = names['lab_db']
        self.raw = self.db + '.RAW'
        self.app = self.db + '.APP'
        self.stage = self.raw + '.CONTRACT_PDF_STAGE'
        self.base = ['snow', 'sql', '--connection', connection, '--role', 'ACCOUNTADMIN',
                     '--warehouse', names['lab_wh'], '--database', self.db, '--schema', 'APP', '--format', 'JSON']

    def sql(self, query):
        result = subprocess.run(self.base + ['-q', query], capture_output=True, text=True, timeout=180)
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        return json.loads(result.stdout)

    def render(self, text):
        for key, value in self.names.items():
            text = text.replace('<% ' + key + ' %>', value)
        if '<%' in text:
            raise ValueError('Unresolved SQL template parameter')
        return text

    def guard(self, kind, fqn):
        schema, name = fqn.rsplit('.', 1)
        plural = {'TABLE':'TABLES', 'STAGE':'STAGES', 'STREAM':'STREAMS', 'TASK':'TASKS',
                  'DYNAMIC TABLE':'DYNAMIC TABLES', 'CORTEX SEARCH SERVICE':'CORTEX SEARCH SERVICES'}[kind]
        found = [r for r in self.sql(f"SHOW {plural} LIKE '{name}' IN SCHEMA {schema}") if r.get('name') == name]
        if found and (found[0].get('comment') != MARKER or found[0].get('owner') != 'ACCOUNTADMIN'):
            raise RuntimeError('Refusing unmanaged object: ' + fqn)
        return bool(found)

    def build(self, landing=False):
        text = self.render((ROOT / 'sql/v2/04_document_pipeline.sql').read_text())
        text = re.sub(r'^\s*--[^\n]*', '', text, flags=re.M)
        # This checkpoint contains only simple statements; no scripting blocks or quoted semicolons.
        for statement in text.split(';'):
            statement = re.sub(r'^\s*--[^\n]*', '', statement, flags=re.M).strip()
            if not statement:
                continue
            match = re.match(r'CREATE (DYNAMIC TABLE|TABLE|STAGE|STREAM|TASK) IF NOT EXISTS (\S+)', statement)
            if not match:
                raise ValueError('Unexpected checkpoint statement')
            kind, fqn = match.groups()
            if landing and not (kind == 'STAGE' or fqn.endswith('.CONTRACT_PDF_MANIFEST')):
                continue
            exists = self.guard(kind, fqn)
            if exists:
                self.verify_definition(kind, fqn, statement)
                print('Preserved existing ' + fqn)
            else:
                self.sql(statement)
                print('Created ' + fqn)
        if not landing:
            self.check_modes()

    def verify_definition(self, kind, fqn, expected):
        if kind in {'TASK', 'DYNAMIC TABLE'}:
            schema, name = fqn.rsplit('.', 1)
            plural = 'TASKS' if kind == 'TASK' else 'DYNAMIC TABLES'
            actual = next(r for r in self.sql(f"SHOW {plural} LIKE '{name}' IN SCHEMA {schema}") if r['name'] == name)
            actual_body = actual.get('definition') if kind == 'TASK' else re.split(r'\bAS\s+SELECT\b', actual['text'], maxsplit=1, flags=re.I)[-1]
            expected_body = re.split(r'\bAS\s+', expected, maxsplit=1, flags=re.I)[-1]
            if kind == 'DYNAMIC TABLE':
                expected_body = re.sub(r'^SELECT\s+', '', expected_body, flags=re.I)
            # Tokenize literals separately: ignore SQL formatting, not literal content.
            def tokens(sql):
                return [token if token.startswith("'") else token.upper() for token in
                        re.findall(r"'(?:''|[^'])*'|[A-Za-z_][A-Za-z_0-9$]*|[0-9]+|[^\s]", sql.rstrip(';'))]
            if tokens(actual_body or '') != tokens(expected_body):
                raise RuntimeError('Definition drift; review before changing ' + fqn)
            if actual.get('warehouse') != self.names['lab_wh']:
                raise RuntimeError('Warehouse drift: ' + fqn)
        elif kind == 'TABLE':
            actual = self.sql(f'DESCRIBE TABLE {fqn}')
            expected_columns = ['RELATIVE_PATH','DOCUMENT_ID','VENDOR_NAME','VERSION','CONTRACT_ID','EXPECTED_PAGES','SHA256','FILE_SIZE']
            if fqn.endswith('_FILE_LOG'):
                expected_columns.append('INGESTED_AT')
            if [r['name'] for r in actual] != expected_columns:
                raise RuntimeError('Table schema drift: ' + fqn)
        elif kind == 'STREAM':
            schema, name = fqn.rsplit('.', 1)
            actual = next(r for r in self.sql(f"SHOW STREAMS LIKE '{name}' IN SCHEMA {schema}") if r['name'] == name)
            if actual.get('table_name') != self.stage or actual.get('source_type') != 'Stage' or actual.get('stale'):
                raise RuntimeError('Stage stream source drift or stale stream: ' + fqn)
        elif kind == 'STAGE':
            properties = self.sql(f'DESCRIBE STAGE {fqn}')
            encryption = [r for r in properties if r.get('parent_property') == 'ENCRYPTION' and r.get('property') == 'TYPE']
            if encryption and encryption[0].get('property_value') != 'SNOWFLAKE_SSE':
                raise RuntimeError('Stage encryption drift: ' + fqn)

    def check_modes(self):
        rows = self.sql(f"SHOW DYNAMIC TABLES LIKE 'DT_CONTRACT_PDF_%' IN SCHEMA {self.app}")
        expected = {'DT_CONTRACT_PDF_PARSED', 'DT_CONTRACT_PDF_PAGES'}
        actual = {r['name'] for r in rows if r.get('refresh_mode') == 'INCREMENTAL'}
        if actual != expected:
            raise RuntimeError('Expected exactly two INCREMENTAL document tables')

    def register(self, row):
        values = [row['relative_path'], row['document_id'], row['vendor'], row['version'], row['contract_id'],
                  row['expected_pages'], row['sha256'], row['size_bytes']]
        columns = 'relative_path,document_id,vendor_name,version,contract_id,expected_pages,sha256,file_size'
        existing = self.sql(f"SELECT {columns} FROM {self.raw}.CONTRACT_PDF_MANIFEST WHERE relative_path={literal(row['relative_path'])}")
        if existing:
            if len(existing) != 1 or [existing[0][key.upper()] for key in columns.split(',')] != values:
                raise RuntimeError('Immutable manifest conflict: ' + row['relative_path'])
            return
        self.sql(f'INSERT INTO {self.raw}.CONTRACT_PDF_MANIFEST ({columns}) VALUES ({",".join(map(literal, values))})')

    def upload(self, rows):
        for kind, name in [('STAGE', self.stage), ('TABLE', self.raw + '.CONTRACT_PDF_MANIFEST')]:
            if not self.guard(kind, name):
                raise RuntimeError('Run landing first: ' + name)
        for row in rows:
            relative = row['relative_path']
            self.register(row)
            existing = self.sql(f"LIST @{self.stage}/{relative}")
            # LIST is a prefix match; only accept an exact basename/path suffix.
            existing = [r for r in existing if r['name'].endswith('/' + relative)]
            if existing:
                with tempfile.TemporaryDirectory() as directory:
                    self.sql(f"GET @{self.stage}/{relative} 'file://{directory}/'")
                    remote = Path(directory) / Path(relative).name
                    if not remote.exists() or hashlib.sha256(remote.read_bytes()).hexdigest() != row['sha256']:
                        raise RuntimeError('Existing staged bytes differ; use a new version path: ' + relative)
                print('Unchanged PDF: ' + relative)
                continue
            uri = 'file://' + str(CONTRACTS / relative)
            self.sql(f"PUT {literal(uri)} @{self.stage}/{Path(relative).parent.as_posix()}/ AUTO_COMPRESS=FALSE OVERWRITE=FALSE")
            print('Uploaded PDF: ' + relative)
        self.sql(f'ALTER STAGE {self.stage} REFRESH')

    def backlog(self):
        # Use only before resuming the task; prevents concurrent backlog/task MERGEs.
        tasks = self.sql(f"SHOW TASKS LIKE 'CONTRACT_PDF_INGEST_TASK' IN SCHEMA {self.raw}")
        if tasks[0]['state'] != 'suspended':
            raise RuntimeError('Backlog seeding requires suspended ingest task')
        self.sql(f'''MERGE INTO {self.raw}.CONTRACT_PDF_FILE_LOG dest
USING (SELECT m.* FROM DIRECTORY(@{self.stage}) files
JOIN {self.raw}.CONTRACT_PDF_MANIFEST m ON m.relative_path=files.relative_path AND m.file_size=files.size) src
ON dest.relative_path=src.relative_path
WHEN NOT MATCHED THEN INSERT (relative_path,document_id,vendor_name,version,contract_id,expected_pages,sha256,file_size)
VALUES(src.relative_path,src.document_id,src.vendor_name,src.version,src.contract_id,src.expected_pages,src.sha256,src.file_size)''')

    def wait(self, rows, timeout, search=False):
        deadline = time.monotonic() + timeout
        expected = {r['relative_path']: r['expected_pages'] for r in rows}
        unknown = self.sql(f'''SELECT files.relative_path FROM DIRECTORY(@{self.stage}) files
LEFT JOIN {self.raw}.CONTRACT_PDF_MANIFEST m ON m.relative_path=files.relative_path
WHERE m.relative_path IS NULL OR files.size<>m.file_size''')
        if unknown:
            raise RuntimeError('Unrecognized or changed staged files: ' + json.dumps(unknown))
        while time.monotonic() < deadline:
            parsed = self.sql(f'SELECT relative_path, parse_result:error::VARCHAR AS error FROM {self.app}.DT_CONTRACT_PDF_PARSED')
            failures = [r for r in parsed if r['ERROR'] is not None]
            if failures:
                raise RuntimeError('Document parse errors: ' + json.dumps(failures))
            pages = self.sql(f'SELECT relative_path, page_number, source_id FROM {self.app}.DT_CONTRACT_PDF_PAGES')
            actual = {}
            for page in pages:
                actual.setdefault(page['RELATIVE_PATH'], []).append(page['PAGE_NUMBER'])
            ready = all(sorted(actual.get(path, [])) == list(range(1, count + 1)) for path, count in expected.items())
            if ready and search:
                for row in rows:
                    request = json.dumps({'query': row['vendor'], 'columns':['RELATIVE_PATH','PAGE_NUMBER','CONTENT'],
                                          'filter':{'@eq':{'RELATIVE_PATH':row['relative_path']}}, 'limit':10})
                    result = self.sql(f"SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW('{self.app}.CONTRACT_PDF_SEARCH', {literal(request)}) AS result")
                    payload = result[0]['RESULT']
                    hits = json.loads(payload)['results'] if isinstance(payload, str) else payload['results']
                    ready = ready and sorted(int(hit['PAGE_NUMBER']) for hit in hits) == list(range(1, row['expected_pages'] + 1))
            if ready:
                print(f'Ready: {len(rows)} documents; PDF pages' + (' and Search verified' if search else ' verified'))
                return
            print('Waiting for parsed pages' + (' / Search' if search else '') + '...', flush=True)
            time.sleep(5)
        raise TimeoutError('Readiness timeout; inspect task history and dynamic-table refresh history. Do not rebuild or reload text.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['landing','build','stage','import','backlog','wait','resume','pause'])
    parser.add_argument('--connection', required=True)
    parser.add_argument('--names', default=str(ROOT / 'sql/v2/names.default.env'))
    parser.add_argument('--group', choices=['baseline','new-arrival','all'], default='baseline')
    parser.add_argument('--document', help='Optional manifest document_id for a capped first test')
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('--search', action='store_true', help='Require indexed page evidence too')
    args = parser.parse_args()
    started = time.monotonic()
    pipeline = Pipeline(args.connection, names_from(args.names))
    print('Target:', pipeline.sql('SELECT CURRENT_ACCOUNT_NAME() AS account, CURRENT_ROLE() AS role'), pipeline.db, flush=True)
    rows = manifest_rows(args.group)
    if args.document:
        rows = [row for row in rows if row['document_id'] == args.document]
        if not rows:
            raise ValueError('Document not in selected group')
    if args.command == 'landing':
        pipeline.build(landing=True)
    elif args.command == 'build':
        pipeline.build()
    elif args.command == 'stage':
        pipeline.upload(rows)
    elif args.command == 'import':
        pipeline.upload(rows)
        pipeline.sql(f'EXECUTE TASK {pipeline.raw}.CONTRACT_PDF_INGEST_TASK')
        pipeline.wait(rows, args.timeout, args.search)
    elif args.command == 'backlog':
        pipeline.backlog()
    elif args.command == 'wait':
        pipeline.wait(rows, args.timeout, args.search)
    elif args.command == 'resume':
        pipeline.check_modes()
        pipeline.sql(f'ALTER DYNAMIC TABLE {pipeline.app}.DT_CONTRACT_PDF_PARSED RESUME')
        pipeline.sql(f'ALTER DYNAMIC TABLE {pipeline.app}.DT_CONTRACT_PDF_PAGES RESUME')
        pipeline.wait(rows, args.timeout, True)
        pipeline.sql(f'ALTER TASK {pipeline.raw}.CONTRACT_PDF_INGEST_TASK RESUME')
    elif args.command == 'pause':
        pipeline.sql(f'ALTER TASK {pipeline.raw}.CONTRACT_PDF_INGEST_TASK SUSPEND')
        pipeline.sql(f'ALTER DYNAMIC TABLE {pipeline.app}.DT_CONTRACT_PDF_PAGES SUSPEND')
        pipeline.sql(f'ALTER DYNAMIC TABLE {pipeline.app}.DT_CONTRACT_PDF_PARSED SUSPEND')
        print('Task and DTs paused. Search serving/indexing and storage may still incur costs; see operating checklist.')
    print(f'Elapsed: {time.monotonic() - started:.1f} seconds')


if __name__ == '__main__':
    main()
