import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

// Placeholder for version two. In the lab, CoCo wires this page to the
// Seat Sweeper agent through the Cortex Agent REST API.
export default function AskPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <h1 className="text-3xl font-semibold">Ask Seat Sweeper</h1>
      <Card>
        <CardHeader>
          <CardTitle>Coming in version two</CardTitle>
          <CardDescription>
            You will connect this page to an agent that answers questions about seat opportunity and vendor contract
            terms.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Nothing is sent from this page yet.</CardContent>
      </Card>
    </main>
  )
}
