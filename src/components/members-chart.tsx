"use client"

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { formatDay, type MemberPoint } from "@/lib/metrics"

// Série unique : pas de légende, le titre de la carte nomme la donnée.
const config = {
  members: { label: "Membres", color: "var(--chart-1)" },
} satisfies ChartConfig

export function MembersChart({ points }: { points: MemberPoint[] }) {
  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Membres du groupe</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState />
        </CardContent>
      </Card>
    )
  }

  const values = points.map((p) => p.members)
  // Domaine resserré autour des valeurs : sur une plage courte, partir de zéro
  // écraserait la courbe. On garde une marge pour ne pas coller aux bords.
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = Math.max(1, Math.round((max - min) * 0.2))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Membres du groupe</CardTitle>
        <CardDescription>
          {points.length} relevé{points.length > 1 ? "s" : ""} ·{" "}
          {formatDay(points[0].date)} → {formatDay(points.at(-1)!.date)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-[260px] w-full">
          <LineChart data={points} margin={{ left: 4, right: 16, top: 8 }}>
            {/* Grille discrète : horizontale seulement, elle sert de repère, pas de motif. */}
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDay}
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={24}
            />
            <YAxis
              domain={[min - pad, max + pad]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={36}
              tickMargin={6}
            />
            <ChartTooltip
              // Le crosshair accroche la date : on vise un jour, pas un trait de 2px.
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    formatDay(String(payload?.[0]?.payload?.date ?? ""))
                  }
                />
              }
            />
            <Line
              dataKey="members"
              type="monotone"
              stroke="var(--color-members)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="text-muted-foreground flex h-[260px] items-center justify-center rounded-md border border-dashed text-sm">
      Aucun relevé sur cette plage.
    </div>
  )
}
