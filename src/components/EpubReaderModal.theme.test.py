import asyncio, zipfile, json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path('/tmp/browser/epub-theme')
with zipfile.ZipFile(ROOT/'theme.epub','w') as z:
 z.writestr('mimetype','application/epub+zip')
 z.writestr('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
 z.writestr('book.opf','''<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">theme-test</dc:identifier><dc:title>Reader theme regression</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-21T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>''')
 z.writestr('nav.xhtml','''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Chapter One</a></li><li><a href="two.xhtml">Chapter Two</a></li></ol></nav></body></html>''')
 for chapter in ['one','two']:
  z.writestr(chapter+'.xhtml',f'''<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter {chapter}</title><style>p {{ color: #111 !important; background: white !important; }}</style></head><body><h1>Chapter {chapter}</h1><p id="plain">A readable chapter with ordinary text.</p><p id="inline" style="color: white !important; background-color: white !important"><span style="color: white !important">Embedded text must remain readable.</span></p><a href="#plain">Chapter link</a></body></html>''')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  page=await browser.new_page(viewport={'width':1280,'height':1800})
  await page.goto('http://localhost:8080')
  await page.evaluate("window.dispatchEvent(new CustomEvent('open-modal', {detail: 'epub-reader'}))")
  await page.get_by_role("button",name="Choose EPUB file",exact=False).last.wait_for()
  await page.locator('input[type=file][accept=".epub,application/epub+zip"]').last.set_input_files(str(ROOT/'theme.epub'))
  frame=page.frame_locator('iframe').last
  await frame.locator('#plain').wait_for()
  reader=page.locator(".epub-reader-viewer").last.locator("xpath=ancestor::div[contains(@class, 'fixed')][1]")
  for theme in ['Light','Sepia','Dark','Light']:
   await reader.locator('button[title="'+theme+'"]').last.click()
   await page.wait_for_timeout(250)
   colors=await frame.locator('body').evaluate('''body => { const s = getComputedStyle(body); return {bg:s.backgroundColor,text:s.color,heading:getComputedStyle(body.querySelector('h1')).color,inline:getComputedStyle(body.querySelector('#inline span')).color,paragraph:getComputedStyle(body.querySelector('#plain')).color}; }''')
   def luminance(value):
    import re
    channels=[int(v)/255 for v in re.findall(r'\d+', value)[:3]]
    channels=[v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4 for v in channels]
    return sum(v*w for v,w in zip(channels,[0.2126,0.7152,0.0722]))
   bg=luminance(colors['bg'])
   for key in ['text','heading','inline','paragraph']:
    fg=luminance(colors[key])
    assert (max(bg,fg)+0.05)/(min(bg,fg)+0.05)>=4.5, f'{theme}: {key} must be readable'
   await frame.locator('body').screenshot(path=str(ROOT/(theme.lower()+'.png')))
   print('PASS',theme,json.dumps(colors))
  await reader.locator('button[title="Sepia"]').click()
  await reader.locator('button[title="Contents"]').click()
  await reader.get_by_role('button',name='Chapter Two',exact=True).click()
  await page.wait_for_timeout(700)
  new_chapter=page.frame_locator('iframe').last
  await new_chapter.locator('#plain').wait_for()
  assert await new_chapter.locator('h1').inner_text()=='Chapter two'
  assert await new_chapter.locator('body').evaluate("b => getComputedStyle(b).backgroundColor")=='rgb(244, 236, 215)', 'New chapters must use the selected theme'
  await new_chapter.locator('body').screenshot(path=str(ROOT/'new-chapter.png'))
  print('PASS: newly loaded chapter keeps the current theme')
  await browser.close()
asyncio.run(main())
