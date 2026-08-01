// Extracts declarative { toc, content } CSS selectors from the vendored
// WebToEpub parsers so the Node backend can support the same sites.
import fs from "node:fs";
import path from "node:path";

const DIR = "/dev-server/public/webtoepub/plugin/js/parsers";
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".js"));

const classes = new Map(); // className -> { body, extends }
const domains = new Map(); // domain -> className

for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), "utf8");

  for (const m of src.matchAll(
    /parserFactory\.register\(\s*["']([^"']+)["']\s*,\s*\(\)\s*=>\s*new\s+(\w+)\s*\(/g
  )) {
    domains.set(m[1].toLowerCase(), m[2]);
  }

  // split file into class blocks by brace matching
  for (const m of src.matchAll(/class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/g)) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let end = start;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    classes.set(m[1], { body: src.slice(start, end), ext: m[2] || null });
  }
}

/** Grabs a method body by brace matching. */
function method(body, names) {
  for (const name of names) {
    const re = new RegExp(`(?:static\\s+)?(?:async\\s+)?${name}\\s*\\(([^)]*)\\)\\s*\\{`, "g");
    const m = re.exec(body);
    if (!m) continue;
    const start = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = start; i < body.length; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}") {
        depth--;
        if (depth === 0) return body.slice(start + 1, i);
      }
    }
  }
  return "";
}

/** util.getElement(dom, "div", e => e.className === "x") -> div.x */
function utilGetElement(src) {
  const out = [];
  for (const m of src.matchAll(
    /util\.getElement\(\s*\w+\s*,\s*["']([\w-]+)["']\s*(?:,\s*[^)]*?(?:className|id)\s*(?:===?|\.includes\(|\.startsWith\()\s*["']([^"']+)["'])?/g
  )) {
    const tag = m[1];
    const val = m[2];
    if (!val) out.push(tag);
    else if (/className/.test(m[0])) out.push(`${tag}.${val.trim().split(/\s+/).join(".")}`);
    else out.push(`${tag}#${val}`);
  }
  return out;
}

function selectorsFrom(src, all) {
  const out = [];
  const re = all
    ? /querySelectorAll\(\s*["']([^"']+)["']\s*\)/g
    : /querySelector\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of src.matchAll(re)) out.push(m[1]);
  out.push(...utilGetElement(src));
  return out;
}

const BAD = /^(body|html|head|script|style|a|input|form|meta|title|img|iframe)$/i;

function resolve(className, seen = new Set()) {
  if (!className || seen.has(className)) return { toc: [], content: [] };
  seen.add(className);
  const cls = classes.get(className);
  if (!cls) return { toc: [], content: [] };

  const inherited = cls.ext ? resolve(cls.ext, seen) : { toc: [], content: [] };

  // ---- content selectors ----
  let contentSrc = method(cls.body, ["findContent", "findContentElement"]);
  // Some parsers delegate: findContent -> X.findContentElement(dom)
  if (/findContentElement/.test(contentSrc) && !/querySelector/.test(contentSrc)) {
    const owner = /(\w+)\.findContentElement/.exec(contentSrc)?.[1];
    if (owner && owner !== className) {
      contentSrc = method(classes.get(owner)?.body || "", ["findContentElement"]) || contentSrc;
    } else {
      contentSrc = method(cls.body, ["findContentElement"]) || contentSrc;
    }
  }
  const content = selectorsFrom(contentSrc, false).filter((s) => !BAD.test(s));

  // ---- toc selectors ----
  const tocSrc =
    method(cls.body, ["extractPartialChapterList", "getChapterUrls", "getChapterUrlsFromDom"]) || "";
  const toc = [];
  for (const s of selectorsFrom(tocSrc, true)) if (!BAD.test(s)) toc.push(s);
  // util.hyperlinksToChapterList(dom.querySelector("SEL")) -> "SEL a"
  for (const m of tocSrc.matchAll(
    /hyperlinksToChapterList\(\s*(?:\w+\.)?querySelector\(\s*["']([^"']+)["']/g
  )) {
    if (!BAD.test(m[1])) toc.push(`${m[1]} a`);
  }
  for (const s of selectorsFrom(tocSrc, false)) {
    if (!BAD.test(s) && /hyperlinksToChapterList|chapterList|\.map\(/.test(tocSrc)) toc.push(`${s} a`);
  }

  const uniq = (a) => [...new Set(a.map((s) => s.trim()).filter(Boolean))];
  return {
    toc: uniq([...toc, ...inherited.toc]).slice(0, 6),
    content: uniq([...content, ...inherited.content]).slice(0, 6),
  };
}

const out = {};
for (const [domain, className] of domains) {
  const r = resolve(className);
  if (!r.content.length && !r.toc.length) continue;
  out[domain] = { parser: className, ...r };
}

// Domains handled by hand-written backend parsers stay out of the generic table.
const HANDLED = [
  "novelhall.com",
  "freewebnovel.com",
  "novelfire.",
  "novgo.",
  "novelbuddy.com",
  "novelarrow.com",
  "novelfull",
  "novelbin",
  "novlove",
  "wtr-lab.com",
  "wattpad.com",
];
for (const d of Object.keys(out)) {
  if (HANDLED.some((h) => d.includes(h))) delete out[d];
}

fs.writeFileSync(
  "/dev-server/server/src/siteConfigs.json",
  JSON.stringify(out, null, 0) + "\n"
);
console.log("domains registered:", domains.size, "-> emitted:", Object.keys(out).length);
const sample = Object.entries(out).slice(0, 12);
for (const [d, c] of sample) console.log(d, JSON.stringify(c));
