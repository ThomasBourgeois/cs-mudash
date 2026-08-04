import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import type { Attendee, SentMap } from "./types"

/**
 * Participants et suivi des envois de matériel.
 *
 * Ces deux fichiers sont gitignorés et n'existent que sur la machine de
 * l'organisateur : ils contiennent des emails de tiers. Le dashboard déployé
 * ailleurs ne les trouvera pas et masquera simplement la section — c'est le
 * comportement voulu, pas une panne.
 */

// Chemins scopés statiquement au dossier data/, comme dans data.ts : sinon le
// tracing de fichiers de Next embarque tout le projet.
const ATTENDEES_PATH = resolve(process.cwd(), "data", "attendees.ndjson")
const SENT_PATH = resolve(process.cwd(), "data", "attendees-sent.json")

export function readAttendees(): Attendee[] {
  if (!existsSync(ATTENDEES_PATH)) return []
  return readFileSync(ATTENDEES_PATH, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Attendee)
}

export function readSent(): SentMap {
  if (!existsSync(SENT_PATH)) return {}
  try {
    const parsed = JSON.parse(readFileSync(SENT_PATH, "utf8"))
    return typeof parsed === "object" && parsed !== null ? (parsed as SentMap) : {}
  } catch {
    // Fichier corrompu : on repart d'un suivi vide plutôt que de casser la page.
    // Le pire cas est de recocher quelques cases, pas de perdre des emails.
    return {}
  }
}

export function writeSent(map: SentMap): void {
  mkdirSync(resolve(process.cwd(), "data"), { recursive: true })
  writeFileSync(SENT_PATH, JSON.stringify(map, null, 2) + "\n")
}
