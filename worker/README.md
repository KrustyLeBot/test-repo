# Addon Nuvio « Mes abonnements YouTube »

Cloudflare Worker (lecture seule du KV) + GitHub Action (`.github/workflows/refresh.yml`) qui met à jour le KV toutes les 10 min.
- `TOKEN` : chaîne aléatoire (lettres/chiffres), préfixe de l'URL de l'addon.

URL à installer : `https://yt-subs-addon.<compte>.workers.dev/<TOKEN>/manifest.json`

Test du parsing : `node worker/test/parse.test.mjs`

Secrets GitHub Actions (jamais dans le code) : `CHANNELS`, `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`, `CF_API_TOKEN`.
