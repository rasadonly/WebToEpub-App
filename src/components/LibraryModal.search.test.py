"""Run with python3 src/components/LibraryModal.search.test.py against the preview."""
import asyncio
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 1800})
        await page.goto("http://localhost:8080")
        await page.get_by_role("button", name="Library", exact=True).click()
        await page.get_by_role("button", name="Download", exact=False).first.wait_for(timeout=120_000)
        counter = page.get_by_role("heading", name="Community Library", exact=True).locator("..").locator("p")
        original_count = await counter.inner_text()
        search = page.get_by_placeholder("Search titles…").filter(visible=True)
        await search.fill("zzzzmissinglibrarybook123456789")
        await page.wait_for_timeout(300)
        assert await counter.inner_text() == original_count, "Typing must not filter the library"
        await search.press("Enter")
        await page.get_by_text('No results for "zzzzmissinglibrarybook123456789"', exact=True).wait_for()
        await search.press("Backspace")
        assert await counter.inner_text() == "0 books", "Backspace must not change submitted results"
        await search.fill("")
        assert await counter.inner_text() == "0 books", "Clearing must also wait for Enter"
        await search.press("Enter")
        await page.get_by_role("button", name="Download", exact=False).first.wait_for()
        assert await counter.inner_text() == original_count, "Empty Enter restores the library"
        await page.screenshot(path="/tmp/browser/library-enter/verified.png")
        print("PASS: typing and backspace wait for Enter; Enter filters and empty Enter restores books")
        await browser.close()


asyncio.run(main())