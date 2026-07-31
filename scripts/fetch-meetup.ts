/**
 * Relève quotidienne des chiffres d'un groupe Meetup.
 *
 * Meetup n'expose plus d'API REST publique, mais ses pages sont rendues par
 * Next.js : le cache Apollo complet est embarqué dans <script id="__NEXT_DATA__">.
 * On y lit des valeurs structurées (pas du texte scrapé), ce qui est nettement
 * plus stable que de parser du HTML.
 *
 * Trois pages suffisent :
 *   /<groupe>/                  -> stats.memberCounts.all
 *   /<groupe>/events/           -> événements à venir (first:30)
 *   /<groupe>/events/?type=past -> événements passés (first:10, plus récents d'abord)
 *
 * Le résultat est ajouté à data/history.ndjson (une ligne JSON par jour).
 * Relancer le script le même jour remplace la ligne du jour : l'opération est
 * idempotente, on peut donc réexécuter sans polluer l'historique.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { EventSnapshot, Snapshot } from "../src/lib/types.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const HISTORY_PATH = resolve(ROOT, "data/history.ndjson")

const GROUP =
  process.env.MEETUP_GROUP ?? "coder-comprendre-lia-grands-debutants-paris"
const BASE = `https://www.meetup.com/fr-FR/${GROUP}`

/** Un vrai User-Agent : Meetup renvoie une page dégradée sans données aux UA inconnus. */
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Récupère une page avec quelques tentatives : Actions tourne sur des IP datacenter, parfois throttlées. */
async function fetchPage(url: string, attempts = 3): Promise<string> {
  let lastError: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const html = await res.text()
      if (!html.includes("__NEXT_DATA__")) {
        throw new Error(
          "réponse sans __NEXT_DATA__ (page anti-bot ou captcha probable)",
        )
      }
      return html
    } catch (err) {
      lastError = err
      if (i < attempts) {
        const wait = i * 3000
        console.warn(`  tentative ${i}/${attempts} échouée (${err}), retry dans ${wait / 1000}s`)
        await sleep(wait)
      }
    }
  }
  throw new Error(`Échec du fetch de ${url} après ${attempts} tentatives : ${lastError}`)
}

/**
 * Le cache Apollo est du JSON non typé venant du réseau : on ne le traite pas
 * comme sûr. Ces trois accesseurs valident chaque champ à la lecture, ce qui
 * fait échouer bruyamment un changement de structure côté Meetup plutôt que de
 * laisser passer un `undefined` jusque dans l'historique.
 */
type ApolloEntity = Record<string, unknown>

const asObject = (v: unknown): ApolloEntity | null =>
  typeof v === "object" && v !== null ? (v as ApolloEntity) : null
const asNumber = (v: unknown): number | null => (typeof v === "number" ? v : null)
const asString = (v: unknown): string | null => (typeof v === "string" ? v : null)

/** Extrait le cache Apollo normalisé du blob __NEXT_DATA__. */
function apolloState(html: string, url: string): Record<string, ApolloEntity> {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s,
  )
  if (!match) throw new Error(`__NEXT_DATA__ introuvable dans ${url}`)

  const state = JSON.parse(match[1])?.props?.pageProps?.__APOLLO_STATE__
  if (!state || typeof state !== "object") {
    throw new Error(`__APOLLO_STATE__ absent ou malformé dans ${url}`)
  }
  return state
}

/** Normalise une entité Event du cache Apollo. */
function toEventSnapshot(e: ApolloEntity): EventSnapshot | null {
  const id = asString(e.id) ?? asNumber(e.id)?.toString()
  const dateTime = asString(e.dateTime)
  // Entité partielle (simple référence dans le cache) : on l'écarte.
  if (!id || !dateTime) return null

  // `going.totalCount` est le compteur d'inscrits. Le champ `rsvps(...)` porte
  // la même valeur mais sa clé embarque les arguments de la requête GraphQL,
  // qui varient d'une page à l'autre — d'où la recherche par préfixe.
  const rsvps = Object.entries(e).find(([k]) => k.startsWith("rsvps("))?.[1]
  const going =
    asNumber(asObject(e.going)?.totalCount) ??
    asNumber(asObject(rsvps)?.totalCount) ??
    0

  return {
    id,
    title: asString(e.title) ?? "(sans titre)",
    dateTime,
    status: asString(e.status) ?? "UNKNOWN",
    going,
    maxTickets: asNumber(e.maxTickets),
    isOnline: Boolean(e.isOnline),
    eventUrl:
      asString(e.eventUrl) ?? `https://www.meetup.com/${GROUP}/events/${id}/`,
  }
}

