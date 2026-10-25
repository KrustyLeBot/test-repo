const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export function parse(xml, channelId) {
  const author = decode((xml.match(/<author>\s*<name>([^<]*)<\/name>/) || [])[1] || "");
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map(([, e]) => ({
      id: (e.match(/<yt:videoId>([^<]+)/) || [])[1],
      title: decode((e.match(/<title>([^<]*)/) || [])[1] || ""),
      published: (e.match(/<published>([^<]+)/) || [])[1] || "",
      isShort: /href="[^"]*\/shorts\//.test(e),
      channel: author,
      channelId,
    }))
    .filter((v) => v.id);
}
