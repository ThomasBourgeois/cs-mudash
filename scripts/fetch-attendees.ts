/**
 * Relève les participants des événements À VENIR, avec leurs réponses à la
 * question d'inscription (email + motivation pour recevoir le matériel).
 *
 * Contrairement à `fetch-meetup.ts`, ces données ne sont PAS publiques : seul
 * l'organisateur connecté voit la page /attendees/. L'authentification se fait
 * par le cookie de session, recopié depuis ton navigateur dans .env.local :
 *
 *   MEETUP_COOKIE="..."
 *
 * (DevTools > Network > la requête de la page > clic droit > Copier comme cURL,
 * puis colle la valeur de l'en-tête `cookie`.)
 *
 * On charge la page dans un Chromium headless plutôt que via un simple fetch :
 * les réponses aux questions d'inscription arrivent en GraphQL après
 * l'hydratation, elles ne sont pas dans le HTML rendu côté serveur.
 *
 *   npm run fetch:attendees                  relève tous les événements à venir
 *   npm run fetch:attendees -- --event 315692119   un seul, passé compris
 *   npm run fetch:attendees -- --dump        garde les réponses brutes
 *   npm run fetch:attendees -- --from-dump   rejoue le parsing sans réseau
 *
 * Le résultat va dans data/attendees.ndjson — gitignoré : ce sont des données
 * personnelles de tiers, elles ne quittent pas cette machine.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type BrowserContext, type Page } from "playwright"
import type { Attendee, Snapshot } from "../src/lib/types.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const HISTORY_PATH = resolve(ROOT, "data/history.ndjson")
const ATTENDEES_PATH = resolve(ROOT, "data/attendees.ndjson")
const ENV_PATH = resolve(ROOT, ".env.local")
const DUMP_DIR = resolve(ROOT, ".meetup-dump")

const GROUP =
  process.env.MEETUP_GROUP ?? "coder-comprendre-lia-grands-debutants-paris"
const ORIGIN = "https://www.meetup.com/"
const BASE = `${ORIGIN}fr-FR/${GROUP}`

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const value = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------- cookie */

/**
 * Lecture minimale de .env.local : Next le charge pour l'application, mais pas
 * pour les scripts tsx. Une dépendance de plus serait disproportionnée pour
 * une seule variable.
 */