function collectEvents(state: Record<string, ApolloEntity>): EventSnapshot[] {
  return Object.entries(state)
    .filter(([key]) => key.startsWith("Event:"))
    .map(([, entity]) => toEventSnapshot(entity))
    .filter((e): e is EventSnapshot => e !== null)
}

async function buildSnapshot(): Promise<Snapshot> {
  console.log(`Groupe : ${GROUP}`)

  console.log("→ page d'accueil du groupe…")
  const homeHtml = await fetchPage(`${BASE}/`)
  const homeState = apolloState(homeHtml, "accueil")

  const groupEntry = Object.entries(homeState).find(([k]) => k.startsWith("Group:"))
  if (!groupEntry) throw new Error("Aucune entité Group dans le cache Apollo de l'accueil")
  const group = groupEntry[1]

  const memberCount = asNumber(
    asObject(asObject(group.stats)?.memberCounts)?.all,
  )
  if (memberCount === null) {
    throw new Error(
      "stats.memberCounts.all introuvable — la structure de la page Meetup a probablement changé",
    )
  }
  console.log(`  membres : ${memberCount}`)

  console.log("→ événements à venir…")
  const upcomingState = apolloState(await fetchPage(`${BASE}/events/`), "events")

  console.log("→ événements passés…")
  const pastState = apolloState(
    await fetchPage(`${BASE}/events/?type=past`),
    "events?type=past",
  )

  // Dédoublonnage par id, sur les 3 pages. L'accueil ne liste que 4 événements,
  // les pages /events/ complètent ; les doublons portent les mêmes valeurs.
  const byId = new Map<string, EventSnapshot>()
  for (const e of [
    ...collectEvents(homeState),
    ...collectEvents(upcomingState),
    ...collectEvents(pastState),
  ]) {
    byId.set(e.id, e)
  }

  const events = [...byId.values()].sort((a, b) =>
    a.dateTime.localeCompare(b.dateTime),
  )
  console.log(`  ${events.length} événements (${events.filter((e) => e.status === "ACTIVE").length} à venir)`)

  const now = new Date()
  return {
    // Date en heure de Paris : le cron tourne en UTC, on veut que le relevé
    // de 06:00 UTC soit daté du bon jour local.
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
    }).format(now),
    fetchedAt: now.toISOString(),
    group: {
      id: asString(group.id) ?? asNumber(group.id)?.toString() ?? "",
      urlname: asString(group.urlname) ?? GROUP,
      name: asString(group.name) ?? GROUP,
      memberCount,
    },
    events,
  }
}

/** Réécrit l'historique en remplaçant la ligne du jour si elle existe. */
function appendSnapshot(snapshot: Snapshot): { replaced: boolean; total: number } {
  mkdirSync(dirname(HISTORY_PATH), { recursive: true })

  const existing: Snapshot[] = existsSync(HISTORY_PATH)
    ? readFileSync(HISTORY_PATH, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Snapshot)
    : []

  const replaced = existing.some((s) => s.date === snapshot.date)
  const merged = [...existing.filter((s) => s.date !== snapshot.date), snapshot].sort(
    (a, b) => a.date.localeCompare(b.date),
  )

  writeFileSync(HISTORY_PATH, merged.map((s) => JSON.stringify(s)).join("\n") + "\n")
  return { replaced, total: merged.length }
}

const dryRun = process.argv.includes("--dry")

buildSnapshot()
  .then((snapshot) => {
    if (dryRun) {
      console.log("\n--dry : rien n'est écrit\n")
      console.log(JSON.stringify(snapshot, null, 2))
      return
    }
    const { replaced, total } = appendSnapshot(snapshot)
    console.log(
      `\n✓ ${replaced ? "Snapshot du jour remplacé" : "Snapshot ajouté"} (${snapshot.date}) — ${total} jour(s) d'historique`,
    )
  })
  .catch((err) => {
    console.error(`\n✗ Échec du relevé : ${err.message}`)
    process.exit(1)
  })
