"use client"

import { useMemo, useState } from "react"

import { AttendeesPanel } from "@/components/attendees-panel"
import { MembersChart } from "@/components/members-chart"
import { EventsChart } from "@/components/events-chart"
import { EventsTable } from "@/components/events-table"
import { StatTile } from "@/components/stat-tile"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  delta,
  eventColorSlots,
  eventRegistry,
  filterByRange,
  formatEventDate,
  isUpcoming,
  memberSeries,
  upcomingEventSeries,
} from "@/lib/metrics"
import type { Attendee, SentMap, Snapshot } from "@/lib/types"

const RANGES = [
  { value: "7", label: "7 derniers jours" },
  { value: "30", label: "30 derniers jours" },
  { value: "90", label: "90 derniers jours" },
  { value: "all", label: "Tout l'historique" },
] as const

export function Dashboard({
  snapshots,
  isDemo,
  attendees,
  sent,
}: {
  snapshots: Snapshot[]
  isDemo: boolean
  attendees: Attendee[]
  sent: SentMap
}) {
  const [range, setRange] = useState<string>("30")

  // Le filtre cadre TOUT ce qui est en dessous : graphiques, KPI et tableau
  // se recalculent sur la même tranche, donc les chiffres concordent toujours.
  const scoped = useMemo(
    () => filterByRange(snapshots, range === "all" ? "all" : Number(range)),
    [snapshots, range],
  )

  const members = useMemo(() => memberSeries(scoped), [scoped])
  // Les slots de couleur se calculent sur l'historique COMPLET, pas sur la
  // tranche filtrée : c'est ce qui rend la couleur stable d'une plage à l'autre.
  const colorSlots = useMemo(() => eventColorSlots(snapshots), [snapshots])
  const events = useMemo(
    () => upcomingEventSeries(scoped, colorSlots),
    [scoped, colorSlots],
  )
  const registry = useMemo(() => eventRegistry(scoped), [scoped])

  const latest = scoped.at(-1)
  const memberDelta = delta(members)

  const upcoming = registry.filter(isUpcoming)
  const totalUpcomingGoing = upcoming.reduce((sum, e) => sum + e.going, 0)
  const nextEvent = [...upcoming].sort((a, b) =>
    a.dateTime.localeCompare(b.dateTime),
  )[0]
  const lastPast = registry.find((e) => !isUpcoming(e))

  if (snapshots.length === 0) {
    return <NoData />
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {latest?.group.name ?? "Dashboard Meetup"}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {latest ? (
              <>
                Dernier relevé le{" "}
                <time dateTime={latest.fetchedAt}>
                  {new Date(latest.fetchedAt).toLocaleString("fr-FR", {
                    dateStyle: "long",
                    timeStyle: "short",
                  })}
                </time>
              </>
            ) : (
              "Aucun relevé sur cette plage"
            )}
          </p>
        </div>
        <ThemeToggle />
      </header>

      {isDemo && (
        <p className="border-chart-4 bg-chart-4/10 rounded-md border-l-4 px-4 py-2 text-sm">
          <strong>Données de démonstration.</strong>{" "}
          L&apos;historique affiché est
          fictif (généré par <code>npm run seed:demo</code>). Lance{" "}
          <code>npm run dev</code> pour les vraies données.
        </p>
      )}

      {/* Les filtres vivent sur une seule ligne, au-dessus du contenu qu'ils cadrent. */}
      <div className="flex items-center gap-3">
        {/* base-ui émet `null` quand la sélection est vidée : on retombe sur 30 j. */}
        <Select value={range} onValueChange={(v) => setRange(v ?? "30")}>
          <SelectTrigger className="w-[200px]" aria-label="Plage temporelle">
            {/* base-ui rend la valeur brute par défaut : on mappe vers le libellé. */}
            <SelectValue>
              {(value) => RANGES.find((r) => r.value === value)?.label ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-sm">
          {scoped.length} relevé{scoped.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Membres"
          value={latest?.group.memberCount ?? "—"}
          delta={memberDelta ? { value: memberDelta.value } : null}
          hint={memberDelta ? `depuis ${memberDelta.from}` : "un seul relevé"}
        />
        <StatTile
          label="Inscrits à venir"
          value={totalUpcomingGoing}
          hint={`sur ${upcoming.length} événement${upcoming.length > 1 ? "s" : ""}`}
        />
        <StatTile
          label="Prochain événement"
          value={nextEvent ? nextEvent.going : "—"}
          hint={nextEvent ? formatEventDate(nextEvent.dateTime) : "aucun programmé"}
        />
        <StatTile
          label="Dernier événement passé"
          value={lastPast ? lastPast.going : "—"}
          hint={lastPast ? formatEventDate(lastPast.dateTime) : "aucun"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MembersChart points={members} />
        <EventsChart
          series={events.series}
          points={events.points}
          omitted={events.omitted}
        />
      </div>

      <EventsTable events={registry} />

      {/* Hors du cadrage de la plage temporelle : une adresse email ne se
          périme pas au bout de 7 jours, la filtrer n'aurait aucun sens. */}
      <section className="mt-2 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Emails des participants
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Réponses laissées à l&apos;inscription, pour l&apos;envoi du matériel.
            Données locales, jamais commitées.
          </p>
        </div>
        <AttendeesPanel attendees={attendees} sent={sent} />
      </section>
    </div>
  )
}

function NoData() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard Meetup</h1>
      <p className="text-muted-foreground mt-3 text-sm">
        Aucune donnée pour l&apos;instant. Lance un premier relevé :
      </p>
      <pre className="bg-muted mt-3 rounded-md p-3 text-sm">npm run fetch</pre>
    </div>
  )
}