function readCookieFromEnv(): string {
  const fromEnv = process.env.MEETUP_COOKIE
  if (fromEnv?.trim()) return fromEnv.trim()

  if (!existsSync(ENV_PATH)) {
    throw new Error(
      "MEETUP_COOKIE introuvable.\n" +
        "  Crée .env.local à la racine avec :\n" +
        '    MEETUP_COOKIE="…"\n' +
        "  (DevTools > Network sur la page participants > clic droit sur la\n" +
        "   requête > Copier comme cURL, puis colle la valeur de `cookie`.)",
    )
  }

  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const match = line.match(/^\s*MEETUP_COOKIE\s*=\s*(.*)$/)
    if (!match) continue
    return match[1].trim().replace(/^(['"])(.*)\1$/s, "$2").trim()
  }
  throw new Error("MEETUP_COOKIE absent de .env.local")
}

type CookieParam = Parameters<BrowserContext["addCookies"]>[0][number]

/**
 * "a=b; c=d" → cookies Playwright.
 *
 * On tolère les deux formes que DevTools produit : la valeur brute de l'en-tête
 * (« Copy value ») et une commande cURL complète collée telle quelle, pour
 * éviter d'imposer un nettoyage manuel sur une chaîne de 2 000 caractères.
 */
function parseCookies(raw: string): CookieParam[] {
  const fromCurl =
    raw.match(/-H\s+['"]cookie:\s*([^'"]*)['"]/i)?.[1] ??
    raw.match(/-b\s+['"]([^'"]*)['"]/)?.[1]

  return (fromCurl ?? raw)
    .replace(/^\s*cookie\s*:\s*/i, "")
    .split(/;\s*/)
    .map((pair) => {
      const eq = pair.indexOf("=")
      if (eq <= 0) return null
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()

      // Un cookie préfixé __Host- doit être host-only : Chrome le REFUSE dès
      // qu'on lui donne un domaine, et fait échouer tout le lot avec un
      // « Invalid cookie fields » qui ne dit pas lequel. Le poser par URL laisse
      // le navigateur en déduire le bon (hôte, path, secure). Meetup en pose un
      // pour son jeton CSRF, donc le cas n'a rien de théorique.
      if (name.startsWith("__Host-")) return { name, value, url: ORIGIN }

      return {
        // Le point initial couvre www.meetup.com comme meetup.com.
        domain: ".meetup.com",
        path: "/",
        // Exigé par les cookies préfixés __Secure-, et sans effet sur les
        // autres : on ne visite que du https.
        secure: true,
        name,
        value,
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.name.length > 0)
}

/**
 * Pose les cookies en tolérant les brebis galeuses.
 *
 * L'en-tête copié depuis le navigateur mélange les cookies de Meetup et ceux
 * de tiers embarqués (Google One Tap, analytics), dont certains portent une
 * valeur que Chrome refuse — un JSON avec guillemets et virgules, par exemple.
 * Un seul refus fait échouer le lot entier : on repasse alors un par un et on
 * saute les fautifs en les nommant, plutôt que d'abandonner le relevé à cause
 * d'un cookie qui ne sert à rien ici.
 */
async function addCookies(
  context: BrowserContext,
  cookies: CookieParam[],
): Promise<number> {
  try {
    await context.addCookies(cookies)
    return cookies.length
  } catch {
    const skipped: string[] = []
    for (const cookie of cookies) {
      await context.addCookies([cookie]).catch(() => skipped.push(cookie.name))
    }
    if (skipped.length > 0) {
      console.log(
        `⚠ ${skipped.length} cookie(s) refusés par Chrome, ignorés : ${skipped.join(", ")}`,
      )
    }
    return cookies.length - skipped.length
  }
}

/* ------------------------------------------------------------------ capture */

type Capture = { eventId: string; url: string; payloads: unknown[]; html: string }

/**
 * Le bandeau de consentement OneTrust se pose par-dessus la page et bloque le
 * scroll — donc le chargement de la suite de la liste. On le refuse, et on
 * retire ce qu'il en reste au cas où le clic n'aurait pas pris.
 */
async function dismissConsent(page: Page): Promise<void> {
  await page
    .locator("#onetrust-reject-all-handler")
    .first()
    .click({ timeout: 3000 })
    .catch(() => {})
  await page.evaluate(() => {
    document.getElementById("onetrust-consent-sdk")?.remove()
    document.documentElement.style.overflow = ""
    document.body.style.overflow = ""
  })
}

/**
 * Déplie la liste des participants.
 *
 * Meetup les pagine par 10 (`pageInfo.hasNextPage` / `endCursor`) et charge la
 * suite AU SCROLL : il n'y a aucun bouton « voir plus » à cliquer. Un seul
 * scroll ne ramenait qu'une page, ce qui plafonnait le relevé à 20 participants
 * sur 29.
 *
 * Le témoin de progression est le nombre de participants EXTRAITS des réponses
 * GraphQL, pas le nombre de cartes dans le DOM : la liste est virtualisée, le
 * DOM démonte ce qui sort de l'écran et son compte redescend en cours de route.
 * Les réponses réseau, elles, ne se reprennent jamais.
 */
async function expandList(
  page: Page,
  { progress, target }: { progress: () => number; target: number },
): Promise<void> {
  await dismissConsent(page)

  let seen = progress()
  let idle = 0
  // Trois descentes sans nouveau participant : on est en bas de la liste.
  for (let i = 0; i < 60 && idle < 3; i++) {
    // Meetup pagine via IntersectionObserver sur un sentinel en bas de liste.
    // Un simple scrollTo(0, scrollHeight) ne re-déclenche pas l'observer quand
    // le sentinel reste dans le viewport. On le fait sortir (scroll en haut de
    // la liste) puis revenir (scroll en bas) pour forcer une intersection.
    await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>('[class*="min-h-"][class*="space-y"]')
      if (list) list.scrollIntoView({ block: "start" })
      else window.scrollTo(0, 0)
    })
    await sleep(300)
    await page.evaluate(() => {
      // Le sentinel est le <span style="font-size: 0px"> juste après la liste.
      const sentinel = document.querySelector<HTMLElement>('span[style*="font-size: 0px"]')
      if (sentinel) sentinel.scrollIntoView({ block: "end" })
      else window.scrollTo(0, document.body.scrollHeight)
    })
    await sleep(1500)

    const now = progress()
    if (now > seen) {
      seen = now
      idle = 0
    } else {
      idle++
    }
    // `going` du dernier relevé quotidien : un plancher, pas un plafond — des
    // inscriptions ont pu arriver depuis. On ne s'arrête dessus que pour éviter
    // de scroller dans le vide une fois la liste manifestement complète.
    if (target > 0 && seen >= target) break
  }
}

async function captureEvent(
  page: Page,
  event: EventRef,
  cookieCount: number,
): Promise<Capture> {
  const url = `${BASE}/events/${event.id}/attendees/`
  const payloads: unknown[] = []

  // On écoute les réponses GraphQL : les réponses aux questions d'inscription
  // arrivent après l'hydratation, elles ne sont pas dans le HTML initial.
  const onResponse = async (res: import("playwright").Response) => {
    if (!/\/gql|graphql|\/api\//.test(res.url())) return
    try {
      payloads.push(await res.json())
    } catch {
      /* réponse non-JSON : sans intérêt ici */
    }
  }
  page.on("response", onResponse)

  await page.goto(url, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {})

  if (/login|signup/.test(new URL(page.url()).pathname)) {
    throw new Error(
      "Meetup renvoie vers la page de connexion : cookie invalide ou expiré.\n" +
        (cookieCount < 3
          ? `  Seulement ${cookieCount} cookie(s) chargé(s) — un cookie isolé ne suffit\n` +
            "  généralement pas. Copie l'en-tête `cookie:` ENTIER : DevTools >\n" +
            "  Network > requête `attendees/` > Request Headers > cookie > Copy value.\n"
          : "  Recopie MEETUP_COOKIE depuis ton navigateur dans .env.local.\n"),
    )
  }

  await expandList(page, {
    progress: () => parseCapture({ eventId: event.id, url, payloads, html: "" }, event).length,
    target: event.going,
  })
  page.off("response", onResponse)

  // Le blob __NEXT_DATA__ du rendu serveur complète les réponses réseau.
  const html = await page.content()
  const nextData = await page
    .evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent ?? null)
    .catch(() => null)
  if (nextData) {
    try {
      payloads.push(JSON.parse(nextData))
    } catch {
      /* ignoré */
    }
  }

  return { eventId: event.id, url, payloads, html }
}

/* ------------------------------------------------------------------- parsing */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+[\w]/g

function walk(node: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (typeof node !== "object" || node === null) return
  const obj = node as Record<string, unknown>
  visit(obj)
  for (const v of Object.values(obj)) walk(v, visit)
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const ANSWER_KEY = /answer|response|survey|question|reply/i

/**
 * Ramasse le texte des réponses libres d'un RSVP.
 *
 * Meetup range la réponse dans un objet — `answer: { text, __typename }` — et
 * pas directement en chaîne. On descend donc dans tout le sous-arbre d'une clé
 * qui sent la réponse, au lieu de n'accepter qu'une valeur textuelle immédiate :
 * ça survit aussi bien à `answer: "…"` qu'à un tableau de réponses multiples.
 */
function collectAnswers(rsvp: Record<string, unknown>): string[] {
  const out: string[] = []

  const harvest = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.trim()) out.push(v.trim())
    } else if (Array.isArray(v)) {
      v.forEach(harvest)
    } else if (isRecord(v)) {
      for (const [k, sub] of Object.entries(v)) {
        if (k !== "__typename") harvest(sub)
      }
    }
  }

  walk(rsvp, (o) => {
    for (const [key, v] of Object.entries(o)) {
      if (ANSWER_KEY.test(key)) harvest(v)
    }
  })
  return [...new Set(out)]
}

