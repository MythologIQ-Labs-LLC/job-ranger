// Web resume PDF writer: text outside Windows-1252 is set in embedded Noto
// fonts and must survive the same extraction the Parseability Gate performs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as pdfLib from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { buildPdfFonts } from "../scripts/pdf-fonts.mjs";
import { extractPdfText } from "../src/pwa/runtime/document-text.ts";
import { renderResumePdfBytes, ResumePdfEncodingError } from "../src/pwa/runtime/resume-pdf.ts";

globalThis.pdfjsWorker = pdfjsWorker;
const require = createRequire(import.meta.url);
const { normalizedParseabilityText, parseabilityTokens } = require("../electron-runtime/electron/src/parseability-text.cjs");

const { directory, manifest } = await buildPdfFonts();
const loads = [];
const unicode = {
  manifest,
  fontkit: async () => fontkit,
  async load(entry) {
    loads.push(entry.file);
    const bytes = readFileSync(path.join(directory, entry.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `${entry.file} matches the manifest`);
    return new Uint8Array(bytes);
  },
};

const projection = (contact, sections = ["Experience", "Skills"]) => ({
  id: "projection-unicode",
  pageFormat: "a4",
  templateId: "ats-standard-v1",
  sections,
  updatedAt: "2026-10-05T12:00:00.000Z",
  contact: { phone: "", location: "", links: [], ...contact },
});

/** The Parseability Gate's statement check, applied to the web runtime's extraction. */
function assertParseable(bytes, texts) {
  return extractPdfText(bytes, pdfjs).then((parsed) => {
    const extracted = normalizedParseabilityText(parsed.text);
    let last = -1;
    for (const text of texts) {
      const { tokens, containsUnverifiableScript } = parseabilityTokens(text);
      assert.equal(containsUnverifiableScript, false, text);
      assert.ok(tokens.length > 0, `${text} has verifiable tokens`);
      const missing = tokens.filter((token) => !extracted.includes(token));
      assert.deepEqual(missing, [], `every token of "${text}" is extractable`);
      // Same rule as the gate: anchors that cannot be located are skipped.
      const anchor = extracted.indexOf(tokens.slice(0, 3).join(" "));
      if (anchor < 0) continue;
      assert.ok(anchor >= last, `reading order preserved at "${text}"`);
      last = anchor;
    }
    return parsed;
  });
}

const cases = [
  {
    name: "Cyrillic, Greek, Vietnamese, Latin extended",
    contact: { fullName: "Олександра Ковальчук", email: "o.kovalchuk@example.com", location: "Kraków, Polska" },
    statements: [
      "Керувала логістикою складу на 40 000 м² і скоротила час обробки замовлень на 18%.",
      "Συντονισμός προμηθειών για 12 νοσοκομεία στην Αθήνα.",
      "Quản lý dự án chuỗi cung ứng tại Hà Nội và Thành phố Hồ Chí Minh.",
      "Łódź · Ærøskøbing · Đà Nẵng · İstanbul · Šiauliai",
    ],
  },
  {
    name: "Simplified Chinese with Latin terms",
    contact: { fullName: "王小明", email: "xiaoming.wang@example.com", location: "上海" },
    statements: [
      "负责华东区域供应链管理，协调 SAP 系统上线，库存周转率提升 25%。",
      "带领 14 人团队完成仓储自动化改造项目，按期交付。",
    ],
  },
  {
    name: "Traditional Chinese",
    contact: { fullName: "陳美玲", email: "meiling@example.com", location: "臺北市" },
    statements: ["負責醫療器材採購與供應商管理，導入電子簽核流程。", "協調護理部門與資訊部門，縮短病歷調閱時間。"],
  },
  {
    name: "Japanese",
    contact: { fullName: "佐藤 花子", email: "hanako.sato@example.com", location: "東京都" },
    statements: ["プロジェクト管理を担当し、物流センターの稼働率を改善しました。", "介護施設のシフト管理システムを導入。"],
  },
  {
    name: "Korean",
    contact: { fullName: "김민준", email: "minjun.kim@example.com", location: "서울특별시" },
    statements: ["물류 센터 운영 관리 및 재고 정확도 개선을 담당했습니다.", "간호 인력 근무 일정 시스템을 도입했습니다."],
  },
  {
    name: "Thai",
    contact: { fullName: "สมชาย ใจดี", email: "somchai@example.com", location: "กรุงเทพมหานคร" },
    statements: ["ผู้จัดการโครงการด้านโลจิสติกส์ ดูแลคลังสินค้าและการขนส่ง", "ประสานงานกับโรงพยาบาลเพื่อจัดซื้อเวชภัณฑ์"],
  },
];

for (const testCase of cases) {
  const statements = testCase.statements.map((text, index) => ({ section: "Experience", order: index, text }));
  const input = projection(testCase.contact);
  loads.length = 0;
  const first = await renderResumePdfBytes(pdfLib, input, statements, unicode);
  const loadedForFirst = [...loads];
  const second = await renderResumePdfBytes(pdfLib, input, statements, unicode);
  assert.equal(
    createHash("sha256").update(first).digest("hex"),
    createHash("sha256").update(second).digest("hex"),
    `${testCase.name}: deterministic bytes`,
  );
  const parsed = await assertParseable(first, [testCase.contact.fullName, ...testCase.statements]);
  assert.deepEqual(parsed.emptyPages, [], testCase.name);
  assert.ok(loadedForFirst.length > 0 && loadedForFirst.length < 40, `${testCase.name}: loads only the slices it needs (${loadedForFirst.length})`);
  console.log(`ok   ${testCase.name}: ${first.length} bytes, ${loadedForFirst.length} font slices`);
}

// Regional CJK glyph forms: the document's script decides which CJK family leads.
for (const [text, family] of [
  ["日本語の職務経歴書", "noto-sans-jp"],
  ["한국어 이력서 관리", "noto-sans-kr"],
  ["項目經理負責醫療器材", "noto-sans-tc"],
  ["项目经理负责医疗器材", "noto-sans-sc"],
]) {
  loads.length = 0;
  await renderResumePdfBytes(pdfLib, projection({ fullName: "Test", email: "t@example.com" }), [{ section: "Skills", order: 0, text }], unicode);
  const cjk = loads.filter((file) => /noto-sans-(sc|tc|jp|kr)-/.test(file));
  assert.ok(cjk.length > 0 && cjk.every((file) => file.startsWith(family)), `${text} uses ${family} (${cjk.join(", ")})`);
}

// Long CJK text wraps between characters and paginates without losing content.
const longStatements = Array.from({ length: 50 }, (_, index) => ({
  section: "Experience",
  order: index,
  text: `第${index + 1}期仓储自动化项目：负责需求调研、供应商评估、系统联调与上线培训，确保库存准确率达到百分之九十九以上并持续改进。`,
}));
const long = await renderResumePdfBytes(pdfLib, projection({ fullName: "李华", email: "li.hua@example.com" }), longStatements, unicode);
const longParsed = await assertParseable(long, ["李华", ...longStatements.map((statement) => statement.text)]);
assert.ok(longParsed.pageCount >= 2, "long CJK resumes paginate");

// Latin-only resumes keep the standard Helvetica output (no embedded fonts, no font loads).
loads.length = 0;
const latin = await renderResumePdfBytes(pdfLib, projection({ fullName: "Avery Okafor", email: "avery@example.com" }), [
  { section: "Experience", order: 0, text: "Señora Müller café — reduced dock-to-stock time by 18%." },
], unicode);
assert.deepEqual(loads, [], "Windows-1252 text does not load embedded fonts");
assert.ok(!Buffer.from(latin).toString("latin1").includes("FontFile2"), "Windows-1252 text embeds no font programs");

// Right-to-left and Indic scripts fail explicitly instead of producing a misleading PDF.
for (const text of ["مدير مشروع في الرياض", "מנהל פרויקטים בתל אביב", "परियोजना प्रबंधक", "திட்ட மேலாளர்"]) {
  await assert.rejects(
    renderResumePdfBytes(pdfLib, projection({ fullName: "Test", email: "t@example.com" }), [{ section: "Skills", order: 0, text }], unicode),
    (error) => error instanceof ResumePdfEncodingError && /right-to-left or Indic/.test(error.message) && /Remove or transliterate/.test(error.message) && !/Windows app|desktop app/.test(error.message),
    text,
  );
}
// Characters no bundled font covers fail with the supported-script list.
await assert.rejects(
  renderResumePdfBytes(pdfLib, projection({ fullName: "Test", email: "t@example.com" }), [{ section: "Skills", order: 0, text: "Հայերեն ռեզյումե" }], unicode),
  (error) => error instanceof ResumePdfEncodingError && /cannot render/.test(error.message),
  "Armenian has no bundled font",
);

// A font file that does not match the manifest is never embedded.
const tampered = {
  ...unicode,
  async load(entry) {
    const bytes = await unicode.load(entry);
    const digest = createHash("sha256").update(bytes.subarray(1)).digest("hex");
    if (digest !== entry.sha256) throw new Error(`Font ${entry.file} failed integrity verification`);
    return bytes;
  },
};
await assert.rejects(
  renderResumePdfBytes(pdfLib, projection({ fullName: "王小明", email: "x@example.com" }), [], tampered),
  /integrity verification/,
);

console.log("web unicode PDF tests passed");
