"""Render and deploy the workshop agent using validated names; preserve a snapshot on edits."""
import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from contract_pipeline import ROOT, names_from


def run(arguments):
    result = subprocess.run(arguments, check=True, capture_output=True, text=True)
    return result.stdout


def require_fresh_agent(connection, fqn):
    schema, name = fqn.rsplit('.', 1)
    rows = json.loads(run(['snow', 'sql', '--connection', connection,
                          '--role', 'ACCOUNTADMIN', '--format', 'JSON', '-q',
                          f"SHOW AGENTS LIKE '{name}' IN SCHEMA {schema}"]))
    if not isinstance(rows, list):
        raise RuntimeError('Unexpected agent inventory response; refusing deployment')
    if any(str(row.get('name', row.get('NAME', ''))).upper() == name for row in rows):
        raise RuntimeError(f'Agent already exists: {fqn}. Review it before explicitly using --update.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--connection', required=True)
    parser.add_argument('--names', default=str(ROOT / 'sql/v2/names.default.env'))
    parser.add_argument('--update', action='store_true', help='Read, snapshot, save and publish an existing rehearsal/lab agent')
    args = parser.parse_args()
    names = names_from(args.names)
    fqn = names['lab_db'] + '.APP.SEAT_SWEEPER_AGENT'
    folder = ROOT / 'v2/agent'
    template = (folder / 'seat_sweeper_agent.agent.yaml.tmpl').read_text()
    for key, value in names.items():
        template = template.replace('<% ' + key + ' %>', value)
    if '<%' in template:
        raise ValueError('Unresolved agent template')
    cli = ['cortex', 'agent-studio']
    if not args.update:
        require_fresh_agent(args.connection, fqn)
    if args.update:
        prior = json.loads(run(cli + ['agent-read', '--connection', args.connection, '--fqn', fqn]))
        snapshot = folder / 'versions' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        snapshot.mkdir(parents=True, exist_ok=False)
        (snapshot / 'before.agent.yaml').write_text(prior['yaml_content'])
        (snapshot / 'after.agent.yaml').write_text(template)
    # agent-write tracks the workspace spec before cloud save/deploy.
    written = run(cli + ['agent-write', '--yaml-content', template, '--source-object', fqn])
    print(written)
    path = folder / (names['lab_db'] + '.pdf.agent.yaml')
    path.write_text(template)
    if args.update:
        print(run(cli + ['agent-save', '--connection', args.connection, '--fqn', fqn, '--file-path', str(path)]))
        print(run(cli + ['agent-publish', '--connection', args.connection, '--fqn', fqn]))
    else:
        # Create with ACCOUNTADMIN: `agent-deploy` uses the connection's default role, which in
        # attendee accounts (ATTENDEE_ROLE) cannot CREATE AGENT in the lab schema.
        if '$$' in template:
            raise ValueError('Agent template must not contain $$')
        print(run(['snow', 'sql', '--connection', args.connection, '--role', 'ACCOUNTADMIN', '-q',
                   f"CREATE AGENT IF NOT EXISTS {fqn} FROM SPECIFICATION $${template}$$"]))
    print(run(['snow', 'sql', '--connection', args.connection, '--role', 'ACCOUNTADMIN', '-q',
               f"GRANT USAGE ON AGENT {fqn} TO ROLE {names['lab_role']}; "
               # Caller's rights for Ask: the user's own access plus the app's caller grant.
               f"GRANT USAGE ON AGENT {fqn} TO ROLE PUBLIC; "
               f"GRANT CALLER USAGE ON AGENT {fqn} TO ROLE {names['lab_role']}"]))


if __name__ == '__main__':
    main()
