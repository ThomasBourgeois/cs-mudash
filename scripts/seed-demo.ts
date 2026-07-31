/**
 * Génère data/history.demo.ndjson : un historique FICTIF de 45 jours, extrapolé
 * à rebours depuis le dernier relevé réel.
 *
 * Objectif : voir le dashboard peuplé (courbes, deltas, tooltips) sans attendre
 * un mois d'accumulation. Ces données ne sont jamais lues par défaut — il faut
 * lancer `npm run dev:demo`. data/history.ndjson n'est ni lu en écriture ni modifié.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Snapshot } from "../src/lib/types.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const REAL = resolve(ROOT, "data/history.ndjson")
const DEMO = resolve(ROOT, "data/history.demo.ndjson")
const DAYS = 45

if (!existsSync(REAL)) {
  console.error("✗ data/history.ndjson introuvable — lance d'abord `npm run fetch`")
  process.exit(1)
}

const lines = readFileSync(REAL, "utf8").split("\n").filter((l) => l.trim())
const template = JSON.parse(lines[lines.length - 1]) as Snapshot

// Générateur déterministe : relancer le seed ne fait pas bouger les courbes.
let seed = 42
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

/**
 * Trajectoire croissante de `from` à `to` en `steps` points, à pas irréguliers.
 * Les compteurs Meetup ne redescendent quasiment jamais : une marche aléatoire
 * qui zigzague d'un jour à l'autre ne ressemblerait à rien de réel.
 */
function monotonicPath(steps: number, from: number, to: number): number[] {
  if (steps <= 1) return [to]
  const increments = Array.from({ length: steps - 1 }, () => rand())
  const total = increments.reduce((a, b) => a + b, 0) || 1
  const path = [from]
  let acc = 0
  for (const inc of increments) {
    acc += inc / total
    path.push(Math.round(from + (to - from) * acc))
  }
  return path
}

const dates = Array.from({ length: DAYS }, (_, i) => {
  const day = new Date()
  day.setDate(day.getDate() - (DAYS - 1 - i))
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(day)
})

// Le groupe démarre à ~45 % de son effectif actuel et croît jusqu'au vrai chiffre.
const memberPath = monotonicPath(
  DAYS,
  Math.round(template.group.memberCount * 0.45),
  template.group.memberCount,
)

// Chaque événement « naît » à un jour différent de la fenêtre, puis se remplit.
const eventPaths = template.events.map((event, i) => {
  const bornAt = Math.floor(DAYS * (0.1 + i * 0.12))
  return { bornAt, path: monotonicPath(DAYS - bornAt, 0, event.going) }
})

const snapshots: Snapshot[] = dates.map((date, d) => ({
  date,
  fetchedAt: new Date(`${date}T06:00:00Z`).toISOString(),
  group: { ...template.group, memberCount: memberPath[d] },
  events: template.events
    .map((event, i) => {
      const { bornAt, path } = eventPaths[i]
      if (d < bornAt) return null
      return { ...event, going: path[d - bornAt] }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null),
}))

// Le dernier jour reprend exactement le relevé réel : les KPI affichés en démo
// correspondent aux vrais chiffres du jour, seule l'histoire est inventée.
snapshots[snapshots.length - 1] = { ...template, date: snapshots.at(-1)!.date }

writeFileSync(DEMO, snapshots.map((s) => JSON.stringify(s)).join("\n") + "\n")
console.log(`✓ ${DAYS} jours de démo écrits dans data/history.demo.ndjson`)
console.log("  Lance `npm run dev:demo` pour les visualiser.")
