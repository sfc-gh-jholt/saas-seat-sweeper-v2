/**
 * POST /api/client-log
 *
 * Receives browser errors from components/client-error-reporter and writes one JSON
 * line per error to stdout (the account event table). Bodies are capped, fields are
 * clipped, and each user is limited to CLIENT_LOG_RATE_LIMIT reports per minute.
 */

import { allowClientLog, clip, logEvent, MAX_CLIENT_LOG_BYTES, withObservability } from "@/lib/observability"

export const dynamic = "force-dynamic"

export const POST = withObservability("client-log", async (req, ctx) => {
  const text = await req.text()
  if (text.length > MAX_CLIENT_LOG_BYTES) return Response.json({ error: "Too large" }, { status: 413 })
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object")
    body = parsed
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!allowClientLog(ctx.user)) return Response.json({ error: "Rate limited" }, { status: 429 })
  logEvent({
    event: "client_error",
    user: ctx.user,
    request_id: ctx.requestId,
    kind: clip(body.kind, 40),
    message: clip(body.message),
    source: clip(body.source, 300),
    page: clip(body.page, 300),
    stack: clip(body.stack, 1000),
  })
  return new Response(null, { status: 204 })
})
