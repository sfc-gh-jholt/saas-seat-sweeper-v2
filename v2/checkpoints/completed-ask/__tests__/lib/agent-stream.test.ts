import { describe, expect, it } from 'vitest'
import { AgentProjection, readSse } from '../../lib/agent-stream'

const event = (event: string, data: unknown) => ({ event, data: JSON.stringify(data) })
const bytes = (value: string, size = 1) => {
  const data = new TextEncoder().encode(value)
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let index = 0; index < data.length; index += size) controller.enqueue(data.slice(index, index + size))
    controller.close()
  } })
}

describe('SSE parser', () => {
  it('handles split UTF-8, CRLF, comments and multiline data', async () => {
    const stream = ': heartbeat\r\nevent: response.text.delta\r\ndata: {"text":\r\ndata: "café"}\r\n\r\n'
    const result = []
    for await (const item of readSse(bytes(stream))) result.push(item)
    expect(result).toEqual([{ event: 'response.text.delta', data: '{"text":\n"café"}' }])
  })
  it('ignores an unterminated final frame', async () => {
    const result = []
    for await (const item of readSse(bytes('event: response\ndata: {}'))) result.push(item)
    expect(result).toEqual([])
  })
  it('bounds input size', async () => {
    await expect(async () => { for await (const item of readSse(bytes('data: too long\n\n'), 5)) void item }).rejects.toThrow('STREAM_LIMIT')
  })
})

describe('Agent API projection', () => {
  it('streams and reconciles final text/thinking without duplication or signatures', () => {
    const projection = new AgentProjection()
    projection.accept(event('response.thinking.delta', { content_index: 0, text: 'Checking contract' }))
    projection.accept(event('response.text.delta', { content_index: 1, text: 'Answer' }))
    const final = event('response', { status: 'completed', content: [
      { type: 'thinking', thinking: { text: 'Checking contract', signature: 'SECRET' } },
      { type: 'text', text: 'Answer' },
    ] })
    projection.accept(final); projection.accept(final)
    expect(projection.state.answer).toBe('Answer')
    expect(projection.state.thinking).toBe('Checking contract')
    expect(projection.state.status).toBe('complete')
    expect(JSON.stringify(projection.state)).not.toContain('SECRET')
  })
  it('uses block indices for multiple answer blocks', () => {
    const projection = new AgentProjection()
    projection.accept(event('response.text.delta', { content_index: 3, text: 'Second' }))
    projection.accept(event('response.text.delta', { content_index: 1, text: 'First' }))
    expect(projection.state.answer).toBe('First\n\nSecond')
  })
  it('deduplicates evidence and extracts SQL, tables and citations', () => {
    const projection = new AgentProjection()
    const citation = { type: 'cortex_search_citation', index: 1, doc_id: '2', doc_title: 'Figma', text: '90 days' }
    projection.accept(event('response.text.annotation', { annotation: citation }))
    projection.accept(event('response.tool_use', { tool_use_id: 'tool1', name: 'seat_opportunity' }))
    const tool = { tool_use_id: 'tool1', name: 'seat_opportunity', status: 'success', content: [{ json: {
      sql: 'SELECT 1', query_id: 'query1', result_set: { resultSetMetaData: { rowType: [{ name: 'TOTAL' }] }, data: [['1']] },
    } }] }
    projection.accept(event('response.tool_result', tool))
    projection.accept(event('response', { status: 'completed', content: [{ type: 'tool_result', tool_result: tool }, { type: 'text', text: 'A', annotations: [citation] }] }))
    expect(projection.state.tools).toHaveLength(1)
    expect(projection.state.queries).toEqual([{ id: 'tool1', sql: 'SELECT 1', queryId: 'query1' }])
    expect(projection.state.tables[0].rows).toEqual([['1']])
    expect(projection.state.citations).toHaveLength(1)
  })
  it('does not infer success from missing final status or failed tools', () => {
    const projection = new AgentProjection()
    projection.accept(event('response.tool_result', { tool_use_id: 'x', name: 'contract_terms', status: 'error' }))
    projection.accept(event('response', { content: [{ type: 'text', text: 'Partial answer' }] }))
    expect(projection.state.status).toBe('incomplete')
    expect(projection.state.tools[0].status).toBe('failed')
  })
  it('sanitizes warnings and raw errors', () => {
    const projection = new AgentProjection()
    projection.accept(event('response.warning', { code: '399569', message: 'SECRET raw error' }))
    projection.accept(event('error', { code: '390303', message: 'SECRET token' }))
    expect(projection.state.status).toBe('failed')
    expect(projection.state.warnings.join()).toContain('399569')
    expect(JSON.stringify(projection.state)).not.toContain('SECRET')
  })
  it('ignores unknown events, rejects malformed known events and limits table rows', () => {
    const projection = new AgentProjection()
    expect(projection.accept({ event: 'unknown', data: 'not JSON' })).toBe(false)
    expect(() => projection.accept({ event: 'response', data: 'bad' })).toThrow()
    projection.accept(event('response.table', { query_id: 'q', result_set: { resultSetMetaData: { rowType: [{ name: 'x' }], numRows: 102 }, data: Array.from({ length: 102 }, () => ['a']) } }))
    expect(projection.state.tables[0].rows).toHaveLength(100)
    expect(projection.state.tables[0].truncated).toBe(true)
  })
})
