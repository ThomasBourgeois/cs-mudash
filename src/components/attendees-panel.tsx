"use client"

import { useMemo, useState, useTransition } from "react"
import { Check, Copy, Mail, TriangleAlert } from "lucide-react"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { setSent } from "@/app/actions"
import { formatEventDate, isUpcoming } from "@/lib/metrics"
import {
  attendeeKey,
  type Attendee,
  type EventSnapshot,
  type SentMap,
} from "@/lib/types"

const plural = (n: number) => (n > 1 ? "s" : "")

/**
 * Les emails laissés par les participants, prêts à être copiés, et le suivi de
 * ce qui a déjà été envoyé.
 *
 * Ne s'affiche que si data/attendees.ndjson existe — un fichier local et
 * gitignoré. Sur un déploiement distant, la section disparaît : c'est voulu,
 * ces données personnelles ne quittent pas la machine de l'organisateur.
 *
 * Ce relevé est MANUEL, contrairement à l'historique que GitHub Actions
 * rafraîchit tous les jours : il vieillit dès qu'une inscription arrive. On
 * confronte donc chaque capture au `going` du dernier snapshot pour dire
 * combien de participants manquent, plutôt que d'afficher un compte périmé
 * qui a l'air complet.
 */
export function AttendeesPanel({
  attendees,
  sent: initialSent,
  events,
}: {
  attendees: Attendee[]
  sent: SentMap
  /** Dernier état connu de chaque événement — la référence de fraîcheur. */
  events: EventSnapshot[]
}) {
  const [sent, setSentMap] = useState<SentMap>(initialSent)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Un groupe par événement, dans l'ordre chronologique.
  const groups = useMemo(() => {
    const byEvent = new Map<string, Attendee[]>()
    for (const a of attendees) {
      const list = byEvent.get(a.eventId)
      if (list) list.push(a)
      else byEvent.set(a.eventId, [a])
    }
    const eventById = new Map(events.map((e) => [e.id, e]))

    const groups = [...byEvent].map(([eventId, list]) => ({
      eventId,
      event: eventById.get(eventId),
      attendees: list,
      dateTime: list[0].eventDateTime,
    }))

    // Un événement à venir jamais relevé n'a aucune ligne dans le fichier : sans
    // ça il disparaîtrait de la section, alors que c'est justement celui dont
    // les emails manquent le plus.
    for (const event of events) {
      if (isUpcoming(event) && !byEvent.has(event.id)) {
        groups.push({
          eventId: event.id,
          event,
          attendees: [],
          dateTime: event.dateTime,
        })
      }
    }

    return groups.sort((a, b) => a.dateTime.localeCompare(b.dateTime))
  }, [attendees, events])

  function toggle(key: string, next: boolean) {
    // Optimiste : cocher doit être instantané, l'écriture disque suit.
    setSentMap((prev) => {
      const copy = { ...prev }
      if (next) copy[key] = new Date().toISOString()
      else delete copy[key]
      return copy
    })
    setError(null)
    startTransition(async () => {
      try {
        setSentMap(await setSent(key, next))
      } catch {
        setError("Impossible d'enregistrer le suivi — la case a été remise à son état précédent.")
        setSentMap((prev) => {
          const copy = { ...prev }
          if (next) delete copy[key]
          else copy[key] = new Date().toISOString()
          return copy
        })
      }
    })
  }

  if (attendees.length === 0) return <EmptyState />

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="border-destructive bg-destructive/10 text-destructive rounded-md border-l-4 px-4 py-2 text-sm">
          {error}
        </p>
      )}
      {groups.map((group) =>
        group.attendees.length === 0 ? (
          <UncapturedEvent key={group.eventId} event={group.event!} />
        ) : (
          <EventAttendees
            key={group.eventId}
            attendees={group.attendees}
            event={group.event}
            sent={sent}
            onToggle={toggle}
            pending={pending}
          />
        ),
      )}
    </div>
  )
}

