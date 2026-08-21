# cs-mudash — dashboard Meetup

Suivi quotidien du nombre de membres et des inscriptions aux événements du groupe
Meetup, avec un relevé automatique par GitHub Actions et un dashboard qui tourne
en local.

## Comment ça marche

```
GitHub Actions (06:00 UTC)  →  scripts/fetch-meetup.ts  →  data/history.ndjson  →  git commit
                                                                    ↓
                                                    dashboard local (npm run dev)
```

Le relevé tourne sur les serveurs GitHub, donc **indépendamment de ton ordinateur**.
Il commite une ligne par jour dans `data/history.ndjson`. En local, un `git pull`
suffit pour voir les chiffres du jour.

## Démarrage

```bash
npm install
npm run fetch     # premier relevé
npm run dev       # dashboard sur http://localhost:3000
```

Pour voir le dashboard peuplé sans attendre un mois d'historique :

```bash
npm run seed:demo   # génère 45 jours FICTIFS dans data/history.demo.ndjson
npm run dev:demo    # les affiche, avec un bandeau d'avertissement
```

Les données de démo ne sont jamais mélangées aux vraies ni versionnées.

## Scripts

| Commande | Effet |
|---|---|
| `npm run fetch` | Relève les chiffres et ajoute une ligne à `data/history.ndjson` |
| `npm run fetch:dry` | Affiche le relevé sans rien écrire |
| `npm run fetch:attendees` | Relève les participants et leurs emails (local, manuel) |
| `npm run dev` | Dashboard en local |
| `npm run seed:demo` / `npm run dev:demo` | Historique de démonstration |

Relancer `npm run fetch` le même jour **remplace** la ligne du jour au lieu d'en
ajouter une : l'opération est idempotente.

## Configuration

Le groupe est lu depuis la variable d'environnement `MEETUP_GROUP` (son slug
d'URL). Par défaut : `coder-comprendre-lia-grands-debutants-paris`.

Pour la changer côté GitHub Actions : *Settings → Secrets and variables → Actions
→ Variables* → nouvelle variable `MEETUP_GROUP`.

## Le relevé automatique

`.github/workflows/daily-fetch.yml` tourne tous les jours à 06:00 UTC et se
déclenche aussi à la main depuis l'onglet **Actions** (bouton *Run workflow*).

Trois choses à savoir :

- **L'heure n'est pas garantie.** Le `schedule:` de GitHub est en UTC et
  « au mieux » : retards de 5 à 30 min fréquents, exécution occasionnellement
  sautée. Sans conséquence, le snapshot étant daté du jour.
- **Coût.** Dépôt privé : ~1 min/jour sur les 2 000 min/mois du forfait gratuit.
  Dépôt public : illimité.
- **Le workflow doit pouvoir pousser.** *Settings → Actions → General → Workflow
  permissions* doit être sur **Read and write permissions**.

## D'où viennent les chiffres

Meetup n'expose plus d'API REST publique. Les pages du site sont rendues par
Next.js et embarquent leur cache Apollo complet dans
`<script id="__NEXT_DATA__">` — on y lit des valeurs structurées plutôt que du
texte scrapé, ce qui est nettement plus stable.

Trois pages par relevé :

| Page | Donnée |
|---|---|
| `/<groupe>/` | `stats.memberCounts.all` |
| `/<groupe>/events/` | Événements à venir + `going.totalCount` |
| `/<groupe>/events/?type=past` | Événements passés (10 plus récents) |

**Si Meetup change la structure de ses pages, le relevé échoue bruyamment** — le
workflow passe au rouge et GitHub envoie un mail. Il n'écrit jamais de données
silencieusement fausses. La réparation est localisée dans
`scripts/fetch-meetup.ts`.

Meetup ne renvoyant que les 10 événements passés les plus récents, l'historique
NDJSON sert de mémoire longue : les événements plus anciens restent connus du
dashboard parce qu'un relevé précédent les avait capturés.

Le relevé tourne depuis une IP datacenter GitHub, plus exposée au blocage que
ton IP personnelle. Si ça arrive un jour, le repli est `npm run fetch` en local.

## Les emails des participants

À l'inscription, chaque événement peut poser une question — ici : laisser son
email et dire ce qui amène le participant, pour recevoir le support. Ces réponses
ne sont **pas publiques** : seul l'organisateur connecté voit la page
`/events/<id>/attendees/`. D'où un relevé séparé, **manuel et local**.

### Mise en route

1. Dans ton navigateur, connecté à Meetup, ouvre la page participants d'un
   événement.
2. **F12 → Network → Ctrl+R**, clique la première requête (le document
   `attendees/`), section **Request Headers**, ligne `cookie:` → **Copy value**.
3. Colle dans `.env.local` à la racine :

   ```
   MEETUP_COOKIE="…"
   ```

   Un « Copy as cURL » collé tel quel fonctionne aussi : le script en extrait le
   cookie. Attention, un cookie isolé ne suffit pas — il faut l'en-tête complet
   (une trentaine de paires).

