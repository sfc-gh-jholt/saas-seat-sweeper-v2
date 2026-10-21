import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET } from '../../app/api/seats/route'
import { queryPostgres } from '../../lib/postgres'
import { labToday } from '../../lib/lab-date'
vi.mock('../../lib/postgres', () => ({ queryPostgres: vi.fn() }))
vi.mock('../../lib/lab-date', () => ({ labToday: vi.fn(() => '2026-10-20') }))
const get = (qs = '') => GET(new Request(`http://localhost/api/seats${qs}`))
const seat = { emp_id: 73, name: 'Ada', department: 'Design', asset_id: 2, asset_name: 'Figma Pro', vendor_name: 'Figma',
  monthly_cost_per_seat: 45, last_active_date: '2026-08-01', days_inactive: 81, latest_decision: 'keep',
  decided_at: '2026-10-21T02:49:33.000Z', decided_by: 'JSMITH' }
const mockRows = () => vi.mocked(queryPostgres).mockImplementation(async (sql: string) =>
  (/SELECT DISTINCT vendor_name/.test(sql) ? [{ vendor_name: 'Figma' }, { vendor_name: 'Slack' }] : [seat]) as never)
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

it('lists all eligible seats read-only with the eligibility rule', async () => {
  mockRows()
  expect((await get()).status).toBe(200)
  for (const [sql] of vi.mocked(queryPostgres).mock.calls) {
    expect(sql).toMatch(/status = 'Inactive'/)
    expect(sql).toMatch(/last_active_date <= \$\d::date - 30/); expect(sql).not.toMatch(/current_date/)
    expect(sql).toMatch(/monthly_cost_per_seat > 0/)
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i)
  }
  expect(vi.mocked(queryPostgres).mock.calls.map(c => c[1])).toEqual([[null, '2026-10-20'], ['2026-10-20']])
  const [sql] = vi.mocked(queryPostgres).mock.calls[0]
  expect(sql).toMatch(/ORDER BY s\.monthly_cost_per_seat DESC, days_inactive DESC, s\.emp_id, s\.asset_id\s+LIMIT 500/)
})
it('binds the vendor filter as a parameter', async () => {
  mockRows()
  await get("?vendor=Figma'%3B%20DROP")
  const [sql, values] = vi.mocked(queryPostgres).mock.calls[0]
  expect(values).toEqual(["Figma'; DROP", '2026-10-20']); expect(sql).not.toContain('DROP')
})
it('treats an empty vendor as unfiltered', async () => {
  mockRows()
  await get('?vendor=')
  expect(vi.mocked(queryPostgres).mock.calls[0][1]).toEqual([null, '2026-10-20'])
})
it('rejects an over-long vendor without querying', async () => {
  const response = await get(`?vendor=${'x'.repeat(101)}`)
  expect(response.status).toBe(400)
  const body = await response.json()
  expect(body.code).toBe('BAD_REQUEST'); expect(body.requestId).toBeTruthy()
  expect(queryPostgres).not.toHaveBeenCalled()
})
it('hides database errors from the browser', async () => {
  vi.mocked(queryPostgres).mockRejectedValue(Object.assign(new Error('PRIVATE host detail'), { code: 'ECONNREFUSED' }))
  const response = await get()
  expect(response.status).toBe(503)
  const text = await response.text()
  expect(text).not.toContain('PRIVATE'); expect(JSON.parse(text).requestId).toBeTruthy()
})
it('passes the seats and vendors through in the contract shape', async () => {
  mockRows()
  expect(await (await get()).json()).toEqual({ seats: [seat], vendors: ['Figma', 'Slack'] })
  expect(labToday).toHaveBeenCalled()
})
