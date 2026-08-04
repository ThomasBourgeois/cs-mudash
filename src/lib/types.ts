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

/**
 * Un participant inscrit à un événement, avec ce qu'il a répondu à la question
 * posée au moment du RSVP. Une ligne de data/attendees.ndjson.
 *
 * Fichier gitignoré : données personnelles de tiers, elles restent en local.
 * Clé : (eventId, memberId).
 */
export type Attendee = {
  eventId: string
  eventTitle: string
  /** ISO 8601 avec offset, recopié de l'événement pour rester lisible seul. */
  eventDateTime: string
  /**
   * Question posée à l'inscription, null si l'événement n'en pose aucune.
   * Distingue « personne n'a répondu » de « rien n'a été demandé ».
   */
  eventQuestion: string | null
  memberId: string
  name: string
  /** Réponses libres aux questions d'inscription, telles qu'écrites. */
  answers: string[]
  /** Premier email trouvé dans les réponses, null si le participant n'en a pas laissé. */
  email: string | null
  /** Les suivants, quand quelqu'un en écrit plusieurs. */
  extraEmails: string[]
  /** Horodatage du relevé, ISO 8601 UTC. */
  capturedAt: string
}

/** Clé du participant → date d'envoi du matériel, ISO 8601 UTC. */
export type SentMap = Record<string, string>

/**
 * Clé stable d'un participant : il peut s'inscrire à plusieurs événements.
 *
 * Vit ici plutôt que dans attendees.ts pour rester importable côté client :
 * attendees.ts lit le disque, l'importer depuis un composant embarquerait
 * `node:fs` dans le bundle navigateur.
 */
export function attendeeKey(a: { eventId: string; memberId: string }): string {
  return `${a.eventId}:${a.memberId}`
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
