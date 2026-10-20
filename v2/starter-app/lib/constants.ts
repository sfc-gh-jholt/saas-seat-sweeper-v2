/** App title — displayed in the nav header and browser tab */
export const APP_TITLE = "Seat Sweeper"

/** Path to the logo in /public (used in the header and as favicon) */
export const LOGO_SRC = "/icon.svg"

/**
 * Lab database, set per deployment target in app.yml (LAB_DB).
 * Locally, export LAB_DB before `npm run dev`. Validated so it can be
 * safely placed in SQL as an identifier.
 */
export function labDatabase(): string {
  const db = process.env.LAB_DB ?? "SEAT_SWEEPER_LAB"
  if (!/^[A-Z][A-Z0-9_]*$/.test(db)) throw new Error("LAB_DB must be an unquoted uppercase identifier")
  return db
}

/**
 * Lab warehouse (LAB_WH in app.yml). Caller's-rights sessions do not use the service's
 * query_warehouse, so routes pass this explicitly.
 */
export function labWarehouse(): string {
  const wh = process.env.LAB_WH ?? "SEAT_SWEEPER_WH"
  if (!/^[A-Z][A-Z0-9_]*$/.test(wh)) throw new Error("LAB_WH must be an unquoted uppercase identifier")
  return wh
}
