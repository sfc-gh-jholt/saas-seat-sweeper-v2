"""Build a V2-only participant archive; excludes rehearsal targets and generated agent snapshots."""
import hashlib
import json
import re
import zipfile
from pathlib import Path

import yaml
from contract_pipeline import ROOT, manifest_rows
from validate_notebook import validate_notebook, validate_links_and_prompts

EXCLUDED = {'node_modules','.next','.git','.snowflake','.cortex','__pycache__','coverage','dist','out','output','versions'}
ALLOWED = {'.md','.json','.ts','.tsx','.js','.mjs','.css','.yml','.yaml','.sql','.svg','.png','.pdf','.py','.toml','.lock','.sh','.tmpl','.ipynb'}
SCRIPTS = ['contract_pipeline.py','generate_contract_pdfs.py','test_contract_pipeline.py','deploy_lab_agent.py','package_v2.py','validate_notebook.py','test_v2_workbook.py']


def main():
    manifest_rows('all')
    notebook = validate_notebook((ROOT / 'v2/lab_instructions.ipynb').read_bytes())
    validate_links_and_prompts(notebook, ROOT, ROOT / 'v2')
    files = {}
    paths = [ROOT / 'README.md', ROOT / '.gitignore'] + list((ROOT / 'v2').rglob('*')) + list((ROOT / 'sql/v2').rglob('*')) + [ROOT / 'scripts' / name for name in SCRIPTS]
    for path in sorted(paths):
        rel = path.relative_to(ROOT)
        if set(rel.parts) & EXCLUDED or path.is_dir():
            continue
        if path.is_symlink():
            raise ValueError('Symlink not allowed: ' + str(rel))
        if path.name.startswith('.env') or (path.suffix == '.env' and path.name != 'names.default.env'):
            continue
        if path.name.endswith('.agent.yaml') or (path.name != '.gitignore' and path.suffix not in ALLOWED | {'.env'}):
            continue
        data = path.read_bytes()
        if rel.as_posix() == 'v2/starter-app/app.yml':
            config = yaml.safe_load(data)
            config['targets'] = {'lab': config['targets']['lab']}
            data = yaml.safe_dump(config, sort_keys=False).encode()
        if path.suffix not in {'.pdf','.png'}:
            text = data.decode()
            if re.search(r'/Users/|/home/[\w.-]+/|[A-Z0-9]+_[A-Z0-9_]*REHEARSAL[A-Z0-9_]*\.|[a-z0-9-]+\.snowflakecomputing\.app|BEGIN .*PRIVATE KEY', text, re.I) and path.name != 'package_v2.py':
                raise ValueError('Private identifier in ' + str(rel))
        files[rel.as_posix()] = data
    required = ['v2/lab_instructions.ipynb','scripts/validate_notebook.py','v2/README.md','sql/v2/names.default.env','sql/v2/setup.sh','scripts/contract_pipeline.py','v2/contracts/manifest.json','v2/agent/seat_sweeper_agent.agent.yaml.tmpl']
    for name in required:
        assert name in files, name
    assert sum(name.endswith('.pdf') for name in files) == 11
    files['package-manifest.json'] = json.dumps({name:hashlib.sha256(data).hexdigest() for name,data in files.items()}, indent=2).encode()
    output = ROOT / 'dist/seat-sweeper-v2.zip'
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            entry = zipfile.ZipInfo('seat-sweeper/' + name, date_time=(2026,10,19,0,0,0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = (0o100755 if name.endswith('.sh') else 0o100644) << 16
            archive.writestr(entry,data)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        for name,data in files.items():
            assert archive.read('seat-sweeper/' + name) == data
    print(f'Verified {output}: {len(files)} files, 11 PDFs; no rehearsal target or credentials')


if __name__ == '__main__':
    main()
