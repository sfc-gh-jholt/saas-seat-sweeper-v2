import type { OpportunityRow } from "@/app/api/opportunity/route"

export type OpportunityGroup = {
  name: string
  seats: number
  monthly: number
  unlinkedSeats: number
  unlinkedMonthly: number
}

export function summarizeOpportunity(rows: OpportunityRow[]) {
  const vendors = new Map<string, OpportunityGroup>()
  const departments = new Map<string, OpportunityGroup>()
  let seats = 0
  let monthly = 0
  let unlinkedSeats = 0
  let unlinkedMonthly = 0

  for (const row of rows) {
    seats += row.inactiveSeats
    monthly += row.monthly
    if (!row.hasContract) {
      unlinkedSeats += row.inactiveSeats
      unlinkedMonthly += row.monthly
    }
    for (const [groups, name] of [[vendors, row.vendor], [departments, row.department]] as const) {
      const group = groups.get(name) ?? { name, seats: 0, monthly: 0, unlinkedSeats: 0, unlinkedMonthly: 0 }
      group.seats += row.inactiveSeats
      group.monthly += row.monthly
      if (!row.hasContract) {
        group.unlinkedSeats += row.inactiveSeats
        group.unlinkedMonthly += row.monthly
      }
      groups.set(name, group)
    }
  }

  const ranked = (groups: Map<string, OpportunityGroup>) => [...groups.values()]
    .sort((left, right) => right.monthly - left.monthly || left.name.localeCompare(right.name))

  return {
    seats, monthly, annualized: monthly * 12, unlinkedSeats, unlinkedMonthly,
    vendors: ranked(vendors), departments: ranked(departments),
    unlinkedVendors: ranked(vendors).filter(group => group.unlinkedSeats > 0)
      .sort((left, right) => right.unlinkedMonthly - left.unlinkedMonthly || left.name.localeCompare(right.name)),
  }
}

export function filterOpportunity(rows: OpportunityRow[], query: string, unlinkedOnly: boolean) {
  const search = query.trim().toLowerCase()
  return rows.filter(row => (!unlinkedOnly || !row.hasContract)
    && `${row.vendor} ${row.department}`.toLowerCase().includes(search))
    .sort((left, right) => right.monthly - left.monthly
      || left.vendor.localeCompare(right.vendor) || left.department.localeCompare(right.department)
      || Number(left.hasContract) - Number(right.hasContract))
}
