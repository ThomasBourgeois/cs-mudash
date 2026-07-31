import { ExternalLink } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatEventDate, isUpcoming } from "@/lib/metrics"
import type { EventSnapshot } from "@/lib/types"

/**
 * Vue tableau de tous les événements connus.
 *
 * C'est aussi le filet de sécurité d'accessibilité du dashboard : chaque valeur
 * lisible dans un graphique est atteignable ici sans survol ni perception des couleurs.
 */
export function EventsTable({ events }: { events: EventSnapshot[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tous les événements</CardTitle>
        <CardDescription>
          {events.length} événement{events.length > 1 ? "s" : ""} connu
          {events.length > 1 ? "s" : ""}, du plus récent au plus ancien
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Événement</TableHead>
                <TableHead className="text-right">Inscrits</TableHead>
                <TableHead className="w-[180px]">Remplissage</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    Aucun événement relevé.
                  </TableCell>
                </TableRow>
              )}
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatEventDate(event.dateTime)}
                  </TableCell>
                  <TableCell className="max-w-[380px]">
                    <span className="line-clamp-2">{event.title}</span>
                    <span className="mt-1 flex gap-1.5">
                      <Badge variant={isUpcoming(event) ? "default" : "secondary"}>
                        {isUpcoming(event) ? "À venir" : "Passé"}
                      </Badge>
                      <Badge variant="outline">
                        {event.isOnline ? "En ligne" : "Présentiel"}
                      </Badge>
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-base font-semibold tabular-nums">
                    {event.going}
                  </TableCell>
                  <TableCell>
                    <FillMeter going={event.going} max={event.maxTickets} />
                  </TableCell>
                  <TableCell>
                    <a
                      href={event.eventUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground inline-flex p-1"
                      aria-label={`Ouvrir « ${event.title} » sur Meetup`}
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

/** Ratio contre une limite → jauge sur piste de même teinte, jamais un camembert. */
function FillMeter({ going, max }: { going: number; max: number | null }) {
  if (max === null) {
    return <span className="text-muted-foreground text-sm">illimité</span>
  }
  const ratio = Math.min(1, going / max)
  const pct = Math.round(ratio * 100)

  return (
    <div className="flex items-center gap-2">
      <div
        className="bg-muted h-2 w-full overflow-hidden rounded-full"
        role="meter"
        aria-valuenow={going}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={`${going} inscrits sur ${max} places`}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(pct, going > 0 ? 3 : 0)}%`,
            backgroundColor: ratio >= 1 ? "var(--chart-6)" : "var(--chart-1)",
          }}
        />
      </div>
      {/* Le pourcentage en clair : la jauge seule ne se lit pas au pixel près. */}
      <span className="text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums">
        {pct}% · {max}
      </span>
    </div>
  )
}
