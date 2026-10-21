import { withObservability, clip, logEvent } from '@/lib/observability'
import { labToday } from '@/lib/lab-date'
import { queryPostgres } from '@/lib/postgres'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const MAX_VENDOR_LENGTH = 100
const MAX_SEATS = 500

export type Seat = {
  emp_id: number
  name: string
  department: string
  asset_id: number
  asset_name: string
  vendor_name: string
  monthly_cost_per_seat: number
  last_active_date: string
  days_inactive: number
  latest_decision: 'reclaim' | 'keep' | null
  decided_at: string | null
  decided_by: string | null
}

// Same rule as the Snowflake dynamic table: inactive 30+ days and the seat costs money.
// Decisions are log only, so they never remove a seat from this list.
// "Today" is the Snowflake account's date (see lib/lab-date.ts), bound as a parameter.
const ELIGIBLE = (today: string) => `
  SELECT ea.emp_id, e.name, e.department, a.asset_id, a.asset_name,
         COALESCE(c.vendor_name, a.asset_name) AS vendor_name,
         a.monthly_cost_per_seat::float8 AS monthly_cost_per_seat,
         ea.last_active_date
    FROM public.employee_assets ea
    JOIN public.employees e ON e.emp_id = ea.emp_id
    JOIN public.assets a ON a.asset_id = ea.asset_id
    LEFT JOIN public.contracts c ON c.contract_id = a.contract_id
   WHERE ea.status = 'Inactive'
     AND ea.last_active_date <= ${today}::date - 30
     AND a.monthly_cost_per_seat > 0`

const SEATS_SQL = `
  WITH eligible AS (${ELIGIBLE('$2')})
  SELECT s.emp_id, s.name, s.department, s.asset_id, s.asset_name, s.vendor_name,
         s.monthly_cost_per_seat,
         to_char(s.last_active_date, 'YYYY-MM-DD') AS last_active_date,
         ($2::date - s.last_active_date)::int AS days_inactive,
         d.decision AS latest_decision,
         to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS decided_at,
         d.actor AS decided_by
    FROM eligible s
    LEFT JOIN LATERAL (
      SELECT sa.decision, sa.created_at, sa.actor
        FROM public.seat_actions sa
       WHERE sa.emp_id = s.emp_id AND sa.asset_id = s.asset_id
       ORDER BY sa.created_at DESC, sa.action_id DESC
       LIMIT 1
    ) d ON true
   WHERE ($1::text IS NULL OR s.vendor_name = $1::text)
   ORDER BY s.monthly_cost_per_seat DESC, days_inactive DESC, s.emp_id, s.asset_id
   LIMIT ${MAX_SEATS}`

const VENDORS_SQL = `
  WITH eligible AS (${ELIGIBLE('$1')})
  SELECT DISTINCT vendor_name FROM eligible ORDER BY vendor_name`

function pgFailure(e: unknown, route: string, requestId: string) {
  const code = (e as { code?: string }).code ?? (e instanceof Error ? e.name : 'Error')
  logEvent({ event: 'pg_error', route, request_id: requestId, code, error_message: clip(e instanceof Error ? e.message : e) })
  return Response.json({ code: 'SEATS_UNAVAILABLE', error: 'Could not reach the seats store.', requestId }, { status: 503 })
}

/**
 * GET /api/seats[?vendor=X]: eligible (reclaimable) seats with their latest decision, plus the
 * distinct vendor list across all eligible seats. Read only; the vendor is always a bound value.
 */
export const GET = withObservability('seats', async (request, ctx) => {
  const vendor = new URL(request.url).searchParams.get('vendor') || null
  if (vendor && vendor.length > MAX_VENDOR_LENGTH) {
    return Response.json({ code: 'BAD_REQUEST', error: `vendor must be ${MAX_VENDOR_LENGTH} characters or fewer.`, requestId: ctx.requestId }, { status: 400 })
  }
  try {
    const today = labToday()
    const seats = await queryPostgres<Seat>(SEATS_SQL, [vendor, today])
    const vendors = (await queryPostgres<{ vendor_name: string }>(VENDORS_SQL, [today])).map(r => r.vendor_name)
    return Response.json({ seats, vendors })
  } catch (e) {
    return pgFailure(e, 'seats', ctx.requestId)
  }
})
