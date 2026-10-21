"""Run with python3 src/components/LibraryModal.search.test.py against the preview."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 1800})
        await page.goto("http://localhost:8080")
        await page.get_by_role("button", name="Library", exact=True).click()
        await page.get_by_role("button", name="Download", exact=False).first.wait_for(timeout=120_000)
        counter = page.get_by_role("heading", name="Community Library", exact=True).filter(visible=True).last.locator("..").locator("p")
        original_count = await counter.inner_text()
        search = page.get_by_placeholder("Search titles…").filter(visible=True).last
        initial_url = page.url
        await search.fill("Shadow Slave")
        await search.press("Enter")
        await page.wait_for_timeout(300)
        assert page.url == initial_url, "Enter must not navigate to the homepage"
        assert await search.is_visible(), "Enter must keep the Library open"
        library = search.locator("xpath=ancestor::div[contains(@class, 'fixed')][1]")
        titles = await library.get_by_role("heading", level=3).all_text_contents()
        assert titles and all("shadowslave" in "".join(t.lower().split()) for t in titles), "Enter must show matching books"
        await search.fill("Lord of Mysteries")
        await library.get_by_role("button", name="Search", exact=True).filter(visible=True).click()
        await page.wait_for_timeout(300)
        titles = await library.get_by_role("heading", level=3).all_text_contents()
        assert titles and all("lordofmysteries" in "".join(t.lower().split()) for t in titles), "Search button must show matching books"
        assert page.url == initial_url and await search.is_visible(), "Search button must keep the Library open without navigation"
        await search.fill("")
        await search.press("Enter")
        await search.fill("zzzzmissinglibrarybook123456789")
        await page.wait_for_timeout(300)
        assert await counter.inner_text() == original_count, "Typing must not filter the library"
        await search.press("Enter")
        await page.get_by_text('No results for "zzzzmissinglibrarybook123456789"', exact=True).filter(visible=True).last.wait_for()
        await search.press("Backspace")
        assert await counter.inner_text() == "0 books", "Backspace must not change submitted results"
        await search.fill("")
        assert await counter.inner_text() == "0 books", "Clearing must also wait for Enter"
        await search.press("Enter")
        await page.get_by_role("button", name="Download", exact=False).first.wait_for()
        assert await counter.inner_text() == original_count, "Empty Enter restores the library"
        screenshots = Path("/tmp/browser/library-search-button")
        screenshots.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(screenshots / "desktop.png"))
        await page.set_viewport_size({"width": 390, "height": 844})
        search = page.get_by_placeholder("Search titles…").filter(visible=True).last
        await search.fill("Shadow Slave")
        await library.get_by_role("button", name="Search", exact=True).filter(visible=True).click()
        await page.wait_for_timeout(300)
        titles = await library.get_by_role("heading", level=3).all_text_contents()
        assert titles and all("shadowslave" in "".join(t.lower().split()) for t in titles), "Mobile Search button must show matching books"
        assert page.url == initial_url and await search.is_visible(), "Mobile Search must keep the Library open"
        await page.screenshot(path=str(screenshots / "mobile.png"))
        print("PASS: Search buttons filter on desktop and mobile; Enter works; typing and backspace do not filter or navigate")
        await browser.close()


asyncio.run(main())