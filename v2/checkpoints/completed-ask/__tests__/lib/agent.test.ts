import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openAgentStream } from '../../lib/agent'
import { getRestApiAuthHeader, getSnowflakeBaseUrl } from '../../lib/snowflake'
vi.mock('../../lib/snowflake', () => ({ getRestApiAuthHeader: vi.fn(), getSnowflakeBaseUrl: vi.fn() }))
const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); vi.stubEnv('LAB_DB', 'SEAT_SWEEPER_LAB')
  vi.mocked(getSnowflakeBaseUrl).mockReturnValue('https://host.example')
  vi.mocked(getRestApiAuthHeader).mockReturnValue('Bearer test-token')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('calls only the configured named Agent API using streaming OAuth', async () => {
  fetchMock.mockResolvedValue(new Response('event: response\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
  const stream = await openAgentStream('Question', new AbortController().signal)
  expect(stream).toBeTruthy()
  const [url, options] = fetchMock.mock.calls[0]
  expect(url).toBe('https://host.example/api/v2/databases/SEAT_SWEEPER_LAB/schemas/APP/agents/SEAT_SWEEPER_AGENT:run')
  expect(options.redirect).toBe('error')
  expect(options.headers.Accept).toBe('text/event-stream')
  expect(options.headers['X-Snowflake-Authorization-Token-Type']).toBe('OAUTH')
  expect(JSON.parse(options.body).stream).toBe(true)
})
it('exposes numeric codes but never raw upstream errors', async () => {
  fetchMock.mockResolvedValue(Response.json({ code: '390303', message: 'PRIVATE' }, { status: 401 }))
  const error = await openAgentStream('Q', new AbortController().signal).catch(error => error)
  expect(error.upstreamCode).toBe('390303'); expect(JSON.stringify(error)).not.toContain('PRIVATE')
})
it('rejects missing credentials, unsafe host and non-streaming responses', async () => {
  vi.mocked(getRestApiAuthHeader).mockReturnValue('Bearer ')
  await expect(openAgentStream('Q', new AbortController().signal)).rejects.toThrow('AGENT_AUTH_UNAVAILABLE')
  vi.mocked(getSnowflakeBaseUrl).mockReturnValue('http://host.example')
  await expect(openAgentStream('Q', new AbortController().signal)).rejects.toThrow('API_HOST_INVALID')
  vi.mocked(getSnowflakeBaseUrl).mockReturnValue(null)
  await expect(openAgentStream('Q', new AbortController().signal)).rejects.toThrow('API_HOST_UNAVAILABLE')
  expect(fetchMock).not.toHaveBeenCalled()
  vi.mocked(getSnowflakeBaseUrl).mockReturnValue('https://host.example')
  vi.mocked(getRestApiAuthHeader).mockReturnValue('Bearer token')
  fetchMock.mockResolvedValue(Response.json({ content: [] }))
  await expect(openAgentStream('Q', new AbortController().signal)).rejects.toThrow('AGENT_BAD_RESPONSE')
})
