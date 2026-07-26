const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({headless: "new"});
  const page = await browser.newPage();
  await page.goto('https://freewebnovel.com/novel/against-the-gods', {waitUntil: 'networkidle2'});
  const html = await page.content();
  const fs = require('fs');
  fs.writeFileSync('fwn.html', html);
  console.log('done');
  await browser.close();
})();
