/**
 * GET /api/opportunity
 *
 * Reads the attendee-built pipeline view, V_VENDOR_OPPORTUNITY, as the app's
 * service role. Returns one row per vendor contract and department.
 */

import { querySnowflake } from "@/lib/snowflake"
import { labDatabase } from "@/lib/constants"

export const dynamic = "force-dynamic"

export type OpportunityRow = {
  vendor: string
  department: string
  hasContract: boolean
  inactiveSeats: number
  monthly: number
  annualized: number
}

export async function GET() {
  try {
    const rows = await querySnowflake(
      `SELECT vendor_name, department, has_contract, inactive_seats,
              monthly_opportunity, annualized_opportunity
       FROM ${labDatabase()}.APP.V_VENDOR_OPPORTUNITY
       ORDER BY monthly_opportunity DESC, vendor_name, department`,
    )
    const data: OpportunityRow[] = rows.map((r) => ({
      vendor: String(r.VENDOR_NAME),
      department: String(r.DEPARTMENT),
      hasContract: r.HAS_CONTRACT === true || r.HAS_CONTRACT === "true",
      inactiveSeats: Number(r.INACTIVE_SEATS),
      monthly: Number(r.MONTHLY_OPPORTUNITY),
      annualized: Number(r.ANNUALIZED_OPPORTUNITY),
    }))
    return Response.json({ rows: data })
  } catch (e) {
    console.error("Opportunity route error:", e)
    return Response.json({ error: "Could not load opportunity data. Check that V_VENDOR_OPPORTUNITY exists." }, { status: 500 })
  }
}
