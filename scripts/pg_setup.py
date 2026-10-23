"""Seat Sweeper Postgres setup, called by lab_setup.py. Every step is safe to re-run.

Works on any lab_setup.Snowflake session (Snowsight notebook or laptop). Talks to Postgres with
psycopg; there is no psql, ~/.pgpass, ~/.pg_service.conf or snowflake-postgres skill dependency.

  ensure_instance     Create SEAT_SWEEPER_PG if missing (billable) and wait until it is READY and its
                      host resolves. CREATE returns the snowflake_admin password; it stays in memory.
  ensure_app_database Run sql/v2/pg/10_schema.sql, load the seed CSVs once, give seat_sweeper_app a
                      generated password, and write it with the host and CA to GOVERNANCE secrets.
                      Skipped when PG_APP_LOGIN already exists on an existing instance.
  ensure_mirror       Create the seat_sweeper_ops mirror if missing and wait until it replicates.

Passwords are never printed, logged, or written to disk.
"""
import json
import secrets
import socket
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from contract_pipeline import literal

REPO = Path(__file__).resolve().parent.parent
PG_SQL = REPO / 'sql' / 'v2' / 'pg'
MIRROR_TABLES = ['public.employees', 'public.contracts', 'public.assets',
                 'public.employee_assets', 'public.seat_actions']
SEED_TABLES = ['employees', 'contracts', 'assets', 'employee_assets']  # load order follows foreign keys
APP_LOGIN = 'seat_sweeper_app'


@dataclass
class Instance:
    name: str
    host: str
    ca: str
    admin_password: str | None = None  # set only when this run created the instance or reset access

    def __repr__(self):
        return f'Instance(name={self.name!r}, host={self.host!r})'


def log(msg):
    print(msg, flush=True)


def lower_keys(rows):
    return [{k.lower(): v for k, v in row.items()} for row in rows]


def describe(sf, name):
    return {r['property']: r['value'] for r in lower_keys(sf.rows(f'DESCRIBE POSTGRES INSTANCE {name}'))}


def admin_password_from(row):
    roles = row.get('access_roles')
    if isinstance(roles, str):
        roles = json.loads(roles)
    if isinstance(roles, dict):
        return roles.get('snowflake_admin')
    for role in roles or []:
        if isinstance(role, dict) and role.get('name') == 'snowflake_admin':
            return role.get('password')
    return None


def ensure_instance(sf, name, compute='STANDARD_M', storage=10, version=18):
    password = None
    if sf.rows(f"SHOW POSTGRES INSTANCES LIKE '{name}'"):
        log(f'Instance {name} exists; not creating.')
    else:
        log(f'Creating {name} ({compute}, {storage} GB, Postgres {version}). This is billable.')
        created = lower_keys(sf.rows(
            f"CREATE POSTGRES INSTANCE {name} COMPUTE_FAMILY = '{compute}' STORAGE_SIZE_GB = {storage} "
            f"AUTHENTICATION_AUTHORITY = POSTGRES POSTGRES_VERSION = {version} "
            "COMMENT = 'Seat Sweeper system of record'"))
        password = admin_password_from(created[0]) if created else None
        if not password:
            raise SystemExit('CREATE POSTGRES INSTANCE returned no snowflake_admin password.')

    deadline = time.time() + 1800
    while (props := describe(sf, name)).get('state') != 'READY':
        if time.time() > deadline:
            raise SystemExit(f"{name} not READY after 30 minutes (state {props.get('state')}).")
        log(f"Instance {name} state: {props.get('state')}, waiting...")
        time.sleep(15)

    host = props['host']
    # A new instance reports READY before its hostname is in public DNS (seen taking >10 min).
    deadline = time.time() + 1200
    while True:
        try:
            socket.getaddrinfo(host, 5432)
            break
        except socket.gaierror:
            if time.time() > deadline:
                raise SystemExit(f'{host} still does not resolve after 1200s. Re-run setup; every step is idempotent.')
            log(f'Waiting for DNS: {host}')
            time.sleep(15)
    return Instance(name, host, props.get('certificate', '').strip(), password)


def secret_exists(sf, fqn):
    schema, name = fqn.rsplit('.', 1)
    return any(r['name'] == name for r in sf.rows(f"SHOW SECRETS LIKE '{name}' IN SCHEMA {schema}"))


def write_secret(sf, fqn, role, clause, comment):
    sf.rows(f'CREATE OR REPLACE SECRET {fqn} {clause} COMMENT = {literal(comment)}')
    sf.rows(f'GRANT READ ON SECRET {fqn} TO ROLE {role}')


def pg_connect(pg, ca_file):
    import psycopg
    try:
        return psycopg.connect(host=pg.host, port=5432, dbname='postgres', user='snowflake_admin',
                               password=pg.admin_password, sslmode='verify-full', sslrootcert=ca_file,
                               connect_timeout=15, application_name='seat_sweeper_setup')
    except psycopg.OperationalError as err:
        raise SystemExit(
            f'Could not reach Postgres at {pg.host}:5432 ({type(err).__name__}).\n'
            'In a Snowsight notebook: open Notebook settings > External access, turn on SEAT_SWEEPER_PG_EAI, '
            'let the notebook restart, then run setup again (it skips finished steps).') from None


