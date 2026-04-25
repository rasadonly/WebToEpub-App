import { parseHTML } from 'linkedom';
console.log("Linkedom loaded");
const { window } = parseHTML('<html></html>');
console.log("DOM parsed");
console.log("Window exists:", !!window);
