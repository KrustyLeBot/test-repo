// Usage : node worker/test/parse.test.mjs            (flux d'exemple)
//         node worker/test/parse.test.mjs <channel_id> (vrai flux YouTube)
import { readFileSync } from "node:fs";
import { parse } from "../src/parse.js";

const id = process.argv[2];
const xml = id
  ? await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`)).text()
  : readFileSync(new URL("./sample.xml", import.meta.url), "utf8");
const t = performance.now();
const vids = parse(xml, id || "sample");
console.log(`${vids.length} vidéos, parse en ${(performance.now() - t).toFixed(2)} ms`);
console.log(vids);
console.log("shorts détectés :", vids.filter((v) => v.isShort).length);
