"""Create a lab PAT and a named connection that uses it, so later steps never open a browser.

  python3 scripts/pat_setup.py --from-connection <existing-connection> [--name seat_sweeper_lab]

Signs in once with the existing connection, then as ACCOUNTADMIN:
  1. Creates network policy SEAT_SWEEPER_LAB_ALLOW_ALL (0.0.0.0/0) and sets it on the current user only.
     Person users must be subject to a network policy to log in with a PAT. Lab accounts only.
  2. Creates PAT SEAT_SWEEPER_LAB_PAT restricted to ACCOUNTADMIN. A token secret is shown only once,
     so an existing token with that name is replaced.
  3. Writes [<name>] to ~/.snowflake/connections.toml with the token as the password (file mode 600).
The token is never printed. Safe to re-run.
"""
import argparse
import os
import re
import shutil
import time
from pathlib import Path

POLICY = 'SEAT_SWEEPER_LAB_ALLOW_ALL'
TOKEN = 'SEAT_SWEEPER_LAB_PAT'


def connections_file():
    home = Path(os.environ.get('SNOWFLAKE_HOME', Path.home() / '.snowflake'))
    return home / 'connections.toml'


def write_connection(path, name, fields):
    text = path.read_text() if path.exists() else ''
    if text:
        shutil.copy2(path, path.with_name(f'{path.name}.bak.{time.strftime("%Y%m%d%H%M%S")}'))
    # Drop any previous [name] block, up to the next section header.
    text = re.sub(rf'(?ms)^\[{re.escape(name)}\]\n.*?(?=^\[|\Z)', '', text).rstrip()
    block = f'[{name}]\n' + ''.join(f'{k} = "{v}"\n' for k, v in fields.items())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text((text + '\n\n' if text else '') + block)
    path.chmod(0o600)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--from-connection', required=True, help='existing connection used to sign in once')
    parser.add_argument('--name', default='seat_sweeper_lab', help='connection name to write')
    parser.add_argument('--days', type=int, default=7, help='token lifetime in days')
    args = parser.parse_args()

    import snowflake.connector

    with snowflake.connector.connect(connection_name=args.from_connection, role='ACCOUNTADMIN') as conn:
        cur = conn.cursor()
        account, user = cur.execute(
            "SELECT CURRENT_ORGANIZATION_NAME() || '-' || CURRENT_ACCOUNT_NAME(), CURRENT_USER()").fetchone()
        login = next(r[1] for r in cur.execute('DESCRIBE USER IDENTIFIER(%s)', (user,)) if r[0] == 'LOGIN_NAME')
        cur.execute(f"CREATE NETWORK POLICY IF NOT EXISTS {POLICY} ALLOWED_IP_LIST = ('0.0.0.0/0') "
                    "COMMENT = 'Seat Sweeper lab: lets the lab user log in with a PAT'")
        cur.execute(f'ALTER USER IDENTIFIER(%s) SET NETWORK_POLICY = {POLICY}', (user,))
        existing = [r[0] for r in cur.execute('SHOW USER PROGRAMMATIC ACCESS TOKENS FOR USER IDENTIFIER(%s)', (user,))]
        if TOKEN in existing:
            cur.execute(f'ALTER USER IDENTIFIER(%s) REMOVE PROGRAMMATIC ACCESS TOKEN {TOKEN}', (user,))
        secret = cur.execute(
            f"ALTER USER IDENTIFIER(%s) ADD PROGRAMMATIC ACCESS TOKEN {TOKEN} ROLE_RESTRICTION = 'ACCOUNTADMIN' "
            f"DAYS_TO_EXPIRY = {int(args.days)} COMMENT = 'Seat Sweeper lab'", (user,)).fetchone()[1]

    path = connections_file()
    write_connection(path, args.name, {'account': account, 'user': login, 'password': secret, 'role': 'ACCOUNTADMIN'})
    del secret

    with snowflake.connector.connect(connection_name=args.name) as conn:
        who = conn.cursor().execute('SELECT CURRENT_USER(), CURRENT_ROLE()').fetchone()
    print(f'Connection [{args.name}] written to {path} and verified as {who[0]} / {who[1]}. '
          f'Token expires in {args.days} days.')


if __name__ == '__main__':
    main()
