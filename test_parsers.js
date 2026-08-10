import { fetchChapterLinks } from "./src/fetcher.js";

async function runTests() {
  console.log("Starting backend parser verification test for FreeWebNovel...\n");
  const url = "https://freewebnovel.com/against-the-gods.html";
  try {
    const chapters = await fetchChapterLinks(url);
    console.log(`✅ FreeWebNovel Success: Found ${chapters.length} chapters.`);
    if (chapters.length > 0) {
      console.log(`   First Chapter: "${chapters[0].title}" -> ${chapters[0].url}`);
      console.log(`   Last Chapter: "${chapters[chapters.length - 1].title}" -> ${chapters[chapters.length - 1].url}`);
    }
  } catch (e) {
    console.log(`❌ FreeWebNovel Failed: ${e.message}`);
  }
}

runTests();
