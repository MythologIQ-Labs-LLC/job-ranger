// Unit tests for the web runtime adapters that replace Node/Electron
// infrastructure. Each adapter is checked against the behavior the shared core
// relies on (usually against Node's own implementation).
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { isIP as nodeIsIP } from "node:net";
import { strToU8, zipSync } from "fflate";
import { unzipSync } from "fflate";
import * as pdfLib from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { createHash as webCreateHash } from "../src/pwa/adapters/node-crypto.ts";
import webPath from "../src/pwa/adapters/node-path.ts";
import { isIP as webIsIP } from "../src/pwa/adapters/node-net.ts";
import {
  classifyCompoundFile,
  DocumentTextError,
  extractDocxText,
  extractPdfText,
  MAX_DOCX_XML_BYTES,
  wordDocumentXmlToText,
} from "../src/pwa/runtime/document-text.ts";
import { renderResumePdfBytes, ResumePdfEncodingError } from "../src/pwa/runtime/resume-pdf.ts";
import {
  ACQUISITION_ORIGINS,
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  isAllowedAcquisitionOrigin,
} from "../src/pwa/security/policy.ts";

globalThis.pdfjsWorker = pdfjsWorker;

// --- SHA-256 (provenance + backup integrity hashes) ---
for (const size of [0, 1, 3, 55, 56, 57, 63, 64, 65, 127, 128, 1000, 1024 * 1024 + 7]) {
  const bytes = randomBytes(size);
  assert.equal(
    webCreateHash("sha256").update(bytes).digest("hex"),
    createHash("sha256").update(bytes).digest("hex"),
    `sha256 parity for ${size} bytes`,
  );
}
const chunked = webCreateHash("sha256");
chunked.update("Career ").update(new TextEncoder().encode("Evidence ✓"));
assert.equal(chunked.digest("hex"), createHash("sha256").update("Career Evidence ✓").digest("hex"));
assert.equal(
  webCreateHash("sha256").update("abc").digest("base64"),
  createHash("sha256").update("abc").digest("base64"),
);
assert.throws(() => webCreateHash("md5"), /only supports sha256/);

// --- POSIX path semantics used by managed-artifact and backup code ---
const pathCases = [
  ["join", ["/job-ranger/data", "artifacts", "sources", "a1", "source.pdf"]],
  ["join", ["/a/b", "../c", "./d"]],
  ["join", ["a", "", "b/"]],
  ["dirname", ["/job-ranger/data/jobscout.sqlite3"]],
  ["dirname", ["/job-ranger"]],
  ["dirname", ["relative"]],
  ["basename", ["/x/y/source.docx"]],
  ["basename", ["/x/y/source.docx", ".docx"]],
  ["extname", ["/x/y/source.tar.gz"]],
  ["extname", ["/x/.hidden"]],
  ["resolve", ["/job-ranger/data", "artifacts/x"]],
  ["resolve", ["/a", "/b", "c/../d"]],
  ["relative", ["/job-ranger/data", "/job-ranger/data/artifacts/sources/x"]],
  ["relative", ["/job-ranger/data", "/job-ranger/other"]],
  ["relative", ["/job-ranger/data", "/job-ranger/data"]],
  ["isAbsolute", ["/abs"]],
  ["isAbsolute", ["rel/x"]],
  ["normalize", ["/a//b/./c/.."]],
];
for (const [fn, args] of pathCases) {
  assert.deepEqual(webPath[fn](...args), nodePath.posix[fn](...args), `path.${fn}(${args.join(", ")})`);
}

// --- isIP (acquisition URL policy) ---
for (const value of [
  "127.0.0.1", "10.0.0.1", "255.255.255.255", "256.1.1.1", "1.2.3", "::1", "::", "fe80::1",
  "2001:db8::1", "::ffff:192.168.0.1", "1::2::3", "example.com", "", "fc00::", "1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7:8:9",
]) {
  assert.equal(webIsIP(value), nodeIsIP(value), `isIP(${value})`);
}

// --- Security policy ---
const csp = buildContentSecurityPolicy();
assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'|\*/, "CSP forbids inline/eval/wildcards");
assert.match(csp, /default-src 'none'/);
assert.match(csp, /frame-ancestors 'none'/);
assert.match(csp, /require-trusted-types-for 'script'/);
assert.match(csp, /trusted-types job-ranger-script-url/);
const connect = csp.split("; ").find((directive) => directive.startsWith("connect-src"));
assert.deepEqual(connect.split(" ").slice(1), ["'self'", ...ACQUISITION_ORIGINS]);
for (const origin of ACQUISITION_ORIGINS) assert.match(origin, /^https:\/\/[a-z0-9.-]+$/);
assert.equal(isAllowedAcquisitionOrigin("https://boards-api.greenhouse.io/v1/boards/x/jobs"), true);
assert.equal(isAllowedAcquisitionOrigin("https://boards-api.greenhouse.io.evil.example/v1"), false);
assert.equal(isAllowedAcquisitionOrigin("http://boards-api.greenhouse.io/v1"), false);
assert.equal(isAllowedAcquisitionOrigin("https://evil.example/?https://api.lever.co"), false);
const headers = buildSecurityHeaders();
assert.match(headers["Strict-Transport-Security"], /max-age=\d{8,}/);
assert.equal(headers["X-Content-Type-Options"], "nosniff");
assert.equal(headers["Referrer-Policy"], "no-referrer");

