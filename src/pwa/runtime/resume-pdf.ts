/**
 * Deterministic, text-based ATS resume PDF writer for the Job Ranger web
 * runtime (pdf-lib; no embedded scripts or images).
 *
 * Input is the same prepared, Truth-Gate-approved projection the Electron
 * runtime renders through Chromium: identical contact snapshot, section order,
 * statement order, and statement text. Only typography differs. The shared
 * Parseability Gate re-parses the produced bytes before an artifact is
 * accepted, exactly as in Electron.
 *
 * Text that Windows-1252 can encode is set in the standard Helvetica fonts.
 * Anything else (Latin extended, Greek, Cyrillic, Vietnamese, Thai, Chinese,
 * Japanese, Korean) is set in embedded, subset Noto Sans fonts chosen per
 * character from the build's font manifest. Right-to-left and Indic scripts
 * need bidirectional layout and shaping that this writer does not perform, so
 * they fail explicitly instead of producing a misleading PDF.
 *
 * Only erasable TypeScript syntax is used so Node tests can load this file.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ResumePdfProjection {
  id: string;
  pageFormat: "letter" | "a4";
  templateId: "ats-standard-v1" | "ats-compact-v1";
  sections: string[];
  updatedAt: string;
  contact: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    links: string[];
  };
}

export interface ResumePdfStatement {
  section: string;
  order: number;
  text: string;
}

export interface PdfFontEntry {
  file: string;
  family: string;
  subset: string;
  weight: number;
  sha256: string;
  bytes: number;
  ranges: [number, number][];
}

export interface PdfFontManifest {
  schemaVersion: 1;
  families: string[];
  fonts: PdfFontEntry[];
}

/** Embedded-font support for text outside Windows-1252. */
export interface UnicodeFontSupport {
  manifest: PdfFontManifest;
  /** Resolves the `@pdf-lib/fontkit` module (loaded only when needed). */
  fontkit(): Promise<any>;
  /** Returns the verified bytes of one manifest font file. */
  load(entry: PdfFontEntry): Promise<Uint8Array>;
}

export class ResumePdfEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumePdfEncodingError";
  }
}

const POINTS_PER_INCH = 72;
const BULLET = "•";
const SUPPORTED_SCRIPTS = "Latin, Greek, Cyrillic, Vietnamese, Thai, Chinese, Japanese, and Korean";
const UNSUPPORTED_LAYOUT_SCRIPT =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Tibetan}]/gu;
const WORD_SPLIT_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

function templateMetrics(templateId: ResumePdfProjection["templateId"]) {
  const compact = templateId === "ats-compact-v1";
  return {
    margin: (compact ? 0.42 : 0.55) * POINTS_PER_INCH,
    body: compact ? 9.5 : 10.5,
    lineHeight: compact ? 1.28 : 1.38,
    name: compact ? 19 : 22,
    heading: compact ? 10.5 : 11.5,
    contact: 9,
    sectionGap: compact ? 9 : 13,
    itemGap: compact ? 2 : 4,
    bulletIndent: 13,
  };
}

function cleanText(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

interface LabeledText {
  text: string;
  label: string;
  bold: boolean;
}

/** A line-break unit and the separator placed before it when it follows other text. */
interface BreakUnit {
  text: string;
  joiner: string;
}

interface TextEngine {
  width(text: string, size: number, bold: boolean): number;
  draw(page: any, text: string, x: number, y: number, size: number, bold: boolean, color: any): void;
  units(text: string): BreakUnit[];
  characters(text: string): string[];
}

// --- Standard fonts (Windows-1252) -------------------------------------------

function unencodableCharacters(font: any, text: string): string[] {
  const set = new Set<number>(font.getCharacterSet());
  return Array.from(new Set(Array.from(text).filter((char) => !set.has(char.codePointAt(0) ?? -1))));
}

function standardEngine(regular: any, bold: any): TextEngine {
  const fontFor = (isBold: boolean) => (isBold ? bold : regular);
  return {
    width: (text, size, isBold) => fontFor(isBold).widthOfTextAtSize(text, size),
    draw: (page, text, x, y, size, isBold, color) => page.drawText(text, { x, y, size, font: fontFor(isBold), color }),
    units: (text) => text.split(" ").filter(Boolean).map((word) => ({ text: word, joiner: " " })),
    characters: (text) => Array.from(text),
  };
}

// --- Embedded Noto fonts ------------------------------------------------------

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

function covers(entry: PdfFontEntry, codePoint: number): boolean {
  let low = 0;
  let high = entry.ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end] = entry.ranges[middle];
    if (codePoint < start) high = middle - 1;
    else if (codePoint > end) low = middle + 1;
    else return true;
  }
  return false;
}

