/** Un événement tel que capturé un jour donné. */
export type EventSnapshot = {
  id: string
  title: string
  /** ISO 8601 avec offset, ex. "2026-08-04T19:00:00+02:00" */
  dateTime: string
  status: "ACTIVE" | "PAST" | "CANCELLED" | "DRAFT" | string
  /** Nombre d'inscrits ("going") au moment du fetch. */
  going: number
  /** Capacité maximale, null si illimitée. */
  maxTickets: number | null
  isOnline: boolean
  eventUrl: string
}

/** L'état complet du groupe un jour donné. Une ligne de data/history.ndjson. */
export type Snapshot = {
  /** Jour du relevé, "YYYY-MM-DD". Clé primaire : un seul snapshot par jour. */
  date: string
  /** Horodatage exact du fetch, ISO 8601 UTC. */
  fetchedAt: string
  group: {
    id: string
    urlname: string
    name: string
    memberCount: number
  }
  events: EventSnapshot[]
}
