/// <reference types="vite/client" />

declare module "*?worker&url" {
  const url: string;
  export default url;
}

declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}

declare module "virtual:sojourner-pdf-fonts" {
  const manifest: import("./runtime/resume-pdf").PdfFontManifest;
  export default manifest;
}

declare module "@pdf-lib/fontkit" {
  const fontkit: unknown;
  export default fontkit;
}
