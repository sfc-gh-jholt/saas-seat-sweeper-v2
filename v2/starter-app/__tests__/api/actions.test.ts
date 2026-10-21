import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET, POST } from '../../app/api/actions/route'
import { queryPostgres } from '../../lib/postgres'
vi.mock('../../lib/postgres', () => ({ queryPostgres: vi.fn() }))
const post = (body: unknown, type = 'application/json', headers = {}) => new Request('http://localhost/api/actions', { method: 'POST', headers: { 'content-type': type, 'sf-context-current-user': 'JSMITH', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const valid = { emp_id: 73, asset_id: 2, decision: 'reclaim', note: 'left the design team' }
const row = { action_id: 1, emp_id: 73, asset_id: 2, decision: 'reclaim', note: 'left the design team', actor: 'JSMITH', created_at: '2026-10-21T02:49:33Z' }
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

it.each([{}, null, [], 'bad JSON', { ...valid, decision: 'delete' }, { ...valid, emp_id: '73' }, { ...valid, asset_id: 0 },
  { ...valid, emp_id: 1.5 }, { ...valid, note: 'x'.repeat(501) }, { ...valid, note: 4 }, { ...valid, actor: 'ADMIN' }])('rejects invalid body %j', async body => {
  expect((await POST(post(body))).status).toBe(400); expect(queryPostgres).not.toHaveBeenCalled()
})
it('rejects oversized payloads, non-JSON and cross-site browser requests', async () => {
  expect((await POST(post(' '.repeat(3000)))).status).toBe(400)
  expect((await POST(post('emp_id=1', 'text/plain'))).status).toBe(415)
  expect((await POST(post(valid, 'application/json', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
  expect(queryPostgres).not.toHaveBeenCalled()
})
it('inserts with bound parameters and takes the actor from the signed-in user', async () => {
  vi.mocked(queryPostgres).mockResolvedValue([row])
  const response = await POST(post(valid))
  expect(response.status).toBe(201)
  expect((await response.json()).action).toEqual(row)
  const [sql, values] = vi.mocked(queryPostgres).mock.calls[0]
  expect(sql).toMatch(/INSERT INTO public\.seat_actions/); expect(sql).not.toMatch(/UPDATE|employee_assets/)
  expect(values).toEqual([73, 2, 'reclaim', 'left the design team', 'JSMITH'])
})
it('stores a blank note as null', async () => {
  vi.mocked(queryPostgres).mockResolvedValue([row])
  await POST(post({ emp_id: 73, asset_id: 2, decision: 'keep', note: '   ' }))
  expect(vi.mocked(queryPostgres).mock.calls[0][1]).toEqual([73, 2, 'keep', null, 'JSMITH'])
})
it('returns 404 for a seat the employee does not hold', async () => {
  vi.mocked(queryPostgres).mockRejectedValue(Object.assign(new Error('violates foreign key'), { code: '23503' }))
  const response = await POST(post(valid))
  expect(response.status).toBe(404); expect((await response.json()).code).toBe('SEAT_NOT_FOUND')
})
it('hides database errors from the browser', async () => {
  vi.mocked(queryPostgres).mockRejectedValue(Object.assign(new Error('PRIVATE host detail'), { code: 'ECONNREFUSED' }))
  for (const response of [await POST(post(valid)), await GET(new Request('http://localhost/api/actions'))]) {
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toContain('PRIVATE'); expect(JSON.parse(text).requestId).toBeTruthy()
  }
})
it('lists recent actions', async () => {
  vi.mocked(queryPostgres).mockResolvedValue([row])
  const response = await GET(new Request('http://localhost/api/actions'))
  expect(response.status).toBe(200); expect((await response.json()).actions).toEqual([row])
  expect(vi.mocked(queryPostgres).mock.calls[0][0]).toMatch(/ORDER BY created_at DESC[\s\S]*LIMIT 20/)
})
