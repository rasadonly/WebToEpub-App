import { aiContentSelectors } from './src/aiParser.js';

const html = `
<html>
<body>
  <div class="chapter-title">Chapter 1: The Beginning</div>
  <div class="chapter-content">
    <p>This is the story.</p>
    <div class="ads">Ad here</div>
  </div>
</body>
</html>
`;

async function run() {
    console.log("Testing with NVIDIA_API_KEY:", process.env.NVIDIA_API_KEY ? "SET" : "NOT SET");
    try {
        const result = await aiContentSelectors(html, "https://example.com/chapter-1");
        console.log("Result:", result);
    } catch(e) {
        console.error("Error:", e);
    }
}
run();
