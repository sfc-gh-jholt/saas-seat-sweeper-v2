'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export type Decision = 'reclaim' | 'keep'
export type Seat = {
  emp_id: number; name: string; department: string
  asset_id: number; asset_name: string; vendor_name: string
  monthly_cost_per_seat: number; last_active_date: string; days_inactive: number
  latest_decision: Decision | null; decided_at: string | null; decided_by: string | null
}
export type RowError = { key: string; message: string; requestId: string }
export type SeatListState = {
  status: 'loading' | 'ready' | 'failed'
  seats: Seat[]; vendors: string[]; vendor: string
  loadError: { message: string; requestId: string } | null
  pending: string[]; rowError: RowError | null
}
export type SeatListAction =
  | { type: 'load'; vendor: string }
  | { type: 'loaded'; seats: Seat[]; vendors: string[] }
  | { type: 'loadFailed'; message: string; requestId: string }
  | { type: 'decide'; key: string }
  | { type: 'decided'; key: string; decision: Decision; actor: string; created_at: string }
  | { type: 'decideFailed'; key: string; message: string; requestId: string }
  | { type: 'dismissError' }

export const seatKey = (seat: Pick<Seat, 'emp_id' | 'asset_id'>) => `${seat.emp_id}:${seat.asset_id}`
export const initialSeatListState = (): SeatListState => ({ status: 'loading', seats: [], vendors: [], vendor: '', loadError: null, pending: [], rowError: null })

export function seatListReducer(state: SeatListState, action: SeatListAction): SeatListState {
  switch (action.type) {
    case 'load': return { ...state, status: 'loading', vendor: action.vendor, loadError: null }
    case 'loaded': return { ...state, status: 'ready', seats: action.seats, vendors: action.vendors, loadError: null }
    case 'loadFailed': return { ...state, status: 'failed', loadError: { message: action.message, requestId: action.requestId } }
    case 'decide': return { ...state, pending: [...state.pending, action.key], rowError: state.rowError?.key === action.key ? null : state.rowError }
    case 'decided': return {
      ...state, pending: state.pending.filter(key => key !== action.key),
      seats: state.seats.map(seat => seatKey(seat) === action.key ? { ...seat, latest_decision: action.decision, decided_by: action.actor, decided_at: action.created_at } : seat),
    }
    case 'decideFailed': return { ...state, pending: state.pending.filter(key => key !== action.key), rowError: { key: action.key, message: action.message, requestId: action.requestId } }
    case 'dismissError': return { ...state, rowError: null }
  }
}

type Dispatch = (action: SeatListAction) => void
type ApiError = { message: string; requestId: string }

async function readError(response: Response | null, fallback: string): Promise<ApiError> {
  const body = response ? await response.json().catch(() => ({})) : {}
  return {
    message: typeof body.error === 'string' ? body.error : fallback,
    requestId: typeof body.requestId === 'string' ? body.requestId : response?.headers.get('x-request-id') ?? '',
  }
}

/** Fetch seats for a vendor ('' = all) and dispatch the result. */
export async function loadSeats(dispatch: Dispatch, vendor: string, fetchImpl: typeof fetch = fetch) {
  dispatch({ type: 'load', vendor })
  let response: Response | null = null
  try {
    response = await fetchImpl(vendor ? `/api/seats?vendor=${encodeURIComponent(vendor)}` : '/api/seats')
    if (response.ok) {
      const body = await response.json()
      if (Array.isArray(body.seats) && Array.isArray(body.vendors)) return dispatch({ type: 'loaded', seats: body.seats, vendors: body.vendors })
    }
  } catch { /* fall through to the generic failure below */ }
  const error = await readError(response?.ok ? null : response, 'Could not load seats.')
  dispatch({ type: 'loadFailed', ...error })
}

/** Record one decision; logs an action and never changes the seat. */
export async function recordDecision(dispatch: Dispatch, seat: Seat, decision: Decision, fetchImpl: typeof fetch = fetch) {
  const key = seatKey(seat)
  dispatch({ type: 'decide', key })
  let response: Response | null = null
  try {
    response = await fetchImpl('/api/actions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emp_id: seat.emp_id, asset_id: seat.asset_id, decision }),
    })
    if (response.status === 201) {
      const { action } = await response.json()
      return dispatch({ type: 'decided', key, decision: action.decision, actor: action.actor, created_at: action.created_at })
    }
  } catch { /* fall through */ }
  const error = await readError(response?.status === 201 ? null : response, 'Could not record the decision.')
  dispatch({ type: 'decideFailed', key, ...error })
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const label = (decision: Decision) => decision === 'reclaim' ? 'Reclaim' : 'Keep'

export function summarizeSeats(seats: Seat[]) {
  return {
    count: seats.length,
    monthly: seats.reduce((sum, seat) => sum + Number(seat.monthly_cost_per_seat || 0), 0),
    reclaim: seats.filter(seat => seat.latest_decision === 'reclaim').length,
    keep: seats.filter(seat => seat.latest_decision === 'keep').length,
    undecided: seats.filter(seat => !seat.latest_decision).length,
  }
}

export type SeatListViewProps = {
  state: SeatListState
  onVendorChange: (vendor: string) => void
  onDecide: (seat: Seat, decision: Decision) => void
  onRetry: () => void
  onDismissError: () => void
}