/**
 * Parcours en profondeur du JSON capturé.
 *
 * On ne présume pas du schéma GraphQL de Meetup — il change sans préavis et
 * varie d'une page à l'autre. On cherche donc la FORME d'un RSVP : un objet
 * portant un `member` nommé. Tout ce qui ressemble à une réponse de
 * questionnaire à côté est ramassé, et l'email en est extrait par regex.
 */
function parseCapture(capture: Capture, event: EventRef): Attendee[] {
  const byMember = new Map<string, Attendee>()
  const capturedAt = new Date().toISOString()

  // Tous les événements ne posent pas de question à l'inscription. Sans ça,
  // « 0 email » serait ambigu : rien demandé, ou personne n'a répondu ?
  let eventQuestion: string | null = null
  for (const payload of capture.payloads) {
    walk(payload, (o) => {
      if (o.__typename === "RsvpQuestion" && typeof o.text === "string" && !eventQuestion) {
        eventQuestion = o.text.trim()
      }
    })
  }

  for (const payload of capture.payloads) {
    walk(payload, (obj) => {
      const member = obj.member
      if (!isRecord(member)) return
      const name = typeof member.name === "string" ? member.name : null
      const memberId =
        typeof member.id === "string"
          ? member.id
          : typeof member.id === "number"
            ? String(member.id)
            : null
      if (!name || !memberId) return

      const answers = collectAnswers(obj)
      const emails = [...new Set(answers.join("\n").match(EMAIL_RE) ?? [])]

      const previous = byMember.get(memberId)
      // Le même membre apparaît dans plusieurs payloads, parfois en version
      // partielle : on garde la plus riche plutôt que la dernière vue.
      if (previous && previous.answers.join().length >= answers.join().length) return

      byMember.set(memberId, {
        eventId: event.id,
        eventTitle: event.title,
        eventDateTime: event.dateTime,
        eventQuestion,
        memberId,
        name,
        answers,
        email: emails[0] ?? null,
        extraEmails: emails.slice(1),
        capturedAt,
      })
    })
  }

  return [...byMember.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"))
}

/* -------------------------------------------------------------------- store */

type EventRef = {
  id: string
  title: string
  dateTime: string
  /** Inscrits au dernier relevé quotidien — le compte que la capture doit atteindre. */
  going: number
}

function readSnapshots(): Snapshot[] {
  if (!existsSync(HISTORY_PATH)) {
    throw new Error("data/history.ndjson introuvable — lance d'abord `npm run fetch`")
  }
  return readFileSync(HISTORY_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Snapshot)
}

function upcomingEvents(): EventRef[] {
  const latest = readSnapshots().at(-1)!
  return latest.events
    .filter((e) => e.status === "ACTIVE" && new Date(e.dateTime).getTime() > Date.now())
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime))
    .map((e) => ({ id: e.id, title: e.title, dateTime: e.dateTime, going: e.going }))
}

