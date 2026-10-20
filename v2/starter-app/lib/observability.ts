/**
 * Request observability for route handlers.
 *
 *   export const GET = withObservability("opportunity", async (req, ctx) => {
 *     const rows = await querySnowflake(sql, { queryTag: ctx.queryTag, callersRights: ctx.callersRights })
 *     return Response.json({ rows })
 *   })
 *
 * Every request gets a request id and one JSON log line on stdout, which Snowflake
 * writes to the account event table (see lab Step 7):
 *   {"event":"request","route":"opportunity","status":200,"duration_ms":41,"user":"JSMITH",...}
 *
 * The signed-in user comes from the Sf-Context-Current-User header that the Snowflake
 * ingress proxy adds. Caller's rights is used only when the proxy also sent
 * Sf-Context-Current-User-Token (app.yml run.executeAsCaller: true); otherwise queries
 * run with the app's owner role and the user still appears in the log and QUERY_TAG.
 */

import { randomUUID } from "crypto"

export const APP_NAME = "seat_sweeper"

export type RequestContext = {
  requestId: string
  route: string
  user: string
  /** True when the caller token header is present, so caller's rights can run. */
  callersRights: boolean
  /** JSON string for the QUERY_TAG statement parameter. */
  queryTag: string
}

type Handler = (req: Request, ctx: RequestContext) => Promise<Response>

/** Keep log fields short and single-line. */
export function clip(value: unknown, max = 500): string {
  const s = String(value ?? "").replace(/\s+/g, " ").trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export function logEvent(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ app: APP_NAME, ts: new Date().toISOString(), ...fields }))
}

export const MAX_CLIENT_LOG_BYTES = 4096
export const CLIENT_LOG_RATE_LIMIT = 20
const CLIENT_LOG_WINDOW_MS = 60_000
const clientLogCounts = new Map<string, { start: number; n: number }>()

/** Per-user, per-minute limit for /api/client-log (in memory, per instance). */
export function allowClientLog(user: string): boolean {
  const now = Date.now()
  const c = clientLogCounts.get(user)
  if (!c || now - c.start > CLIENT_LOG_WINDOW_MS) {
    clientLogCounts.set(user, { start: now, n: 1 })
    return true
  }
  c.n += 1
  return c.n <= CLIENT_LOG_RATE_LIMIT
}

export function resetClientLogLimits(): void {
  clientLogCounts.clear()
}

export function requestContext(req: Request | undefined, route: string): RequestContext {
  const h = req?.headers
  const requestId = h?.get("x-request-id") || randomUUID()
  const user = clip(h?.get("sf-context-current-user") || "local", 128)
  const callersRights = Boolean(h?.get("sf-context-current-user-token"))
  const queryTag = JSON.stringify({ app: APP_NAME, route, request_id: requestId, user })
  return { requestId, route, user, callersRights, queryTag }
}

export function withObservability(route: string, handler: Handler) {
  return async (req?: Request): Promise<Response> => {
    const ctx = requestContext(req, route)
    const t0 = Date.now()
    try {
      const res = await handler(req ?? new Request("http://local/"), ctx)
      logEvent({
        event: "request",
        route,
        method: req?.method ?? "GET",
        status: res.status,
        duration_ms: Date.now() - t0,
        user: ctx.user,
        request_id: ctx.requestId,
        callers_rights: ctx.callersRights,
      })
      res.headers.set("x-request-id", ctx.requestId)
      return res
    } catch (e) {
      logEvent({
        event: "request",
        route,
        method: req?.method ?? "GET",
        status: 500,
        duration_ms: Date.now() - t0,
        user: ctx.user,
        request_id: ctx.requestId,
        callers_rights: ctx.callersRights,
        error: e instanceof Error ? e.name : "Error",
        error_message: clip(e instanceof Error ? e.message : e),
      })
      return Response.json({ error: "Request failed.", requestId: ctx.requestId }, { status: 500 })
    }
  }
}
