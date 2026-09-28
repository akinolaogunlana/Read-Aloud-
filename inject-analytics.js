const fs = require("fs");
const path = require("path");

const GA_ID = "G-MN42CDBBZE";

const GOOGLE_ANALYTICS = `
<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_ID}');
</script>
`;

const SKIP = new Set([
  "node_modules",
  ".git",
  ".vercel"
]);

function processDirectory(directory) {
  for (const file of fs.readdirSync(directory)) {
    const fullPath = path.join(directory, file);

    if (SKIP.has(file)) continue;

    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      processDirectory(fullPath);
      continue;
    }

    if (!file.toLowerCase().endsWith(".html")) continue;

    let html = fs.readFileSync(fullPath, "utf8");

    // Prevent duplicate installation
    if (html.includes(GA_ID)) {
      console.log(`SKIPPED — already installed: ${fullPath}`);
      continue;
    }

    // Make sure the document has a <head>
    if (!/<head(?:\s[^>]*)?>/i.test(html)) {
      console.log(`SKIPPED — no <head>: ${fullPath}`);
      continue;
    }

    html = html.replace(
      /(<head(?:\s[^>]*)?>)/i,
      `$1${GOOGLE_ANALYTICS}`
    );

    fs.writeFileSync(fullPath, html, "utf8");

    console.log(`ADDED — ${fullPath}`);
  }
}

processDirectory(".");

console.log("\nGoogle Analytics injection complete.");
console.log(`Measurement ID: ${GA_ID}`);