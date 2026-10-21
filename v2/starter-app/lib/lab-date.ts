/**
 * The lab's business date. Snowflake evaluates CURRENT_DATE() in the account TIMEZONE
 * (America/Los_Angeles), and the vendor-opportunity dynamic table uses it for the 30-day cutoff.
 * Postgres runs in UTC, so app queries that apply the same rule must bind this date instead of
 * using current_date, or the two disagree every evening. Override with LAB_TIMEZONE.
 */
export function labToday(now = new Date()): string {
  const timeZone = process.env.LAB_TIMEZONE || 'America/Los_Angeles'
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
