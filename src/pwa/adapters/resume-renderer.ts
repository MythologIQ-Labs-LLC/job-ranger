/**
 * Web runtime adapter replacing electron/src/resume-renderer.cts.
 * Renders the prepared, Truth-Gate-approved projection with the deterministic
 * pdf-lib writer and stores it at the same managed temporary path; the shared
 * ResumeService then runs the Parseability Gate on those exact bytes.
 *
 * Text outside Windows-1252 is set in embedded Noto fonts. Font files are
 * fetched from this origin only when a resume needs them and are verified
 * against the SHA-256 recorded in the build's font manifest before use.
 */
import * as pdfLib from "pdf-lib";
import pdfFontManifest from "virtual:sojourner-pdf-fonts";
import type { PreparedResumeRender } from "../../../electron/src/resume-service.cjs";
import { promises as fs } from "./node-fs";
import { renderResumePdfBytes, type PdfFontEntry, type UnicodeFontSupport } from "../runtime/resume-pdf";

export const RESUME_RENDERER_ID = "web-pdf-lib-ats-text";

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadFont(entry: PdfFontEntry): Promise<Uint8Array> {
  // The runtime worker script lives in assets/; fonts are emitted beside it
  // under fonts/. (Resolved against self.location, not import.meta.url, which
  // Vite would rewrite into a build-time asset glob.)
  const url = new URL(`../fonts/${encodeURIComponent(entry.file)}`, self.location.href);
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new Error(
      "The fonts for this resume's languages could not be downloaded. Connect to the internet once to generate it; they stay available offline afterwards.",
    );
  }
  if (!response.ok) throw new Error(`Resume font ${entry.file} returned HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (toHex(await crypto.subtle.digest("SHA-256", bytes)) !== entry.sha256) {
    throw new Error(`Resume font ${entry.file} failed integrity verification`);
  }
  return new Uint8Array(bytes);
}

const unicodeFonts: UnicodeFontSupport = {
  manifest: pdfFontManifest,
  fontkit: async () => (await import("@pdf-lib/fontkit")).default,
  load: loadFont,
};

export async function renderResumePdf(prepared: PreparedResumeRender): Promise<void> {
  const bytes = await renderResumePdfBytes(pdfLib, prepared.projection, prepared.statements, unicodeFonts);
  await fs.writeFile(prepared.temporaryPath, bytes);
}
