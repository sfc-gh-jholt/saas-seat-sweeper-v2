"""Seat Sweeper Postgres helpers for setup.sh. Every step is safe to re-run.

  python3 scripts/pg_setup.py instance --connection <snowflake-conn> --instance SEAT_SWEEPER_PG
      Create the instance if it does not exist (billable), through the snowflake-postgres skill's
      pg_connect.py so the snowflake_admin password goes straight to ~/.pgpass and is never
      printed. Then wait until the instance is READY.

  python3 scripts/pg_setup.py access-vars --connection <snowflake-conn> --instance SEAT_SWEEPER_PG
      Print pg_host=<host> for 06_app_postgres_access.sql.

  python3 scripts/pg_setup.py seed --service seat_sweeper_pg
      Run sql/v2/pg/10_schema.sql and 11_seed.sql with psql as snowflake_admin.

  python3 scripts/pg_setup.py app-login --service seat_sweeper_pg
      Give the least-privilege seat_sweeper_app role (created by 10_schema.sql) a generated password
      and LOGIN, and save it to ~/.pgpass. Skipped when ~/.pgpass already has it. The password goes
      to psql on stdin with statement logging off, so it never reaches argv, output or the server log.

  python3 scripts/pg_setup.py mirror --connection <snowflake-conn> --instance SEAT_SWEEPER_PG --mirror seat_sweeper_ops
      Create the mirror if missing (new target database each run; a dropped name cannot be reused),
      wait until every table is REPLICATING, then print mirror_db=<target database>.

  python3 scripts/pg_setup.py secret --connection <snowflake-conn> --service seat_sweeper_pg
      Create or replace SEAT_SWEEPER_LAB.GOVERNANCE.PG_APP_LOGIN (TYPE = PASSWORD) from the
      seat_sweeper_app entry in ~/.pgpass, plus PG_HOST and PG_CA_CERT, and
      grant READ to the app role. The password is read from the file and bound as a
      parameter; it is never printed or put in argv.
"""
import argparse
import configparser
import json
import os
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
# The snowflake-postgres skill ships with Cortex Code; override with PG_SKILL_DIR elsewhere.
SKILL_DIR = Path(os.environ.get(
    'PG_SKILL_DIR',
    '/Applications/Cortex Code.app/Contents/Resources/app/resources/snowflake/skills/'
    'cortex-code-skills/snowflake-postgres'))
MIRROR_TABLES = ['public.employees', 'public.contracts', 'public.assets',
                 'public.employee_assets', 'public.seat_actions']
APP_LOGIN = 'seat_sweeper_app'


def log(msg):
    # stdout is reserved for KEY=VALUE output that setup.sh reads.
    print(msg, file=sys.stderr, flush=True)


def sf_connect(connection):
    import snowflake.connector
    return snowflake.connector.connect(connection_name=connection, role='ACCOUNTADMIN')


