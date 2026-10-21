import { withObservability, clip, logEvent } from "@/lib/observability"
import { queryPostgres } from "@/lib/postgres"

export const dynamic = "force-dynamic"

/** Can the app reach its Postgres instance? Used by the lab to prove the network path. */
export const GET = withObservability("pg_health", async (_req, ctx) => {
  const t0 = Date.now()
  try {
    const [row] = await queryPostgres<{ version: string; actions: number }>(
      "SELECT split_part(version(), ' ', 2) AS version, (SELECT count(*)::int FROM public.seat_actions) AS actions",
    )
    return Response.json({ ok: true, postgres: row.version, seat_actions: row.actions, latency_ms: Date.now() - t0 })
  } catch (e) {
    const code = (e as { code?: string }).code ?? (e instanceof Error ? e.name : "Error")
    logEvent({ event: "pg_error", route: "pg_health", request_id: ctx.requestId, code, error_message: clip(e instanceof Error ? e.message : e) })
    return Response.json({ ok: false, code, requestId: ctx.requestId }, { status: 503 })
  }
})
