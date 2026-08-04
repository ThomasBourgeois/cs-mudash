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
 *   npm run fetch:attendees -- --event 315692119
 *   npm run fetch:attendees -- --dump        garde les réponses brutes
 *   npm run fetch:attendees -- --from-dump   rejoue le parsing sans réseau
 *
 * Le résultat va dans data/attendees.ndjson — gitignoré : ce sont des données
 * personnelles de tiers, elles ne quittent pas cette machine.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Page } from "playwright"
import type { Attendee, Snapshot } from "../src/lib/types.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const HISTORY_PATH = resolve(ROOT, "data/history.ndjson")
const ATTENDEES_PATH = resolve(ROOT, "data/attendees.ndjson")
const ENV_PATH = resolve(ROOT, ".env.local")
const DUMP_DIR = resolve(ROOT, ".meetup-dump")

const GROUP =
  process.env.MEETUP_GROUP ?? "coder-comprendre-lia-grands-debutants-paris"
const BASE = `https://www.meetup.com/fr-FR/${GROUP}`

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

/**
 * "a=b; c=d" → cookies Playwright.
 *
 * On tolère les deux formes que DevTools produit : la valeur brute de l'en-tête
 * (« Copy value ») et une commande cURL complète collée telle quelle, pour
 * éviter d'imposer un nettoyage manuel sur une chaîne de 2 000 caractères.
 */
function parseCookies(raw: string): { name: string; value: string; domain: string; path: string }[] {
  const fromCurl =
    raw.match(/-H\s+['"]cookie:\s*([^'"]*)['"]/i)?.[1] ??
    raw.match(/-b\s+['"]([^'"]*)['"]/)?.[1]

  return (fromCurl ?? raw)
    .replace(/^\s*cookie\s*:\s*/i, "")
    .split(/;\s*/)
    .map((pair) => {
      const eq = pair.indexOf("=")
      if (eq <= 0) return null
      return {
        // Le point initial couvre www.meetup.com comme meetup.com.
        domain: ".meetup.com",
        path: "/",
        name: pair.slice(0, eq).trim(),
        value: pair.slice(eq + 1).trim(),
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.name.length > 0)
}

/* ------------------------------------------------------------------ capture */

type Capture = { eventId: string; url: string; payloads: unknown[]; html: string }

/** Déplie la liste : Meetup pagine les participants derrière un bouton. */
async function expandList(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const more = page
      .getByRole("button", { name: /plus|more|suivant|next/i })
      .filter({ visible: true })
      .first()
    if ((await more.count()) === 0) break
    await more.click({ timeout: 5000 }).catch(() => {})
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {})
    await sleep(500)
  }
  // Certaines listes chargent au scroll plutôt qu'au clic.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {})
}

async function captureEvent(
  page: Page,
  eventId: string,
  cookieCount: number,
): Promise<Capture> {
  const url = `${BASE}/events/${eventId}/attendees/`
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

  await expandList(page)
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

  return { eventId, url, payloads, html }
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

type EventRef = { id: string; title: string; dateTime: string }

function upcomingEvents(): EventRef[] {
  if (!existsSync(HISTORY_PATH)) {
    throw new Error("data/history.ndjson introuvable — lance d'abord `npm run fetch`")
  }
  const lines = readFileSync(HISTORY_PATH, "utf8").split("\n").filter((l) => l.trim())
  const latest = JSON.parse(lines.at(-1)!) as Snapshot
  return latest.events
    .filter((e) => e.status === "ACTIVE" && new Date(e.dateTime).getTime() > Date.now())
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime))
    .map((e) => ({ id: e.id, title: e.title, dateTime: e.dateTime }))
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
}

async function main(): Promise<void> {
  const only = value("event")
  const events = upcomingEvents().filter((e) => !only || e.id === only)

  if (flag("from-dump")) {
    console.log("Rejeu du parsing depuis .meetup-dump/ (aucun réseau)\n")
    const all: Attendee[] = []
    for (const capture of loadDumps()) {
      const event = events.find((e) => e.id === capture.eventId) ?? {
        id: capture.eventId,
        title: "(inconnu)",
        dateTime: "",
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
  console.log(`${events.length} événement(s) à venir — ${cookies.length} cookies chargés\n`)

  // `channel: "chrome"` réutilise le Chrome installé sur la machine plutôt que
  // le Chromium de Playwright, dont la version change à chaque mise à jour du
  // paquet et impose un `npx playwright install` de 150 Mo.
  const browser = await chromium
    .launch({ headless: true, channel: "chrome" })
    .catch(() => chromium.launch({ headless: true }))
  const context = await browser.newContext({ locale: "fr-FR" })
  await context.addCookies(cookies)
  const page = await context.newPage()

  try {
    const all: Attendee[] = []
    for (const event of events) {
      const capture = await captureEvent(page, event.id, cookies.length)
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
