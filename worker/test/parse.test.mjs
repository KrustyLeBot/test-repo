// Usage: node worker/test/parse.test.mjs            (sample feed)
//         node worker/test/parse.test.mjs <channel_id> (real YouTube feed)
import { readFileSync } from "node:fs";
import { parse } from "../src/parse.js";

const id = process.argv[2];
const xml = id
  ? await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`)).text()
  : readFileSync(new URL("./sample.xml", import.meta.url), "utf8");
const t = performance.now();
const vids = parse(xml, id || "sample");
console.log(`${vids.length} videos, parsed in ${(performance.now() - t).toFixed(2)} ms`);
console.log(vids);
console.log("Shorts detected:", vids.filter((v) => v.isShort).length);
