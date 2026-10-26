const MANIFEST = {
  id: "perso.ytsubs",
  version: "0.1.0",
  name: "Mes abonnements YouTube",
  description: "Dernières vidéos de mes chaînes",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["yt_"],
  catalogs: [{ type: "movie", id: "yt-subs", name: "Abonnements YouTube" }],
};

const json = (o) =>
  new Response(JSON.stringify(o), {
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });

const toMeta = (v) => ({
  id: `yt_${v.id}`,
  type: "movie",
  name: v.title,
  poster: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
  posterShape: "landscape",
  background: `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`,
  description: `${v.channel} — ${v.published.slice(0, 10)}`,
  releaseInfo: v.published.slice(0, 10),
});

export default {
  async fetch(req, env) {
    if (!env.TOKEN) return new Response("Not found", { status: 404 });
    const prefix = `/${env.TOKEN}`;
    const url = new URL(req.url);
    if (!url.pathname.startsWith(prefix + "/")) return new Response("Not found", { status: 404 });
    const p = decodeURIComponent(url.pathname.slice(prefix.length));

    if (p === "/manifest.json") return json(MANIFEST);

    if (p.startsWith("/catalog/movie/yt-subs")) {
      const videos = JSON.parse((await env.KV.get("videos")) || "[]");
      return json({ metas: videos.map(toMeta) });
    }

    let m = p.match(/^\/meta\/movie\/yt_([\w-]{11})\.json$/);
    if (m) {
      const videos = JSON.parse((await env.KV.get("videos")) || "[]");
      const v = videos.find((x) => x.id === m[1]);
      return json({ meta: v ? toMeta(v) : { id: `yt_${m[1]}`, type: "movie", name: m[1] } });
    }

    m = p.match(/^\/stream\/movie\/yt_([\w-]{11})\.json$/);
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
