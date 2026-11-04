// Renders the film's end card as a 1600x900 PNG from HTML (system fonts and the approved Sojourner icon).
// No artwork is generated: the card is type plus the supplied icon file. The opener is not made here: it is
// the owner-approved MythologIQ Labs opener from the Sonic Rift v0.9.1 final cut (make_opener.py).
//   node scripts/demo/film/cards.mjs <brand dir> <out dir>
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const [brand, out] = process.argv.slice(2);
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(path.join(brand, file)).toString("base64")}`;
const icon = dataUrl("sojourner-icon.png", "image/png");
const base = `margin:0;width:1600px;height:900px;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;`;

const cards = {
  "card-end.png": `<body style="${base}background:radial-gradient(circle at 50% 38%,#1d4a35 0%,#10261c 58%,#0b1a13 100%);color:#f4fbf6;
      display:flex;flex-direction:column;align-items:center;justify-content:center;">
    <img src="${icon}" style="width:190px;height:190px;border-radius:50%;box-shadow:0 10px 40px rgba(0,0,0,.35);">
    <div style="margin-top:30px;font:400 92px/1 Georgia,'Times New Roman',serif;letter-spacing:-.01em;">Sojourner</div>
    <div style="margin-top:14px;font:500 26px/1.3 'Segoe UI',sans-serif;opacity:.85;letter-spacing:.04em;">Employment Toolkit</div>
    <div style="margin-top:46px;font:600 24px/1.4 'Segoe UI',sans-serif;">Windows Alpha · v1.0.0-alpha.1</div>
    <div style="margin-top:8px;font:400 21px/1.4 'Segoe UI',sans-serif;opacity:.8;">github.com/MythologIQ-Labs-LLC/sojourner/releases</div>
    <div style="position:absolute;bottom:30px;font:400 17px/1.4 'Segoe UI',sans-serif;opacity:.6;">
      MythologIQ Labs, LLC · Jordan Ellis and Harbor Health are fictional; all data shown is demo data.</div>
  </body>`,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (const [name, html] of Object.entries(cards)) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`);
  await page.waitForLoadState("load");
  await page.screenshot({ path: path.join(out, name) });
  console.log(name);
}
await browser.close();