/**
 * Common characters whose Simplified and Traditional forms differ (pairwise).
 * Both CJK fonts cover most of both sets, so coverage cannot tell them apart;
 * usage of these frequent forms can.
 */
const SIMPLIFIED_FORMS = "们个这来为会说对时国学经过与从动现实后员开关点体发业务电长问题应处书网资讯号区医疗职责协调导负专项价质统计划营销范围审标准历验证级际产设备运输购库仓门车东华湾办构织优键组队领训练络测试软数据户线环节讲读写语话页报记录杂单简";
const TRADITIONAL_FORMS = "們個這來為會說對時國學經過與從動現實後員開關點體發業務電長問題應處書網資訊號區醫療職責協調導負專項價質統計劃營銷範圍審標準歷驗證級際產設備運輸購庫倉門車東華灣辦構織優鍵組隊領訓練絡測試軟數據戶線環節講讀寫語話頁報記錄雜單簡";

/**
 * Fallback order: Noto Sans (Latin/Greek/Cyrillic/Vietnamese), Thai, then the
 * CJK family matching the document so shared Han characters take the right
 * regional glyph forms: Japanese when kana is present, Korean with Hangul,
 * Traditional Chinese when its distinctive forms outnumber Simplified ones.
 */
function familyOrder(manifest: PdfFontManifest, text: string): string[] {
  const has = (family: string) => manifest.families.includes(family);
  let primaryCjk = "noto-sans-sc";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) primaryCjk = "noto-sans-jp";
  else if (/\p{Script=Hangul}/u.test(text)) primaryCjk = "noto-sans-kr";
  else {
    let simplified = 0;
    let traditional = 0;
    for (const char of text) {
      if (SIMPLIFIED_FORMS.includes(char)) simplified += 1;
      else if (TRADITIONAL_FORMS.includes(char)) traditional += 1;
    }
    if (traditional > simplified) primaryCjk = "noto-sans-tc";
  }
  const leading = ["noto-sans", "noto-sans-thai", primaryCjk].filter(has);
  return [...leading, ...manifest.families.filter((family) => !leading.includes(family))];
}

interface LoadedFont {
  entry: PdfFontEntry;
  kit: any;
  bytes: Uint8Array;
}

class FontResolver {
  private readonly loaded = new Map<string, Promise<LoadedFont>>();
  private readonly order: PdfFontEntry[][];
  private readonly support: UnicodeFontSupport;
  private readonly fontkit: any;

  constructor(support: UnicodeFontSupport, fontkit: any, families: string[]) {
    this.support = support;
    this.fontkit = fontkit;
    // Candidates per weight in fallback order; bold falls back to regular.
    const forWeight = (weight: number) =>
      families.flatMap((family) => {
        const ofFamily = support.manifest.fonts.filter((font) => font.family === family);
        const exact = ofFamily.filter((font) => font.weight === weight);
        const regular = ofFamily.filter((font) => font.weight === 400);
        return weight === 400 ? regular : [...exact, ...regular.filter((font) => !exact.some((bold) => bold.subset === font.subset))];
      });
    this.order = [forWeight(400), forWeight(700)];
  }

