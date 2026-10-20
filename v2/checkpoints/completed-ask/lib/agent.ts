import { buildCallerRightsToken, getRestApiAuthHeader, getServiceToken, getSnowflakeBaseUrl } from '@/lib/snowflake'
import { labDatabase } from '@/lib/constants'

export class AgentError extends Error {
  constructor(public code: string, public upstreamStatus?: number, public upstreamCode?: string) { super(code) }
}

/**
 * Opens the named Agent REST stream. Credentials and destinations stay server-side.
 * With `callerToken` (the Sf-Context-Current-User-Token header, present when app.yml sets
 * run.executeAsCaller) the agent runs as the signed-in user (caller's rights); otherwise
 * it runs as the app's owner role.
 */
export async function openAgentStream(question: string, signal: AbortSignal, callerToken?: string): Promise<ReadableStream<Uint8Array>> {
  const base = getSnowflakeBaseUrl()
  if (!base) throw new AgentError('API_HOST_UNAVAILABLE')
  const origin = new URL(base)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) throw new AgentError('API_HOST_INVALID')
  const auth = callerToken && getServiceToken() ? `Bearer ${buildCallerRightsToken(callerToken)}` : getRestApiAuthHeader()
  if (!auth.startsWith('Bearer ') || !auth.slice(7).trim()) throw new AgentError('AGENT_AUTH_UNAVAILABLE')
  const url = new URL(`/api/v2/databases/${labDatabase()}/schemas/APP/agents/SEAT_SWEEPER_AGENT:run`, origin)
  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: auth, 'X-Snowflake-Authorization-Token-Type': 'OAUTH', 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: [{ type: 'text', text: question }] }] }),
    })
  } catch {
    throw new AgentError(signal.aborted ? 'AGENT_INTERRUPTED' : 'AGENT_UNREACHABLE')
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    const code = /^\d{3,7}$/.test(String(failure?.code)) ? String(failure.code) : undefined
    throw new AgentError('AGENT_REQUEST_FAILED', response.status, code)
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel()
    throw new AgentError('AGENT_BAD_RESPONSE')
  }
  return response.body
}
