"use client"

/**
 * Sends uncaught browser errors and unhandled promise rejections to /api/client-log
 * so they show up in the event table next to server logs. Renders nothing.
 */

import { useEffect } from "react"

const MAX_REPORTS_PER_PAGE = 10

export function ClientErrorReporter() {
  useEffect(() => {
    let sent = 0
    const report = (payload: Record<string, unknown>) => {
      if (sent >= MAX_REPORTS_PER_PAGE) return
      sent += 1
      fetch("/api/client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, page: window.location.pathname }),
        keepalive: true,
      }).catch(() => {})
    }
    const onError = (e: ErrorEvent) =>
      report({ kind: "error", message: e.message, source: `${e.filename}:${e.lineno}:${e.colno}`, stack: e.error?.stack })
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason
      report({ kind: "unhandledrejection", message: r instanceof Error ? r.message : String(r), stack: r?.stack })
    }
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])
  return null
}