/**
 * Un événement quelconque de l'historique, passé compris.
 *
 * Le relevé par défaut se limite aux événements à venir — ce sont eux dont on
 * attend encore des inscriptions. Mais la page participants reste accessible
 * après coup, et un relevé oublié se rattrape : `--event <id>` doit donc
 * pouvoir viser un événement déjà passé, pas seulement ceux du dernier
 * snapshot.
 */
function findEvent(id: string): EventRef {
  for (const snap of readSnapshots().reverse()) {
    const match = snap.events.find((e) => e.id === id)
    if (match) {
      return {
        id: match.id,
        title: match.title,
        dateTime: match.dateTime,
        going: match.going,
      }
    }
  }
  throw new Error(
    `Événement ${id} inconnu de data/history.ndjson.\n` +
      "  Vérifie l'identifiant dans l'URL Meetup, ou lance `npm run fetch`.",
  )
}

/**
 * Fusion par (événement, membre) : un relevé remplace le précédent pour les
 * événements qu'il couvre, sans toucher aux autres. Réexécutable sans doublon.
 */
function mergeAttendees(fresh: Attendee[], eventIds: string[]): number {
  mkdirSync(dirname(ATTENDEES_PATH), { recursive: true })

  const existing: Attendee[] = existsSync(ATTENDEES_PATH)
    ? readFileSync(ATTENDEES_PATH, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Attendee)
    : []

  const touched = new Set(eventIds)
  const merged = [...existing.filter((a) => !touched.has(a.eventId)), ...fresh].sort(
    (a, b) =>
      a.eventDateTime.localeCompare(b.eventDateTime) || a.name.localeCompare(b.name, "fr"),
  )

  writeFileSync(ATTENDEES_PATH, merged.map((a) => JSON.stringify(a)).join("\n") + "\n")
  return merged.length
}

function saveDump(capture: Capture): void {
  mkdirSync(DUMP_DIR, { recursive: true })
  writeFileSync(
    join(DUMP_DIR, `${capture.eventId}.json`),
    JSON.stringify({ url: capture.url, payloads: capture.payloads }, null, 2),
  )
  writeFileSync(join(DUMP_DIR, `${capture.eventId}.html`), capture.html)
}

