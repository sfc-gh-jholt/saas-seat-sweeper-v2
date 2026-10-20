import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { AgentAnswer, safeAnswerUrl } from '../../components/agent-answer'
import { initialAgentState } from '../../lib/agent-stream'
it('renders Markdown and disclosure thinking without loading images or executing raw HTML', () => {
  const state = { ...initialAgentState(), thinking: 'Agent-provided planning text', answer: '**Useful answer**\n\n<script>alert(1)</script>\n\n![beacon](https://example.org/track)\n\n[unsafe](javascript:alert(1))' }
  const html = renderToStaticMarkup(React.createElement(AgentAnswer, { state }))
  expect(html).toContain('<strong>Useful answer</strong>')
  expect(html).toContain('Agent-provided planning text')
  expect(html).toContain('<details')
  expect(html).not.toMatch(/<script|<img|javascript:|<details[^>]+open/)
})
it('renders table, source excerpt, SQL and warnings', () => {
  const state = { ...initialAgentState(), tables: [{ id: 'q', title: 'Results', columns: ['VENDOR'], rows: [['Figma']], truncated: true }], citations: [{ id: '2', index: 0, title: 'Figma contract', excerpt: '90 days notice' }], queries: [{ id: 'q', sql: 'SELECT 1', queryId: 'query-123' }], warnings: ['Partial response'] }
  const html = renderToStaticMarkup(React.createElement(AgentAnswer, { state }))
  expect(html).toContain('90 days notice'); expect(html).toContain('SELECT 1'); expect(html).toContain('query-123')
  expect(html).toContain('href="#source-0"'); expect(html).toContain('100 rows'); expect(html).toContain('Partial response')
})
it('rejects unsafe link protocols and ambiguous relative URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/path']) expect(safeAnswerUrl(url)).toBe('')
  expect(safeAnswerUrl('https://docs.snowflake.com')).toBe('https://docs.snowflake.com')
  expect(safeAnswerUrl('#source-1')).toBe('#source-1')
})
