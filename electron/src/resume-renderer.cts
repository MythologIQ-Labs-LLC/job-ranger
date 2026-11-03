import { BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import type { PreparedResumeRender } from "./resume-service.cjs";

export const RESUME_RENDERER_ID = "electron-chromium-print-to-pdf";

/**
 * Electron runtime adapter: renders the prepared, Truth-Gate-approved resume
 * HTML in an isolated, JavaScript-disabled Chromium window. The browser
 * runtime substitutes a deterministic pdf-lib renderer for this module.
 */
export async function renderResumePdf(prepared: PreparedResumeRender): Promise<void> {
  const { html, temporaryPath: targetPath } = prepared;
  const pageFormat = prepared.projection.pageFormat;
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      javascript: false,
      partition: `sojourner-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  try {
    const encoded = Buffer.from(html, "utf8").toString("base64");
    await window.loadURL(`data:text/html;base64,${encoded}`);
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: pageFormat === "a4" ? "A4" : "Letter",
      preferCSSPageSize: false,
    });
    await fs.writeFile(targetPath, pdf);
  } finally {
    window.webContents.removeAllListeners();
    if (!window.isDestroyed()) window.destroy();
  }
}
