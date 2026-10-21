/**
 * Postgres access for the app's operational data (Snowflake Postgres instance).
 *
 *   const rows = await queryPostgres<{ n: number }>("SELECT count(*)::int AS n FROM seat_actions WHERE emp_id = $1", [42])
 *
 * Deployed: credentials come from the PG_APP_LOGIN password secret, the host from PG_HOST and
 * the instance CA from PG_CA_CERT, all mounted under /secrets by app.yml. The host is a secret
 * (not an app.yml value) because every account has its own instance: setup writes it, so the
 * manifest stays the same for everyone. TLS always verifies the server certificate.
 * Local: set the PG_HOST environment variable plus the standard PGUSER / PGPASSWORD (or a
 * .pgpass file) and, optionally, PG_CA_FILE pointing at the fetched instance CA.
 *
 * Always pass values as $1, $2... parameters. Never build SQL from request input.
 */

import { readFileSync, existsSync } from "fs"
import { Pool, type QueryResultRow } from "pg"

const SECRET_DIR = "/secrets/PG_APP_LOGIN"
const HOST_FILE = "/secrets/PG_HOST/secret_string"
const CA_FILE = "/secrets/PG_CA_CERT/secret_string"

let pool: Pool | null = null

function readTrimmed(path: string): string {
  return readFileSync(path, "utf8").trim()
}

/** Build connection settings fresh, so a rotated secret takes effect on the next pool. */
export function postgresConfig() {
  const host = existsSync(HOST_FILE) ? readTrimmed(HOST_FILE) : process.env.PG_HOST
  if (!host) throw new Error("PG_HOST is not set")
  const caPath = existsSync(CA_FILE) ? CA_FILE : process.env.PG_CA_FILE
  const deployed = existsSync(`${SECRET_DIR}/password`)
  return {
    host,
    port: 5432,
    database: process.env.PG_DATABASE ?? "postgres",
    ...(deployed
      ? { user: readTrimmed(`${SECRET_DIR}/username`), password: readTrimmed(`${SECRET_DIR}/password`) }
      : {}),
    ssl: caPath ? { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true } : { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    application_name: "seat_sweeper",
  }
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool(postgresConfig())
    // A broken idle connection must not crash the server; the next query opens a new one.
    pool.on("error", () => {})
  }
  return pool
}

/** Drop the pool so the next query reconnects with freshly read credentials. */
export async function resetPostgres(): Promise<void> {
  const current = pool
  pool = null
  await current?.end().catch(() => {})
}

export async function queryPostgres<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await getPool().query<T>(text, values)
    return result.rows
  } catch (err) {
    // 28P01 = invalid password (for example after a rotation): retry once with new credentials.
    if ((err as { code?: string }).code === "28P01") {
      await resetPostgres()
      return (await getPool().query<T>(text, values)).rows
    }
    throw err
  }
}
