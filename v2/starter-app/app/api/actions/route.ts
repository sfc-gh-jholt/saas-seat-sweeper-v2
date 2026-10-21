import { withObservability, clip, logEvent } from '@/lib/observability'
import { queryPostgres } from '@/lib/postgres'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const MAX_BODY_BYTES = 2048
const DECISIONS = new Set(['reclaim', 'keep'])
const FIELDS = new Set(['emp_id', 'asset_id', 'decision', 'note'])

export type SeatAction = {
  action_id: number
  emp_id: number
  asset_id: number
  decision: 'reclaim' | 'keep'
  note: string | null
  actor: string
  created_at: string
}

type ActionInput = { emp_id: number; asset_id: number; decision: 'reclaim' | 'keep'; note: string | null }

function parseAction(text: string): ActionInput {
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('BAD_REQUEST')
  const body = JSON.parse(text)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('BAD_REQUEST')
  if (Object.keys(body).some(key => !FIELDS.has(key))) throw new Error('BAD_REQUEST')
  const { emp_id, asset_id, decision, note } = body
  if (!Number.isInteger(emp_id) || emp_id <= 0 || !Number.isInteger(asset_id) || asset_id <= 0) throw new Error('BAD_REQUEST')
  if (typeof decision !== 'string' || !DECISIONS.has(decision)) throw new Error('BAD_REQUEST')
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) throw new Error('BAD_REQUEST')
  return { emp_id, asset_id, decision: decision as ActionInput['decision'], note: note?.trim() || null }
}

function pgFailure(e: unknown, route: string, requestId: string) {
  const code = (e as { code?: string }).code ?? (e instanceof Error ? e.name : 'Error')
  logEvent({ event: 'pg_error', route, request_id: requestId, code, error_message: clip(e instanceof Error ? e.message : e) })
  return Response.json({ code: 'ACTIONS_UNAVAILABLE', error: 'Could not reach the decisions store.', requestId }, { status: 503 })
}

/**
 * POST /api/actions: record one Reclaim or Keep decision for a seat. Log only: it never
 * changes the seat itself. The actor is the signed-in user from the Snowflake ingress
 * header, never the request body. Writes go to Postgres and reach Snowflake via the mirror.
 */
export const POST = withObservability('actions', async (request, ctx) => {
  const json = (code: string, error: string, status: number) => Response.json({ code, error, requestId: ctx.requestId }, { status })
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json('BAD_REQUEST', 'Send JSON.', 415)
  // Reject browser cross-site posts without trusting proxy-rewritten request URLs.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return json('BAD_ORIGIN', 'Record decisions from the app.', 403)
  let input: ActionInput
  try { input = parseAction(await request.text()) } catch {
    return json('BAD_REQUEST', 'Send emp_id, asset_id, decision (reclaim or keep) and an optional note of up to 500 characters.', 400)
  }
  try {
    const [row] = await queryPostgres<SeatAction>(
      `INSERT INTO public.seat_actions (emp_id, asset_id, decision, note, actor)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING action_id::int, emp_id, asset_id, decision, note, actor, created_at`,
      [input.emp_id, input.asset_id, input.decision, input.note, ctx.user],
    )
    logEvent({ event: 'seat_action', route: 'actions', request_id: ctx.requestId, user: ctx.user, action_id: row.action_id, decision: row.decision })
    return Response.json({ action: row }, { status: 201 })
  } catch (e) {
    // 23503 = no such employee/asset assignment (foreign key).
    if ((e as { code?: string }).code === '23503') return json('SEAT_NOT_FOUND', 'That employee does not hold that seat.', 404)
    return pgFailure(e, 'actions', ctx.requestId)
  }
})

/** GET /api/actions: the 20 most recent decisions, newest first. */
export const GET = withObservability('actions', async (_request, ctx) => {
  try {
    const actions = await queryPostgres<SeatAction>(
      `SELECT action_id::int, emp_id, asset_id, decision, note, actor, created_at
       FROM public.seat_actions ORDER BY created_at DESC, action_id DESC LIMIT 20`,
    )
    return Response.json({ actions })
  } catch (e) {
    return pgFailure(e, 'actions', ctx.requestId)
  }
})
