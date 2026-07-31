import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import type { Snapshot } from "./types"

/**
 * MUDASH_DEMO=1 fait lire un historique de démonstration généré par
 * `npm run seed:demo`. Sert uniquement à voir le dashboard peuplé avant
 * d'avoir accumulé de vrais relevés — jamais mélangé aux données réelles.
 */
const isDemo = process.env.MUDASH_DEMO === "1"

// Chemin scopé statiquement au dossier data/ : sinon le tracing de fichiers de
// Next embarque tout le projet en pensant que la lecture est arbitraire.
const HISTORY_PATH = resolve(
  process.cwd(),
  "data",
  isDemo ? "history.demo.ndjson" : "history.ndjson",
)

export function readHistory(): Snapshot[] {
  if (!existsSync(HISTORY_PATH)) return []
  return readFileSync(HISTORY_PATH, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Snapshot)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export const usingDemoData = isDemo
