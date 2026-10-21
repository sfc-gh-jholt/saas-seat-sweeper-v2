import { it, expect, afterEach } from 'vitest'
import { labToday } from '../../lib/lab-date'

afterEach(() => { delete process.env.LAB_TIMEZONE })

it('uses the Snowflake account date, not UTC, in the evening Pacific', () => {
  // 03:11 UTC on Oct 21 is still Oct 20 in Los Angeles: the case that made the seat list
  // show 436 seats while the dashboard showed 428.
  expect(labToday(new Date('2026-10-21T03:11:45Z'))).toBe('2026-10-20')
  expect(labToday(new Date('2026-10-21T08:00:00Z'))).toBe('2026-10-21')
})
it('honours LAB_TIMEZONE', () => {
  process.env.LAB_TIMEZONE = 'UTC'
  expect(labToday(new Date('2026-10-21T03:11:45Z'))).toBe('2026-10-21')
})