  private load(entry: PdfFontEntry): Promise<LoadedFont> {
    let pending = this.loaded.get(entry.file);
    if (!pending) {
      pending = this.support.load(entry).then((bytes) => ({ entry, bytes, kit: this.fontkit.create(bytes) }));
      this.loaded.set(entry.file, pending);
    }
    return pending;
  }

  /** The first font, in fallback order, that has glyphs for every code point of `grapheme`. */
  async resolve(grapheme: string, bold: boolean): Promise<LoadedFont | null> {
    const codePoints = Array.from(grapheme, (char) => char.codePointAt(0) ?? 0);
    for (const entry of this.order[bold ? 1 : 0]) {
      if (!codePoints.every((codePoint) => covers(entry, codePoint))) continue;
      const font = await this.load(entry);
      if (codePoints.every((codePoint) => font.kit.hasGlyphForCodePoint(codePoint))) return font;
    }
    return null;
  }
}

function unicodeUnits(text: string): BreakUnit[] {
  const units: BreakUnit[] = [];
  for (const word of text.split(" ").filter(Boolean)) {
    if (!WORD_SPLIT_SCRIPT.test(word)) {
      units.push({ text: word, joiner: " " });
      continue;
    }
    // Chinese, Japanese, and Thai do not separate words with spaces: break
    // between words, keeping punctuation attached to the preceding word.
    let first = true;
    for (const segment of wordSegmenter.segment(word)) {
      const previous = units[units.length - 1];
      if (!first && !segment.isWordLike && previous) previous.text += segment.segment;
      else units.push({ text: segment.segment, joiner: first ? " " : "" });
      first = false;
    }
  }
  return units;
}

async function unicodeEngine(
  document: any,
  support: UnicodeFontSupport,
  texts: LabeledText[],
): Promise<TextEngine> {
  const unsupported = new Map<string, string[]>();
  for (const { text, label } of texts) {
    const found = text.match(UNSUPPORTED_LAYOUT_SCRIPT);
    if (found) unsupported.set(label, Array.from(new Set(found)));
  }
  if (unsupported.size > 0) {
    const [label, chars] = Array.from(unsupported)[0];
    throw new ResumePdfEncodingError(
      `The web resume renderer does not yet lay out right-to-left or Indic scripts. ${label} contains ${chars.slice(0, 8).join(" ")}. Remove or transliterate that text to export a PDF from the web app.`,
    );
  }

  const fontkit = await support.fontkit();
  document.registerFontkit(fontkit);
  const resolver = new FontResolver(support, fontkit, familyOrder(support.manifest, texts.map((item) => item.text).join("\n")));
  const resolved = new Map<string, LoadedFont>();
  const missing = new Map<string, Set<string>>();
  const key = (grapheme: string, bold: boolean) => `${bold ? "b" : "r"}:${grapheme}`;
  const required: LabeledText[] = [
    { text: BULLET, label: "The bullet", bold: false },
    { text: " ", label: "A space", bold: false },
    { text: " ", label: "A space", bold: true },
  ];
  for (const { text, label, bold } of [...texts, ...required]) {
    for (const grapheme of graphemes(text)) {
      if (resolved.has(key(grapheme, bold))) continue;
      const font = await resolver.resolve(grapheme, bold);
      if (font) resolved.set(key(grapheme, bold), font);
      else if (!/^\s+$/u.test(grapheme) || grapheme === " ") missing.set(label, (missing.get(label) ?? new Set()).add(grapheme));
    }
  }
  if (missing.size > 0) {
    const [label, chars] = Array.from(missing)[0];
    throw new ResumePdfEncodingError(
      `The web resume renderer supports ${SUPPORTED_SCRIPTS} text. ${label} contains characters it cannot render (${Array.from(chars).slice(0, 8).join(" ")}). Edit the text to export a PDF from the web app.`,
    );
  }

  // Embed in a stable order (manifest order) so identical input gives identical bytes.
  const used = Array.from(new Set(Array.from(resolved.values(), (font) => font.entry.file)));
  const ordered = support.manifest.fonts.filter((entry) => used.includes(entry.file));
  const embedded = new Map<string, { pdfFont: any; hasSpace: boolean }>();
  for (const entry of ordered) {
    const font = Array.from(resolved.values()).find((candidate) => candidate.entry.file === entry.file) as LoadedFont;
    embedded.set(entry.file, {
      pdfFont: await document.embedFont(font.bytes, { subset: true }),
      hasSpace: font.kit.hasGlyphForCodePoint(32),
    });
  }

  // Whitespace takes the font of the text around it; it never starts a font switch.
  const runs = (text: string, bold: boolean): { font: any; text: string }[] => {
    const result: { font: any; text: string; hasSpace: boolean }[] = [];
    for (const grapheme of graphemes(text)) {
      const previous = result[result.length - 1];
      if (grapheme === " " && previous?.hasSpace) {
        previous.text += grapheme;
        continue;
      }
      const own = resolved.get(key(grapheme, bold)) ?? (resolved.get(key(" ", bold)) as LoadedFont);
      const font = embedded.get(own.entry.file) as { pdfFont: any; hasSpace: boolean };
      if (previous && previous.font === font.pdfFont) previous.text += grapheme;
      else result.push({ font: font.pdfFont, text: grapheme, hasSpace: font.hasSpace });
    }
    return result;
  };

  return {
    width: (text, size, bold) => runs(text, bold).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0),
    draw: (page, text, x, y, size, bold, color) => {
      let cursor = x;
      for (const run of runs(text, bold)) {
        page.drawText(run.text, { x: cursor, y, size, font: run.font, color });
        cursor += run.font.widthOfTextAtSize(run.text, size);
      }
    },
    units: unicodeUnits,
    characters: graphemes,
  };
}

