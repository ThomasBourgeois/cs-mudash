"use client"

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  formatDay,
  formatEventDate,
  type EventChartPoint,
  type EventSeries,
} from "@/lib/metrics"

type Props = {
  series: EventSeries[]
  points: EventChartPoint[]
  omitted: number
}

/**
 * Inscriptions aux événements à venir, une ligne par événement.
 *
 * 5–6 séries : la légende porte l'identité (pas de labels directs, ils se
 * chevaucheraient), et le tableau en dessous donne les valeurs exactes — ce qui
 * satisfait aussi la règle de relief des teintes à faible contraste en mode clair.
 */
export function EventsChart({ series, points, omitted }: Props) {
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [
      s.id,
      // La légende identifie par la date : les titres d'événements sont longs
      // et souvent identiques d'une session à l'autre.
      { label: formatEventDate(s.dateTime), color: s.color },
    ]),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inscriptions aux événements à venir</CardTitle>
        <CardDescription>
          {series.length === 0
            ? "Aucun événement à venir."
            : `${series.length} événement${series.length > 1 ? "s" : ""} suivi${series.length > 1 ? "s" : ""}, identifié${series.length > 1 ? "s" : ""} par date`}
          {omitted > 0 && ` · ${omitted} de plus dans le tableau`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {series.length === 0 || points.length === 0 ? (
          <div className="text-muted-foreground flex h-[260px] items-center justify-center rounded-md border border-dashed text-sm">
            Rien à tracer pour l&apos;instant.
          </div>
        ) : (
          <ChartContainer config={config} className="h-[260px] w-full">
            <LineChart data={points} margin={{ left: 4, right: 16, top: 8 }}>
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
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={36}
                tickMargin={6}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      formatDay(String(payload?.[0]?.payload?.date ?? ""))
                    }
                  />
                }
              />
              {series.map((s) => (
                <Line
                  key={s.id}
                  dataKey={s.id}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                  // Trou = événement pas encore créé ; on ne relie pas au-dessus.
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
        {series.length > 0 && <Legend series={series} />}
      </CardContent>
    </Card>
  )
}

/**
 * Légende maison plutôt que celle de Recharts : cette dernière retrie les
 * entrées par dataKey (l'id Meetup), ce qui donnait un ordre sans rapport avec
 * les dates. Ici l'ordre chronologique des séries est respecté, et le repère
 * est un trait — il reflète la marque qu'il désigne.
 */
function Legend({ series }: { series: EventSeries[] }) {
  return (
    <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
      {series.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-0.5 w-3.5 shrink-0 rounded-full"
            style={{ backgroundColor: s.color }}
          />
          <span className="text-muted-foreground text-xs">
            {formatEventDate(s.dateTime)}
          </span>
        </li>
      ))}
    </ul>
  )
}
