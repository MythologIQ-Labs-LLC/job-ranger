import { strToU8, zipSync } from "fflate";
import type { Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const distPwa = path.join(projectRoot, "dist-pwa");
/** Demo-flavor production build (npm run build:pwa:demo), served on its own origin by its tests. */
export const distPwaDemo = path.join(projectRoot, "dist-pwa-demo");

/** Minimal, valid DOCX (OOXML package) for a non-software career history. */
export function healthcareResumeDocx(): Buffer {
  const paragraph = (text: string, style?: string, list = false) =>
    `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ""}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const body = [
    paragraph("Morgan Rivera", "Title"),
    paragraph("Experience", "Heading1"),
    paragraph("Patient Services Coordinator, Harbor Family Clinic, 2023 - Present"),
    paragraph("Coordinated patient scheduling, referrals, and insurance verification for six providers.", undefined, true),
    paragraph("Maintained HIPAA-aware front-desk workflows and patient communications.", undefined, true),
    paragraph("Certifications", "Heading1"),
    paragraph("CPR/BLS, American Heart Association", undefined, true),
  ].join("");
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "word/document.xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    }),
  );
}

export const greenhouseFixture = {
  jobs: [
    {
      id: 4100123,
      title: "Medical Office Coordinator",
      absolute_url: "https://boards.greenhouse.io/harbor-health/jobs/4100123",
      location: { name: "Baltimore, MD" },
      updated_at: "2026-10-01T12:00:00-04:00",
      content:
        "&lt;p&gt;Coordinate patient scheduling, referrals, insurance verification, and front-desk workflows for a multi-provider clinic.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;At least two years of patient scheduling experience is required.&lt;/li&gt;&lt;li&gt;Experience with insurance verification is required.&lt;/li&gt;&lt;li&gt;Working knowledge of HIPAA privacy practices is required.&lt;/li&gt;&lt;li&gt;Current CPR or BLS certification is preferred.&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Salary: $52,000 - $68,000 per year. Full-time.&lt;/p&gt;",
    },
  ],
};

/**
 * Resolves once the web runtime is usable *and* the application has rendered.
 *
 * The entry point installs `window.electronAPI` before it imports the `App` chunk, and
 * the boot screen only exists after React mounts, so neither fact alone proves the UI is
 * on screen (#298). Every route, including onboarding and loading states, renders the
 * shared `Layout`, whose `#main-content` landmark is therefore the readiness signal.
 */
export async function waitForRuntime(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { electronAPI?: unknown }).electronAPI), null, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="pwa-boot-screen"]') &&
      document.getElementById("main-content") !== null,
    null,
    { timeout: 60_000 },
  );
}

export const healthcareProfile = {
  version: 2,
  fullName: "Morgan Rivera",
  homeLocation: "Baltimore, MD",
  radiusMiles: 30,
  minimumPay: 52000,
  payBasis: "annual",
  targetTitles: ["Medical Office Coordinator", "Patient Services Coordinator"],
  skills: ["Patient scheduling", "Insurance verification", "HIPAA workflows"],
  certifications: ["CPR/BLS"],
  sectors: ["Healthcare"],
  onCallPreference: "no",
  fullTimeOnly: true,
  updatedAt: null,
} as const;
