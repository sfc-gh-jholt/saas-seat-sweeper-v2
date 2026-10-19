// Shared wire format. Only explicitly selected Agent API fields reach the browser.
export type RunStatus = 'running' | 'complete' | 'incomplete' | 'failed' | 'stopped'
export type Citation = { id: string; index: number; title: string; excerpt: string }
export type ToolActivity = { id: string; name: string; status: string }
export type EvidenceTable = { id: string; title: string; columns: string[]; rows: string[][]; truncated: boolean }
export type SqlEvidence = { id: string; sql: string; queryId: string }
export type AgentState = {
  status: RunStatus; activity: string; answer: string; thinking: string;
  tools: ToolActivity[]; citations: Citation[]; tables: EvidenceTable[];
  queries: SqlEvidence[]; warnings: string[];
}
export type StreamMessage = { state: AgentState; correlationId: string }
export const initialAgentState = (): AgentState => ({
  status: 'running', activity: 'Connecting to agent', answer: '', thinking: '',
  tools: [], citations: [], tables: [], queries: [], warnings: [],
})
export type SseEvent = { event: string; data: string }

// Fetch chunks are not event boundaries; TextDecoder also preserves split UTF-8.
export async function* readSse(stream: ReadableStream<Uint8Array>, maxBytes = 8_000_000): AsyncGenerator<SseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = '', event = '', data: string[] = [], total = 0, frame = 0
  let done = false
  function line(value: string): SseEvent | undefined {
    if (value === '') {
      const result = data.length ? { event: event || 'message', data: data.join('\n') } : undefined
      event = ''; data = []; frame = 0
      return result
    }
    frame += value.length
    if (frame > 1_000_000) throw new Error('STREAM_LIMIT')
    if (value.startsWith(':')) return
    const colon = value.indexOf(':')
    const field = colon < 0 ? value : value.slice(0, colon)
    let content = colon < 0 ? '' : value.slice(colon + 1)
    if (content.startsWith(' ')) content = content.slice(1)
    if (field === 'event') event = content
    if (field === 'data') data.push(content)
  }
  try {
    while (!done) {
      const chunk = await reader.read()
      done = chunk.done
      total += chunk.value?.byteLength ?? 0
      if (total > maxBytes) throw new Error('STREAM_LIMIT')
      buffer += decoder.decode(chunk.value, { stream: !done })
      let match: RegExpExecArray | null
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break
        const result = line(buffer.slice(0, match.index))
        buffer = buffer.slice(match.index + match[0].length)
        if (result) yield result
      }
      if (buffer.length > 1_000_000) throw new Error('STREAM_LIMIT')
    }
    // An unterminated frame is not a complete event (and cannot prove completion).
  } finally {
    if (!done) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export const encodeSse = (message: StreamMessage) => new TextEncoder().encode(`event: state\ndata: ${JSON.stringify(message)}\n\n`)

type Json = Record<string, unknown>
const obj = (value: unknown): Json => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown, limit = 50_000) => typeof value === 'string' ? value.slice(0, limit) : ''
const integer = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback
const numericCode = (value: unknown) => /^\d{3,7}$/.test(String(value)) ? String(value) : ''
const toolLabel = (name: unknown) => ({ seat_opportunity: 'Querying seat opportunity', contract_terms: 'Searching contracts', system_execute_sql: 'Executing SQL' })[text(name)] ?? 'Running tool'
const statusLabels: Record<string, string> = {
  planning: 'Planning the answer', executing_tool: 'Using tools', reasoning_agent_stop: 'Reviewing results',
  proceeding_to_answer: 'Preparing the answer', generating: 'Writing the answer',
}

/** Projects the documented Agent SSE events into bounded, user-facing state. */
export class AgentProjection {
  state = initialAgentState()
  terminal = false
  private blocks = new Map<number, { answer?: string; thinking?: string }>()
  private evidence = new Map<string, SqlEvidence>()
  private tables = new Map<string, EvidenceTable>()
  private citations = new Map<string, Citation>()
  private tools = new Map<string, ToolActivity>()

