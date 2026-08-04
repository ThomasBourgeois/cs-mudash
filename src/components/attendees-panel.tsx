"use client"

import { useMemo, useState, useTransition } from "react"
import { Check, Copy, Mail } from "lucide-react"

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
import { formatEventDate } from "@/lib/metrics"
import { attendeeKey, type Attendee, type SentMap } from "@/lib/types"

/**
 * Les emails laissés par les participants, prêts à être copiés, et le suivi de
 * ce qui a déjà été envoyé.
 *
 * Ne s'affiche que si data/attendees.ndjson existe — un fichier local et
 * gitignoré. Sur un déploiement distant, la section disparaît : c'est voulu,
 * ces données personnelles ne quittent pas la machine de l'organisateur.
 */
export function AttendeesPanel({
  attendees,
  sent: initialSent,
}: {
  attendees: Attendee[]
  sent: SentMap
}) {
  const [sent, setSentMap] = useState<SentMap>(initialSent)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Un groupe par événement, dans l'ordre du fichier (chronologique).
  const groups = useMemo(() => {
    const byEvent = new Map<string, Attendee[]>()
    for (const a of attendees) {
      const list = byEvent.get(a.eventId)
      if (list) list.push(a)
      else byEvent.set(a.eventId, [a])
    }
    return [...byEvent.values()]
  }, [attendees])

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
      {groups.map((group) => (
        <EventAttendees
          key={group[0].eventId}
          attendees={group}
          sent={sent}
          onToggle={toggle}
          pending={pending}
        />
      ))}
    </div>
  )
}

function EventAttendees({
  attendees,
  sent,
  onToggle,
  pending,
}: {
  attendees: Attendee[]
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">{first.eventTitle}</CardTitle>
        <CardDescription>
          {formatEventDate(first.eventDateTime)} · {attendees.length} inscrit
          {attendees.length > 1 ? "s" : ""}
          {asksQuestion ? (
            <>
              {" "}
              · {withEmail.length} email{withEmail.length > 1 ? "s" : ""} · {sentCount}{" "}
              envoyé{sentCount > 1 ? "s" : ""}
            </>
          ) : (
            <> · aucune question posée à l&apos;inscription</>
          )}
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
        {asksQuestion && (
          <p className="text-muted-foreground mb-3 line-clamp-2 text-xs italic">
            « {first.eventQuestion} »
          </p>
        )}
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
