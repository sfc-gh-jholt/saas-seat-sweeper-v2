/**
 * GET /api/opportunity
 *
 * Reads the attendee-built pipeline view, V_VENDOR_OPPORTUNITY. Runs as the signed-in
 * user (caller's rights) when Snowflake passes the caller token, otherwise as the app's
 * service role. Returns one row per vendor contract and department, plus `dataAsOf`:
 * the data timestamp of the last successful DT_VENDOR_OPPORTUNITY refresh.
 *
 * Every query carries a QUERY_TAG with route, request id and user (see lib/observability).
 */

import { querySnowflake } from "@/lib/snowflake"
import { labDatabase, labWarehouse } from "@/lib/constants"
import { clip, logEvent, withObservability } from "@/lib/observability"

export const dynamic = "force-dynamic"

export type OpportunityRow = {
  vendor: string
  department: string
  hasContract: boolean
  inactiveSeats: number
  monthly: number
  annualized: number
}

export const GET = withObservability("opportunity", async (_req, ctx) => {
  try {
    const db = labDatabase()
    const [rows, freshness] = await Promise.all([
      querySnowflake(
        `SELECT vendor_name, department, has_contract, inactive_seats,
                monthly_opportunity, annualized_opportunity
         FROM ${db}.APP.V_VENDOR_OPPORTUNITY
         ORDER BY monthly_opportunity DESC, vendor_name, department`,
        { queryTag: ctx.queryTag, callersRights: ctx.callersRights, warehouse: labWarehouse() },
      ),
      // Freshness is best effort and runs as the app's role, so a missing grant never
      // breaks the page.
      querySnowflake(
        `SELECT MAX(data_timestamp) AS data_as_of
         FROM TABLE(${db}.INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY(
           NAME => '${db}.APP.DT_VENDOR_OPPORTUNITY'))
         WHERE state = 'SUCCEEDED'`,
        { queryTag: ctx.queryTag },
      ).catch((e) => {
        logEvent({ event: "freshness_error", request_id: ctx.requestId, error_message: clip(e instanceof Error ? e.message : e) })
        return []
      }),
    ])
    const data: OpportunityRow[] = rows.map((r) => ({
      vendor: String(r.VENDOR_NAME),
      department: String(r.DEPARTMENT),
      hasContract: r.HAS_CONTRACT === true || r.HAS_CONTRACT === "true",
      inactiveSeats: Number(r.INACTIVE_SEATS),
      monthly: Number(r.MONTHLY_OPPORTUNITY),
      annualized: Number(r.ANNUALIZED_OPPORTUNITY),
    }))
    const asOf = freshness[0]?.DATA_AS_OF
    const dataAsOf = asOf ? new Date(asOf).toISOString() : null
    return Response.json({ rows: data, dataAsOf, requestId: ctx.requestId })
  } catch (e) {
    logEvent({
      event: "route_error",
      route: ctx.route,
      request_id: ctx.requestId,
      user: ctx.user,
      error: e instanceof Error ? e.name : "Error",
      error_message: clip(e instanceof Error ? e.message : e),
    })
    return Response.json(
      { error: "Could not load opportunity data. Check that V_VENDOR_OPPORTUNITY exists.", requestId: ctx.requestId },
      { status: 500 },
    )
  }
})