  private warn(message: string) {
    if (!this.state.warnings.includes(message)) this.state.warnings = [...this.state.warnings, message].slice(0, 20)
  }
  private block(index: number, field: 'answer' | 'thinking', value: string, append = false) {
    if (index > 512 || (!this.blocks.has(index) && this.blocks.size >= 128)) return
    const block = this.blocks.get(index) ?? {}
    block[field] = ((append ? block[field] ?? '' : '') + value).slice(0, 50_000)
    this.blocks.set(index, block)
    const sorted = [...this.blocks].sort(([left], [right]) => left - right).map(([, item]) => item)
    this.state.answer = sorted.map(item => item.answer).filter(Boolean).join('\n\n').slice(0, 100_000)
    this.state.thinking = sorted.map(item => item.thinking).filter(Boolean).join('\n\n').slice(0, 100_000)
  }
  private citation(raw: unknown) {
    const item = obj(raw)
    if (item.type !== 'cortex_search_citation' || this.citations.size >= 50) return
    const index = integer(item.index)
    const id = text(item.search_result_id, 200) || text(item.doc_id, 200) || `citation-${index}`
    this.citations.set(id, { id, index, title: text(item.doc_title, 300) || 'Contract source', excerpt: text(item.text, 8_000) })
    this.state.citations = [...this.citations.values()]
  }
  private tool(raw: unknown, result = false) {
    const item = obj(raw), id = text(item.tool_use_id, 200)
    if (!id || this.tools.size >= 30) return
    const previous = this.tools.get(id)
    const name = text(item.name, 100) || previous?.name || 'Tool'
    const status = result ? (item.status === 'success' ? 'complete' : 'failed') : 'running'
    this.tools.set(id, { id, name, status })
    this.state.tools = [...this.tools.values()]
    this.state.activity = toolLabel(name)
    if (result) {
      if (status === 'failed') this.warn('A tool did not complete successfully. Treat this answer as incomplete.')
      for (const content of list(item.content)) this.sql(obj(obj(content).json), id)
    }
  }
  private sql(item: Json, id: string) {
    if (this.evidence.size >= 30) return
    const prior = this.evidence.get(id)
    const sql = text(item.sql) || prior?.sql || ''
    const queryId = text(item.query_id, 200) || prior?.queryId || ''
    if (sql || queryId) this.evidence.set(id, { id, sql, queryId })
    this.state.queries = [...this.evidence.values()]
    if (item.result_set) this.table({ tool_use_id: id, query_id: queryId, result_set: item.result_set })
  }
  private table(item: Json) {
    if (this.tables.size >= 10) return
    const result = obj(item.result_set), metadata = obj(result.resultSetMetaData)
    const id = text(item.query_id, 200) || text(item.tool_use_id, 200)
    if (!id) return
    const columns = list(metadata.rowType).slice(0, 20).map(column => text(obj(column).name, 200))
    if (!columns.length) return
    const data = list(result.data)
    this.tables.set(id, {
      id, title: text(item.title, 300) || 'Query results', columns,
      rows: data.slice(0, 100).map(row => list(row).slice(0, columns.length).map(cell => cell === null ? '' : String(cell).slice(0, 2_000))),
      truncated: data.length > 100 || integer(metadata.numRows) > Math.min(data.length, 100) || list(metadata.rowType).length > 20,
    })
    this.state.tables = [...this.tables.values()]
  }
  private content(raw: unknown, index: number) {
    const item = obj(raw)
    if (item.type === 'text') { this.block(index, 'answer', text(item.text)); list(item.annotations).forEach(a => this.citation(a)) }
    if (item.type === 'thinking') this.block(index, 'thinking', text(obj(item.thinking).text))
    if (item.type === 'tool_use') this.tool(item.tool_use)
    if (item.type === 'tool_result') this.tool(item.tool_result, true)
    if (item.type === 'table') this.table(obj(item.table))
  }
  accept(event: SseEvent): boolean {
    if (this.terminal) return false
    const known = ['response', 'error', 'response.status', 'response.text', 'response.text.delta', 'response.thinking', 'response.thinking.delta', 'response.text.annotation', 'response.tool_use', 'response.tool_result', 'response.tool_result.status', 'response.tool_result.analyst.delta', 'response.table', 'response.warning']
    if (!known.includes(event.event)) return false
    const item = obj(JSON.parse(event.data))
    const index = integer(item.content_index)
    switch (event.event) {
      case 'response.status': this.state.activity = statusLabels[text(item.status)] ?? 'Agent is working'; break
      case 'response.text.delta': this.block(index, 'answer', text(item.text), true); break
      case 'response.text': this.block(index, 'answer', text(item.text)); list(item.annotations).forEach(a => this.citation(a)); break
      case 'response.thinking.delta': this.block(index, 'thinking', text(item.text), true); break
      case 'response.thinking': this.block(index, 'thinking', text(item.text)); break
      case 'response.text.annotation': this.citation(item.annotation); break
      case 'response.tool_use': this.tool(item); break
      case 'response.tool_result': this.tool(item, true); break
      case 'response.tool_result.status': this.state.activity = toolLabel(item.tool_name ?? item.tool_type); break
      case 'response.tool_result.analyst.delta': this.sql(obj(item.delta), text(item.tool_use_id, 200)); break
      case 'response.table': this.table(item); break
      case 'response.warning': this.warn(`Agent warning${numericCode(item.code) ? ` (${numericCode(item.code)})` : ''}: an expected capability may be unavailable. Review the answer and tool evidence.`); break
      case 'error': this.finish('failed', `Agent request failed${numericCode(item.code) ? ` (${numericCode(item.code)})` : ''}. Check the correlation ID in app logs.`); break
      case 'response':
        if (!Array.isArray(item.content)) throw new Error('INVALID_FINAL_RESPONSE')
        this.blocks.clear()
        this.state.answer = ''; this.state.thinking = ''
        item.content.forEach((content, offset) => this.content(content, offset))
        for (const warning of list(item.warnings)) this.warn(`Agent warning${numericCode(obj(warning).code) ? ` (${numericCode(obj(warning).code)})` : ''}: review the answer and tool evidence.`)
        this.finish(item.status === 'completed' && !this.state.warnings.length && this.state.answer ? 'complete' : 'incomplete')
        break
    }
    return true
  }
  finish(status: RunStatus, warning?: string) {
    this.terminal = true
    this.state.status = status
    this.state.activity = status === 'complete' ? 'Answer complete' : status === 'failed' ? 'Request failed' : status === 'stopped' ? 'Stopped locally' : 'Answer incomplete'
    if (warning) this.warn(warning)
  }
}
