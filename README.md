# Addon Nuvio « Mes abonnements YouTube »

Affiche dans Nuvio (Stremio-compatible) les dernières vidéos de mes chaînes YouTube : pas de recommandations, pas de serveur à héberger, liste des abonnements privée.

## Fonctionnement

```
GitHub Action (toutes les 10 min)          Cloudflare Worker (gratuit)            Nuvio
  lit les flux RSS des chaînes      ──►   lit le KV et sert l'addon     ◄──   /<TOKEN>/manifest.json
  filtre les Shorts                       (catalogue, meta, stream ytId)
  écrit le résultat dans le KV
```

- `worker/src/index.js` : le Worker. Lecture seule du KV, 404 si le token de l'URL est faux.
- `worker/src/parse.js` : parsing des flux RSS YouTube.
- `worker/scripts/refresh.mjs` : script lancé par l'Action (flux RSS, détection des Shorts, écriture dans le KV).
- `.github/workflows/refresh.yml` : planification de l'Action.
- `worker/test/` : test du parsing (`node worker/test/parse.test.mjs`).

Deux catalogues :
- **Dernières vidéos** (type `movie`) : les 200 dernières vidéos, toutes chaînes confondues.
- **Chaînes** (type `series`) : une « série » par chaîne, triée par dernière publication. Les « épisodes » sont les vidéos de la chaîne : une seule saison, l'épisode 1 est la vidéo la plus récente (la vraie date de publication reste dans `released`).

IDs : `yt_<videoId>` pour une vidéo, `ytch_<channelId>` pour une chaîne. Streams renvoyés : `ytId` (lecture dans Nuvio) et `externalUrl` (YouTube / NewPipe).

Chaque chaîne garde ses 15 dernières vidéos (ce que donne le flux RSS), Shorts compris avant filtrage.

Clés KV : `videos`, `channels`, `ch:<id>`. L'Action n'écrit que les clés qui ont changé (limite gratuite : 1 000 écritures/jour).

## Confidentialité

Le repo est public, donc rien de personnel ne doit y figurer :

| Donnée | Où elle est |
|---|---|
| Liste des chaînes (`CHANNELS`) | secret GitHub Actions |
| Accès au KV (`CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`, `CF_API_TOKEN`) | secrets GitHub Actions |
| Token de l'URL de l'addon (`TOKEN`) | secret du Worker Cloudflare |
| Vidéos récupérées | KV Cloudflare (privé) |

Les handles et liens sont aussi dans le secret `CHANNELS`. Les logs de l'Action sont publics : le script n'y écrit que des totaux et masque les IDs de chaînes. N'y ajoute jamais de `console.log` d'ID ou de titre.

## Installation

### 1. Cloudflare
1. Créer un compte sur dash.cloudflare.com (plan Free).
2. Workers & Pages → Create → Import a repository → ce repo.
3. Project name `yt-subs-addon`, branche `main`, Root directory `worker`, puis Save and Deploy.
4. Worker → Settings → Variables and Secrets → ajouter un **Secret** `TOKEN` (24 lettres/chiffres aléatoires, à noter).
5. Vérifier dans Settings → Bindings que `KV` est lié à un namespace (sinon : le créer dans Storage & Databases → KV puis l'ajouter en binding `KV`).

### 2. GitHub
Settings → Secrets and variables → Actions → New repository secret :

| Nom | Valeur |
|---|---|
| `CHANNELS` | chaînes séparées par des virgules ou des retours à la ligne : `@handle`, lien de chaîne (`https://www.youtube.com/@nom`) ou ID `UC...`. Les handles et liens sont convertis en ID par l'Action (résultat mis en cache dans le KV) |
| `CF_ACCOUNT_ID` | Workers & Pages, colonne de droite |
| `CF_KV_NAMESPACE_ID` | Storage & Databases → KV → ID du namespace |
| `CF_API_TOKEN` | My Profile → API Tokens → Custom Token, permission *Account → Workers KV Storage → Edit* |

### 3. Premier remplissage
Onglet Actions → *Refresh YouTube feeds* → Run workflow. Le log doit afficher `N chaînes : N ok, 0 en échec` puis `N vidéos écrites dans le KV`.

### 4. Nuvio
Installer `https://yt-subs-addon.<compte>.workers.dev/<TOKEN>/manifest.json`.

## Gérer les chaînes

Modifier le secret `CHANNELS` dans GitHub (Settings → Secrets and variables → Actions), puis relancer le workflow à la main ou attendre 10 min. Une chaîne retirée disparaît du catalogue au passage suivant.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| `Secret manquant : XXX` | secret absent ou mal nommé |
| `HTTP 401/403` sur le KV | token Cloudflare faux ou sans permission *Workers KV Storage: Edit* |
| `N non résolues` | handle ou lien introuvable (faute de frappe) ou page YouTube bloquée depuis GitHub : utiliser l'ID `UC...` à la place |
| `0 ok` | YouTube refuse les requêtes depuis GitHub |
| « Not found » dans le navigateur | token de l'URL différent du secret `TOKEN` |
| Les Shorts apparaissent | YouTube bloque le test `/shorts/<id>` depuis GitHub |
| Plus de mise à jour | GitHub désactive les workflows planifiés après 60 jours sans activité sur le repo : les réactiver dans l'onglet Actions |

## Renommer le repo

GitHub redirige l'ancien nom. Si le déploiement Cloudflare ne se déclenche plus après un renommage, reconnecter le repo dans Worker → Settings → Build. Les secrets GitHub restent en place. Le nom du Worker (`wrangler.toml`) fixe l'URL `workers.dev` : ne pas le changer sans réinstaller l'addon.

## Fichiers du test initial

`manifest.json`, `catalog/`, `meta/`, `stream/` à la racine et `.nojekyll` sont l'addon statique qui a servi à valider la lecture `ytId` dans Nuvio via GitHub Pages. Ils ne servent plus et peuvent être supprimés, une fois Pages désactivé.
