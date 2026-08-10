import { parseHTML } from "linkedom";
import fetch from "node-fetch"; // using global fetch in node 20
const partId = "1430932857"; // Just a random Wattpad part ID, or I should fetch one
const res = await fetch(`https://www.wattpad.com/api/v3/story_parts/${partId}?fields=id,title,text`);
const json = await res.json();
console.log(json.text.substring(0, 500));