export function SeatListView({ state, onVendorChange, onDecide, onRetry, onDismissError }: SeatListViewProps) {
  const summary = summarizeSeats(state.seats)
  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
    <header className="max-w-2xl space-y-3">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Seat Sweeper / Seats</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Seats</h1>
      <p className="text-sm leading-6 text-muted-foreground">Inactive paid seats (30+ days). Record a decision; this logs it and does not change the seat.</p>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground" data-testid="seat-summary">
        {summary.count} seats · {currency.format(summary.monthly)}/mo shown · {summary.reclaim} reclaim · {summary.keep} keep · {summary.undecided} undecided
      </p>
      <label className="flex items-center gap-2 text-sm">
        <span>Vendor</span>
        <select value={state.vendor} onChange={event => onVendorChange(event.target.value)} disabled={state.status === 'loading'} className="rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="">All vendors</option>
          {state.vendors.map(vendor => <option key={vendor} value={vendor}>{vendor}</option>)}
        </select>
      </label>
    </div>
    {state.rowError && <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
      <p>{state.rowError.message}{state.rowError.requestId && <span className="ml-2 font-mono text-xs text-muted-foreground">Request {state.rowError.requestId}</span>}</p>
      <Button type="button" variant="ghost" size="sm" onClick={onDismissError}>Dismiss</Button>
    </div>}
    {state.status === 'loading' && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />Loading seats…</p>}
    {state.status === 'failed' && state.loadError && <div role="alert" className="space-y-3 rounded-xl border bg-card p-5 text-sm">
      <p>{state.loadError.message}</p>
      {state.loadError.requestId && <p className="font-mono text-xs text-muted-foreground">Request {state.loadError.requestId}</p>}
      <Button type="button" variant="outline" onClick={onRetry}><RotateCw aria-hidden="true" className="mr-2 h-4 w-4" />Retry</Button>
    </div>}
    {state.status === 'ready' && <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <table className="w-full text-sm">
        <caption className="sr-only">Inactive paid seats with their latest recorded decision</caption>
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>{['Employee', 'Seat', '$/mo', 'Inactive', 'Decision', 'Actions'].map(heading => <th key={heading} scope="col" className="px-4 py-3 font-medium">{heading}</th>)}</tr>
        </thead>
        <tbody>
          {state.seats.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No inactive seats in this view.</td></tr>}
          {state.seats.map(seat => {
            const key = seatKey(seat)
            const pending = state.pending.includes(key)
            return <tr key={key} className="border-b last:border-b-0">
              <td className="px-4 py-3"><span className="block font-medium">{seat.name}</span><span className="text-xs text-muted-foreground">{seat.department}</span></td>
              <td className="px-4 py-3"><span className="block">{seat.asset_name}</span><span className="text-xs text-muted-foreground">{seat.vendor_name}</span></td>
              <td className="px-4 py-3 tabular-nums">{currency.format(Number(seat.monthly_cost_per_seat || 0))}</td>
              <td className="px-4 py-3"><span className="block">{seat.days_inactive} days</span><span className="text-xs text-muted-foreground">Last active {seat.last_active_date}</span></td>
              <td className="px-4 py-3">{seat.latest_decision
                ? <span className="space-y-1"><Badge variant={seat.latest_decision === 'reclaim' ? 'default' : 'secondary'}>{label(seat.latest_decision)}</Badge>{seat.decided_by && <span className="block text-xs text-muted-foreground">by {seat.decided_by}</span>}</span>
                : <span className="text-muted-foreground">—</span>}</td>
              <td className="px-4 py-3"><div className="flex gap-2">
                {(['reclaim', 'keep'] as const).map(decision => {
                  const selected = seat.latest_decision === decision
                  return <Button key={decision} type="button" size="sm" variant={selected ? 'default' : 'outline'} disabled={pending} aria-pressed={selected}
                    aria-label={`${label(decision)} ${seat.asset_name} ${decision === 'reclaim' ? 'from' : 'for'} ${seat.name}`} onClick={() => onDecide(seat, decision)}>
                    {label(decision)}
                  </Button>
                })}
              </div></td>
            </tr>
          })}
        </tbody>
      </table>
    </div>}
    <p className="text-xs text-muted-foreground">Synthetic workshop data. Seat costs are opportunities to review, not realized savings.</p>
  </main>
}

export function SeatList() {
  const [state, dispatch] = useReducer(seatListReducer, undefined, initialSeatListState)
  const latestLoad = useRef(0)
  // Ignore responses from superseded loads so a slow earlier vendor can't overwrite a newer one.
  const load = useCallback((vendor: string) => {
    const id = ++latestLoad.current
    void loadSeats(action => { if (id === latestLoad.current || action.type === 'load') dispatch(action) }, vendor)
  }, [])
  useEffect(() => { load('') }, [load])
  return <SeatListView state={state}
    onVendorChange={load}
    onRetry={() => load(state.vendor)}
    onDecide={(seat, decision) => { if (!state.pending.includes(seatKey(seat))) void recordDecision(dispatch, seat, decision) }}
    onDismissError={() => dispatch({ type: 'dismissError' })} />
}
