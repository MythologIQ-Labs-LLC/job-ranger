// Frame review for the exported demo video: decodes the actual .webm in Chromium,
// writes a frame every N seconds plus frames at given timestamps, a contact sheet,
// and reports duration/resolution and any near-blank frames.
// Usage: node scripts/demo/frames.mjs <video.webm> <outDir> [intervalSeconds=1] [extra timestamps...]
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const [video, outDir, intervalArg = "1", ...extra] = process.argv.slice(2);
const interval = Number(intervalArg);
mkdirSync(outDir, { recursive: true });

const server = createServer((req, res) => {
  if (req.url === "/v.webm") {
    res.writeHead(200, { "Content-Type": "video/webm", "Accept-Ranges": "none" });
    res.end(readFileSync(video));
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<video id=v src='/v.webm' muted preload=auto playsinline></video><canvas id=c></canvas>");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.SOJOURNER_PW_CHROMIUM || undefined });
const page = await browser.newPage();
await page.goto(url);
const meta = await page.evaluate(async () => {
  const v = document.getElementById("v");
  await new Promise((r) => (v.readyState >= 1 ? r() : v.addEventListener("loadedmetadata", r, { once: true })));
  // WebM from MediaRecorder-style writers may report Infinity until seeked to the end.
  if (!Number.isFinite(v.duration)) {
    v.currentTime = 1e9;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
  }
  return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
});

const times = [];
for (let t = 0; t < meta.duration; t += interval) times.push(Number(t.toFixed(2)));
for (const t of extra) times.push(Number(t));
times.push(Math.max(0, meta.duration - 0.2));
const unique = [...new Set(times)].sort((a, b) => a - b);

// Play from the start and grab the first presented frame at or after each target time.
// (Playwright's WebM has no cues, so seeking is unreliable; playback decodes the real stream.)
const captured = await page.evaluate(async (targets) => {
  const v = document.getElementById("v");
  const c = document.getElementById("c");
  v.currentTime = 0;
  await new Promise((r) => setTimeout(r, 200));
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const thumb = document.createElement("canvas");
  thumb.width = 320;
  thumb.height = Math.round((320 * c.height) / c.width);
  const out = [];
  let i = 0;
  v.playbackRate = 2;
  await new Promise((resolve) => {
    const onFrame = (_now, info) => {
      while (i < targets.length && info.mediaTime + 0.001 >= targets[i]) {
        ctx.drawImage(v, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0, sumSq = 0, n = 0;
        for (let k = 0; k < data.length; k += 4 * 97) {
          const lum = 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
          sum += lum; sumSq += lum * lum; n++;
        }
        const mean = sum / n;
        thumb.getContext("2d").drawImage(c, 0, 0, thumb.width, thumb.height);
        out.push({ t: targets[i], mediaTime: info.mediaTime, png: c.toDataURL("image/png"), thumb: thumb.toDataURL("image/jpeg", 0.75), mean, stdev: Math.sqrt(sumSq / n - mean * mean) });
        i++;
      }
      if (i >= targets.length || v.ended) resolve(); else v.requestVideoFrameCallback(onFrame);
    };
    v.addEventListener("ended", () => resolve(), { once: true });
    v.requestVideoFrameCallback(onFrame);
    v.play();
  });
  return out;
}, unique);

const report = [];
for (const r of captured) {
  const name = `frame-${String(r.t.toFixed(2)).padStart(6, "0")}s.png`;
  writeFileSync(path.join(outDir, name), Buffer.from(r.png.split(",")[1], "base64"));
  report.push({ t: r.t, mediaTime: Number(r.mediaTime.toFixed(2)), name, thumb: r.thumb, mean: Math.round(r.mean), stdev: Math.round(r.stdev), nearBlank: r.stdev < 8 });
}

// Contact sheet: grid of thumbnails with timestamps.
const sheet = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const cols = 6;
const html = `<body style="margin:0;background:#111;font:12px system-ui;color:#eee"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;padding:4px">${report
  .map((r) => `<figure style="margin:0"><img style="width:100%;display:block" src="${r.thumb}"><figcaption>${r.t.toFixed(2)}s${r.nearBlank ? " BLANK?" : ""}</figcaption></figure>`)
  .join("")}</div></body>`;
await sheet.setContent(html);
await sheet.screenshot({ path: path.join(outDir, "contact-sheet.png"), fullPage: true });

writeFileSync(path.join(outDir, "frames.json"), JSON.stringify({ meta, report: report.map(({ thumb, ...rest }) => rest) }, null, 2));
console.log(JSON.stringify({ meta, frames: report.length, nearBlank: report.filter((r) => r.nearBlank).map((r) => r.t) }));
await browser.close();
server.close();