def rows(cur, sql, params=None):
    cur.execute(sql, params)
    cols = [c[0].lower() for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def pg_connect(*args, connection):
    if not (SKILL_DIR / 'scripts' / 'pg_connect.py').is_file():
        raise SystemExit(f'pg_connect.py not found under {SKILL_DIR}; set PG_SKILL_DIR.')
    cmd = ['uv', 'run', '--project', str(SKILL_DIR), 'python', str(SKILL_DIR / 'scripts' / 'pg_connect.py'),
           *args, '--snowflake-connection', connection, '--use-role', 'ACCOUNTADMIN']
    # Output goes to stderr so it never mixes with KEY=VALUE lines; the script itself never prints passwords.
    subprocess.run(cmd, check=True, stdout=sys.stderr)


def has_pgpass_user(host, user):
    path = Path(os.environ.get('PGPASSFILE', Path.home() / '.pgpass'))
    if not path.is_file():
        return False
    return any(len(p) == 5 and p[0] in (host, '*') and p[3] == user
               for p in (line.split(':', 4) for line in path.read_text().splitlines()))


def instance_host(cur, instance):
    found = rows(cur, f"SHOW POSTGRES INSTANCES LIKE '{instance}'")
    return found[0].get('host') if found else None


def ensure_instance(args):
    with sf_connect(args.connection) as conn:
        exists = bool(rows(conn.cursor(), f"SHOW POSTGRES INSTANCES LIKE '{args.instance}'"))
    if exists:
        log(f'Instance {args.instance} exists; not creating.')
    else:
        log(f'Creating {args.instance} ({args.compute}, {args.storage} GB, Postgres {args.version}). This is billable.')
        pg_connect('--create', '--instance-name', args.instance, '--compute-pool', args.compute,
                   '--storage', str(args.storage), '--postgres-version', args.version,
                   '--comment', 'Seat Sweeper system of record', connection=args.connection)
    pg_connect('--ensure-ready', '--instance-name', args.instance, connection=args.connection)
    print(f'pg_host={service_host(args.instance.lower())}')


def access_vars(args):
    with sf_connect(args.connection) as conn:
        host = instance_host(conn.cursor(), args.instance)
    if not host:
        raise SystemExit(f'Instance {args.instance} not found. Run the instance step first.')
    print(f'pg_host={host}')


def seed(args):
    for name in ('10_schema.sql', '11_seed.sql'):
        log(f'psql: {name}')
        # 11_seed.sql uses \copy with repo-relative paths, so run from the repo root.
        subprocess.run(['psql', f'service={args.service} dbname=postgres connect_timeout=10',
                        '-v', 'ON_ERROR_STOP=1', '-f', f'sql/v2/pg/{name}'],
                       check=True, cwd=REPO, stdout=sys.stderr)


def app_login(args):
    host = service_host(args.service)
    if has_pgpass_user(host, APP_LOGIN):
        log(f'{APP_LOGIN} already has a ~/.pgpass entry; not changing its password.')
        return
    # token_urlsafe uses only [A-Za-z0-9_-], so the SQL literal needs no escaping.
    password = secrets.token_urlsafe(32)
    sql = ("BEGIN;\nSET LOCAL log_statement = 'none';\n"
           f"ALTER ROLE {APP_LOGIN} LOGIN PASSWORD '{password}';\nCOMMIT;\n")
    subprocess.run(['psql', f'service={args.service} dbname=postgres connect_timeout=10',
                    '-v', 'ON_ERROR_STOP=1', '-q'],
                   input=sql, text=True, check=True, stdout=subprocess.DEVNULL)
    path = Path(os.environ.get('PGPASSFILE', Path.home() / '.pgpass'))
    with open(path, 'a') as f:
        f.write(f'{host}:5432:postgres:{APP_LOGIN}:{password}\n')
    path.chmod(0o600)
    log(f'{APP_LOGIN} can log in; password saved to {path} (not shown).')


def ensure_mirror(args):
    mirror = args.mirror.lower()  # mirror names fold to lowercase
    with sf_connect(args.connection) as conn:
        cur = conn.cursor()
        cur.execute(f'GRANT USAGE ON POSTGRES INSTANCE {args.instance} TO APPLICATION SNOWFLAKE')
        existing = [m for m in rows(cur, 'CALL SNOWFLAKE.POSTGRES.LIST_MIRRORS(%s)', (args.instance,))
                    if m['mirror_name'] == mirror]
        if existing:
            target = existing[0]['target_database']
            log(f'Mirror {mirror} exists -> {target}; not creating.')
        else:
            target = f"{args.target_prefix}_{datetime.now(timezone.utc):%Y%m%d%H%M}"
            log(f'Creating mirror {mirror} -> {target} (refresh {args.refresh}).')
            cur.execute(
                'CALL SNOWFLAKE.POSTGRES.CREATE_MIRROR(mirror_name => %s, postgres_instance => %s, '
                "postgres_database => 'postgres', target_database => %s, "
                f"postgres_tables => [{', '.join(repr(t) for t in MIRROR_TABLES)}], "
                'postgres_schemas => NULL, refresh_interval => %s, warehouse => NULL)',
                (mirror, args.instance, target, args.refresh))
        deadline = time.time() + args.timeout
        while True:
            # Rows can take a few seconds to appear after create; an empty list is not a failure.
            tables = rows(cur, 'CALL SNOWFLAKE.POSTGRES.LIST_MIRRORED_TABLES(%s)', (mirror,))
            states = {t['source_table_name']: t['state'] for t in tables}
            errors = [f"{t['source_table_name']}: {t['last_snapshot_error']}" for t in tables if t.get('last_snapshot_error')]
            if errors:
                raise SystemExit('Mirror snapshot errors:\n  ' + '\n  '.join(errors))
            if len(states) == len(MIRROR_TABLES) and set(states.values()) == {'REPLICATING'}:
                break
            if time.time() > deadline:
                raise SystemExit(f'Mirror not REPLICATING after {args.timeout}s: {states}')
            log(f'Waiting for mirror: {states or "no tables listed yet"}')
            time.sleep(15)
    log(f'All {len(states)} mirrored tables REPLICATING.')
    print(f'mirror_db={target}')


def service_host(service):
    conf = configparser.ConfigParser()
    conf.read(Path(os.environ.get('PGSERVICEFILE', Path.home() / '.pg_service.conf')))
    if service not in conf:
        raise SystemExit(f'No [{service}] in ~/.pg_service.conf. Create the instance first.')
    return conf[service]['host']


def pgpass_password(host, user):
    path = Path(os.environ.get('PGPASSFILE', Path.home() / '.pgpass'))
    for line in path.read_text().splitlines():
        parts = line.split(':', 4)
        if len(parts) == 5 and parts[0] in (host, '*') and parts[3] == user:
            return parts[4]
    raise SystemExit(f'No ~/.pgpass entry for user {user} on {host}. Run pg_connect.py --reset --role {user}.')


def create_secret(args):
    import snowflake.connector

    host = service_host(args.service)
    password = pgpass_password(host, args.user)
    fqn = f'{args.db}.GOVERNANCE.PG_APP_LOGIN'
    with snowflake.connector.connect(connection_name=args.connection, role='ACCOUNTADMIN') as conn:
        cur = conn.cursor()
        cur.execute(
            f"CREATE OR REPLACE SECRET {fqn} TYPE = PASSWORD USERNAME = %s PASSWORD = %s "
            "COMMENT = 'Seat Sweeper app login for Snowflake Postgres'",
            (args.user, password),
        )
        cur.execute(f'GRANT READ ON SECRET {fqn} TO ROLE {args.role}')
        # The host differs per account, so it is a secret too; app.yml stays identical everywhere.
        host_fqn = f'{args.db}.GOVERNANCE.PG_HOST'
        cur.execute(
            f"CREATE OR REPLACE SECRET {host_fqn} TYPE = GENERIC_STRING SECRET_STRING = %s "
            "COMMENT = 'Seat Sweeper Postgres instance host'",
            (host,),
        )
        cur.execute(f'GRANT READ ON SECRET {host_fqn} TO ROLE {args.role}')
        print(f'Secret {host_fqn} ready ({host}).')
        ca = Path.home() / '.snowflake' / 'postgres' / 'certs' / f'{args.service}.pem'
        if ca.is_file():
            # The instance CA is public, but it is instance-specific, so it travels as a secret file
            # rather than in the image or the repo. The app uses it for verify-full TLS.
            ca_fqn = f'{args.db}.GOVERNANCE.PG_CA_CERT'
            cur.execute(
                f"CREATE OR REPLACE SECRET {ca_fqn} TYPE = GENERIC_STRING SECRET_STRING = %s "
                "COMMENT = 'Seat Sweeper Postgres instance CA certificate'",
                (ca.read_text(),),
            )
            cur.execute(f'GRANT READ ON SECRET {ca_fqn} TO ROLE {args.role}')
            print(f'Secret {ca_fqn} ready.')
        else:
            print(f'No CA cert at {ca}; run pg_connect.py --fetch-cert first.')
    print(f'Secret {fqn} ready for user {args.user} (password not shown).')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    inst = sub.add_parser('instance')
    inst.add_argument('--connection', required=True)
    inst.add_argument('--instance', default='SEAT_SWEEPER_PG')
    inst.add_argument('--compute', default='STANDARD_M')
    inst.add_argument('--storage', type=int, default=10)
    inst.add_argument('--version', default='18')

    acc = sub.add_parser('access-vars')
    acc.add_argument('--connection', required=True)
    acc.add_argument('--instance', default='SEAT_SWEEPER_PG')

    sd = sub.add_parser('seed')
    sd.add_argument('--service', default='seat_sweeper_pg')

    al = sub.add_parser('app-login')
    al.add_argument('--service', default='seat_sweeper_pg')

    mir = sub.add_parser('mirror')
    mir.add_argument('--connection', required=True)
    mir.add_argument('--instance', default='SEAT_SWEEPER_PG')
    mir.add_argument('--mirror', default='seat_sweeper_ops')
    mir.add_argument('--target-prefix', default='SEAT_SWEEPER_OPS')
    mir.add_argument('--refresh', default='1 minute')
    mir.add_argument('--timeout', type=int, default=1200)

    secret = sub.add_parser('secret')
    secret.add_argument('--connection', required=True)
    secret.add_argument('--service', default='seat_sweeper_pg')
    secret.add_argument('--user', default=APP_LOGIN)
    secret.add_argument('--db', default='SEAT_SWEEPER_LAB')
    secret.add_argument('--role', default='SEAT_SWEEPER_APP')
    args = parser.parse_args()
    {'instance': ensure_instance, 'access-vars': access_vars, 'seed': seed, 'app-login': app_login,
     'mirror': ensure_mirror, 'secret': create_secret}[args.command](args)


if __name__ == '__main__':
    main()
