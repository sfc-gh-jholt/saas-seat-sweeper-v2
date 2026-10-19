"""Maintainer-only deterministic PDF build; attendees use the packaged PDFs.

uv run --with reportlab --with pypdf scripts/generate_contract_pdfs.py
"""
import hashlib
import json
from pathlib import Path
from xml.sax.saxutils import escape

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

ROOT = Path(__file__).resolve().parents[1] / 'v2' / 'contracts'
DISCLAIMER = 'SYNTHETIC WORKSHOP AGREEMENT - NOT ACTUAL VENDOR TERMS'


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#374151'))
    canvas.drawString(45, 36, DISCLAIMER)
    canvas.drawRightString(567, 36, f'Page {doc.page}')
    canvas.restoreState()


def main():
    records = json.loads((ROOT / 'source.json').read_text())
    manifest = []
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='Clause', fontName='Helvetica', fontSize=11, leading=16, spaceAfter=14))
    for record in records:
        filename = 'zoom-pro.pdf' if record['group'] == 'new-arrival' else record['document_id'] + '-v1.pdf'
        relative = record['group'] + '/' + filename
        path = ROOT / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        doc = SimpleDocTemplate(str(path), pagesize=(612, 792), leftMargin=45, rightMargin=45,
                                topMargin=40, bottomMargin=60, invariant=1,
                                title=record['vendor'] + ' - Synthetic Workshop Agreement', author='Seat Sweeper Workshop')
        story = [Paragraph('SYNTHETIC WORKSHOP AGREEMENT', styles['Heading2']),
                 Paragraph(escape(record['vendor']), styles['Title']),
                 Paragraph('Not an actual vendor agreement. For training only.', styles['Normal']), Spacer(1, .18 * inch),
                 Paragraph(f"Document: {record['document_id']} / version 1", styles['Normal']),
                 Paragraph('Renewal reference: ' + (record['renewal_date'] or 'Not specified / not applicable'), styles['Normal']),
                 Spacer(1, .2 * inch)]
        story += [Paragraph(f'{index}. {escape(clause)}', styles['Clause']) for index, clause in enumerate(record['clauses'], 1)]
        doc.build(story, onFirstPage=footer, onLaterPages=footer)
        reader = PdfReader(path)
        assert len(reader.pages) <= 2
        for page in reader.pages:
            text = page.extract_text()
            assert DISCLAIMER in text and len(text) < 2400
        manifest.append({key: record[key] for key in ('document_id', 'vendor', 'contract_id', 'group')} | {
            'version': 1, 'relative_path': relative, 'expected_pages': len(reader.pages),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'md5': hashlib.md5(path.read_bytes()).hexdigest(), 'size_bytes': path.stat().st_size})
    assert sum(row['expected_pages'] for row in manifest) <= 22
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Validated {len(manifest)} PDFs; {sum(row["expected_pages"] for row in manifest)} pages')


if __name__ == '__main__':
    main()
