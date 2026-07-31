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