function loadDumps(): Capture[] {
  if (!existsSync(DUMP_DIR)) throw new Error(".meetup-dump/ absent — relance avec --dump")
  return readdirSync(DUMP_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(DUMP_DIR, f), "utf8"))
      return {
        eventId: f.replace(/\.json$/, ""),
        url: raw.url,
        payloads: raw.payloads,
        html: "",
      }
    })
}

const tryFindEvent = (id: string): EventRef | null => {
  try {
    return findEvent(id)
  } catch {
    return null
  }
}

/* --------------------------------------------------------------------- main */

function report(event: EventRef, attendees: Attendee[]): void {
  const withAnswer = attendees.filter((a) => a.answers.length > 0).length
  const withEmail = attendees.filter((a) => a.email).length
  const noQuestion = attendees.length > 0 && !attendees[0].eventQuestion
  console.log(
    `  → ${event.id} « ${event.title.slice(0, 40)}… » : ` +
      `${attendees.length} participants, ${withAnswer} réponses, ${withEmail} emails` +
      (noQuestion ? "  (aucune question posée à l'inscription)" : ""),
  )
  // Le relevé quotidien donne un plancher : en dessous, la liste n'a pas fini de
  // se déplier et le silence coûterait des emails. Au-dessus, c'est normal — des
  // inscriptions sont arrivées depuis le snapshot de ce matin.
  if (event.going > attendees.length) {
    console.log(
      `    ⚠ ${event.going} inscrits au dernier relevé quotidien : ` +
        `${event.going - attendees.length} manquent. Relance avec --dump et ` +
        `inspecte .meetup-dump/ — la pagination de la page a pu changer.`,
    )
  }
}

async function main(): Promise<void> {
  const only = value("event")
  const events = only ? [findEvent(only)] : upcomingEvents()

  if (flag("from-dump")) {
    console.log("Rejeu du parsing depuis .meetup-dump/ (aucun réseau)\n")
    const all: Attendee[] = []
    for (const capture of loadDumps()) {
      const event = events.find((e) => e.id === capture.eventId) ??
        tryFindEvent(capture.eventId) ?? {
          id: capture.eventId,
          title: "(inconnu)",
          dateTime: "",
          going: 0,
        }
      const attendees = parseCapture(capture, event)
      report(event, attendees)
      all.push(...attendees)
    }
    const total = mergeAttendees(all, [...new Set(all.map((a) => a.eventId))])
    console.log(`\n✓ data/attendees.ndjson — ${total} participant(s)`)
    return
  }

  if (events.length === 0) {
    console.log("Aucun événement à venir dans data/history.ndjson — rien à relever.")
    return
  }

  const cookies = parseCookies(readCookieFromEnv())

  // `channel: "chrome"` réutilise le Chrome installé sur la machine plutôt que
  // le Chromium de Playwright, dont la version change à chaque mise à jour du
  // paquet et impose un `npx playwright install` de 150 Mo.
  const browser = await chromium
    .launch({ headless: true, channel: "chrome" })
    .catch(() => chromium.launch({ headless: true }))
  const context = await browser.newContext({ locale: "fr-FR" })
  const loaded = await addCookies(context, cookies)
  console.log(
    (only ? `Événement ${only}` : `${events.length} événement(s) à venir`) +
      ` — ${loaded} cookies chargés\n`,
  )
  const page = await context.newPage()

  try {
    const all: Attendee[] = []
    for (const event of events) {
      const capture = await captureEvent(page, event, loaded)
      if (flag("dump")) saveDump(capture)
      const attendees = parseCapture(capture, event)
      report(event, attendees)
      all.push(...attendees)
    }
    const total = mergeAttendees(all, events.map((e) => e.id))
    console.log(`\n✓ data/attendees.ndjson — ${total} participant(s) au total`)
    if (all.every((a) => !a.email)) {
      console.log(
        "\n⚠ Aucun email trouvé. Relance avec --dump puis inspecte .meetup-dump/ :\n" +
          "  la structure de la page Meetup a probablement changé.",
      )
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(`\n✗ Échec du relevé des participants : ${err.message}`)
  process.exit(1)
})
