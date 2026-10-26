const MANIFEST = {
  id: "perso.ytsubs",
  version: "0.2.0",
  name: "Mes abonnements YouTube",
  description: "Dernières vidéos de mes chaînes",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["yt_", "ytch_"],
  catalogs: [
    { type: "movie", id: "yt-subs", name: "Dernières vidéos" },
    { type: "series", id: "yt-channels", name: "Chaînes" },
  ],
};

const json = (o) =>
  new Response(JSON.stringify(o), {
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

const videoMeta = (v) => ({
  id: `yt_${v.id}`,
  type: "movie",
  name: v.title,
  poster: thumb(v.id),
  posterShape: "landscape",
  background: `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`,
  description: `${v.channel} — ${v.published.slice(0, 10)}`,
  releaseInfo: v.published.slice(0, 10),
});

const channelMeta = (c) => ({
  id: `ytch_${c.id}`,
  type: "series",
  name: c.name,
  poster: thumb(c.latestId),
  posterShape: "landscape",
  background: `https://i.ytimg.com/vi/${c.latestId}/maxresdefault.jpg`,
  description: `${c.count} vidéos — dernière : ${c.latest.slice(0, 10)}`,
  releaseInfo: c.latest.slice(0, 10),
});

// Saison = année de publication, épisode = rang dans l'année (du plus ancien au plus récent)
function episodes(vids) {
  const asc = [...vids].sort((a, b) => a.published.localeCompare(b.published));
  const perYear = {};
  return asc.map((v) => {
    const season = Number(v.published.slice(0, 4));
    perYear[season] = (perYear[season] || 0) + 1;
    return {
      id: `yt_${v.id}`,
      title: v.title,
      released: v.published,
      season,
      episode: perYear[season],
      thumbnail: thumb(v.id),
    };
  });
}

export default {
  async fetch(req, env) {
    if (!env.TOKEN) return new Response("Not found", { status: 404 });
    const prefix = `/${env.TOKEN}`;
    const url = new URL(req.url);
    if (!url.pathname.startsWith(prefix + "/")) return new Response("Not found", { status: 404 });
    const p = decodeURIComponent(url.pathname.slice(prefix.length));
    const get = async (key) => (await env.KV.get(key, "json")) || [];

    if (p === "/manifest.json") return json(MANIFEST);

    if (p.startsWith("/catalog/movie/yt-subs")) {
      return json({ metas: (await get("videos")).map(videoMeta) });
    }

    if (p.startsWith("/catalog/series/yt-channels")) {
      return json({ metas: (await get("channels")).map(channelMeta) });
    }

    let m = p.match(/^\/meta\/movie\/yt_([\w-]{11})\.json$/);
    if (m) {
      const v = (await get("videos")).find((x) => x.id === m[1]);
      return json({ meta: v ? videoMeta(v) : { id: `yt_${m[1]}`, type: "movie", name: m[1] } });
    }

    m = p.match(/^\/meta\/series\/ytch_([\w-]+)\.json$/);
    if (m) {
      const c = (await get("channels")).find((x) => x.id === m[1]);
      if (!c) return json({ meta: { id: `ytch_${m[1]}`, type: "series", name: m[1], videos: [] } });
      const vids = (await get(`ch:${m[1]}`)).filter((v) => !v.isShort);
      return json({ meta: { ...channelMeta(c), videos: episodes(vids) } });
    }

    m = p.match(/^\/stream\/(?:movie|series)\/yt_([\w-]{11})\.json$/);
    if (m) {
      return json({
        streams: [
          { title: "YouTube", ytId: m[1] },
          { title: "Ouvrir dans YouTube", externalUrl: `https://www.youtube.com/watch?v=${m[1]}` },
        ],
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