// --- Stable localhost self-host contract ---
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(
  packageJson.scripts["preview:pwa"],
  "vite preview --config vite.pwa.config.ts",
  "preview command must defer host/port authority to the checked-in PWA config",
);
assert.equal(
  packageJson.scripts["selfhost:pwa"],
  "npm run build:pwa && npm run preview:pwa",
  "one command must build and serve the production PWA locally",
);
const pwaConfigSource = readFileSync(new URL("../vite.pwa.config.ts", import.meta.url), "utf8");
assert.match(pwaConfigSource, /preview:\s*\{[\s\S]*?host:\s*"localhost"[\s\S]*?port:\s*4174[\s\S]*?strictPort:\s*true/, "local PWA preview must stay on http://localhost:4174 and fail if the port is busy");

// --- DOCX extraction ---
const documentXml = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Jordan Ellis</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Experience</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Dispatch Supervisor </w:t></w:r><w:r><w:t>&amp; Trainer</w:t></w:r><w:r><w:tab/><w:t>2019</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Cut response times by 12%</w:t></w:r></w:p>
<w:p/>
</w:body></w:document>`;
const docx = zipSync({
  "[Content_Types].xml": strToU8("<Types/>"),
  "word/document.xml": strToU8(documentXml),
});
assert.equal(
  extractDocxText(docx, unzipSync),
  "# Jordan Ellis\n# Experience\nDispatch Supervisor & Trainer\t2019\n- Cut response times by 12%",
);
assert.equal(wordDocumentXmlToText("<w:body><w:p><w:r><w:t>&#x2014;&#169;</w:t></w:r></w:p></w:body>"), "—©");
assert.throws(
  () =>
    extractDocxText(new Uint8Array([0x50, 0x4b, 3, 4]), () => {
      throw new Error("bad zip");
    }),
  (error) => error instanceof DocumentTextError && error.code === "malformed",
);
assert.throws(
  () =>
    extractDocxText(docx, (data, options) => {
      options.filter({ name: "word/document.xml", size: 10, originalSize: MAX_DOCX_XML_BYTES + 1 });
      return {};
    }),
  (error) => error instanceof DocumentTextError && error.code === "resource-limit",
  "decompression-bomb guard",
);
const utf16 = (text) => Uint8Array.from(Array.from(text).flatMap((char) => [char.charCodeAt(0), 0]));
const cfbHeader = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
assert.equal(classifyCompoundFile(new Uint8Array([...cfbHeader, ...utf16("EncryptionInfo")])).code, "encrypted");
assert.equal(classifyCompoundFile(new Uint8Array([...cfbHeader, ...utf16("WordDocument")])).code, "unsupported");

// --- Deterministic ATS resume PDF + reparse (Parseability Gate input) ---
const projection = {
  id: "projection-1",
  pageFormat: "letter",
  templateId: "ats-standard-v1",
  sections: ["Experience", "Skills", "Certifications"],
  updatedAt: "2026-10-05T12:00:00.000Z",
  contact: {
    fullName: "Avery Okafor",
    email: "avery@example.com",
    phone: "555-0100",
    location: "Columbus, OH",
    links: ["https://example.com/avery"],
  },
};
const statements = [
  { section: "Skills", order: 1, text: "Forklift operation, cycle counting, WMS reconciliation" },
  { section: "Experience", order: 2, text: "Reduced inbound dock-to-stock time by 18% across a 120,000 sq ft facility." },
  { section: "Experience", order: 1, text: "Warehouse Shift Lead, Midwest Distribution Co. — supervised 14 associates on second shift." },
  { section: "Certifications", order: 1, text: "OSHA 10-Hour General Industry (active)" },
  ...Array.from({ length: 60 }, (_, index) => ({
    section: "Experience",
    order: 10 + index,
    text: `Coordinated cross-dock transfer wave ${index + 1} with carrier partners and documented exceptions for audit review.`,
  })),
];
const first = await renderResumePdfBytes(pdfLib, projection, statements);
const second = await renderResumePdfBytes(pdfLib, projection, statements);
assert.equal(createHash("sha256").update(first).digest("hex"), createHash("sha256").update(second).digest("hex"), "deterministic bytes");
const parsed = await extractPdfText(first, pdfjs);
assert.ok(parsed.pageCount >= 2, "long resumes paginate");
assert.deepEqual(parsed.emptyPages, []);
const text = parsed.text.replace(/\s+/g, " ");
for (const expected of ["Avery Okafor", "avery@example.com", "EXPERIENCE", "Warehouse Shift Lead", "dock-to-stock", "OSHA 10-Hour", "wave 60"]) {
  assert.ok(text.includes(expected), `PDF text includes ${expected}`);
}
assert.ok(text.indexOf("Warehouse Shift Lead") < text.indexOf("dock-to-stock"), "statement order preserved");
assert.ok(text.indexOf("EXPERIENCE") < text.indexOf("SKILLS"), "section order preserved");
const metadataDocument = await pdfLib.PDFDocument.load(first);
assert.equal(metadataDocument.getCreator(), "Sojourner");
await assert.rejects(
  renderResumePdfBytes(pdfLib, projection, [{ section: "Skills", order: 1, text: "Mandarin (普通话)" }]),
  (error) => error instanceof ResumePdfEncodingError && /cannot encode/.test(error.message),
  "unencodable text fails honestly instead of being dropped",
);

console.log("PWA adapter tests passed");
