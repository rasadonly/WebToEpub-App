const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const html = fs.readFileSync('fwn.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

console.log("Total chapters in #idData li > a:", doc.querySelectorAll('#idData li > a').length);
console.log("Total chapters in .m-newest2 a:", doc.querySelectorAll('.m-newest2 a').length);
console.log("Total chapters in .chapter-list a:", doc.querySelectorAll('.chapter-list a').length);
const pages = doc.querySelectorAll('.page-link'); // or pagination
console.log("Pagination links:");
doc.querySelectorAll('a').forEach(a => {
  if (a.textContent.includes('Next') || a.textContent.includes('Last') || /^\d+$/.test(a.textContent.trim())) {
    console.log(a.textContent.trim(), a.href);
  }
});
