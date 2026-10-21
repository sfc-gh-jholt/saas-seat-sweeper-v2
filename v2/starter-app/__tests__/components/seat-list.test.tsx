import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SeatListView, initialSeatListState, loadSeats, recordDecision, seatKey, seatListReducer,
  type Seat, type SeatListAction, type SeatListState,
} from '../../components/seat-list'

const seat = (overrides: Partial<Seat> = {}): Seat => ({
  emp_id: 7, name: 'Jane Doe', department: 'Design', asset_id: 3, asset_name: 'Figma Full Seat', vendor_name: 'Figma',
  monthly_cost_per_seat: 45, last_active_date: '2026-08-01', days_inactive: 81,
  latest_decision: null, decided_at: null, decided_by: null, ...overrides,
})
const seats = [seat(), seat({ emp_id: 8, name: 'Sam Lee', department: 'Sales', asset_id: 4, asset_name: 'Slack Pro', vendor_name: 'Slack', monthly_cost_per_seat: 8.75, latest_decision: 'keep', decided_by: 'ANA' })]
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A store that drives the real reducer, as useReducer would. */
function store(start: SeatListState = initialSeatListState()) {
  let state = start
  const dispatch = vi.fn((action: SeatListAction) => { state = seatListReducer(state, action) })
  return { dispatch, get state() { return state } }
}
const render = (state: SeatListState) => renderToStaticMarkup(React.createElement(SeatListView, { state, onVendorChange() {}, onDecide() {}, onRetry() {}, onDismissError() {} }))
const ready = () => seatListReducer(initialSeatListState(), { type: 'loaded', seats, vendors: ['Figma', 'Slack'] })

afterEach(() => vi.unstubAllGlobals())

describe('SeatList', () => {
  it('renders rows and summary from GET /api/seats', async () => {
    const fetchMock = vi.fn(async () => json({ seats, vendors: ['Figma', 'Slack'] }))
    vi.stubGlobal('fetch', fetchMock)
    const s = store()
    expect(render(s.state)).toContain('Loading seats')
    await loadSeats(s.dispatch, '')
    expect(fetchMock).toHaveBeenCalledWith('/api/seats')
    const html = render(s.state)
    expect(html).toContain('2 seats · $53.75/mo shown · 0 reclaim · 1 keep · 1 undecided')
    expect(html).toContain('Jane Doe'); expect(html).toContain('Design'); expect(html).toContain('Figma Full Seat')
    expect(html).toContain('$45.00'); expect(html).toContain('81 days'); expect(html).toContain('Last active 2026-08-01')
    expect(html).toContain('<caption'); expect(html).toContain('by ANA'); expect(html).toContain('—')
    expect(html).toContain('aria-label="Reclaim Figma Full Seat from Jane Doe"')
    expect(html).toContain('<option value="Slack">Slack</option>')
  })

  it('vendor filter refetches with an encoded ?vendor=', async () => {
    const fetchMock = vi.fn(async () => json({ seats: [], vendors: ['A&B Co'] }))
    vi.stubGlobal('fetch', fetchMock)
    const s = store(ready())
    await loadSeats(s.dispatch, 'A&B Co / Pro')
    expect(fetchMock).toHaveBeenCalledWith('/api/seats?vendor=A%26B%20Co%20%2F%20Pro')
    expect(s.state.vendor).toBe('A&B Co / Pro')
  })

  it('Reclaim POSTs the correct body and updates the badge', async () => {
    const fetchMock = vi.fn(async () => json({ action: { action_id: 1, emp_id: 7, asset_id: 3, decision: 'reclaim', note: null, actor: 'JHOLT', created_at: '2026-10-21T10:00:00Z' } }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const s = store(ready())
    await recordDecision(s.dispatch, seats[0], 'reclaim')
    expect(fetchMock).toHaveBeenCalledWith('/api/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emp_id: 7, asset_id: 3, decision: 'reclaim' }) })
    expect(s.state.seats[0]).toMatchObject({ latest_decision: 'reclaim', decided_by: 'JHOLT', decided_at: '2026-10-21T10:00:00Z' })
    const html = render(s.state)
    expect(html).toContain('by JHOLT')
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Reclaim Figma Full Seat from Jane Doe"/)
    expect(html).toContain('1 reclaim · 1 keep · 0 undecided')
  })

  it('disables only that row\'s buttons while pending', async () => {
    let resolve!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r })))
    const s = store(ready())
    const done = recordDecision(s.dispatch, seats[0], 'keep')
    expect(s.state.pending).toEqual([seatKey(seats[0])])
    const html = render(s.state)
    expect(html).toMatch(/disabled=""[^>]*aria-label="Reclaim Figma Full Seat from Jane Doe"/)
    expect(html).toMatch(/disabled=""[^>]*aria-label="Keep Figma Full Seat for Jane Doe"/)
    expect(html).not.toMatch(/disabled=""[^>]*aria-label="Keep Slack Pro for Sam Lee"/)
    resolve(json({ action: { action_id: 2, emp_id: 7, asset_id: 3, decision: 'keep', note: null, actor: 'JHOLT', created_at: 'x' } }, 201))
    await done
    expect(s.state.pending).toEqual([])
  })

  it('POST 404 shows an inline error with the requestId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'SEAT_NOT_FOUND', error: 'That employee does not hold that seat.', requestId: 'req-404' }, 404)))
    const s = store(ready())
    await recordDecision(s.dispatch, seats[0], 'reclaim')
    const html = render(s.state)
    expect(html).toContain('role="alert"'); expect(html).toContain('That employee does not hold that seat.'); expect(html).toContain('req-404')
    expect(html).toContain('Jane Doe') // non-blocking: table still rendered
    expect(s.state.seats[0].latest_decision).toBeNull()
  })

  it('GET failure shows retry, and retry refetches', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ code: 'SEATS_UNAVAILABLE', error: 'Could not reach the seats store.', requestId: 'req-503' }, 503))
      .mockResolvedValueOnce(json({ seats, vendors: ['Figma'] }))
    vi.stubGlobal('fetch', fetchMock)
    const s = store()
    await loadSeats(s.dispatch, '')
    const html = render(s.state)
    expect(html).toContain('Retry'); expect(html).toContain('Could not reach the seats store.'); expect(html).toContain('req-503')
    await loadSeats(s.dispatch, s.state.vendor)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(s.state.status).toBe('ready')
    expect(render(s.state)).toContain('Jane Doe')
  })
})
