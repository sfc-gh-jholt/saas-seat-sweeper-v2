import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST } from '../../app/api/ask/route'
import { openAgentStream, AgentError } from '../../lib/agent'
import { readSse } from '../../lib/agent-stream'
vi.mock('../../lib/agent', async original => ({ ...(await original<typeof import('../../lib/agent')>()), openAgentStream: vi.fn() }))
const post = (body: unknown, type = 'application/json', headers = {}) => new Request('http://localhost/api/ask', { method: 'POST', headers: { 'content-type': type, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const source = (text: string) => new Response(text).body!
const frame = (event: string, value: unknown) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())
it.each([{}, null, [], { question: '' }, { question: 3 }, { question: 'x'.repeat(501) }, { question: 'Q', host: 'evil' }, 'bad JSON'])('rejects invalid body %j', async body => {
  expect((await POST(post(body))).status).toBe(400); expect(openAgentStream).not.toHaveBeenCalled()
})
it('rejects oversized payloads, non-JSON and cross-site browser requests', async () => {
  expect((await POST(post(' '.repeat(5000)))).status).toBe(400)
  expect((await POST(post('q=x', 'text/plain'))).status).toBe(415)
  expect((await POST(post({ question: 'Q' }, 'application/json', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
})
it('streams selected fields, retains thinking without signatures, and logs no content', async () => {
  vi.mocked(openAgentStream).mockResolvedValue(source(frame('response.thinking.delta', { text: 'API thinking', signature: 'SECRET' }) + frame('response', { status: 'completed', content: [{ type: 'thinking', thinking: { text: 'API thinking', signature: 'SECRET' } }, { type: 'text', text: 'Final answer' }] })))
  const response = await POST(post({ question: 'PRIVATE QUESTION' }))
  expect(response.headers.get('content-type')).toBe('text/event-stream')
  const states = []
  for await (const item of readSse(response.body!)) states.push(JSON.parse(item.data))
  expect(states[1].state.thinking).toBe('API thinking')
  expect(states.at(-1).state.status).toBe('complete')
  expect(JSON.stringify(states)).not.toContain('SECRET')
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/PRIVATE QUESTION|API thinking|Final answer/)
})
it('marks EOF and malformed streams incomplete, preserving partial text', async () => {
  for (const ending of ['', 'event: response\ndata: bad\n\n']) {
    vi.mocked(openAgentStream).mockResolvedValue(source(frame('response.text.delta', { text: 'Partial' }) + ending))
    const response = await POST(post({ question: 'Q' }))
    const states = []
    for await (const item of readSse(response.body!)) states.push(JSON.parse(item.data).state)
    expect(states.at(-1).status).toBe('incomplete'); expect(states.at(-1).answer).toBe('Partial')
  }
})
it('returns safe pre-stream errors', async () => {
  vi.mocked(openAgentStream).mockRejectedValue(new AgentError('AGENT_REQUEST_FAILED', 401, '390303'))
  const response = await POST(post({ question: 'Q' }))
  expect(response.status).toBe(502); expect((await response.json()).correlationId).toBeTruthy()
  vi.mocked(openAgentStream).mockRejectedValue(new Error('PRIVATE'))
  expect(await (await POST(post({ question: 'Q' }))).text()).not.toContain('PRIVATE')
})
it('explains that the agent is not built yet on a 404', async () => {
  vi.mocked(openAgentStream).mockRejectedValue(new AgentError('AGENT_REQUEST_FAILED', 404))
  const response = await POST(post({ question: 'Q' }))
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ code: 'AGENT_NOT_BUILT' })
})
it('passes the caller token only when caller rights are available', async () => {
  vi.mocked(openAgentStream).mockResolvedValue(source(frame('response', { status: 'completed', content: [] })))
  await POST(post({ question: 'Q' }))
  expect(vi.mocked(openAgentStream).mock.calls[0][2]).toBeUndefined()
  await POST(post({ question: 'Q' }, 'application/json', { 'sf-context-current-user-token': 'tok' }))
  expect(vi.mocked(openAgentStream).mock.calls[1][2]).toBe('tok')
})
it('aborts upstream when the browser disconnects', async () => {
  vi.mocked(openAgentStream).mockResolvedValue(new ReadableStream({ start() {} }))
  const response = await POST(post({ question: 'Q' }))
  const signal = vi.mocked(openAgentStream).mock.calls[0][1]
  await response.body!.cancel()
  expect(signal.aborted).toBe(true)
})
