const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

const { ResumeService } = require("../electron-runtime/electron/src/resume-service.cjs");
const {
  buildTruthEvidenceIndex,
  unsupportedTruthTokens,
} = require("../electron-runtime/electron/src/truth-gate-tokens.cjs");

// evaluateTruth is pure; the service never touches SQLite here.
const tempDir = path.join(os.tmpdir(), "sojourner-truth-gate-unused");
const service = new ResumeService({
  dataDirectory: tempDir,
  databasePath: path.join(tempDir, "unused.sqlite"),
  sqliteBinaryPath: "sqlite3",
});

function evidence(id, fields) {
  return {
    id,
    subjectType: "achievement",
    verificationState: "user-confirmed",
    statement: "",
    organization: null,
    titleOrName: null,
    skills: [],
    methodsOrTools: [],
    scope: [],
    outcomes: [],
    metrics: [],
    ...fields,
  };
}

function gate(text, item) {
  const report = service.evaluateTruth(
    {},
    [{ id: "statement-1", text, evidenceIds: [item.id], userEdited: true }],
    [item],
  );
  return report.issues.find((issue) => issue.code === "unsupported-edit");
}

function assertFlagged(text, item, expectedTerms, label) {
  const issue = gate(text, item);
  assert.ok(issue, `${label}: expected unsupported-edit for "${text}"`);
  for (const term of expectedTerms) {
    assert.ok(
      issue.message.includes(term),
      `${label}: message should name "${term}": ${issue.message}`,
    );
  }
}

function assertPasses(text, item, label) {
  const issue = gate(text, item);
  assert.equal(issue, undefined, `${label}: ${issue?.message}`);
}

const legacyStopWords = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of",
  "on", "or", "the", "to", "with", "using", "through", "across", "within",
  "while", "that", "this", "these", "those", "is", "are", "was", "were",
]);

const cases = [];
function test(name, fn) {
  cases.push([name, fn]);
}

