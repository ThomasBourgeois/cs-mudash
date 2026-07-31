import type { EventSnapshot, Snapshot } from "./types"

/** Nombre de séries colorées max sur le graphique des événements (plafond de la palette). */
export const MAX_EVENT_SERIES = 6

export function filterByRange(snapshots: Snapshot[], days: number | "all"): Snapshot[] {
  if (days === "all") return snapshots
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (days - 1))
  const cutoffDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
  }).format(cutoff)
  return snapshots.filter((s) => s.date >= cutoffDate)
}

export type MemberPoint = { date: string; members: number }

export function memberSeries(snapshots: Snapshot[]): MemberPoint[] {
  return snapshots.map((s) => ({ date: s.date, members: s.group.memberCount }))
}

/**
 * Dernier état connu de chaque événement, tous relevés confondus.
 *
 * Meetup ne renvoie que les 10 événements passés les plus récents ; en balayant
 * tout l'historique on conserve les plus anciens, déjà capturés par un relevé
 * précédent. L'historique NDJSON est donc la mémoire longue du dashboard.
 */
export function eventRegistry(snapshots: Snapshot[]): EventSnapshot[] {
  const byId = new Map<string, EventSnapshot>()
  for (const snap of snapshots) {
    for (const event of snap.events) byId.set(event.id, event)
  }
  return [...byId.values()].sort((a, b) => b.dateTime.localeCompare(a.dateTime))
}

export function isUpcoming(event: EventSnapshot): boolean {
  return event.status === "ACTIVE" && new Date(event.dateTime).getTime() > Date.now()
}

export type EventSeries = {
  id: string
  title: string
  dateTime: string
  color: string
}

export type EventChartPoint = { date: string } & Record<string, number | string>

/**
 * Attribue un slot de palette à chaque événement, par ordre de PREMIÈRE
 * apparition dans l'historique complet.
 *
 * Cet ordre est append-only : l'index d'un événement ne bouge jamais une fois
 * attribué. La couleur suit donc l'identité de l'événement et non son rang
 * parmi ceux affichés — changer de plage temporelle, ou voir un événement
 * passer, ne repeint pas les autres.
 *
 * Le modulo peut théoriquement donner la même couleur à deux événements
 * distants de 6 rangs, mais des événements simultanés sont créés à des dates
 * proches, donc à des rangs consécutifs : le cas ne se présente pas en pratique.
 */
export function eventColorSlots(allSnapshots: Snapshot[]): Map<string, string> {
  const slots = new Map<string, string>()
  for (const snap of allSnapshots) {
    for (const event of snap.events) {
      if (!slots.has(event.id)) {
        slots.set(event.id, `var(--chart-${(slots.size % MAX_EVENT_SERIES) + 1})`)
      }
    }
  }
  return slots
}

/**
 * Construit les séries « inscriptions par événement à venir », dans l'ordre
 * chronologique et bornées au plafond de la palette.
 */
export function upcomingEventSeries(
  snapshots: Snapshot[],
  colorSlots: Map<string, string>,
): {
  series: EventSeries[]
  points: EventChartPoint[]
  omitted: number
} {
  const latest = snapshots.at(-1)
  if (!latest) return { series: [], points: [], omitted: 0 }

  const upcoming = latest.events
    .filter(isUpcoming)
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime))

  const kept = upcoming.slice(0, MAX_EVENT_SERIES)
  const series: EventSeries[] = kept.map((event) => ({
    id: event.id,
    title: event.title,
    dateTime: event.dateTime,
    color: colorSlots.get(event.id) ?? "var(--chart-1)",
  }))

  const points: EventChartPoint[] = snapshots.map((snap) => {
    const point: EventChartPoint = { date: snap.date }
    for (const s of series) {
      const match = snap.events.find((e) => e.id === s.id)
      // Événement pas encore créé à cette date : on laisse un trou plutôt que
      // de tracer un faux zéro, la ligne démarre à sa vraie date de création.
      if (match) point[s.id] = match.going
    }
    return point
  })

  return { series, points, omitted: Math.max(0, upcoming.length - kept.length) }
}

/** Variation entre le premier et le dernier relevé de la plage. */
export function delta(points: MemberPoint[]): { value: number; from: number } | null {
  if (points.length < 2) return null
  const first = points[0].members
  const last = points.at(-1)!.members
  return { value: last - first, from: first }
}

export function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  })
}

export function formatEventDate(dateTime: string): string {
  return new Date(dateTime).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}
