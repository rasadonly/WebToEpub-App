const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const html = fs.readFileSync('/tmp/fwn_proxy.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;
console.log("Title:", doc.title);
const chapterLinks = Array.from(doc.querySelectorAll('a')).filter(a => a.textContent.toLowerCase().includes('chapter'));
console.log("Found links with 'chapter':", chapterLinks.length);
if (chapterLinks.length > 0) {
  console.log("First 5:", chapterLinks.slice(0, 5).map(a => a.className + ' | ' + a.href));
  const parentClass = chapterLinks[0].parentElement.className;
  console.log("Parent class of first link:", parentClass);
  const grandparentClass = chapterLinks[0].parentElement.parentElement.className;
  console.log("Grandparent class:", grandparentClass);
}
const allDivs = Array.from(doc.querySelectorAll('div'));
console.log("Classes of divs containing chapter lists:");
for (const div of allDivs) {
  if (div.querySelectorAll('a').length > 20) {
    console.log(div.className);
  }
}
const pagination = doc.querySelector('.pagination, .nav-links, .page-nav');
if (pagination) console.log("Found pagination block class:", pagination.className);
