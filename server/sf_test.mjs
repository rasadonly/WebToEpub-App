import { fetchChapterLinks, fetchChapterContent } from "./src/fetcher.js";
const t = Date.now();
const ch = await fetchChapterLinks("https://shanghaifantasy.com/novel/apocalyptic-natural-disasters/");
console.log("RESULT chapters", ch.length, ((Date.now() - t) / 1000) + "s", JSON.stringify(ch[0]).slice(0, 160), JSON.stringify(ch.at(-1)).slice(0, 160));
const c = await fetchChapterContent(ch[0].url ?? ch[0]);
const txt = String(c?.content ?? c?.html ?? c).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
console.log("RESULT ch1 chars", txt.length);
process.exit(0);
