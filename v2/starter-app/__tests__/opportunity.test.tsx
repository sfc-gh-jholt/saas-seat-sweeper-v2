import React from "react"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { filterOpportunity, summarizeOpportunity } from "../lib/opportunity-summary"
import type { OpportunityRow } from "../app/api/opportunity/route"

const query = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock("@tanstack/react-query", () => ({ useQuery: () => query.state }))
import Home from "../app/page"

const rows: OpportunityRow[] = [
  { vendor: "Alpha", department: "Sales", hasContract: true, inactiveSeats: 4, monthly: 40, annualized: 480 },
  { vendor: "Alpha", department: "Engineering", hasContract: false, inactiveSeats: 2, monthly: 20, annualized: 240 },
  { vendor: "Beta", department: "Sales", hasContract: false, inactiveSeats: 3, monthly: 60, annualized: 720 },
]

function render(state: Record<string, unknown>) {
  // Tests pass `data` as the row array; the page receives { rows, dataAsOf }.
  const data = Array.isArray(state.data) ? { rows: state.data, dataAsOf: state.dataAsOf ?? null } : state.data
  query.state = { refetch: vi.fn(), isFetching: false, isLoading: false, dataUpdatedAt: 0, ...state, data }
  return renderToStaticMarkup(<Home />)
}

describe("opportunity summary", () => {
  it("aggregates actual rows without double-counting vendors or departments", () => {
    const summary = summarizeOpportunity(rows)
    expect(summary).toMatchObject({ seats: 9, monthly: 120, annualized: 1440, unlinkedSeats: 5, unlinkedMonthly: 80 })
    expect(summary.vendors).toHaveLength(2)
    expect(summary.departments).toHaveLength(2)
    expect(summary.vendors[0]).toMatchObject({ name: "Alpha", seats: 6, monthly: 60, unlinkedSeats: 2, unlinkedMonthly: 20 })
    expect(summary.departments[0]).toMatchObject({ name: "Sales", monthly: 100 })
    expect(summary.unlinkedVendors.map(group => group.name)).toEqual(["Beta", "Alpha"])
    expect(rows[0].monthly).toBe(40)
  })
  it("handles empty data and groups with reserved property names", () => {
    expect(summarizeOpportunity([])).toMatchObject({ seats: 0, monthly: 0, annualized: 0, vendors: [], unlinkedVendors: [] })
    expect(summarizeOpportunity([{ ...rows[0], vendor: "__proto__" }]).vendors[0].monthly).toBe(40)
  })
  it("filters by vendor/department and linkage without mutating source rows", () => {
    expect(filterOpportunity(rows, " ALPHA ", true)).toEqual([rows[1]])
    expect(filterOpportunity(rows, "sales", false)).toEqual([rows[2], rows[0]])
    expect(filterOpportunity(rows, "missing", false)).toEqual([])
    expect(rows[0].vendor).toBe("Alpha")
  })
  it("counts a mixed-linkage vendor once but isolates its unlinked amount", () => {
    const summary = summarizeOpportunity([rows[0], { ...rows[1], department: "Sales" }])
    expect(summary.vendors).toHaveLength(1)
    expect(summary.unlinkedMonthly).toBe(20)
    expect(summary.unlinkedSeats).toBe(2)
  })
})

describe("opportunity page", () => {
  it("shows real derived KPIs, ranked chart and contract caveat", () => {
    const html = render({ data: rows })
    expect(html).toContain("$1,440.00")
    expect(html).toContain("$120.00")
    expect(html).toContain("Where the opportunity sits")
    expect(html).toContain("does not mean a contract PDF is unavailable")
    expect(html).toContain('href="/ask"')
    expect(html).toContain("Search vendor or department")
    expect(html).not.toContain("NaN")
  })
  it("shows loading rather than fabricated zero KPIs", () => {
    const html = render({ isLoading: true })
    expect(html).toContain("Loading opportunity breakdowns")
    expect(html).not.toContain("$0.00")
    expect(html).not.toContain("No inactive paid seats found")
  })
  it("keeps initial failure distinct from empty data", () => {
    const html = render({ error: new Error("Warehouse unavailable") })
    expect(html).toContain('role="alert"')
    expect(html).toContain("Unavailable")
    expect(html).not.toContain("$0.00")
    expect(html).not.toContain("No inactive paid seats found")
  })
  it("marks retained results as stale on refresh failure", () => {
    const html = render({ data: rows, error: new Error("Refresh failed") })
    expect(html).toContain("Showing the last fetched snapshot")
    expect(html).toContain("$120.00")
  })
  it("shows successful empty state and zeros without empty charts", () => {
    const html = render({ data: [] })
    expect(html).toContain("No inactive paid seats found")
    expect(html).toContain("$0.00")
    expect(html).not.toContain("Where the opportunity sits")
  })
  it("escapes vendor content and avoids misleading missing-PDF claims", () => {
    const html = render({ data: [{ ...rows[0], vendor: "<script>alert(1)</script>" }] })
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("No contract</")
  })
})
