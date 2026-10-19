import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { GET } from "../../app/api/opportunity/route"
import { querySnowflake } from "../../lib/snowflake"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn() }))

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("LAB_DB", "SEAT_SWEEPER_LAB") })
afterEach(() => vi.unstubAllEnvs())

describe("GET /api/opportunity", () => {
  it("reads the lab view and normalizes rows", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([
      { VENDOR_NAME: "Figma Enterprise", DEPARTMENT: "Design", HAS_CONTRACT: true, INACTIVE_SEATS: "3", MONTHLY_OPPORTUNITY: "225.00", ANNUALIZED_OPPORTUNITY: "2700.00" },
      { VENDOR_NAME: "Zoom Pro", DEPARTMENT: "Sales", HAS_CONTRACT: false, INACTIVE_SEATS: 1, MONTHLY_OPPORTUNITY: 15.99, ANNUALIZED_OPPORTUNITY: 191.88 },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    const { rows } = await res.json()
    expect(rows[0]).toEqual({ vendor: "Figma Enterprise", department: "Design", hasContract: true, inactiveSeats: 3, monthly: 225, annualized: 2700 })
    expect(rows[1].hasContract).toBe(false)
    expect(vi.mocked(querySnowflake).mock.calls[0][0]).toContain("SEAT_SWEEPER_LAB.APP.V_VENDOR_OPPORTUNITY")
  })

  it("returns a safe error when the query fails", async () => {
    vi.mocked(querySnowflake).mockRejectedValue(new Error("PRIVATE detail"))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain("PRIVATE")
  })

  it("refuses an unsafe database name", async () => {
    vi.stubEnv("LAB_DB", "X; DROP")
    const res = await GET()
    expect(res.status).toBe(500)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
})
