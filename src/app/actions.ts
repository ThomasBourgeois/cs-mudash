"use server"

import { readAttendees, readSent, writeSent } from "@/lib/attendees"
import { attendeeKey, type SentMap } from "@/lib/types"

/**
 * Marque (ou démarque) l'envoi du matériel à un participant.
 *
 * Le dashboard tourne en local, sans authentification : la seule garde utile
 * est de refuser une clé inconnue, pour qu'un appel direct ne puisse pas écrire
 * n'importe quoi dans data/attendees-sent.json.
 *
 * Renvoie le suivi à jour — le composant client s'aligne dessus plutôt que de
 * recharger toute la page à chaque case cochée.
 */
export async function setSent(key: string, sent: boolean): Promise<SentMap> {
  const known = new Set(readAttendees().map(attendeeKey))
  if (!known.has(key)) {
    throw new Error(`Participant inconnu : ${key}`)
  }

  const map = readSent()
  if (sent) {
    map[key] = new Date().toISOString()
  } else {
    delete map[key]
  }
  writeSent(map)
  return map
}
