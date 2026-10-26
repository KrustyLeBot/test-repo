// Lancé par GitHub Actions : lit les flux RSS et pousse le résultat dans le KV Cloudflare.
// Les IDs de chaînes viennent d'un secret et ne doivent JAMAIS être écrits dans les logs (repo public).
import { parse } from "../src/parse.js";

const { CHANNELS, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
const FEED_BASE = process.env.FEED_BASE || "https://www.youtube.com/feeds/videos.xml?channel_id=";
const CF_API = process.env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
const SHORTS_BASE = process.env.SHORTS_BASE || "https://www.youtube.com/shorts/";
const MAX_VIDEOS = 200;
const CONCURRENCY = 10;

for (const [k, v] of Object.entries({ CHANNELS, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN })) {
  if (!v) { console.error(`Secret manquant : ${k}`); process.exit(1); }
}

const channels = CHANNELS.split(/[,\s]+/).filter(Boolean);
for (const id of channels) console.log(`::add-mask::${id}`);

const kvUrl = (key) => `${CF_API}/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${key}`;
const auth = { Authorization: `Bearer ${CF_API_TOKEN}` };

async function kvGet(key) {
  const r = await fetch(kvUrl(key), { headers: auth });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`KV get ${key}: HTTP ${r.status}`);
  return r.text();
}
async function kvPut(key, value) {
  const r = await fetch(kvUrl(key), { method: "PUT", headers: auth, body: value });
  if (!r.ok) throw new Error(`KV put ${key}: HTTP ${r.status}`);
}

const store = JSON.parse((await kvGet("byChannel")) || "{}");

// ID -> isShort déjà connu, pour ne tester chaque vidéo qu'une fois
const known = new Map();
for (const vids of Object.values(store)) for (const v of vids) if (typeof v.isShort === "boolean") known.set(v.id, v.isShort);

// Pool simple : exécute fn sur chaque élément, CONCURRENCY à la fois
async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// /shorts/<id> répond 200 pour un Short et redirige (3xx) pour une vidéo normale
async function checkShort(v) {
  try {
    const r = await fetch(SHORTS_BASE + v.id, { redirect: "manual" });
    v.isShort = r.status === 200;
  } catch {
    v.isShort = false;
  }
}

let ok = 0, failed = 0;
await pool(channels, async (id) => {
  try {
    const r = await fetch(FEED_BASE + id);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const vids = parse(await r.text(), id);
    if (!vids.length) throw new Error("vide");
    for (const v of vids) if (!v.isShort && known.has(v.id)) v.isShort = known.get(v.id);
    store[id] = vids;
    ok++;
  } catch {
    failed++; // on garde les anciennes données de cette chaîne
  }
});

const toCheck = Object.values(store).flat().filter((v) => !v.isShort && !known.has(v.id));
await pool(toCheck, checkShort);
console.log(`${toCheck.length} vidéos testées pour les Shorts`);
console.log(`${channels.length} chaînes : ${ok} ok, ${failed} en échec`);

if (ok === 0) { console.error("Aucun flux récupéré, KV non modifié."); process.exit(1); }

for (const k of Object.keys(store)) if (!channels.includes(k)) delete store[k];

const videos = Object.values(store)
  .flat()
  .filter((v) => !v.isShort) // retirer cette ligne pour garder les Shorts
  .sort((a, b) => b.published.localeCompare(a.published))
  .slice(0, MAX_VIDEOS);

await kvPut("byChannel", JSON.stringify(store));
await kvPut("videos", JSON.stringify(videos));
console.log(`${videos.length} vidéos écrites dans le KV`);
