const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const html = fs.readFileSync('/tmp/fwn_proxy.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

console.log("Total chapters in #idData li > a:", doc.querySelectorAll('#idData li > a').length);
console.log("Total chapters in .m-newest2 a:", doc.querySelectorAll('.m-newest2 a').length);
console.log("Total chapters in .chapter-list a:", doc.querySelectorAll('.chapter-list a').length);

const paginationLinks = Array.from(doc.querySelectorAll('a')).map(a => a.href).filter(href => href.includes('page=') || href.includes('indexselect'));
console.log("Pagination links:");
console.log(paginationLinks.slice(0, 5));

const options = doc.querySelectorAll('#indexselect option');
console.log("#indexselect options count:", options.length);

const scriptTags = Array.from(doc.querySelectorAll('script')).map(s => s.innerHTML);
for(const s of scriptTags) {
  if(s.includes('totalPage') || s.includes('chapterPagination')) {
    console.log("Found pagination in script:");
    console.log(s.substring(0, 200));
  }
}
