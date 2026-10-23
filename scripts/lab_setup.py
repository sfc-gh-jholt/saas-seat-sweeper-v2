"""Seat Sweeper V2 lab setup. Runs the same steps in a Snowsight notebook or on a laptop.

  In a Snowsight Workspaces notebook (uses the notebook's own session):
      import lab_setup; lab_setup.run()
  On a laptop (CoCo Desktop, any terminal), with a named connection:
      python scripts/lab_setup.py --connection <name> [--names sql/v2/names.default.env]

Every step checks what exists first, so re-running is safe. Passwords are never printed.
"""
import argparse
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / 'sql' / 'v2'
PG_INSTANCE = 'SEAT_SWEEPER_PG'
IDENT = re.compile(r'[A-Z][A-Z0-9_]*')
HOST = re.compile(r'[a-z0-9][a-z0-9.-]*')


class Snowflake:
    """One small interface over a Snowpark session (Snowsight) or a connector connection (laptop)."""

    def __init__(self, session=None, conn=None):
        self.session, self.conn = session, conn

    @classmethod
    def connect(cls, connection=None):
        try:
            from snowflake.snowpark.context import get_active_session
            return cls(session=get_active_session())
        except Exception:
            if not connection:
                raise SystemExit('No notebook session found. Pass --connection <name> (see: snow connection list).')
            import snowflake.connector
            return cls(conn=snowflake.connector.connect(connection_name=connection))

    @property
    def in_snowsight(self):
        return self.session is not None

    def rows(self, query):
        """Run one statement; return rows as dicts keyed by the column names Snowflake returns."""
        if self.session is not None:
            return [r.as_dict() for r in self.session.sql(query).collect()]
        from snowflake.connector import DictCursor
        with self.conn.cursor(DictCursor) as cur:
            cur.execute(query)
            return cur.fetchall() if cur.description else []

    def put(self, local_path, stage_dir):
        if self.session is not None:
            self.session.file.put(str(local_path), stage_dir, auto_compress=False, overwrite=False)
        else:
            self.rows(f"PUT 'file://{local_path}' {stage_dir} AUTO_COMPRESS=FALSE OVERWRITE=FALSE")

    def get(self, stage_path, local_dir):
        if self.session is not None:
            self.session.file.get(stage_path, str(local_dir))
        else:
            self.rows(f"GET {stage_path} 'file://{local_dir}/'")

    def run_script(self, text):
        """Run every statement in a SQL script and return the last result."""
        result = []
        for statement in split_statements(text):
            result = self.rows(statement)
        return result


def split_statements(text):
    """Split a SQL script on semicolons outside quotes, comments and $$ blocks."""
    statements, current, i, n = [], [], 0, len(text)
    while i < n:
        two = text[i:i + 2]
        if two == '--':
            end = text.find('\n', i)
            i = n if end < 0 else end
            continue
        if two == '/*':
            end = text.find('*/', i + 2)
            i = n if end < 0 else end + 2
            continue
        if two == '$$':
            end = text.find('$$', i + 2)
            end = n if end < 0 else end + 2
            current.append(text[i:end])
            i = end
            continue
        ch = text[i]
        if ch == "'":
            j = i + 1
            while j < n:
                if text[j] == "'" and text[j + 1:j + 2] == "'":
                    j += 2
                elif text[j] == "'":
                    break
                else:
                    j += 1
            current.append(text[i:j + 1])
            i = j + 1
            continue
        if ch == ';':
            statement = ''.join(current).strip()
            if statement:
                statements.append(statement)
            current = []
        else:
            current.append(ch)
        i += 1
    statement = ''.join(current).strip()
    if statement:
        statements.append(statement)
    return statements


def render(text, values):
    """Fill <% key %> placeholders, the same syntax snow sql -D uses. Values must be identifiers or hosts."""
    for key, value in values.items():
        pattern = HOST if key == 'pg_host' else IDENT
        if not pattern.fullmatch(value):
            raise ValueError(f'Invalid value for {key}: {value!r}')
    def fill(match):
        key = match.group(1)
        if key not in values:
            raise ValueError(f'No value for <% {key} %>')
        return values[key]
    return re.sub(r'<%\s*(\w+)\s*%>', fill, text)


def run_file(sf, name, values):
    print(f'Running sql/v2/{name}', flush=True)
    return sf.run_script(render((SQL / name).read_text(), values))


def run(sf=None, connection=None, names_file=SQL / 'names.default.env'):
    from contract_pipeline import Pipeline, manifest_rows, names_from
    import pg_setup

    started = time.monotonic()
    sf = sf or Snowflake.connect(connection)
    names = names_from(names_file)
    sf.rows('USE ROLE ACCOUNTADMIN')
    print('Account check:', sf.rows('SELECT CURRENT_ACCOUNT_NAME() AS account, CURRENT_USER() AS user_name, '
                                    'CURRENT_ROLE() AS role')[0], flush=True)

    run_file(sf, '00_setup.sql', names)
    run_file(sf, '01_seed.sql', names)

    # Stage the real documents now; the attendee builds parsing in the pipeline segment.
    sf.rows(f"USE WAREHOUSE {names['lab_wh']}")
    sf.rows(f"USE SCHEMA {names['lab_db']}.APP")
    pipeline = Pipeline(None, names, sf=sf)
    pipeline.build(landing=True)
    pipeline.upload(manifest_rows('baseline'))

    # Postgres system of record, then the mirror that feeds the OPS views.
    pg = pg_setup.ensure_instance(sf, PG_INSTANCE)
    run_file(sf, '06_app_postgres_access.sql', {**names, 'pg_instance': PG_INSTANCE, 'pg_host': pg.host})
    pg_setup.ensure_app_database(sf, pg, names)
    mirror_db = pg_setup.ensure_mirror(sf, PG_INSTANCE)
    run_file(sf, '05_ops_views.sql', {**names, 'mirror_db': mirror_db})

    print(f'Setup complete in {time.monotonic() - started:.0f}s. Postgres mirror: {mirror_db}. '
          f'Suspend the instance when idle: ALTER POSTGRES INSTANCE {PG_INSTANCE} SUSPEND;', flush=True)
    return mirror_db


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--connection', help='named connection from ~/.snowflake/connections.toml')
    parser.add_argument('--names', default=str(SQL / 'names.default.env'))
    args = parser.parse_args()
    run(connection=args.connection, names_file=args.names)


if __name__ == '__main__':
    main()
