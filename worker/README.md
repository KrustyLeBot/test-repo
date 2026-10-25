# Addon Nuvio « Mes abonnements YouTube »

Cloudflare Worker + KV + Cron. Secrets à définir dans le dashboard Cloudflare :
- `TOKEN` : chaîne aléatoire (lettres/chiffres), préfixe de l'URL de l'addon.
- `CHANNELS` : IDs de chaînes (`UC...`) séparés par des virgules.

URL à installer : `https://yt-subs-addon.<compte>.workers.dev/<TOKEN>/manifest.json`

Test du parsing : `node worker/test/parse.test.mjs`
