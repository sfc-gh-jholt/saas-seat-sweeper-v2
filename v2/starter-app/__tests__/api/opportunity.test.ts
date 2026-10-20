import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { GET } from "../../app/api/opportunity/route"
import { POST } from "../../app/api/client-log/route"
import { querySnowflake } from "../../lib/snowflake"
import { CLIENT_LOG_RATE_LIMIT, resetClientLogLimits } from "../../lib/observability"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn() }))

let logs: Record<string, any>[] = []

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("LAB_DB", "SEAT_SWEEPER_LAB")
  logs = []
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    try { logs.push(JSON.parse(line)) } catch { /* not JSON */ }
  })
  resetClientLogLimits()
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

const viewRows = [
  { VENDOR_NAME: "Figma Enterprise", DEPARTMENT: "Design", HAS_CONTRACT: true, INACTIVE_SEATS: "3", MONTHLY_OPPORTUNITY: "225.00", ANNUALIZED_OPPORTUNITY: "2700.00" },
  { VENDOR_NAME: "Zoom Pro", DEPARTMENT: "Sales", HAS_CONTRACT: false, INACTIVE_SEATS: 1, MONTHLY_OPPORTUNITY: 15.99, ANNUALIZED_OPPORTUNITY: 191.88 },
]

function mockQueries(freshness: Record<string, any>[] | Error = [{ DATA_AS_OF: "2026-10-20T15:00:00Z" }]) {
  vi.mocked(querySnowflake).mockImplementation(async (sql: string) => {
    if (sql.includes("DYNAMIC_TABLE_REFRESH_HISTORY")) {
      if (freshness instanceof Error) throw freshness
      return freshness
    }
    return viewRows
  })
}

const signedIn = (extra: Record<string, string> = {}) =>
  new Request("http://app/api/opportunity", { headers: { "sf-context-current-user": "JSMITH", ...extra } })

describe("GET /api/opportunity", () => {
  it("reads the lab view and normalizes rows", async () => {
    mockQueries()
    const res = await GET(signedIn())
    expect(res.status).toBe(200)
    const { rows, dataAsOf } = await res.json()
    expect(rows[0]).toEqual({ vendor: "Figma Enterprise", department: "Design", hasContract: true, inactiveSeats: 3, monthly: 225, annualized: 2700 })
    expect(rows[1].hasContract).toBe(false)
    expect(dataAsOf).toBe("2026-10-20T15:00:00.000Z")
    expect(vi.mocked(querySnowflake).mock.calls[0][0]).toContain("SEAT_SWEEPER_LAB.APP.V_VENDOR_OPPORTUNITY")
  })

  it("tags queries with route, request id and user", async () => {
    mockQueries()
    const res = await GET(signedIn())
    const tag = JSON.parse(vi.mocked(querySnowflake).mock.calls[0][1]!.queryTag!)
    expect(tag).toMatchObject({ app: "seat_sweeper", route: "opportunity", user: "JSMITH" })
    expect(res.headers.get("x-request-id")).toBe(tag.request_id)
  })

  it("uses caller's rights only when the caller token header is present", async () => {
    mockQueries()
    await GET(signedIn())
    expect(vi.mocked(querySnowflake).mock.calls[0][1]!.callersRights).toBe(false)
    vi.mocked(querySnowflake).mockClear()
    await GET(signedIn({ "sf-context-current-user-token": "tok" }))
    expect(vi.mocked(querySnowflake).mock.calls[0][1]!.callersRights).toBe(true)
  })

  it("writes one structured request log line", async () => {
    mockQueries()
    await GET(signedIn())
    const req = logs.filter((l) => l.event === "request")
    expect(req).toHaveLength(1)
    expect(req[0]).toMatchObject({ route: "opportunity", status: 200, user: "JSMITH", callers_rights: false })
    expect(typeof req[0].duration_ms).toBe("number")
  })

  it("still returns rows when the freshness lookup fails", async () => {
    mockQueries(new Error("no monitor"))
    const res = await GET(signedIn())
    expect(res.status).toBe(200)
    expect((await res.json()).dataAsOf).toBeNull()
    expect(logs.some((l) => l.event === "freshness_error")).toBe(true)
  })

  it("returns a safe error when the query fails", async () => {
    vi.mocked(querySnowflake).mockRejectedValue(new Error("PRIVATE detail"))
    const res = await GET(signedIn())
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain("PRIVATE")
    expect(logs.find((l) => l.event === "request")?.status).toBe(500)
  })

  it("refuses an unsafe database name", async () => {
    vi.stubEnv("LAB_DB", "X; DROP")
    const res = await GET(signedIn())
    expect(res.status).toBe(500)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
})

describe("POST /api/client-log", () => {
  const post = (body: string) =>
    POST(new Request("http://app/api/client-log", { method: "POST", body, headers: { "sf-context-current-user": "JSMITH" } }))

  it("logs a client error", async () => {
    const res = await post(JSON.stringify({ kind: "error", message: "boom", page: "/" }))
    expect(res.status).toBe(204)
    expect(logs.find((l) => l.event === "client_error")).toMatchObject({ user: "JSMITH", kind: "error", message: "boom" })
  })

  it("rejects invalid and oversized bodies", async () => {
    expect((await post("not json")).status).toBe(400)
    expect((await post(JSON.stringify({ message: "x".repeat(5000) }))).status).toBe(413)
  })

  it("rate limits per user", async () => {
    for (let i = 0; i < CLIENT_LOG_RATE_LIMIT; i++) expect((await post("{}")).status).toBe(204)
    expect((await post("{}")).status).toBe(429)
  })
})