// --- Layout -------------------------------------------------------------------

function wrap(engine: TextEngine, text: string, size: number, width: number, bold: boolean): string[] {
  const lines: string[] = [];
  let current = "";
  const fits = (value: string) => engine.width(value, size, bold) <= width;
  for (const unit of engine.units(text)) {
    const candidate = current ? `${current}${unit.joiner}${unit.text}` : unit.text;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (fits(unit.text)) {
      current = unit.text;
      continue;
    }
    let fragment = "";
    for (const char of engine.characters(unit.text)) {
      if (fits(fragment + char)) fragment += char;
      else {
        lines.push(fragment);
        fragment = char;
      }
    }
    current = fragment;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/**
 * @param pdfLib the `pdf-lib` module namespace.
 * @param unicode embedded-font support; without it, text outside
 *   Windows-1252 fails with {@link ResumePdfEncodingError}.
 */
export async function renderResumePdfBytes(
  pdfLib: any,
  projection: ResumePdfProjection,
  statements: readonly ResumePdfStatement[],
  unicode?: UnicodeFontSupport,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, PageSizes } = pdfLib;
  const metrics = templateMetrics(projection.templateId);
  const document = await PDFDocument.create({ updateMetadata: false });
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const [pageWidth, pageHeight] = projection.pageFormat === "a4" ? PageSizes.A4 : PageSizes.Letter;
  const contentWidth = pageWidth - metrics.margin * 2;
  const black = rgb(0.067, 0.067, 0.067);

  const fullName = cleanText(projection.contact.fullName);
  const contactItems = [
    projection.contact.email,
    projection.contact.phone,
    projection.contact.location,
    ...projection.contact.links,
  ]
    .map(cleanText)
    .filter(Boolean);
  const ordered = projection.sections
    .map((section) => ({
      section,
      items: statements
        .filter((statement) => statement.section === section)
        .sort((a, b) => a.order - b.order)
        .map((statement) => cleanText(statement.text))
        .filter(Boolean),
    }))
    .filter((group) => group.items.length > 0);

  const texts: LabeledText[] = [
    { text: fullName, label: "The name", bold: true },
    ...contactItems.map((item) => ({ text: item, label: "The contact line", bold: false })),
    ...ordered.flatMap((group) => [
      { text: group.section.toUpperCase(), label: `Section "${group.section}"`, bold: true },
      ...group.items.map((item) => ({ text: item, label: `The statement "${item.slice(0, 60)}"`, bold: false })),
    ]),
  ];
  const firstUnencodable = texts.find((item) => unencodableCharacters(item.bold ? bold : regular, item.text).length > 0);
  let engine: TextEngine;
  if (!firstUnencodable) {
    engine = standardEngine(regular, bold);
  } else if (unicode) {
    engine = await unicodeEngine(document, unicode, texts);
  } else {
    const chars = unencodableCharacters(firstUnencodable.bold ? bold : regular, firstUnencodable.text);
    throw new ResumePdfEncodingError(
      `The web resume renderer supports Latin-script text (Windows-1252) without its font set. ${firstUnencodable.label} contains characters it cannot encode (${chars.slice(0, 8).join(" ")}). Edit the text to export a PDF from the web app.`,
    );
  }

  let page = document.addPage([pageWidth, pageHeight]);
  let cursor = pageHeight - metrics.margin;
  const ensureSpace = (height: number) => {
    if (cursor - height < metrics.margin) {
      page = document.addPage([pageWidth, pageHeight]);
      cursor = pageHeight - metrics.margin;
    }
  };
  const drawLine = (text: string, x: number, size: number, isBold: boolean) => {
    const lineHeight = size * metrics.lineHeight;
    ensureSpace(lineHeight);
    cursor -= size;
    engine.draw(page, text, x, cursor, size, isBold, black);
    cursor -= lineHeight - size;
  };
  const drawRule = (thickness: number) => {
    page.drawLine({
      start: { x: metrics.margin, y: cursor },
      end: { x: pageWidth - metrics.margin, y: cursor },
      thickness,
      color: rgb(0.35, 0.35, 0.35),
    });
  };

  for (const line of wrap(engine, fullName, metrics.name, contentWidth, true)) {
    drawLine(line, metrics.margin, metrics.name, true);
  }
  if (contactItems.length > 0) {
    for (const line of wrap(engine, contactItems.join("  |  "), metrics.contact, contentWidth, false)) {
      drawLine(line, metrics.margin, metrics.contact, false);
    }
  }
  cursor -= 4;
  drawRule(1.5);
  cursor -= metrics.sectionGap;

  for (const group of ordered) {
    ensureSpace(metrics.heading * 3);
    drawLine(group.section.toUpperCase(), metrics.margin, metrics.heading, true);
    cursor += 2;
    drawRule(0.75);
    cursor -= 5;
    for (const item of group.items) {
      const lines = wrap(engine, item, metrics.body, contentWidth - metrics.bulletIndent, false);
      lines.forEach((line, index) => {
        if (index === 0) {
          const lineHeight = metrics.body * metrics.lineHeight;
          ensureSpace(lineHeight);
          engine.draw(page, BULLET, metrics.margin + 3, cursor - metrics.body, metrics.body, false, black);
        }
        drawLine(line, metrics.margin + metrics.bulletIndent, metrics.body, false);
      });
      cursor -= metrics.itemGap;
    }
    cursor -= metrics.sectionGap;
  }

  const stamp = new Date(projection.updatedAt);
  const fixedDate = Number.isNaN(stamp.getTime()) ? new Date(0) : stamp;
  document.setTitle(`${fullName} - Resume`, { showInWindowTitleBar: false });
  document.setAuthor(fullName);
  document.setSubject("Resume");
  document.setCreator("Job Ranger");
  document.setProducer("Job Ranger web runtime (pdf-lib)");
  document.setCreationDate(fixedDate);
  document.setModificationDate(fixedDate);
  return document.save({ useObjectStreams: false });
}
