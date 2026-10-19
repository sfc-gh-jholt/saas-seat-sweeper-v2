"""Offline validation of the distributable local notebook; never executes cells."""
import ast
import json
from pathlib import Path
import re


def validate_notebook(data):
    notebook = json.loads(data)
    if notebook.get('nbformat') != 4 or notebook.get('nbformat_minor', 0) < 5:
        raise ValueError('Notebook requires nbformat 4.5 or higher')
    metadata = notebook.get('metadata', {})
    allowed = {'kernelspec', 'language_info'}
    if set(metadata) - allowed:
        raise ValueError('Remove notebook execution, widget or editor metadata before publishing')
    if 'kernelspec' in metadata:
        spec = metadata['kernelspec']
        if spec != {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'}:
            raise ValueError('Use portable Python 3 kernel metadata, not a local kernel path')
    if 'language_info' in metadata and metadata['language_info'].get('name') != 'python':
        raise ValueError('Notebook must use Python')
    identifiers = set()
    cells = notebook.get('cells', [])
    if not cells:
        raise ValueError('Notebook must contain cells')
    for cell in cells:
        identifier = cell.get('id', '')
        if not re.fullmatch(r'[a-zA-Z0-9]{8}', identifier) or identifier in identifiers:
            raise ValueError('Notebook cell IDs must be unique eight-character alphanumeric strings')
        identifiers.add(identifier)
        if cell.get('metadata') or cell.get('attachments'):
            raise ValueError('Remove cell metadata and attachments before publishing')
        source = cell.get('source', '')
        text = ''.join(source) if isinstance(source, list) else source
        if not isinstance(text, str):
            raise ValueError('Invalid cell source')
        if cell.get('cell_type') == 'code':
            if cell.get('outputs') != [] or cell.get('execution_count', 'missing') is not None:
                raise ValueError('Clear notebook outputs and execution counts before publishing')
            tree = ast.parse(text)
            for node in ast.walk(tree):
                if isinstance(node, ast.Assign):
                    for target in node.targets:
                        if isinstance(target, ast.Name) and target.id in {
                            'connection_name', 'expected_account', 'expected_user', 'participant_app_fqn'
                        }:
                            if not isinstance(node.value, ast.Constant) or not isinstance(node.value.value, str) or not node.value.value.startswith('REPLACE_'):
                                raise ValueError('Restore notebook connection placeholders before publishing')
        elif cell.get('cell_type') != 'markdown':
            raise ValueError('Only local Python and Markdown cells are supported')
    return notebook


def validate_links_and_prompts(notebook, root, notebook_dir=None):
    """Resolve links beside the notebook; #N prompt markers select a 1-based block.

    Unnumbered markers retain the legacy requirement of exactly one block.
    All resolved paths, including symlinks, must stay inside the repository.
    """
    root = Path(root).resolve()
    base = Path(notebook_dir).resolve() if notebook_dir is not None else root
    if not base.is_relative_to(root):
        raise ValueError('Notebook directory must be inside repository')
    for cell in notebook['cells']:
        if cell['cell_type'] != 'markdown':
            continue
        text = ''.join(cell['source'])
        for target in re.findall(r'(?<!!)\[[^\]]+\]\(([^)]+)\)', text):
            if '://' in target or target.startswith('#'):
                continue
            path = (base / target.split('#')[0]).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError(f'Broken or nonlocal notebook link: {target}')
        markers = list(re.finditer(r'<!-- prompt: ([^\s]+) -->\s*```text\n(.*?)\n```', text, re.S))
        if text.count('<!-- prompt:') != len(markers):
            raise ValueError('Malformed notebook prompt marker')
        for match in markers:
            relative, separator, block_number = match[1].partition('#')
            path = (base / relative).resolve()
            prompt_root = (base / 'coco-prompts').resolve()
            if not prompt_root.is_relative_to(root) or not path.is_relative_to(prompt_root) or not path.is_file():
                raise ValueError('Prompt must be in coco-prompts')
            blocks = re.findall(r'```text\n(.*?)\n```', path.read_text(), re.S)
            if separator:
                if not block_number.isdigit() or not 1 <= int(block_number) <= len(blocks):
                    raise ValueError('Invalid canonical prompt block number')
                blocks = [blocks[int(block_number) - 1]]
            if blocks != [match[2]]:
                raise ValueError(f'Notebook prompt differs from canonical source: {match[1]}')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('notebook', nargs='?', default='v2/START_HERE.ipynb',
                        help='Repository-relative notebook path (default: V2 workbook)')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    path = (root / args.notebook).resolve()
    if not path.is_relative_to(root):
        raise ValueError('Notebook must be inside repository')
    notebook = validate_notebook(path.read_bytes())
    validate_links_and_prompts(notebook, root, path.parent)
    print(f"Notebook validated offline: {len(notebook['cells'])} cells; no execution performed.")
