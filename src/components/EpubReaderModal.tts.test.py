# Regression: closing the EPUB reader must stop read-aloud (close button and Escape).
# Run: python3 src/components/EpubReaderModal.tts.test.py  (dev server on :8080)
import asyncio, zipfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path('/tmp/browser/epub-tts'); ROOT.mkdir(parents=True, exist_ok=True)
EPUB = ROOT / 'tts.epub'
with zipfile.ZipFile(EPUB, 'w') as z:
    z.writestr('mimetype', 'application/epub+zip')
    z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    z.writestr('book.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">tts-test</dc:identifier><dc:title>TTS close</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-22T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>')
    z.writestr('nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>C</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">One</a></li></ol></nav></body></html>')
    z.writestr('one.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body>' + ''.join(f'<p>Paragraph {i} has a sentence to read aloud for testing purposes.</p>' for i in range(20)) + '</body></html>')

# Fake speech engine: utterances "speak" until cancel() is called.
MOCK = """
(() => {
  const s = { speaking: false, paused: false, spoken: 0,
    speak(u) { this.speaking = true; this.spoken++; },
    cancel() { this.speaking = false; this.paused = false; },
    pause() { this.paused = true; }, resume() { this.paused = false; },
    getVoices() { return []; }, onvoiceschanged: null };
  Object.defineProperty(window, 'speechSynthesis', { value: s, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
})();
"""

async def run(close_with):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1280, 'height': 1800})
        await page.add_init_script(MOCK)
        await page.goto('http://localhost:8080')
        await page.evaluate("window.dispatchEvent(new CustomEvent('open-modal', {detail: 'epub-reader'}))")
        await page.locator('input[type=file][accept=".epub,application/epub+zip"]').last.set_input_files(str(EPUB))
        await page.frame_locator('iframe').last.locator('p').first.wait_for()
        await page.locator('button[title="Text-to-speech (scroll mode)"]').last.click()
        await page.locator('button[title="Play"]').last.click()
        await page.wait_for_timeout(500)
        assert await page.evaluate('speechSynthesis.speaking'), 'read-aloud did not start'
        if close_with == 'button':
            await page.locator('button[title="Close"]').last.click()
        else:
            await page.keyboard.press('Escape')
        await page.wait_for_timeout(300)
        spoken = await page.evaluate('speechSynthesis.spoken')
        await page.wait_for_timeout(1500)
        assert not await page.evaluate('speechSynthesis.speaking'), f'still speaking after {close_with} close'
        assert await page.evaluate('speechSynthesis.spoken') == spoken, f'kept queueing speech after {close_with} close'
        assert await page.locator('button[title="Play"]').count() == 0, 'reader still open'
        print('PASS', close_with)
        await browser.close()

async def main():
    await run('button')
    await run('escape')

asyncio.run(main())
