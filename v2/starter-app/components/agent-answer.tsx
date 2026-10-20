import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentState } from '@/lib/agent-stream'

export function safeAnswerUrl(url: string) {
  if (/^#source-\d+$/.test(url)) return url
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? url : '' } catch { return '' }
}

export function AgentAnswer({ state }: { state: AgentState }) {
  return <div className="space-y-6">
    {state.thinking && <details className="rounded-lg border bg-muted/30 p-4">
      <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2">Thinking <span className="ml-2 font-normal text-muted-foreground">From the Agent API</span></summary>
      <p className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{state.thinking}</p>
    </details>}
    {state.answer && <section aria-label="Agent answer" className="min-w-0 break-words text-sm leading-7 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:font-semibold [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-4 [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:pl-4">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeAnswerUrl} components={{
        img: () => null,
        a: ({ href, children }) => href ? <a href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer" className="text-primary underline underline-offset-4">{children}</a> : <span>{children}</span>,
        table: ({ children }) => <div className="my-4 max-w-full overflow-x-auto rounded-md border"><table className="w-full text-left text-sm [&_td]:border-t [&_td]:p-3 [&_th]:bg-muted/40 [&_th]:p-3">{children}</table></div>,
      }}>{state.answer}</Markdown>
    </section>}
    {state.warnings.length > 0 && <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{state.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
    {state.tables.map(table => <section key={table.id} aria-label={table.title} className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold">{table.title}</h3>
      <div className="max-w-full overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm">
        <thead className="bg-muted/40"><tr>{table.columns.map((column, index) => <th scope="col" className="whitespace-nowrap p-3 font-medium" key={index}>{column.replaceAll('_', ' ')}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t">{row.map((cell, columnIndex) => <td key={columnIndex} className="max-w-80 break-words p-3 align-top">{cell}</td>)}</tr>)}</tbody>
      </table></div>
      {table.truncated && <p className="text-xs text-muted-foreground">Preview limited to 100 rows and 20 columns; additional results are not shown.</p>}
    </section>)}
    {state.citations.length > 0 && <section aria-label="Contract sources" className="space-y-3 border-t pt-5">
      <h3 className="text-sm font-semibold">Contract sources</h3>
      <div className="flex flex-wrap gap-2">{state.citations.map((citation, index) => <a key={citation.id} href={`#source-${index}`} onClick={() => { const source = document.getElementById(`source-${index}`); if (source instanceof HTMLDetailsElement) source.open = true }} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{index + 1}. {citation.title}</a>)}</div>
      {state.citations.map((citation, index) => <details key={citation.id} id={`source-${index}`} className="scroll-mt-20 rounded-lg border p-3 open:bg-muted/20">
        <summary className="cursor-pointer text-sm font-medium">{citation.title}</summary>
        <blockquote className="mt-3 border-l-2 pl-3 text-sm leading-6 text-muted-foreground">{citation.excerpt || 'No excerpt was returned for this source.'}</blockquote>
      </details>)}
    </section>}
    {state.queries.length > 0 && <section aria-label="SQL evidence" className="space-y-2 border-t pt-5">
      {state.queries.map((query, index) => <details key={query.id} className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">SQL used{state.queries.length > 1 ? ` (${index + 1})` : ''}</summary>
        {query.queryId && <p className="my-3 break-all font-mono text-xs text-muted-foreground">Query ID: {query.queryId}</p>}
        <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{query.sql || 'SQL text was not returned.'}</pre>
      </details>)}
    </section>}
  </div>
}
