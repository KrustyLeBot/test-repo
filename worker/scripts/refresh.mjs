// Run by GitHub Actions: reads the RSS feeds and pushes the result to the Cloudflare KV.
// Channel IDs come from private config and must NEVER be written to the logs (public repo).
//
// KV keys:
//   videos     latest videos across all channels (no Shorts)
//   channels   channel list sorted by latest upload
//   ch:<id>    one channel's recent videos (Shorts included, flagged isShort)
import { parse } from "../src/parse.js";

const { CHANNELS, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
const FEED_BASE = process.env.FEED_BASE || "https://www.youtube.com/feeds/videos.xml?channel_id=";
const SHORTS_BASE = process.env.SHORTS_BASE || "https://www.youtube.com/shorts/";
const CF_API = process.env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
const MAX_LATEST = 200;
const MAX_PER_CHANNEL = 15;
const CONCURRENCY = 10;

for (const [k, v] of Object.entries({ CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN })) {
  if (!v) { console.error(`Missing secret: ${k}`); process.exit(1); }
}

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

// Simple pool: runs fn on every item, CONCURRENCY at a time
async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// Channel list: KV key "config" (editable in the Cloudflare dashboard), otherwise the CHANNELS secret.
// Accepts, separated by commas / spaces / newlines: IDs (UC...), @handles,
// or channel links (youtube.com/@name, /channel/UC..., /c/name, /user/name).
// A Google Takeout subscriptions.csv can be pasted as is: only the first column (ID) is used.
const entries = ((await kvGet("config")) ?? CHANNELS ?? "")
  .split(/\r?\n/)
  .flatMap((line) => {
    if (/^\s*channel[ _]?id\b/i.test(line)) return []; // CSV header line
    const first = line.split(",")[0].trim();
    if (/^UC[\w-]{22}$/.test(first)) return [first];
    return line.split(/[,\s]+/).filter(Boolean);
  });
if (!entries.length) { console.error("No channels: create the \"config\" KV key or the CHANNELS secret."); process.exit(1); }
for (const e of entries) console.log(`::add-mask::${e}`);

// --- Resolve handles / links to channel IDs (cached in the "resolved" KV key) ---
const YT_BASE = process.env.YT_BASE || "https://www.youtube.com";
const ID_ONLY = /^UC[\w-]{22}$/;

function pageUrl(e) {
  if (/^@/.test(e)) return `${YT_BASE}/${e}`;
  if (/^https?:\/\//.test(e)) return /^https:\/\/((www|m)\.)?youtube\.com\//.test(e) ? e : null;
  return `${YT_BASE}/@${e}`;
}

function extractChannelId(html) {
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /<meta itemprop="(?:channelId|identifier)" content="(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
  ];
  for (const re of patterns) { const m = html.match(re); if (m) return m[1]; }
  return null;
}

const resolvedBefore = JSON.parse((await kvGet("resolved")) || "{}");
const resolved = {};
let unresolved = 0;
await pool(entries, async (e) => {
  if (ID_ONLY.test(e)) { resolved[e] = e; return; }
  const direct = e.match(/\/channel\/(UC[\w-]{22})/);
  if (direct) { resolved[e] = direct[1]; return; }
  if (resolvedBefore[e]) { resolved[e] = resolvedBefore[e]; return; }
  try {
    const url = pageUrl(e);
    if (!url) throw new Error("lien non YouTube");
    const r = await fetch(url, { headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: "SOCS=CAI; CONSENT=YES+1",
    } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const id = extractChannelId(await r.text());
    if (!id) throw new Error("ID introuvable");
    resolved[e] = id;
  } catch {
    unresolved++; // never log the entry: public repo
  }
});
const channels = [...new Set(entries.map((e) => resolved[e]).filter(Boolean))]; // stable order
for (const id of channels) console.log(`::add-mask::${id}`);
console.log(`${entries.length} entries: ${channels.length} channels, ${unresolved} unresolved`);
if (JSON.stringify(entries.filter((e) => resolved[e]).map((e) => [e, resolved[e]])) !== JSON.stringify(Object.entries(resolvedBefore))) await kvPut("resolved", JSON.stringify(Object.fromEntries(entries.filter((e) => resolved[e]).map((e) => [e, resolved[e]]))));

// Current KV state: key -> JSON text (used to rewrite only what changed)
const current = {};
await pool(await kvList("ch:"), async (key) => { current[key] = await kvGet(key); });

const history = {};   // channelId -> videos (old + new)
const names = {};     // channelId -> channel name
const known = new Map(); // videoId -> already known isShort
for (const [key, text] of Object.entries(current)) {
  try {
    const vids = JSON.parse(text);
    history[key.slice(3)] = vids;
    for (const v of vids) if (typeof v.isShort === "boolean") known.set(v.id, v.isShort);
  } catch { /* unreadable key: ignored, will be rewritten */ }
}
try {
  for (const c of JSON.parse((await kvGet("channels")) || "[]")) names[c.id] = c.name;
} catch { /* ignored */ }

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
      byId.set(v.id, { id: v.id, title: v.title, published: v.published, isShort: v.isShort ? true : (old?.isShort ?? known.get(v.id)) }); // undefined = not tested yet
    }
    history[id] = [...byId.values()]
      .sort((a, b) => b.published.localeCompare(a.published))
      .slice(0, MAX_PER_CHANNEL);
    ok++;
  } catch {
    failed++; // keep this channel's existing data
  }
});

// /shorts/<id> answers 200 for a Short and redirects (3xx) for a regular video
const toCheck = channels.flatMap((id) => (history[id] || []).filter((v) => typeof v.isShort !== "boolean"));
await pool(toCheck, async (v) => {
  try {
    const r = await fetch(SHORTS_BASE + v.id, { redirect: "manual" });
    v.isShort = r.status === 200;
  } catch {
    v.isShort = false;
  }
});
console.log(`${toCheck.length} videos checked for Shorts`);
console.log(`${channels.length} channels: ${ok} ok, ${failed} failed`);

if (ok === 0) { console.error("No feed fetched, KV left untouched."); process.exit(1); }

// Derived data
const latest = [];
const channelList = [];
for (const id of channels) {
  const vids = (history[id] || []).filter((v) => !v.isShort);
  if (!vids.length) continue;
  channelList.push({ id, name: names[id] || id, latest: vids[0].published, latestId: vids[0].id, count: vids.length });
  for (const v of vids.slice(0, 30)) latest.push({ ...v, channel: names[id] || id, channelId: id });
}
channelList.sort((a, b) => b.latest.localeCompare(a.latest) || a.id.localeCompare(b.id));
latest.sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id) || a.channelId.localeCompare(b.channelId));

const next = { videos: JSON.stringify(latest.slice(0, MAX_LATEST)), channels: JSON.stringify(channelList) };
for (const id of channels) if (history[id]) next[`ch:${id}`] = JSON.stringify(history[id]);

// Writes: only what changed
const previous = { ...current, videos: await kvGet("videos"), channels: await kvGet("channels") };
const writes = Object.keys(next).filter((k) => previous[k] !== next[k]);
await pool(writes, (k) => kvPut(k, next[k]));

// Cleanup: removed channels, legacy byChannel key
const stale = Object.keys(current).filter((k) => !(k in next));
if ((await kvGet("byChannel")) !== null) stale.push("byChannel");
await pool(stale, kvDelete);

console.log(`${latest.length} videos, ${channelList.length} channels, ${writes.length} writes, ${stale.length} deletions`);
