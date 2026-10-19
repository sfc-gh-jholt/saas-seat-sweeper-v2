'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Database, FileText, Layers, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentAnswer } from '@/components/agent-answer'
import { initialAgentState, readSse, type AgentState, type StreamMessage } from '@/lib/agent-stream'

const examples = [
  { title: 'Find seat opportunity', description: 'Rank vendors by monthly cost of inactive seats.', question: 'Which three vendors have the most monthly inactive seat opportunity?', icon: Database },
  { title: 'Read the contract', description: 'Check Figma notice periods and true-up terms.', question: 'What is the cancellation notice period and true-up clause for Figma Enterprise?', icon: FileText },
  { title: 'Bring both together', description: 'Match the largest opportunities with contract limits.', question: 'For the top two vendors by monthly opportunity, how much can we reduce seats this year without penalty?', icon: Layers },
]
const toolNames: Record<string, string> = { seat_opportunity: 'Seat data', contract_terms: 'Contract search', system_execute_sql: 'SQL execution' }

export default function AskPage() {
  const [question, setQuestion] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [state, setState] = useState<AgentState | null>(null)
  const [correlationId, setCorrelationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const request = useRef<AbortController | null>(null)
  const started = useRef(0)

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])
  useEffect(() => () => request.current?.abort(), [])

  async function ask(value: string) {
    const input = value.trim()
    if (request.current || !input || input.length > 500) return
    const controller = new AbortController()
    request.current = controller
    started.current = Date.now()
    setElapsed(0); setBusy(true); setSubmitted(input); setState(initialAgentState()); setCorrelationId('')
    let terminal = false
    try {
      const response = await fetch('/api/ask', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: input }),
      })
      setCorrelationId(response.headers.get('x-correlation-id') ?? '')
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        const error = await response.json().catch(() => ({}))
        setCorrelationId(typeof error.correlationId === 'string' ? error.correlationId : '')
        throw new Error('The agent connection failed. Check the app logs using the request ID below.')
      }
      for await (const event of readSse(response.body, 32_000_000)) {
        if (controller.signal.aborted) break
        if (event.event !== 'state') continue
        const message = JSON.parse(event.data) as StreamMessage
        if (!message.state || !Array.isArray(message.state.tools)) throw new Error('Invalid stream')
        setState(message.state); setCorrelationId(message.correlationId)
        if (message.state.status !== 'running') { terminal = true; break }
      }
      if (!terminal && !controller.signal.aborted) setState(previous => previous && ({ ...previous, status: 'incomplete', activity: 'Answer incomplete', warnings: [...previous.warnings, 'The connection ended before completion. Partial results are preserved.'] }))
    } catch {
      if (!controller.signal.aborted) setState(previous => previous && ({ ...previous, status: 'failed', activity: 'Request interrupted', warnings: [...previous.warnings, 'The request could not finish. Partial results are preserved. Check the request ID in app logs before trying again.'] }))
    } finally {
      setElapsed(Math.floor((Date.now() - started.current) / 1000))
      request.current = null; setBusy(false)
    }
  }
  function stop() {
    request.current?.abort()
    setState(previous => previous && ({ ...previous, status: 'stopped', activity: 'Stopped locally', warnings: [...previous.warnings, 'Stopped receiving this response. The upstream agent may still be running and consuming credits.'] }))
  }

  return <main className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
    <header className="max-w-2xl space-y-3">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Seat Sweeper / Ask</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">From idle seats to informed decisions.</h1>
      <p className="text-sm leading-6 text-muted-foreground">Explore the numbers, read the contract, or combine both. Every answer comes from your lab's Cortex Agent.</p>
    </header>
    <div className="grid gap-3 sm:grid-cols-3">{examples.map(example => <button type="button" key={example.title} disabled={busy} onClick={() => { setQuestion(example.question); void ask(example.question) }} className="group rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 motion-reduce:transition-none">
      <example.icon aria-hidden="true" className="mb-4 h-5 w-5 text-primary" />
      <span className="block text-sm font-semibold">{example.title}</span>
      <span className="mt-2 block text-xs leading-5 text-muted-foreground">{example.description}</span>
    </button>)}</div>
    <form className="rounded-xl border bg-card p-3 shadow-sm" onSubmit={event => { event.preventDefault(); void ask(question) }}>
      <label htmlFor="question" className="sr-only">Question for Seat Sweeper</label>
      <textarea id="question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} placeholder="What would you like to know about seats or contracts?" className="min-h-20 w-full resize-y rounded-md bg-transparent px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <div className="flex items-center justify-between gap-3 px-2 pt-2">
        <p className="text-xs text-muted-foreground">{question.length}/500 · One question at a time</p>
        {busy ? <Button type="button" variant="outline" onClick={stop}><Square className="mr-2 h-3 w-3" />Stop</Button> : <Button type="submit" disabled={!question.trim()}><ArrowUp className="mr-2 h-4 w-4" />Ask agent</Button>}
      </div>
    </form>
    {state && <section className="min-w-0 rounded-xl border bg-card shadow-sm" aria-label="Agent response">
      <div className="border-b p-5 sm:p-6"><p className="mb-2 text-xs font-medium text-muted-foreground">Your question</p><h2 className="break-words text-base font-medium">{submitted}</h2></div>
      <div className="grid min-w-0 gap-6 p-5 lg:grid-cols-[180px_minmax(0,1fr)] sm:p-6">
        <aside className="space-y-4 border-b pb-4 lg:border-b-0 lg:border-r lg:pr-5" aria-label="Agent activity">
          <div role="status" aria-live="polite" className="flex items-start gap-2 text-sm font-medium">
            {busy ? <Loader2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" /> : state.status === 'complete' ? <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> : null}
            <span>{state.activity}</span>
          </div>
          <p className="font-mono text-xs text-muted-foreground">{elapsed}s elapsed</p>
          <ul className="space-y-3">{state.tools.map(tool => <li key={tool.id} className="text-xs"><span className="block font-medium">{toolNames[tool.name] ?? 'Agent tool'}</span><span className="text-muted-foreground">{tool.status === 'running' && !busy ? 'Completion not confirmed' : tool.status}</span></li>)}</ul>
        </aside>
        <div className="min-w-0">
          {!state.answer && !state.thinking && busy && <p className="text-sm text-muted-foreground">Waiting for the agent's first update…</p>}
          <AgentAnswer state={state} />
        </div>
      </div>
      {correlationId && <footer className="break-all border-t px-5 py-3 font-mono text-xs text-muted-foreground">Request {correlationId}</footer>}
    </section>}
    <p className="text-xs text-muted-foreground">Synthetic workshop data. Seat costs are opportunities to review, not realized savings.</p>
  </main>
}
