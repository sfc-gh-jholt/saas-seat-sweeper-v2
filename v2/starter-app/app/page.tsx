"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, RefreshCw, Search } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { filterOpportunity, summarizeOpportunity } from "@/lib/opportunity-summary"
import type { OpportunityRow } from "@/app/api/opportunity/route"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const count = new Intl.NumberFormat("en-US")
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 })

async function fetchOpportunity(): Promise<{ rows: OpportunityRow[]; dataAsOf: string | null }> {
  const res = await fetch("/api/opportunity")
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP error ${res.status}`)
  return { rows: json.rows, dataAsOf: json.dataAsOf ?? null }
}

export default function Home() {
  const { data, error, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({ queryKey: ["opportunity"], queryFn: fetchOpportunity })
  const [search, setSearch] = useState("")
  const [unlinkedOnly, setUnlinkedOnly] = useState(false)
  const rows = data?.rows ?? []
  const dataAsOf = data?.dataAsOf
  const summary = summarizeOpportunity(rows)
  const visibleRows = filterOpportunity(rows, search, unlinkedOnly)
  const available = data !== undefined
  const topVendors = summary.vendors.slice(0, 6)
  const maxMonthly = topVendors[0]?.monthly ?? 0

  function reviewVendor(vendor: string, unlinked = false) {
    setSearch(vendor)
    setUnlinkedOnly(unlinked)
    document.getElementById("opportunity-details")?.scrollIntoView({ behavior: "instant", block: "start" })
  }

  return (
    <main className="opportunity-page">
      <div className="opportunity-shell">
        <div className="opportunity-heading">
          <div>
            <p className="opportunity-eyebrow">Synthetic workshop data / Seat Sweeper</p>
            <h1>Your seat opportunity at a glance.</h1>
            <p className="opportunity-muted">See where paid seats sit idle, what to review, and where to look next.</p>
          </div>
          <div className="opportunity-refresh">
            <span className="opportunity-chip">{dataUpdatedAt ? `Fetched ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Current snapshot"}</span>
            {dataAsOf && <span className="opportunity-chip" title="Last successful DT_VENDOR_OPPORTUNITY refresh">Data as of {new Date(dataAsOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh opportunity data">
              <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />
              {isFetching ? "Refreshing" : "Refresh"}
            </Button>
          </div>
        </div>

        {error && <div role="alert" className="opportunity-error">
          <strong>{available ? "Refresh failed. Showing the last fetched snapshot." : "Opportunity data could not be loaded."}</strong>
          <p>{error.message} Use Refresh to try again.</p>
        </div>}

        <section className="opportunity-kpis" aria-label="Opportunity summary" aria-busy={isLoading}>
          <Kpi label="Annualized opportunity" value={available ? money.format(summary.annualized) : null} loading={isLoading} note="Monthly opportunity x 12; not a forecast" accent />
          <Kpi label="Monthly opportunity" value={available ? money.format(summary.monthly) : null} loading={isLoading} note="Recurring cost of eligible inactive seats" />
          <Kpi label="Inactive paid seats" value={available ? count.format(summary.seats) : null} loading={isLoading} note="Inactive status and no activity for 30+ days" />
          <Kpi label="Vendors to review" value={available ? count.format(summary.vendors.length) : null} loading={isLoading} note={available ? `Across ${count.format(summary.departments.length)} departments with opportunity` : "Vendors with eligible inactive paid seats"} />
        </section>

        <div className="opportunity-notice">
          <strong>Opportunity to review, not realized savings.</strong>{" "}
          Synthetic workshop data. Confirm ownership and contract terms before making changes.
        </div>

        {isLoading && <div role="status" className="opportunity-two-column"><Skeleton className="h-80 w-full" /><Skeleton className="h-80 w-full" /><span className="sr-only">Loading opportunity breakdowns</span></div>}
        {available && rows.length === 0 && <Card className="opportunity-empty"><h2>No inactive paid seats found.</h2><p className="opportunity-muted">No rows currently meet the opportunity criteria. Refresh after the source data changes.</p></Card>}

        {available && rows.length > 0 && <>
          <SectionHeading title="Opportunity at a glance" description="Current monthly cost by vendor and department. Ranked highest first." action={<a className="opportunity-link" href="#opportunity-details">Explore all rows <ArrowUpRight aria-hidden="true" /></a>} />
          <div className="opportunity-two-column opportunity-overview">
            <Card className="opportunity-panel">
              <PanelHeading title="Where the opportunity sits" description="Top vendors / monthly USD" badge={`${topVendors.length} of ${summary.vendors.length} vendors`} />
              <ol className="opportunity-bars" aria-label="Top vendors by monthly opportunity">
                {topVendors.map(vendor => <li key={vendor.name}>
                  <button className="opportunity-bar-button" onClick={() => reviewVendor(vendor.name)} aria-label={`Review ${vendor.name}: ${money.format(vendor.monthly)} monthly, ${count.format(vendor.seats)} inactive seats`}>
                    <span className="opportunity-bar-label"><span>{vendor.name}</span><strong>{money.format(vendor.monthly)}</strong></span>
                    <span className="opportunity-bar-track" aria-hidden="true"><span style={{ width: `${maxMonthly > 0 ? vendor.monthly / maxMonthly * 100 : 0}%` }} /></span>
                    <span className="opportunity-bar-meta">{count.format(vendor.seats)} inactive seats <span>{percent.format(summary.monthly > 0 ? vendor.monthly / summary.monthly : 0)} of monthly opportunity</span></span>
                  </button>
                </li>)}
              </ol>
              <div className="opportunity-panel-footer"><span>Bar lengths compare vendors, not changes over time.</span><a className="opportunity-link" href="#opportunity-details">View detail</a></div>
            </Card>

            <Card className="opportunity-panel">
              <PanelHeading title="By department" description="Monthly opportunity across all vendors" badge={`${summary.departments.length} departments`} />
              <ul className="opportunity-list">
                {summary.departments.map(department => <li key={department.name}>
                  <div className="opportunity-row-title"><strong>{department.name}</strong><strong>{money.format(department.monthly)}</strong></div>
                  <div className="opportunity-row-meta"><span>{count.format(department.seats)} inactive paid seats</span><span>{percent.format(summary.monthly > 0 ? department.monthly / summary.monthly : 0)} of total</span></div>
                </li>)}
              </ul>
              <div className="opportunity-panel-footer">A current snapshot, not a historical trend.</div>
            </Card>
          </div>

          <SectionHeading title="Where to focus your review" description="Start with the largest opportunities, then resolve missing contract links." />
          <div className="opportunity-two-column">
            <Card className="opportunity-panel">
              <PanelHeading title="Highest-value reviews" description="Top four vendors by monthly opportunity" badge="Review first" />
              <ul className="opportunity-list">
                {summary.vendors.slice(0, 4).map(vendor => <li key={vendor.name}>
                  <div className="opportunity-row-title"><button className="opportunity-link" onClick={() => reviewVendor(vendor.name)}>{vendor.name}</button><strong>{money.format(vendor.monthly)}<span className="opportunity-unit"> / mo</span></strong></div>
                  <div className="opportunity-row-meta"><span>{count.format(vendor.seats)} inactive seats</span><span>{money.format(vendor.monthly * 12)} annualized</span></div>
                </li>)}
              </ul>
              <div className="opportunity-panel-footer"><span>Validate notice periods and seat-reduction rights.</span><Link className="opportunity-link" href="/ask">Open Ask <ArrowUpRight aria-hidden="true" /></Link></div>
            </Card>

            <Card className="opportunity-panel">
              <PanelHeading title="Missing contract links" description="Structured register links to investigate" badge={`${count.format(summary.unlinkedSeats)} seats`} />
              <p className="opportunity-panel-note">A missing register link does not mean a contract PDF is unavailable. Search the documents in Ask.</p>
              {summary.unlinkedVendors.length > 0 ? <ul className="opportunity-list">
                {summary.unlinkedVendors.slice(0, 4).map(vendor => <li key={vendor.name}>
                  <div className="opportunity-row-title"><button className="opportunity-link" onClick={() => reviewVendor(vendor.name, true)}>{vendor.name}</button><span className="opportunity-status opportunity-status-warning">No linked contract</span></div>
                  <div className="opportunity-row-meta"><span>{count.format(vendor.unlinkedSeats)} unlinked seats</span><span>{money.format(vendor.unlinkedMonthly)} / mo</span></div>
                </li>)}
              </ul> : <p className="opportunity-panel-note">All opportunity rows have a linked structured contract.</p>}
              <div className="opportunity-panel-footer"><span>{money.format(summary.unlinkedMonthly)} / mo across {summary.unlinkedVendors.length} unlinked vendors</span><button className="opportunity-link" onClick={() => reviewVendor("", true)}>Review links</button></div>
            </Card>
          </div>

          <section id="opportunity-details" className="opportunity-details" aria-labelledby="details-title">
            <SectionHeading title="By vendor and department" id="details-title" description="The underlying opportunity rows, with annualized amounts and register linkage." />
            <Card className="opportunity-panel">
              <div className="opportunity-table-tools">
                <label className="opportunity-search"><Search aria-hidden="true" /><span className="sr-only">Search vendor or department</span><input type="search" placeholder="Search vendor or department" value={search} onChange={event => setSearch(event.target.value)} /></label>
                <label className="opportunity-checkbox"><input type="checkbox" checked={unlinkedOnly} onChange={event => setUnlinkedOnly(event.target.checked)} /> Missing contract links only</label>
                {(search || unlinkedOnly) && <button className="opportunity-link" onClick={() => { setSearch(""); setUnlinkedOnly(false) }}>Clear filters</button>}
              </div>
              <div className="opportunity-table" tabIndex={0} role="region" aria-label="Opportunity details, horizontally scrollable">
                <Table>
                  <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead>Department</TableHead><TableHead>Contract register</TableHead><TableHead className="text-right">Seats</TableHead><TableHead className="text-right">Monthly</TableHead><TableHead className="text-right">Annualized</TableHead></TableRow></TableHeader>
                  <TableBody>{visibleRows.map(row => <TableRow key={JSON.stringify([row.vendor, row.department, row.hasContract])}>
                    <TableCell className="font-medium">{row.vendor}</TableCell><TableCell>{row.department}</TableCell>
                    <TableCell><span className={`opportunity-status ${row.hasContract ? "opportunity-status-linked" : "opportunity-status-warning"}`}>{row.hasContract ? "Linked" : "No linked contract"}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{count.format(row.inactiveSeats)}</TableCell><TableCell className="text-right tabular-nums">{money.format(row.monthly)}</TableCell><TableCell className="text-right tabular-nums">{money.format(row.annualized)}</TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </div>
              {visibleRows.length === 0 && <p className="opportunity-panel-note" role="status">No rows match these filters. Clear filters to see all opportunities.</p>}
              <div className="opportunity-panel-footer"><span aria-live="polite">{visibleRows.length} of {rows.length} rows</span><span>Source: V_VENDOR_OPPORTUNITY / USD</span></div>
            </Card>
          </section>
        </>}
      </div>
    </main>
  )
}

function Kpi({ label, value, loading, note, accent = false }: { label: string; value: string | null; loading: boolean; note: string; accent?: boolean }) {
  return <Card className={`opportunity-kpi ${accent ? "opportunity-kpi-accent" : ""}`}><h2 className="opportunity-eyebrow">{label}</h2><div className="opportunity-kpi-value">{loading ? <Skeleton className="h-9 w-32" /> : value ?? "Unavailable"}</div><p>{note}</p></Card>
}

function SectionHeading({ title, description, action, id }: { title: string; description: string; action?: React.ReactNode; id?: string }) {
  return <div className="opportunity-section-heading"><div><h2 id={id}>{title}</h2><p className="opportunity-muted">{description}</p></div>{action}</div>
}

function PanelHeading({ title, description, badge }: { title: string; description: string; badge: string }) {
  return <div className="opportunity-panel-heading"><div><h3>{title}</h3><p className="opportunity-muted">{description}</p></div><span className="opportunity-chip">{badge}</span></div>
}
