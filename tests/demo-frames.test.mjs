// Frame review for demo videos must decode the real stream. Recorder WebM has no
// seek cues, so a seek-based extractor returned the same frame for every
// timestamp. This builds a 3 s WebM (colour changes each second) and checks the
// extractor sees three different frames and the true duration.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(path.join(os.tmpdir(), "job-ranger-demo-frames-"));
const video = path.join(work, "sample.webm");
const frames = path.join(work, "frames");

try {
  const browser = await chromium.launch({ executablePath: process.env.JOB_RANGER_PW_CHROMIUM || undefined });
  const page = await browser.newPage();
  await page.setContent("<canvas id='c' width='320' height='180'></canvas>");
  const base64 = await page.evaluate(async () => {
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d");
    const colours = ["#000000", "#808080", "#ffffff"];
    // Warm the encoder first: on a cold browser the first MediaRecorder can start hundreds of
    // milliseconds late, which cuts the measured black second short.
    ctx.fillStyle = colours[0];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const warmup = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm" });
    const warmed = new Promise((resolve) => (warmup.onstop = resolve));
    warmup.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    warmup.stop();
    await warmed;
    const started = performance.now();
    let running = true;
    const draw = () => {
      if (!running) return;
      const second = Math.min(2, Math.floor((performance.now() - started) / 1000));
      ctx.fillStyle = colours[second];
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      requestAnimationFrame(draw);
    };
    draw();
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm" });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    recorder.stop();
    await stopped;
    running = false;
    const buffer = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  await browser.close();
  writeFileSync(video, Buffer.from(base64, "base64"));

  execFileSync(process.execPath, [path.join(root, "scripts", "demo", "frames.mjs"), video, frames, "10", "0.5", "1.5", "2.5"], { stdio: "inherit" });
  const { meta, report } = JSON.parse(readFileSync(path.join(frames, "frames.json"), "utf8"));
  assert.ok(Math.abs(meta.duration - 3) <= 0.5, `duration ${meta.duration} should be about 3 s`);
  const at = (t) => report.find((frame) => frame.t === t);
  const lum = [0.5, 1.5, 2.5].map((t) => at(t)?.mean);
  assert.ok(lum.every((value) => typeof value === "number"), `frames at 0.5/1.5/2.5 s missing: ${JSON.stringify(lum)}`);
  assert.ok(lum[0] < lum[1] && lum[1] < lum[2], `expected rising luminance across the three seconds, got ${lum.join(", ")}`);
  assert.ok(existsSync(path.join(frames, "contact-sheet.png")) && statSync(path.join(frames, "contact-sheet.png")).size > 0, "contact sheet written");
  console.log(`demo frames test passed (duration ${meta.duration.toFixed(2)} s, luminance ${lum.join(" < ")})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
