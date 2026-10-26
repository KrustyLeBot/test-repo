// Lancé par GitHub Actions : lit les flux RSS et pousse le résultat dans le KV Cloudflare.
// Les IDs de chaînes viennent d'un secret et ne doivent JAMAIS être écrits dans les logs (repo public).
//
// Clés KV :
//   videos     dernières vidéos toutes chaînes confondues (sans Shorts)
//   channels   liste des chaînes triée par dernière publication
//   ch:<id>    historique d'une chaîne (Shorts inclus, marqués isShort)
import { parse } from "../src/parse.js";

const { CHANNELS, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
const FEED_BASE = process.env.FEED_BASE || "https://www.youtube.com/feeds/videos.xml?channel_id=";
const SHORTS_BASE = process.env.SHORTS_BASE || "https://www.youtube.com/shorts/";
const CF_API = process.env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
const MAX_LATEST = 200;
const MAX_PER_CHANNEL = 15;
const CONCURRENCY = 10;

for (const [k, v] of Object.entries({ CHANNELS, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN })) {
  if (!v) { console.error(`Secret manquant : ${k}`); process.exit(1); }
}

const channels = CHANNELS.split(/[,\s]+/).filter(Boolean);
for (const id of channels) console.log(`::add-mask::${id}`);

const kvBase = `${CF_API}/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}`;
const auth = { Authorization: `Bearer ${CF_API_TOKEN}` };
const valueUrl = (key) => `${kvBase}/values/${encodeURIComponent(key)}`;

async function kvGet(key) {
  const r = await fetch(valueUrl(key), { headers: auth });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`KV get: HTTP ${r.status}`);
  return r.text();
}
async function kvPut(key, value) {
  const r = await fetch(valueUrl(key), { method: "PUT", headers: auth, body: value });
  if (!r.ok) throw new Error(`KV put: HTTP ${r.status}`);
}
async function kvDelete(key) {
  const r = await fetch(valueUrl(key), { method: "DELETE", headers: auth });
  if (!r.ok && r.status !== 404) throw new Error(`KV delete: HTTP ${r.status}`);
}
async function kvList(prefix) {
  const names = [];
  let cursor = "";
  do {
    const r = await fetch(`${kvBase}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${cursor}` : ""}`, { headers: auth });
    if (!r.ok) throw new Error(`KV list: HTTP ${r.status}`);
    const j = await r.json();
    names.push(...j.result.map((k) => k.name));
    cursor = j.result_info?.cursor || "";
  } while (cursor);
  return names;
}

// Pool simple : exécute fn sur chaque élément, CONCURRENCY à la fois
async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// État actuel du KV : clé -> texte JSON (sert à ne réécrire que ce qui change)
const current = {};
await pool(await kvList("ch:"), async (key) => { current[key] = await kvGet(key); });

const history = {};   // channelId -> vidéos (anciennes + nouvelles)
const names = {};     // channelId -> nom de la chaîne
const known = new Map(); // videoId -> isShort déjà connu
for (const [key, text] of Object.entries(current)) {
  try {
    const vids = JSON.parse(text);
    history[key.slice(3)] = vids;
    for (const v of vids) if (typeof v.isShort === "boolean") known.set(v.id, v.isShort);
  } catch { /* clé illisible : ignorée, sera réécrite */ }
}
try {
  for (const c of JSON.parse((await kvGet("channels")) || "[]")) names[c.id] = c.name;
} catch { /* ignoré */ }

let ok = 0, failed = 0;
await pool(channels, async (id) => {
  try {
    const r = await fetch(FEED_BASE + id);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const fresh = parse(await r.text(), id);
    if (!fresh.length) throw new Error("vide");
    names[id] = fresh[0].channel || names[id] || id;
    const byId = new Map((history[id] || []).map((v) => [v.id, v]));
    for (const v of fresh) {
      const old = byId.get(v.id);
      byId.set(v.id, { id: v.id, title: v.title, published: v.published, isShort: v.isShort ? true : (old?.isShort ?? known.get(v.id)) }); // undefined = pas encore testée
    }
    history[id] = [...byId.values()]
      .sort((a, b) => b.published.localeCompare(a.published))
      .slice(0, MAX_PER_CHANNEL);
    ok++;
  } catch {
    failed++; // on garde l'historique existant de cette chaîne
  }
});

// /shorts/<id> répond 200 pour un Short et redirige (3xx) pour une vidéo normale
const toCheck = channels.flatMap((id) => (history[id] || []).filter((v) => typeof v.isShort !== "boolean"));
await pool(toCheck, async (v) => {
  try {
    const r = await fetch(SHORTS_BASE + v.id, { redirect: "manual" });
    v.isShort = r.status === 200;
  } catch {
    v.isShort = false;
  }
});
console.log(`${toCheck.length} vidéos testées pour les Shorts`);
console.log(`${channels.length} chaînes : ${ok} ok, ${failed} en échec`);

if (ok === 0) { console.error("Aucun flux récupéré, KV non modifié."); process.exit(1); }

// Données dérivées
const latest = [];
const channelList = [];
for (const id of channels) {
  const vids = (history[id] || []).filter((v) => !v.isShort);
  if (!vids.length) continue;
  channelList.push({ id, name: names[id] || id, latest: vids[0].published, latestId: vids[0].id, count: vids.length });
  for (const v of vids.slice(0, 30)) latest.push({ ...v, channel: names[id] || id, channelId: id });
}
channelList.sort((a, b) => b.latest.localeCompare(a.latest));
latest.sort((a, b) => b.published.localeCompare(a.published));

const next = { videos: JSON.stringify(latest.slice(0, MAX_LATEST)), channels: JSON.stringify(channelList) };
for (const id of channels) if (history[id]) next[`ch:${id}`] = JSON.stringify(history[id]);

// Écritures : seulement ce qui a changé
const previous = { ...current, videos: await kvGet("videos"), channels: await kvGet("channels") };
const writes = Object.keys(next).filter((k) => previous[k] !== next[k]);
await pool(writes, (k) => kvPut(k, next[k]));

// Nettoyage : chaînes retirées, ancienne clé byChannel
const stale = Object.keys(current).filter((k) => !(k in next));
if ((await kvGet("byChannel")) !== null) stale.push("byChannel");
await pool(stale, kvDelete);

console.log(`${latest.length} vidéos, ${channelList.length} chaînes, ${writes.length} écritures, ${stale.length} suppressions`);
