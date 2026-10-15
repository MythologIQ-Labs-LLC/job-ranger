// Brand consistency regression. No network calls or optional graphics dependencies.
// Source artwork is the actual Job Ranger side-project logo from Knapp-Kevin/MythologIQ,
// not a temporary recolor or an AI-generated approximation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(path.join(root, name));
const source = (name) => read(name).toString("utf8");

// Git object ID of the exact approved Studio asset at
// Knapp-Kevin/MythologIQ/public/assets/side-projects/job-ranger.png.
// Update this only after a deliberate, reviewed brand-artwork change.
const ACCEPTED_STUDIO_MARK_GIT_BLOB_SHA1 = "9f11465906ef63ed50627b914251d617da462e13";

function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.byteLength}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function pngSize(bytes) {
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("runtime app artwork is the approved MythologIQ Studio Job Ranger mark", () => {
  assert.equal(
    gitBlobSha(read("public/ICON.png")),
    ACCEPTED_STUDIO_MARK_GIT_BLOB_SHA1,
    "public/ICON.png must be copied exactly from the approved Studio side-project asset",
  );
});

test("favicon and runtime artwork use identical image bytes", () => {
  assert.deepEqual(read("public/favicon.png"), read("public/ICON.png"));
  assert.match(source("index.html"), /href="\.\/favicon\.png"/);
  assert.match(source("web/index.html"), /href="\.\/favicon\.png"/);
});

test("navigation uses the runtime logo, not a generic glyph", () => {
  const sidebar = source("src/components/Sidebar.tsx");
  assert.match(sidebar, /import\.meta\.env\.BASE_URL\}ICON\.png/);
  assert.match(sidebar, /alt=""/);
  assert.doesNotMatch(sidebar, /<Briefcase className="h-5 w-5" aria-hidden="true"\s*\/>/);
});

test("derived web and Store icons exist at their packaging-required dimensions", () => {
  const expected = {
    "public/pwa/icon-192.png": [192, 192],
    "public/pwa/icon-512.png": [512, 512],
    "public/pwa/icon-maskable-512.png": [512, 512],
    "public/pwa/apple-touch-icon.png": [180, 180],
    "build/appx/StoreLogo.png": [50, 50],
    "build/appx/Square44x44Logo.png": [44, 44],
    "build/appx/SmallTile.png": [71, 71],
    "build/appx/Square150x150Logo.png": [150, 150],
    "build/appx/LargeTile.png": [310, 310],
    "build/appx/Wide310x150Logo.png": [310, 150],
  };
  for (const [file, dimensions] of Object.entries(expected)) {
    assert.deepEqual(pngSize(read(file)), dimensions, file);
  }
  const manifest = JSON.parse(source("public/manifest.webmanifest"));
  assert.deepEqual(manifest.icons.map((entry) => entry.src), [
    "./pwa/icon-192.png", "./pwa/icon-512.png", "./pwa/icon-maskable-512.png",
  ]);
});