4. `npm run fetch:attendees`

Le relevé couvre **les événements à venir** du dernier snapshot de
`data/history.ndjson`, et charge les pages dans un Chromium headless : les
réponses arrivent en GraphQL après l'hydratation, un simple `fetch` du HTML les
manquerait.

| Option | Effet |
|---|---|
| `-- --event 315692119` | Un seul événement, **passé compris** (le relevé par défaut se limite aux événements à venir) |
| `-- --dump` | Garde les réponses brutes dans `.meetup-dump/` |
| `-- --from-dump` | Rejoue le parsing sur ces captures, sans réseau |

Quand le cookie expire, Meetup renvoie vers `/login` et le script s'arrête en le
disant. Il n'écrit jamais un relevé vide en croyant avoir réussi.

Deux pièges de la page participants, traités par le script :

- **La liste se charge par 10, au scroll**, sans bouton « voir plus », et le DOM
  est virtualisé — le nombre de cartes affichées redescend en cours de route. Le
  script descend donc jusqu'à ce que le nombre de participants *extraits des
  réponses GraphQL* cesse d'augmenter. Un relevé qui reste sous le `going` du
  dernier relevé quotidien est signalé en fin de ligne : c'est le symptôme d'une
  pagination qui a changé.
- **Le bandeau de consentement** se met en travers du scroll : il est refusé et
  retiré avant de dérouler la liste.

Côté cookie, un `__Host-…` (Meetup en pose un pour son jeton CSRF) doit être
posé sans domaine, sinon Chrome rejette **tout le lot** avec un laconique
`Invalid cookie fields`. Les cookies tiers dont Chrome refuse la valeur sont
ignorés un par un plutôt que de faire échouer le relevé.

### Ce qui est affiché

Le dashboard ajoute une section **Emails des participants**, hors du filtre de
plage temporelle — une adresse email ne se périme pas au bout de 7 jours. Par
événement : la question posée, le tableau nom / email / réponse, un bouton
« Copier les N emails » (séparés par `, `, prêts à coller dans un champ
destinataires) et une case **Envoyé** par participant pour suivre les envois de
matériel.

Un événement sans question configurée se réduit à une ligne — « aucune question
posée à l'inscription, donc aucun email à collecter » — sans tableau de
participants : il n'y a rien à y collecter, et la liste des pseudos n'aurait
pas sa place dans une section dédiée aux emails. La ligne reste affichée pour
que son absence ne passe pas pour un oubli de relevé.

**Ce relevé-ci est manuel, l'historique est quotidien** : les deux divergent dès
qu'une inscription arrive après la dernière capture. Chaque événement affiche
donc « N participants relevés sur M inscrits », M venant du dernier snapshot de
`history.ndjson`, et un bandeau réclame un nouveau relevé quand il en manque.
Un événement à venir dont aucun participant n'a jamais été relevé apparaît
quand même, plutôt que de disparaître silencieusement.

### Confidentialité

Ces données sont des **données personnelles de tiers** et ne quittent pas ta
machine. Sont gitignorés, donc jamais commités ni poussés :

| Chemin | Contenu |
|---|---|
| `data/attendees.ndjson` | Noms, emails, réponses |
| `data/attendees-sent.json` | Suivi des envois |
| `.meetup-dump/` | Captures brutes (`--dump`) |
| `.env.local` | Le cookie de session |

Le workflow GitHub Actions quotidien n'y touche pas — il ne commite que
`history.ndjson`. Sur un déploiement distant, les fichiers étant absents, la
section disparaît d'elle-même. Le mode démo ne les charge pas non plus : pas de
vrais emails dans une capture d'écran.

## Données

`data/history.ndjson`, une ligne JSON par jour :

```json
{
  "date": "2026-07-31",
  "fetchedAt": "2026-07-31T09:07:12.345Z",
  "group": { "id": "38583339", "urlname": "…", "name": "…", "memberCount": 81 },
  "events": [
    { "id": "315794314", "title": "…", "dateTime": "2026-08-04T19:00:00+02:00",
      "status": "ACTIVE", "going": 10, "maxTickets": 20, "isOnline": true, "eventUrl": "…" }
  ]
}
```

Format append-only : les diffs git restent minuscules et l'historique complet est
versionné, donc rien n'est jamais perdu.

`data/attendees.ndjson`, une ligne par participant et par événement — **local,
gitignoré** :

```json
{
  "eventId": "315692119", "eventTitle": "…", "eventDateTime": "2026-08-06T19:00:00+02:00",
  "eventQuestion": "Pour recevoir le lien du support…",
  "memberId": "430924712", "name": "…",
  "answers": ["prenom.nom@example.com"],
  "email": "prenom.nom@example.com", "extraEmails": [],
  "capturedAt": "2026-08-02T10:08:44.123Z"
}
```

Clé `(eventId, memberId)` : un relevé remplace les participants des événements
qu'il couvre et laisse les autres intacts, donc réexécutable sans doublon.
