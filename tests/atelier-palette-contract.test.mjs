import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The initial CSS and React's applied theme must agree. A mismatch gives
// users a distracting flash of brown/orange before Atelier hydrates.
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/theme/ThemeProvider.tsx", import.meta.url), "utf8");
const root = css.split(":root {")[1]?.split("\n}")[0];
const atelier = source.split("  atelier: {")[1]?.split("  midnight: {")[0];
assert.ok(root && atelier, "Atelier token sources must remain present");

const cssValue = (token) => {
  const match = root.match(new RegExp("--color-" + token + ":\\s*(#[0-9a-fA-F]{6});", "i"));
  assert.ok(match, `missing CSS token ${token}`);
  return match[1].toLowerCase();
};
const themeValue = (token) => {
  const match = atelier.match(new RegExp("^\\s*" + token + ': "(#[0-9a-fA-F]{6})",', "m"));
  assert.ok(match, `missing theme token ${token}`);
  return match[1].toLowerCase();
};
function contrast(hexA, hexB) {
  const lightness = (hex) => {
    const channels = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((channel) => channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = lightness(hexA);
  const b = lightness(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("Atelier implements the approved 60/30/10 ivory/slate/teal hierarchy", () => {
  assert.equal(cssValue("canvas"), "#f6f3eb");
  assert.equal(cssValue("sidebar"), "#00182e");
  assert.equal(cssValue("primary"), "#00765f");
  assert.equal(cssValue("secondary"), "#17384d");
  assert.equal(cssValue("accent"), "#01896a");
  // Approximate *surface distribution*, not fabricated pixel measurements:
  // 60% light canvas/panels, 30% structural slate, 10% teal action highlights.
  assert.match(atelier, /60\/30\/10: warm ivory surfaces, logo navy structure, accessible trail-green actions/);
  assert.ok(!atelier.includes("#b45309"), "legacy orange must not be the primary color");
  assert.ok(!atelier.includes("#201913"), "legacy brown must not be the sidebar color");
});

test("Atelier CSS fallback and hydrated theme agree on all opaque colors", () => {
  const pairNames = [
    ["primary", "primary"], ["secondary", "secondary"],
    ["accent", "accent"], ["canvas", "canvas"], ["sidebar", "sidebar"],
    ["text-primary", "textPrimary"], ["text-secondary", "textSecondary"],
    ["text-muted", "textMuted"], ["text-inverse", "textInverse"],
    ["success", "success"], ["warning", "warning"],
    ["danger", "danger"], ["info", "info"],
  ];
  for (const [cssName, themeName] of pairNames) {
    assert.equal(cssValue(cssName), themeValue(themeName), cssName + " CSS/React mismatch");
  }
});

test("Atelier text and button pairings meet WCAG AA 4.5:1 against main surfaces", () => {
  const backgrounds = ["#f6f3eb", "#fcfbf6", "#f1f6f2", "#fffefd", "#ffffff"];
  for (const name of ["text-primary", "text-secondary", "text-muted", "primary"]) {
    for (const bg of backgrounds) {
      assert.ok(contrast(cssValue(name), bg) >= 4.5,
        `${name} on ${bg} contrast ${contrast(cssValue(name), bg).toFixed(2)}`);
    }
  }
  assert.ok(contrast(cssValue("text-inverse"), cssValue("primary")) >= 4.5,
    "white action text must contrast against deep teal primary buttons");
  assert.ok(contrast(cssValue("text-inverse"), cssValue("sidebar")) >= 4.5,
    "white nav text must contrast against slate sidebar");
});

test("Only Atelier palette changes, without redefining semantic status badges", () => {
  for (const theme of ['[data-theme="midnight"]', '[data-theme="canopy"]']) {
    assert.ok(css.includes(theme), `missing ${theme} badge treatment`);
  }
  for (const status of ["success", "warning", "danger", "info"]) {
    assert.match(root, new RegExp("--badge-" + status + "-bg:"));
    assert.match(root, new RegExp("--badge-" + status + "-fg:"));
  }
  assert.match(source, /export type ThemeName = "atelier" \| "midnight" \| "canopy"/);
});

test("primary button text keeps AA contrast across the whole gradient in every theme", () => {
  const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, weight) => a.map((v, i) => v * weight + b[i] * (1 - weight));
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  const block = (name, next) => source.split(`  ${name}: {`)[1]?.split(next ? `  ${next}: {` : "\n};")[0];
  const token = (text, name) => text.match(new RegExp("^\\s*" + name + ': "(#[0-9a-fA-F]{6})",', "m"))[1].toLowerCase();
  const themes = { atelier: block("atelier", "midnight"), midnight: block("midnight", "canopy"), canopy: block("canopy") };
  // Shared gradient: primary+white -> secondary+black. Midnight overrides the end with primary+black.
  assert.match(css, /\.primary-button \{[\s\S]*?color-mix\(in srgb, var\(--color-primary\) 92%, white\),\s*color-mix\(in srgb, var\(--color-secondary\) 88%, black\)/);
  assert.match(css, /:root\[data-theme="midnight"\] \.primary-button \{[\s\S]*?color-mix\(in srgb, var\(--color-primary\) 80%, black\)/);
  for (const [name, text] of Object.entries(themes)) {
    assert.ok(text, `missing ${name} theme`);
    const primary = hex(token(text, "primary"));
    const secondary = hex(token(text, "secondary"));
    const ink = token(text, "textInverse");
    const start = mix(primary, white, 0.92);
    const end = name === "midnight" ? mix(primary, black, 0.8) : mix(secondary, black, 0.88);
    for (const stop of [start, mix(start, end, 0.5), end]) {
      assert.ok(contrast(ink, toHex(stop)) >= 4.5, `${name} primary button ink ${ink} on ${toHex(stop)}: ${contrast(ink, toHex(stop)).toFixed(2)}`);
    }
  }
});