test("English behaviour matches the legacy tokenizer, plus single digits", () => {
  const item = evidence("en", {
    statement: "Led migration of billing services to Kubernetes for 12 teams",
    skills: ["Kubernetes", "Go"],
  });
  assertPasses("Led the Kubernetes migration of billing services across 12 teams", item, "en reword");
  assertFlagged("Led Kubernetes migration and earned AWS certification", item, ["aws", "certification", "earned"], "en add");
  // Parity with the pre-Unicode tokenizer on ASCII text, plus single digits.
  const legacy = (value) =>
    value
      .toLowerCase()
      .match(/[a-z0-9+#.-]+/g)
      ?.map((token) => token.replace(/^[.-]+|[.-]+$/g, ""))
      .filter(
        (token) =>
          (token.length > 1 || /^[0-9]$/.test(token)) && !legacyStopWords.has(token),
      ) ?? [];
  const samples = [
    "Reduced p95 latency 38% by rewriting the C# ingestion path in Go 1.21.",
    "Owned CI/CD for 40+ services; migrated Jenkins -> GitHub Actions (2019-2021).",
    "Managed $1.2M budget, hired 5 engineers, shipped v2.0 of the iOS app.",
    "Node.js, TypeScript, React, .NET, A/B testing, e-commerce -- end-to-end.",
  ];
  for (const sample of samples) {
    const expected = Array.from(new Set(legacy(sample)));
    assert.deepEqual(unsupportedTruthTokens(sample, buildTruthEvidenceIndex("")), expected, sample);
    assert.deepEqual(unsupportedTruthTokens(sample, buildTruthEvidenceIndex(sample)), [], sample);
  }
  // Pinned legacy behaviour for ASCII text: tokens and order match the old regex.
  const index = buildTruthEvidenceIndex("C++ and Node.js -- CI/CD.");
  assert.deepEqual(
    unsupportedTruthTokens("C++, node.js, ci, cd, rust.", index),
    ["rust"],
  );
});

test("Single-digit numbers are checked", () => {
  const item = evidence("num", {
    statement: "Hired 5 engineers and cut release time from 3 weeks to 2 days",
    metrics: ["3 weeks", "2 days"],
  });
  assertPasses("Cut release time from 3 weeks to 2 days and hired 5 engineers", item, "same digits");
  assertFlagged("Hired 9 engineers and cut release time from 3 weeks to 2 days", item, ["9"], "changed digit");
  assertFlagged("Hired 5 engineers and cut release time from 3 weeks to 1 day", item, ["1", "day"], "changed metric");
  // Mixed-script and non-ASCII digits.
  assertFlagged("带领9人团队", evidence("zh-num", { statement: "带领5人团队" }), ["9"], "zh digit");
  assertPasses("带领5人团队", evidence("zh-num-ok", { statement: "带领5人团队" }), "zh digit ok");
  assertFlagged("قاد ٩ مهندسين", evidence("ar-num", { statement: "قاد ٥ مهندسين" }), ["٩"], "arabic-indic digit");
  // Single letters are still ignored.
  assertPasses("Hired 5 engineers (team a)", evidence("letter", { statement: "Hired 5 engineers team" }), "single letter");
});

test("Chinese: unsupported certification is flagged", () => {
  const item = evidence("zh", {
    statement: "负责数据平台项目管理，带领五人团队完成迁移",
    skills: ["项目管理"],
  });
  assertFlagged("负责数据平台项目管理，并获得注册会计师证书", item, ["注", "册", "证"], "zh cert");
  assertFlagged("负责数据平台项目管理，获得PMP认证", item, ["pmp"], "zh latin cert");
});

test("Chinese: reworded statement using evidence terms plus particles passes", () => {
  const item = evidence("zh-ok", {
    statement: "负责数据平台项目管理，带领五人团队完成迁移",
  });
  assertPasses("带领五人团队，完成了数据平台的迁移和项目管理", item, "zh reword");
});

test("Japanese: kanji/katakana content flagged, hiragana particles tolerated", () => {
  const item = evidence("ja", {
    statement: "クラウド基盤の移行プロジェクトを担当",
    titleOrName: "プロジェクト・マネージャー",
  });
  assertPasses("プロジェクトマネージャーとしてクラウド基盤の移行を担当しました", item, "ja reword");
  assertFlagged("クラウド基盤の移行を担当し、公認会計士の資格を取得", item, ["公", "資"], "ja kanji");
  assertFlagged("セキュリティ監査を担当", item, ["セキュリティ"], "ja katakana");
});

test("Korean: particles and endings stripped, new content flagged", () => {
  const item = evidence("ko", {
    statement: "데이터 플랫폼 이전 프로젝트 관리",
  });
  assertPasses("데이터 플랫폼 이전 프로젝트를 관리했습니다", item, "ko reword");
  assertFlagged("데이터 플랫폼 이전 프로젝트를 관리하고 공인회계사 자격을 취득했습니다", item, ["공인회계사", "자격"], "ko add");
});

test("Cyrillic, Greek, Arabic, Hebrew, Devanagari words are checked", () => {
  const ru = evidence("ru", { statement: "Руководил миграцией платформы данных" });
  assertPasses("Руководил миграцией платформы данных", ru, "ru same");
  assertFlagged("Руководил миграцией платформы данных и получил сертификат", ru, ["сертификат"], "ru add");

  const el = evidence("el", { statement: "Διαχείριση έργου μετάπτωσης" });
  assertFlagged("Διαχείριση έργου και πιστοποίηση", el, ["πιστοποίηση"], "el add");

  const ar = evidence("ar", { statement: "إدارة مشروع ترحيل البيانات" });
  assertPasses("وإدارة مشروع ترحيل البيانات", ar, "ar proclitic");
  assertFlagged("إدارة مشروع ترحيل البيانات وشهادة محاسب", ar, ["محاسب"], "ar add");

  const he = evidence("he", { statement: "ניהול פרויקט הגירת נתונים" });
  assertPasses("ניהול פרויקט הגירת הנתונים", he, "he proclitic");
  assertFlagged("ניהול פרויקט הגירת נתונים ותעודת רואה חשבון", he, ["חשבון"], "he add");

  const hi = evidence("hi", { statement: "डेटा प्लेटफ़ॉर्म माइग्रेशन का प्रबंधन" });
  assertPasses("डेटा प्लेटफ़ॉर्म माइग्रेशन का प्रबंधन किया", hi, "hi light verb");
  assertFlagged("डेटा प्लेटफ़ॉर्म माइग्रेशन और प्रमाणपत्र", hi, ["प्रमाणपत्र"], "hi add");
});

test("Accented Latin is a whole word and folds accents", () => {
  const item = evidence("es", { statement: "Gestión de proyectos de migración" });
  assertPasses("gestion de proyectos de migracion", item, "es folded");
  assertFlagged("Gestión de proyectos y certificación PMP", item, ["certificación", "pmp"], "es add");
  // Previously "résumé" tokenized to "sum"; now the whole word is required.
  assertFlagged("résumé", evidence("fr", { statement: "summary" }), ["résumé"], "fr word");
});

test("Thai: segmented words must appear in evidence", () => {
  const item = evidence("th", { statement: "ผู้จัดการโครงการย้ายระบบข้อมูล" });
  assertPasses("ผู้จัดการโครงการและย้ายระบบข้อมูล", item, "th reword");
  assertFlagged("ผู้จัดการโครงการและนักบัญชีรับอนุญาต", item, ["บัญชี"], "th add");
});

test("Full-width forms are normalized", () => {
  const item = evidence("fw", { statement: "Python 開発" });
  assertPasses("Ｐｙｔｈｏｎ開発", item, "fw same");
  assertFlagged("Ｐｙｔｈｏｎ開発、ＡＷＳ", item, ["aws"], "fw add");
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error.stack}`);
  }
}
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log("Multilingual Truth Gate tests passed.");
}