function EventAttendees({
  attendees,
  event,
  sent,
  onToggle,
  pending,
}: {
  attendees: Attendee[]
  event: EventSnapshot | undefined
  sent: SentMap
  onToggle: (key: string, next: boolean) => void
  pending: boolean
}) {
  const [first] = attendees
  const withEmail = attendees.filter((a) => a.email)
  const remaining = withEmail.filter((a) => !sent[attendeeKey(a)])
  const sentCount = withEmail.length - remaining.length
  // Sans question à l'inscription, « 0 email » n'est pas un manque de réponses :
  // rien n'a été demandé. On le dit, plutôt que d'afficher un zéro trompeur.
  const asksQuestion = Boolean(first.eventQuestion)

  // Le relevé des participants est manuel, l'historique est quotidien : l'écart
  // entre les deux, c'est exactement ce qui manque au fichier local.
  const going = event?.going ?? null
  const missing = going === null ? 0 : Math.max(0, going - attendees.length)
  const capturedAt = attendees.reduce(
    (latest, a) => (a.capturedAt > latest ? a.capturedAt : latest),
    first.capturedAt,
  )

  // Sans question à l'inscription, il n'y a aucun email à collecter : ni tableau
  // de pseudos, ni relance de relevé. On garde une ligne pour dire pourquoi
  // l'événement n'apporte rien, sinon son absence passerait pour un oubli.
  if (!asksQuestion) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="leading-snug">{first.eventTitle}</CardTitle>
          <CardDescription>
            {formatEventDate(first.eventDateTime)}{" "}
            · aucune question posée à l&apos;inscription, donc aucun email à
            collecter
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">{first.eventTitle}</CardTitle>
        <CardDescription>
          {formatEventDate(first.eventDateTime)} · {attendees.length} participant
          {plural(attendees.length)} relevé{plural(attendees.length)}
          {/* « 29 relevés sur 27 » se lirait comme une erreur : le `going` du
              relevé de ce matin est un plancher, des inscriptions arrivent
              après. On ne l'affiche donc que lorsqu'il manque quelqu'un. */}
          {going !== null &&
            going > attendees.length &&
            ` sur ${going} inscrit${plural(going)}`}
          {" "}
          · {withEmail.length} email{plural(withEmail.length)} · {sentCount} envoyé
          {plural(sentCount)}
        </CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          {remaining.length > 0 && sentCount > 0 && (
            <CopyEmailsButton
              attendees={remaining}
              label={
                remaining.length === 1
                  ? "Copier le restant"
                  : `Copier les ${remaining.length} restants`
              }
              variant="default"
            />
          )}
          <CopyEmailsButton
            attendees={withEmail}
            label={
              withEmail.length === 1
                ? "Copier l'email"
                : `Copier les ${withEmail.length} emails`
            }
            variant={remaining.length > 0 && sentCount > 0 ? "outline" : "default"}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {missing > 0 && (
          <p className="border-chart-4 bg-chart-4/10 mb-3 flex items-start gap-2 rounded-md border-l-4 px-3 py-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>Relevé incomplet.</strong> {attendees.length} participant
              {plural(attendees.length)} capturé{plural(attendees.length)} le{" "}
              {formatEventDate(capturedAt)}, l&apos;événement en compte {going} au
              dernier relevé Meetup — {missing} manquant{plural(missing)}. Relance{" "}
              <code>
                npm run fetch:attendees
                {event && !isUpcoming(event) && ` -- --event ${event.id}`}
              </code>{" "}
              {event && !isUpcoming(event) &&
                "(l'événement est passé : sans --event il serait ignoré) "}
              — recopie d&apos;abord <code>MEETUP_COOKIE</code> dans{" "}
              <code>.env.local</code> s&apos;il a expiré.
            </span>
          </p>
        )}
        <p className="text-muted-foreground mb-3 line-clamp-2 text-xs italic">
          « {first.eventQuestion} »
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[1%] whitespace-nowrap">Envoyé</TableHead>
                <TableHead>Participant</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Réponse</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendees.map((a) => {
                const key = attendeeKey(a)
                const isSent = Boolean(sent[key])
                return (
                  <TableRow key={key} className={isSent ? "text-muted-foreground" : undefined}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="accent-primary size-4 align-middle disabled:opacity-50"
                        checked={isSent}
                        disabled={pending || !a.email}
                        onChange={(e) => onToggle(key, e.target.checked)}
                        aria-label={`Matériel envoyé à ${a.name}`}
                        title={
                          sent[key]
                            ? `Envoyé le ${new Date(sent[key]).toLocaleDateString("fr-FR")}`
                            : undefined
                        }
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{a.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.email ? (
                        <span className="flex items-center gap-1.5">
                          {a.email}
                          {a.extraEmails.length > 0 && (
                            <span
                              className="text-muted-foreground"
                              title={a.extraEmails.join(", ")}
                            >
                              +{a.extraEmails.length}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[420px]">
                      {a.answers.length > 0 ? (
                        <span className="line-clamp-3 text-sm" title={a.answers.join("\n\n")}>
                          {a.answers.join(" — ")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          pas de réponse
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

/** Événement à venir dont aucun participant n'a encore été relevé. */
function UncapturedEvent({ event }: { event: EventSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">{event.title}</CardTitle>
        <CardDescription>
          {formatEventDate(event.dateTime)} · {event.going} inscrit{plural(event.going)}{" "}
          · aucun participant relevé
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        Lance <code>npm run fetch:attendees</code> pour récupérer leurs emails.
      </CardContent>
    </Card>
  )
}

/** Copie les emails séparés par «, » : le format qu'attend un champ destinataires. */
function CopyEmailsButton({
  attendees,
  label,
  variant,
}: {
  attendees: Attendee[]
  label: string
  variant: "default" | "outline"
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    const list = attendees.map((a) => a.email).filter(Boolean).join(", ")
    try {
      await navigator.clipboard.writeText(list)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard refusé (page non sécurisée, permission) : on ne perd pas la
      // liste pour autant, la sélection manuelle reste possible via le prompt.
      window.prompt("Copie manuelle :", list)
    }
  }

  if (attendees.length === 0) return null

  return (
    <Button variant={variant} onClick={copy} disabled={copied}>
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? "Copié" : label}
    </Button>
  )
}

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4" />
          Emails des participants
        </CardTitle>
        <CardDescription>
          Aucun relevé de participants pour l&apos;instant.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-sm">
        <p>
          Renseigne <code>MEETUP_COOKIE</code> dans <code>.env.local</code>, puis lance :
        </p>
        <pre className="bg-muted text-foreground rounded-md p-3">
          npm run fetch:attendees
        </pre>
        <p>
          Les emails restent dans <code>data/attendees.ndjson</code>, gitignoré :
          ils ne sont ni commités ni poussés.
        </p>
      </CardContent>
    </Card>
  )
}
