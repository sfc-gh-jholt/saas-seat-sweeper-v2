import { AgentError, openAgentStream } from '@/lib/agent'
import { AgentProjection, encodeSse, readSse } from '@/lib/agent-stream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const MAX_BODY_BYTES = 4096

async function readQuestion(request: Request) {
  if (!request.body) throw new Error('BAD_REQUEST')
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let size = 0, value = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('BAD_REQUEST') }
      value += decoder.decode(chunk.value, { stream: true })
    }
    value += decoder.decode()
  } finally { reader.releaseLock() }
  const body = JSON.parse(value)
  if (!body || Array.isArray(body) || typeof body.question !== 'string' || Object.keys(body).some(key => key !== 'question')) throw new Error('BAD_REQUEST')
  const question = body.question.trim()
  if (!question || question.length > 500) throw new Error('BAD_REQUEST')
  return question
}

export async function POST(request: Request) {
  const correlationId = crypto.randomUUID()
  const json = (code: string, error: string, status: number) => Response.json({ correlationId, code, error }, { status })
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json('BAD_REQUEST', 'Send JSON.', 415)
  // Reject browser cross-site posts without trusting proxy-rewritten request URLs.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return json('BAD_ORIGIN', 'Use the Ask page to send a question.', 403)
  let question: string
  try { question = await readQuestion(request) } catch { return json('BAD_REQUEST', 'Ask a question of 1 to 500 characters.', 400) }
  const abort = new AbortController()
  const timeout = AbortSignal.timeout(90_000)
  const signal = AbortSignal.any([request.signal, abort.signal, timeout])
  const started = Date.now()
  let source: ReadableStream<Uint8Array>
  try { source = await openAgentStream(question, signal) }
  catch (error) {
    const failure = error instanceof AgentError ? error : new AgentError('ASK_FAILED')
    console.warn(JSON.stringify({ correlationId, op: 'ask', ms: Date.now() - started, code: failure.code, upstreamStatus: failure.upstreamStatus, upstreamCode: failure.upstreamCode }))
    return json(failure.code, 'The agent connection failed. Check app logs using the correlation ID.', timeout.aborted ? 504 : 502)
  }
  const projection = new AgentProjection()
  const events = readSse(source)[Symbol.asyncIterator]()
  let closed = false
  let lastEmit = 0
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encodeSse({ state: projection.state, correlationId })) },
    async pull(controller) {
      if (closed) return
      try {
        while (true) {
          const next = await events.next()
          if (next.done) {
            projection.finish('incomplete', 'The stream ended before completion was confirmed. Partial results are preserved.')
          } else if (!projection.accept(next.value)) continue
          const isTextDelta = !next.done && (next.value.event === 'response.text.delta' || next.value.event === 'response.thinking.delta')
          if (!projection.terminal && isTextDelta && Date.now() - lastEmit < 80) continue
          lastEmit = Date.now()
          controller.enqueue(encodeSse({ state: projection.state, correlationId }))
          if (projection.terminal) {
            closed = true
            console.info(JSON.stringify({ correlationId, op: 'ask', ms: Date.now() - started, status: projection.state.status, tools: projection.state.tools.map(tool => tool.name) }))
            controller.close()
            await events.return?.(undefined)
            abort.abort()
          }
          return
        }
      } catch {
        if (closed) return
        closed = true
        projection.finish('incomplete', timeout.aborted ? 'The request timed out. Partial results are preserved.' : 'The stream was interrupted. Partial results are preserved.')
        console.warn(JSON.stringify({ correlationId, op: 'ask', ms: Date.now() - started, status: 'incomplete' }))
        controller.enqueue(encodeSse({ state: projection.state, correlationId }))
        controller.close()
        abort.abort()
      }
    },
    async cancel() { closed = true; abort.abort(); await events.return?.(undefined) },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'X-Correlation-ID': correlationId } })
}