def ensure_app_database(sf, pg, names):
    db, role = names['lab_db'], names['lab_role']
    login_fqn = f'{db}.GOVERNANCE.PG_APP_LOGIN'
    # The host and CA differ per instance, so they are secrets too; app.yml stays identical everywhere.
    write_secret(sf, f'{db}.GOVERNANCE.PG_HOST', role, f'TYPE = GENERIC_STRING SECRET_STRING = {literal(pg.host)}',
                 'Seat Sweeper Postgres instance host')
    write_secret(sf, f'{db}.GOVERNANCE.PG_CA_CERT', role, f'TYPE = GENERIC_STRING SECRET_STRING = {literal(pg.ca)}',
                 'Seat Sweeper Postgres instance CA certificate')
    if pg.admin_password is None and secret_exists(sf, login_fqn):
        log(f'{login_fqn} exists and the instance was already set up; not changing its password.')
        return
    if pg.admin_password is None:
        # The admin password is only returned at create time, so a half-finished earlier run needs a new one.
        log('Resetting snowflake_admin access to finish Postgres setup.')
        reset = lower_keys(sf.rows(f"ALTER POSTGRES INSTANCE {pg.name} RESET ACCESS FOR 'snowflake_admin'"))
        pg.admin_password = reset[0].get('password') if reset else None
        if not pg.admin_password:
            raise SystemExit('RESET ACCESS returned no password.')

    import psycopg
    from psycopg import sql
    with tempfile.NamedTemporaryFile('w', suffix='.pem') as ca_file:
        ca_file.write(pg.ca + '\n')
        ca_file.flush()
        with pg_connect(pg, ca_file.name) as conn:
            log('Postgres: 10_schema.sql')
            conn.execute((PG_SQL / '10_schema.sql').read_text())
            conn.commit()
            if conn.execute('SELECT count(*) FROM public.employees').fetchone()[0] == 0:
                with conn.transaction():
                    for table in SEED_TABLES:
                        with conn.cursor().copy(f'COPY public.{table} FROM STDIN WITH (FORMAT csv, HEADER true)') as copy:
                            copy.write((PG_SQL / 'seed' / f'{table}.csv').read_bytes())
                log('Postgres: seed loaded.')
            else:
                log('Postgres: seed skipped, data already loaded.')
            for table, count in conn.execute(
                    "SELECT 'employees', count(*) FROM public.employees UNION ALL SELECT 'contracts', count(*) FROM public.contracts "
                    "UNION ALL SELECT 'assets', count(*) FROM public.assets UNION ALL SELECT 'employee_assets', count(*) "
                    "FROM public.employee_assets UNION ALL SELECT 'seat_actions', count(*) FROM public.seat_actions").fetchall():
                log(f'  {table}: {count}')

            # token_urlsafe uses only [A-Za-z0-9_-]; statement logging is off so it never reaches the server log.
            password = secrets.token_urlsafe(32)
            with conn.transaction():
                conn.execute("SET LOCAL log_statement = 'none'")
                conn.execute(sql.SQL('ALTER ROLE {} LOGIN PASSWORD {}').format(
                    sql.Identifier(APP_LOGIN), sql.Literal(password)))
    write_secret(sf, login_fqn, role,
                 f'TYPE = PASSWORD USERNAME = {literal(APP_LOGIN)} PASSWORD = {literal(password)}',
                 'Seat Sweeper app login for Snowflake Postgres')
    del password
    log(f'{APP_LOGIN} can log in; password saved to {login_fqn} (not shown).')


def ensure_mirror(sf, instance, mirror='seat_sweeper_ops', target_prefix='SEAT_SWEEPER_OPS',
                  refresh='1 minute', timeout=1200):
    mirror = mirror.lower()  # mirror names fold to lowercase
    sf.rows(f'GRANT USAGE ON POSTGRES INSTANCE {instance} TO APPLICATION SNOWFLAKE')
    existing = [m for m in lower_keys(sf.rows(f'CALL SNOWFLAKE.POSTGRES.LIST_MIRRORS({literal(instance)})'))
                if m['mirror_name'] == mirror]
    if existing:
        target = existing[0]['target_database']
        log(f'Mirror {mirror} exists -> {target}; not creating.')
    else:
        target = f'{target_prefix}_{datetime.now(timezone.utc):%Y%m%d%H%M}'
        log(f'Creating mirror {mirror} -> {target} (refresh {refresh}).')
        tables = ', '.join(literal(t) for t in MIRROR_TABLES)
        sf.rows(f"CALL SNOWFLAKE.POSTGRES.CREATE_MIRROR(mirror_name => {literal(mirror)}, "
                f"postgres_instance => {literal(instance)}, postgres_database => 'postgres', "
                f"target_database => {literal(target)}, postgres_tables => [{tables}], postgres_schemas => NULL, "
                f"refresh_interval => {literal(refresh)}, warehouse => NULL)")
    deadline = time.time() + timeout
    while True:
        # Rows can take a few seconds to appear after create; an empty list is not a failure.
        tables = lower_keys(sf.rows(f'CALL SNOWFLAKE.POSTGRES.LIST_MIRRORED_TABLES({literal(mirror)})'))
        states = {t['source_table_name']: t['state'] for t in tables}
        errors = [f"{t['source_table_name']}: {t['last_snapshot_error']}" for t in tables if t.get('last_snapshot_error')]
        if errors:
            raise SystemExit('Mirror snapshot errors:\n  ' + '\n  '.join(errors))
        if len(states) == len(MIRROR_TABLES) and set(states.values()) == {'REPLICATING'}:
            break
        if time.time() > deadline:
            raise SystemExit(f'Mirror not REPLICATING after {timeout}s: {states}')
        log(f'Waiting for mirror: {states or "no tables listed yet"}')
        time.sleep(15)
    log(f'All {len(states)} mirrored tables REPLICATING.')
    return target
