import { expect, test } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

test("Personal Brand manual workflow persists exact copy, receipt and analytics after reload", async ({ page, context }) => {
  const outbound: string[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(server.url).origin)
      outbound.push(request.url());
  });
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.goto(`${server.url}#/personal-brand`);
  await expect(page.getByRole("heading", { name: /Make the post useful/i })).toBeVisible();
  const exportGuide = page.getByTestId("linkedin-analytics-export-guide");
  await expect(exportGuide.locator("summary")).toHaveText(/export your LinkedIn analytics/i);
  await exportGuide.locator("summary").click();
  await expect(exportGuide.getByRole("link", { name: /LinkedIn Help/i })).toHaveAttribute("href", "https://www.linkedin.com/help/linkedin/answer/a703268");
  await expect(exportGuide.getByText(/Import preview available below/i)).toBeVisible();
  await expect(exportGuide.getByText(/Past 365 days/)).toBeVisible();


  const text = "A rejection taught me that hiring signals can be incomplete. Here is what I learned.";
  await page.getByLabel("Post text (LinkedIn, text only)").fill(text);
  await page.getByLabel("Hook type").selectOption("concrete_experience");
  await page.getByLabel("Hypothesis to evaluate").fill("A concrete experience brings profile visits.");
  await expect(page.getByText("A human must review originality")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved in the Job Ranger database.")).toBeVisible();

  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByLabel("Post text (LinkedIn, text only)")).toHaveValue(text);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Prepare and copy" }).click();
  await expect(page.getByLabel("Exact prepared post text")).toHaveValue(text);
  const apiPrepared = await page.evaluate(() => window.electronAPI.personalBrand.listPrepared());
  expect(apiPrepared).toHaveLength(1);
  expect(apiPrepared[0].body).toBe(text);

  await page.getByLabel("LinkedIn post URL").fill("https://www.linkedin.com/feed/update/urn:li:activity:15991");
  const publishTime = await page.evaluate(() => {
    const date = new Date(Date.now() - 60_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.getByLabel("Local publication date and time").fill(publishTime);
  await expect(page.getByRole("button", { name: "Record manual publication" })).toBeDisabled();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "Record manual publication" }).click();
  await expect(page.getByText(/publication was recorded as user-confirmed/i)).toBeVisible();
  const publications = await page.evaluate(() => window.electronAPI.personalBrand.listPublications());
  expect(publications).toHaveLength(1);

  await page.getByRole("spinbutton", { name: "Impressions", exact: true }).fill("300");
  await page.getByRole("spinbutton", { name: "Members reached", exact: true }).fill("200");
  await page.getByRole("spinbutton", { name: "Profile views from post", exact: true }).fill("7");
  await page.getByRole("button", { name: "Save timestamped analytics" }).click();
  await expect(page.getByText("Profile visits/reached:")).toBeVisible();
  await expect(page.getByText("3.50%")).toBeVisible();
  const saved = await page.evaluate((id) => window.electronAPI.personalBrand.listSnapshots(id), publications[0].postId);
  expect(saved).toHaveLength(1);
  expect(saved[0].observations.find((m: { name: string }) => m.name === "followers_gained").state).toBe("unavailable");
  expect(saved[0].observations.find((m: { name: string }) => m.name === "reached").value).toBe(200);

  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByLabel("Post text (LinkedIn, text only)")).toHaveValue(text);
  await expect(page.getByText("3.50%")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publication recorded" })).toBeDisabled();
  // Restoring cached approval history must not auto-display selectable text
  // without another current-evidence check and editorial confirmation.
  await expect(page.getByLabel("Exact prepared post text")).toHaveCount(0);
  expect(outbound).toEqual([]);
});

test("linked factual claims fail closed after Career Evidence is superseded", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);

  const evidence = await page.evaluate(() => window.electronAPI.career.createUserEvidence({
    subjectType: "role",
    organization: "Sample Community Clinic",
    titleOrName: "Operations Coordinator",
    startDate: "2023-01",
    endDate: null,
    statement: "Coordinated appointment scheduling for a community clinic.",
    skills: ["Scheduling"],
    methodsOrTools: [],
    scope: [],
    outcomes: [],
    metrics: [],
    credential: null,
  }));

  await page.goto(`${server.url}#/personal-brand`);
  await expect(page.getByRole("heading", { name: /Make the post useful/i })).toBeVisible();
  await page.getByLabel("Post text (LinkedIn, text only)").fill(
    "I coordinated appointment scheduling for a community clinic.",
  );
  await page.getByRole("button", { name: "Add factual claim" }).click();
  await page.getByLabel("Claim being checked").fill(
    "I coordinated appointment scheduling for a community clinic.",
  );
  await page.getByLabel("Link Career Evidence for claim 1").selectOption(evidence.id);
  await page.getByRole("checkbox", { name: /personally checked this claim/i }).check();
  await page.getByRole("checkbox", { name: /private, confidential, or restricted/i }).check();
  await page.getByRole("checkbox", { name: /personally reviewed the exact content/i }).check();
  await page.getByRole("button", { name: "Prepare and copy" }).click();
  await expect(page.getByRole("button", { name: "Recheck evidence and copy" })).toBeVisible();

  const [draft] = await page.evaluate(() => window.electronAPI.personalBrand.listDrafts());
  expect(draft.claimChecks[0].evidenceIds).toEqual([evidence.id]);
  expect(draft.claimChecks[0].verified).toBe(true);

  const successor = await page.evaluate(({ id }) =>
    window.electronAPI.careerEvidence.supersedeEvidence(id, {
      subjectType: "role",
      statement: "Coordinated scheduling and referral tracking for a community clinic.",
    }), { id: evidence.id });
  await page.getByRole("button", { name: "Refresh Career Evidence" }).click();
  await expect(page.getByLabel("Exact prepared post text")).toHaveCount(0);
  await expect(page.getByText(/1 linked evidence record\(s\) are missing, rejected, or superseded/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Recheck evidence and copy" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare and copy" })).toBeDisabled();

  const attempt = await page.evaluate(async ({ id, revision }) =>
    window.electronAPI.personalBrand.prepareDraft(id, revision, true).then(
      () => "allowed",
      (error: Error) => error.message,
    ), { id: draft.id, revision: draft.revision });
  expect(attempt).toMatch(/missing or no longer current/);

  await page.getByRole("button", { name: "Remove link" }).click();
  await page.getByLabel("Link Career Evidence for claim 1").selectOption(successor.id);
  await expect(page.getByRole("checkbox", { name: /personally checked this claim/i })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /private, confidential, or restricted/i })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /personally checked this claim/i }).check();
  await page.getByRole("checkbox", { name: /private, confidential, or restricted/i }).check();
  await page.getByRole("checkbox", { name: /personally reviewed the exact content/i }).check();
  await page.getByRole("button", { name: "Prepare and copy" }).click();
  await expect(page.getByLabel("Exact prepared post text")).toHaveValue("I coordinated appointment scheduling for a community clinic.");
  const [updated] = await page.evaluate(() => window.electronAPI.personalBrand.listDrafts());
  expect(updated.revision).toBeGreaterThan(draft.revision);
  expect(updated.claimChecks[0].evidenceIds).toEqual([successor.id]);
});

test("comparison screen uses since-publication ages and shows non-causal suggestions", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);

  // Screenshots recorded days later should still compare at the time their
  // cumulative analytics window ended. User-entered metrics remain manual.
  await page.evaluate(async () => {
    const api = window.electronAPI.personalBrand;
    for (const [index, hook, views] of [
      [0, "concrete_experience", 10],
      [1, "contradiction", 3],
    ] as const) {
      const draft = await api.createDraft({
        body: `A verifiable experience from my professional journey ${index}.`,
        objective: "recruiter_discovery", audiences: ["hiring managers"],
        destination: "linkedin", format: "text", hookArchetype: hook,
        hypothesis: "Compare professional profile discovery.",
        claimChecks: [], mediaCount: 0, mediaAccessibilityReviewed: true,
      });
      await api.prepareDraft(draft.id, draft.revision, true);
      const publishedAt = new Date(Date.now() - (index + 5) * 86400000).toISOString();
      const receipt = await api.confirmPublication({
        draftId: draft.id, revision: draft.revision,
        publishedUrl: `https://www.linkedin.com/feed/update/urn:li:activity:learning-${index}`,
        publishedAt, userConfirmed: true,
      });
      await api.appendSnapshot(receipt.postId, {
        capturedAt: new Date().toISOString(),
        windowStart: publishedAt,
        windowEnd: new Date(Date.parse(publishedAt) + 24 * 3600000).toISOString(),
        sourceLabel: "Manually transcribed individual post metrics",
        observations: [
          { name: "profile_views", state: "manual", value: views },
          { name: "reached", state: "manual", value: 100 },
        ],
      });
    }
  });

  await page.goto(`${server.url}#/personal-brand`);
  await expect(page.getByRole("heading", { name: "4. Compare equivalent post ages" })).toBeVisible();
  await expect(page.getByText("2 comparable of 2 recorded LinkedIn posts")).toBeVisible();
  await expect(page.getByRole("cell", { name: "10.00%" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "3.00%" })).toBeVisible();
  await expect(page.getByText(/test one hook variation/i)).toBeVisible();
  await expect(page.getByText(/not proof of a winning hook/i)).toBeVisible();
  const contentReview = page.getByTestId("linkedin-approved-content-cohorts");
  await expect(contentReview.getByText(/2 of 2 posts have verified original copy/)).toBeVisible();
  await expect(contentReview.getByText(/1 hook-contrast review candidates/)).toBeVisible();
  await expect(contentReview.getByText(/not controlled/)).toBeVisible();
  for (const summary of await contentReview.getByText("Inspect fingerprint-verified approved copy").all()) {
    await summary.click();
  }
  await expect(contentReview.getByText("A verifiable experience from my professional journey 0.")).toBeVisible();
  await expect(contentReview.getByText("A verifiable experience from my professional journey 1.")).toBeVisible();

  await page.getByLabel("Observation age").selectOption("48");
  await expect(page.getByText("0 comparable of 2 recorded LinkedIn posts")).toBeVisible();
  await expect(contentReview.getByText(/0 hook-contrast review candidates/)).toBeVisible();
  await expect(page.getByText(/Insufficient comparable data/)).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Observation age").selectOption("24");
  await page.getByLabel("Outcome measure").selectOption("engagements_per_reached");
  await expect(page.getByText("0 comparable of 2 recorded LinkedIn posts")).toBeVisible();
  await expect(page.getByText(/At least one required metric is unavailable/i).first()).toBeVisible();
  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "4. Compare equivalent post ages" })).toBeVisible();
  await expect(page.getByText("2 comparable of 2 recorded LinkedIn posts")).toBeVisible();
});

test("career outcomes require manual confirmation and retain only user-attested post context", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  const publication = await page.evaluate(async () => {
    const api = window.electronAPI.personalBrand;
    const draft = await api.createDraft({
      body: "An example of my professional work.", objective: "career_narrative",
      audiences: ["recruiters"], destination: "linkedin", format: "text",
      hookArchetype: "lesson", hypothesis: "Professional context can lead to conversations.",
      claimChecks: [], mediaCount: 0, mediaAccessibilityReviewed: true,
    });
    await api.prepareDraft(draft.id, draft.revision, true);
    return api.confirmPublication({
      draftId: draft.id, revision: draft.revision,
      publishedAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
      publishedUrl: "https://www.linkedin.com/feed/update/urn:li:activity:outcomes-1",
      userConfirmed: true,
    });
  });
  await page.goto(`${server.url}#/personal-brand`);
  await expect(page.getByRole("heading", { name: "5. Record real career outcomes" })).toBeVisible();
  await expect(page.getByText("No confirmed events recorded.")).toBeVisible();
  await page.getByLabel("Type of career outcome").selectOption("meaningful_conversation");
  const localTime = await page.evaluate(() => {
    const time = new Date(Date.now() - 60000);
    return new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  await page.getByLabel("Local date and time of event").fill(localTime);
  await page.getByLabel("Related published post (optional)").selectOption(publication.postId);
  const save = page.getByRole("button", { name: "Save confirmed career outcome" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Observed post relationship").selectOption("post_mentioned");
  await page.getByRole("checkbox", { name: /I confirm the event actually happened/i }).check();
  await save.click();
  await expect(page.getByText("Career outcome recorded as user-attested, not attributed to a post.")).toBeVisible();

  let outcomes = await page.evaluate(() => window.electronAPI.personalBrand.listCareerOutcomes());
  expect(outcomes).toHaveLength(1);
  expect(outcomes[0].association).toBe("post_mentioned");
  expect(outcomes[0].relatedPostId).toBe(publication.postId);
  await expect(page.getByText(/1 confirmed events/)).toBeVisible();
  await expect(page.getByText(/not conversions attributable to a post/i)).toBeVisible();
  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "5. Record real career outcomes" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Meaningful professional conversation" })).toBeVisible();

  const rejected = await page.evaluate(async (postId) => {
    const api = window.electronAPI.personalBrand;
    return api.recordCareerOutcome({
      kind: "offer", occurredAt: "2020-01-01T00:00:00.000Z",
      sourceLabel: "Personal journal", note: "",
      relatedPostId: postId, association: "post_mentioned", userConfirmed: true,
    }).then(() => "incorrectly allowed", (error: Error) => error.message);
  }, publication.postId);
  expect(rejected).toMatch(/post published later/);

  await page.getByRole("button", { name: "Remove outcome" }).click();
  await expect(page.getByRole("button", { name: "Confirm removal" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm removal" }).click();
  outcomes = await page.evaluate(() => window.electronAPI.personalBrand.listCareerOutcomes());
  expect(outcomes).toHaveLength(0);
  await expect(page.getByText("No confirmed events recorded.")).toBeVisible();
});


test("LinkedIn XLSX requires review before saving and deduplicates repeat imports", async ({ page, context }) => {
  const outbound: string[] = [];
  context.on("request", request => {
    if (new URL(request.url()).origin !== new URL(server.url).origin) outbound.push(request.url());
  });
  const columns = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sheetXml = (rows: Array<Array<string | number | null>>) => {
    const xmlRows = rows.map((row, index) => {
      const cells = row.map((value, col) => {
        if (value === null) return "";
        const ref = columns[col] + (index + 1);
        return typeof value === "number"
          ? `<c r="${ref}" t="n"><v>${value}</v></c>`
          : `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
      }).join("");
      return `<row r="${index + 1}">${cells}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`;
  };
  const fakeUrl = "https://www.linkedin.com/posts/example-jobs-share-98765-abc";
  const data: Record<string, Array<Array<string | number | null>>> = {
    "DISCOVERY": [["Overall Performance", "10/8/2026 - 10/9/2026"], ["Impressions", 12], ["Members reached", 8]],
    "ENGAGEMENT": [["Date", "Impressions", "Engagements"], ["10/8/2026", 4, 0], ["10/9/2026", 8, 2]],
    "TOP POSTS": [["Maximum of 50 posts available to include in this list"], [],
      ["Post URL", "Post Publish Date", "Engagements", "481", "Post URL", "Post Publish Date", "Impressions"],
      [fakeUrl, "10/9/2026", 2, "481", fakeUrl, "10/9/2026", 10]],
    "FOLLOWERS": [["Total followers on 10/9/2026", 101], [], ["Date", "New followers"],
      ["10/8/2026", 0], ["10/9/2026", 1]],
    "AUDIENCE DEMOGRAPHICS": [["Top Demographics", "Value", "Percentage"], ["Location", "Exampleville", "< 1%"]],
    "CONTENT DEMOGRAPHICS": [["Top Demographics", "Value", "Percentage"], ["Company size", "11-50", "12%"]],
  };
  const names = Object.keys(data);
  const book = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(book),
    "xl/_rels/workbook.xml.rels": strToU8(rels),
  };
  names.forEach((name, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(data[name])); });
  const zip = Buffer.from(zipSync(files));
  await page.goto(server.url);
  await waitForRuntime(page);
  const approvedCopy = "This user-reviewed synthetic LinkedIn post is a historical fixture.";
  await page.evaluate(async ({ url, body }) => {
    const api = window.electronAPI.personalBrand;
    const draft = await api.createDraft({
      body, objective: "expertise_proof", audiences: ["hiring managers"],
      destination: "linkedin", format: "text", hookArchetype: "contradiction",
      hypothesis: "Observe engagement without attributing career outcomes.",
      claimChecks: [], mediaCount: 0, mediaAccessibilityReviewed: true,
    });
    await api.prepareDraft(draft.id, draft.revision, true);
    await api.confirmPublication({
      draftId: draft.id, revision: draft.revision,
      publishedUrl: url + "?trk=manual-test",
      publishedAt: "2026-10-09T14:00:00-04:00",
      userConfirmed: true,
    });
  }, { url: fakeUrl, body: approvedCopy });
  await page.goto(`${server.url}#/personal-brand`);
  const area = page.getByTestId("linkedin-xlsx-preview");
  await area.getByLabel("Choose exported LinkedIn XLSX (local preview only)").setInputFiles({
    name: "AggregateAnalytics_synthetic.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: zip,
  });
  await expect.poll(async () => ({
    preview: await area.getByTestId("linkedin-preview-results").count(),
    importError: (await area.getByRole("alert").allTextContents()).join(" | "),
  }), { timeout: 10_000 }).toEqual({ preview: 1, importError: "" });
  await expect(area.getByText(/Export review: 2026-10-08 through 2026-10-09/)).toBeVisible();
  await expect(area.getByText("12", { exact: true })).toBeVisible();
  await expect(area.getByText("101", { exact: true })).toBeVisible();
  await expect(area.getByRole("link", { name: "View post" })).toHaveAttribute("href", fakeUrl);
  expect(outbound).toEqual([]);
  await expect(area.getByTestId("linkedin-import-ledger").getByText(/Saved LinkedIn exports \(0\)/)).toBeVisible();
  await expect(area.getByRole("button", { name: "Review and save LinkedIn export" })).toBeDisabled();
  await area.getByRole("checkbox", { name: /I reviewed the reporting period/i }).check();
  await area.getByRole("button", { name: "Review and save LinkedIn export" }).click();
  await expect(area.getByText(/LinkedIn analytics saved in the local Job Ranger database/)).toBeVisible();
  await expect(area.getByTestId("linkedin-import-ledger").getByText(/Saved LinkedIn exports \(1\)/)).toBeVisible();
  const linkedPosts = area.getByTestId("linkedin-post-content-enrichment");
  await expect(linkedPosts.getByText(/1 original approved copies matched/)).toBeVisible();
  await expect(linkedPosts.getByText(/copy verified/)).toBeVisible();
  await linkedPosts.getByText("View original user-approved copy").click();
  await expect(linkedPosts.getByText(approvedCopy)).toBeVisible();
  await expect(linkedPosts.getByText(/Current draft metadata: hook contradiction/)).toBeVisible();
  const reconcile = area.getByTestId("linkedin-reconciliation");
  await expect(reconcile.getByText("Days observed", { exact: true })).toBeVisible();
  await expect(reconcile.getByText("2 of 2", { exact: true })).toBeVisible();
  await expect(reconcile.getByText("12", { exact: true })).toBeVisible();
  await expect(reconcile.getByText(/2026-10-08 to 2026-10-09/)).toBeVisible();
  await page.reload();
  await waitForRuntime(page);
  const newArea = page.getByTestId("linkedin-xlsx-preview");
  await expect(page.getByTestId("linkedin-preview-results")).toHaveCount(0);
  await expect(newArea.getByTestId("linkedin-import-ledger").getByText(/Saved LinkedIn exports \(1\)/)).toBeVisible();
  await expect(newArea.getByTestId("linkedin-reconciliation").getByText("2 of 2", { exact: true })).toBeVisible();
  await expect(newArea.getByTestId("linkedin-post-content-enrichment").getByText(/1 original approved copies matched/)).toBeVisible();
  await newArea.getByLabel("Choose exported LinkedIn XLSX (local preview only)").setInputFiles({
    name: "AggregateAnalytics_synthetic.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: zip,
  });
  await expect(newArea.getByTestId("linkedin-preview-results")).toBeVisible();
  await newArea.getByRole("checkbox", { name: /I reviewed the reporting period/i }).check();
  await newArea.getByRole("button", { name: "Review and save LinkedIn export" }).click();
  await expect(newArea.getByText(/already saved. No duplicate records/)).toBeVisible();
  await expect(newArea.getByTestId("linkedin-import-ledger").getByText(/Saved LinkedIn exports \(1\)/)).toBeVisible();
  await newArea.getByLabel("Select an import to delete").selectOption({ index: 1 });
  await newArea.getByRole("checkbox", { name: /I confirm deletion of the selected/i }).check();
  await newArea.getByRole("button", { name: "Delete selected export" }).click();
  await expect(newArea.getByTestId("linkedin-import-ledger").getByText(/Saved LinkedIn exports \(0\)/)).toBeVisible();
  await expect(newArea.getByTestId("linkedin-reconciliation").getByText(/No saved LinkedIn exports yet/)).toBeVisible();
  await expect(newArea.getByTestId("linkedin-post-content-enrichment").getByText(/Save a LinkedIn analytics export/)).toBeVisible();
});


test("historical LinkedIn posts remain user-attested and match only consistent XLSX source URLs", async ({ page, context }) => {
  const requests: string[] = [];
  context.on("request", req => {
    if (new URL(req.url()).origin !== new URL(server.url).origin) requests.push(req.url());
  });
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.goto(`${server.url}#/personal-brand`);
  const historical = page.getByTestId("linkedin-historical-archive");
  const link = "https://www.linkedin.com/posts/example-user-historical-career-443";
  const body = "A historical post pasted by its author, never pre-approved in Job Ranger.";
  await expect(historical.getByText(/No historical posts archived yet/)).toBeVisible();
  await historical.getByLabel("Historical LinkedIn post permalink").fill(link + "?trk=feed");
  await historical.getByLabel(/Original publication date/).fill("2026-09-20");
  await historical.getByLabel("Historical post text").fill(body);
  await expect(historical.getByRole("button", { name: "Save historical LinkedIn post" })).toBeDisabled();
  await historical.getByRole("checkbox", { name: /I confirm that this is my historical post/ }).check();
  await historical.getByRole("button", { name: "Save historical LinkedIn post" }).click();
  await expect(historical.getByText("Historical archive (1 posts)")).toBeVisible();
  const saved = await page.evaluate(() => window.electronAPI.personalBrand.listHistoricalLinkedInPosts());
  expect(saved).toHaveLength(1);
  expect(saved[0].source).toBe("user_attested_historical");
  expect(saved[0].url).toBe(link);
  expect(saved[0].body).toBe(body);
  const source = {
    format: "linkedin-aggregate-analytics-v1",
    period: { start: "2026-09-19", end: "2026-09-20" },
    discovery: { impressions: 3, membersReached: 2 },
    followers: { asOf: "2026-09-20", total: 17 },
    daily: [
      { date: "2026-09-19", impressions: 1, engagements: 0, newFollowers: 0 },
      { date: "2026-09-20", impressions: 2, engagements: 1, newFollowers: 0 },
    ],
    topPosts: [{
      url: link, publishedOn: "2026-09-20", impressions: 222, engagements: null,
    }],
    audienceDemographics: [], contentDemographics: [], warnings: [],
    provenance: "manual-linkedIn-export",
  };
  await page.evaluate(data => window.electronAPI.personalBrand.saveLinkedInImport(data, true), source);
  await page.reload();
  await waitForRuntime(page);
  const archive = page.getByTestId("linkedin-historical-archive");
  await expect(archive.getByText("Historical archive (1 posts)")).toBeVisible();
  await expect(archive.getByText(/Latest XLSX ranking:/)).toBeVisible();
  await expect(archive.getByText(/222; engagements: Unknown/)).toBeVisible();
  await archive.getByText("View manually recorded post text").click();
  await expect(archive.getByText(body)).toBeVisible();
  await archive.getByLabel("Select a historical post to delete").selectOption({index:1});
  await expect(archive.getByRole("button", {name:"Delete historical post"})).toBeDisabled();
  await archive.getByRole("checkbox", {name:/I confirm deletion of this user-attested/}).check();
  await archive.getByRole("button", {name:"Delete historical post"}).click();
  await expect(archive.getByText("Historical archive (0 posts)")).toBeVisible();
  expect(await page.evaluate(() => window.electronAPI.personalBrand.listLinkedInImports())).toHaveLength(1);
  expect(requests).toEqual([]);
});


test("LinkedIn dashboard compares only complete seven-day windows and withholds disputed totals", async ({page}) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  const content = (lastDayImpressions: number) => {
    const rows = Array.from({length:14},(_,i)=>({
      date:`2026-09-${String(i+1).padStart(2,"0")}`,
      impressions:i===13?lastDayImpressions:(i<7?10:20),
      engagements:i<7?1:2,
      newFollowers:1,
    }));
    return {
      format:"linkedin-aggregate-analytics-v1",
      period:{start:"2026-09-01",end:"2026-09-14"},
      discovery:{impressions:rows.reduce((a,b)=>a+b.impressions,0),membersReached:42},
      followers:{asOf:"2026-09-14",total:91},daily:rows,topPosts:[],
      audienceDemographics:[],contentDemographics:[],warnings:[],
      provenance:"manual-linkedIn-export",
    };
  };
  await page.evaluate(payload=>window.electronAPI.personalBrand.saveLinkedInImport(payload,true),content(20));
  await page.goto(`${server.url}#/personal-brand`);
  const dashboard=page.getByTestId("linkedin-observed-dashboard");
  const impressions=dashboard.getByTestId("linkedin-weekly-impressions");
  await expect(impressions.getByText("140",{exact:true})).toBeVisible();
  await expect(impressions.getByText("70",{exact:true})).toBeVisible();
  await expect(impressions.getByText(/\+70 over prior window \(\+100.0%\)/)).toBeVisible();
  await expect(dashboard.getByTestId("linkedin-weekly-newFollowers").getByText(/0 over prior window/)).toBeVisible();
  await page.evaluate(payload=>window.electronAPI.personalBrand.saveLinkedInImport(payload,true),content(22));
  await page.reload();
  await waitForRuntime(page);
  await expect(impressions.getByText("Unavailable",{exact:true})).toBeVisible();
  await expect(impressions.getByText("Conflicting observations")).toBeVisible();
  await expect(impressions.getByText("Change unavailable")).toBeVisible();
  await expect(dashboard.getByTestId("linkedin-weekly-engagements").getByText("14",{exact:true})).toBeVisible();
});


test("user-attested LinkedIn topic labels survive reload, protect revisions and clear without altering posts", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  const source=await page.evaluate(async()=>{
    const api=window.electronAPI.personalBrand;
    const draft=await api.createDraft({
      body:"Synthetic LinkedIn topic labeling example, no model-derived themes.",
      objective:"expertise_proof",audiences:["recruiters"],destination:"linkedin",
      format:"text",hookArchetype:"lesson",hypothesis:"Test explicit labels",
      claimChecks:[],mediaCount:0,mediaAccessibilityReviewed:true,
    });
    await api.prepareDraft(draft.id,draft.revision,true);
    const receipt=await api.confirmPublication({
      draftId:draft.id,revision:draft.revision,
      publishedUrl:"https://www.linkedin.com/posts/synthetic-user-topic-example-991",
      publishedAt:"2026-10-09T14:00:00-04:00",userConfirmed:true,
    });
    const historic=await api.recordHistoricalLinkedInPost({
      url:"https://www.linkedin.com/posts/synthetic-user-historical-topic-992",
      publishedOn:"2026-09-01",
      body:"A previous published post about changing career directions.",
      textSource:"copied_from_post",
    },true);
    return {receipt,historic};
  });
  await page.goto(`${server.url}#/personal-brand`);
  const section=page.getByTestId("linkedin-topic-attestations");
  await expect(section.getByRole("heading",{name:"Classify published content by topic"})).toBeVisible();
  const selector=section.getByLabel("Choose an existing LinkedIn post");
  await selector.selectOption("confirmed_publication:"+source.receipt.postId);
  const topics=section.getByLabel("Topics (one per line, maximum 6)");
  await topics.fill("Career Change\nAI Governance");
  const confirm=section.getByRole("checkbox",{name:/I personally reviewed these topic labels/});
  const save=section.getByRole("button",{name:"Save reviewed topics"});
  await expect(save).toBeDisabled();
  await confirm.check();
  await save.click();
  await expect(section.getByText(/Current revision: 1/)).toBeVisible();
  const active=await page.evaluate(()=>window.electronAPI.personalBrand.listLinkedInTopicLabels());
  expect(active).toHaveLength(1);
  expect(active[0].topics).toEqual(["ai governance","career change"]);
  const rawDraft=await page.evaluate(()=>window.electronAPI.personalBrand.listDrafts());
  expect(rawDraft[0].body).toContain("Synthetic LinkedIn topic labeling example");

  await page.reload();
  await waitForRuntime(page);
  const fresh=page.getByTestId("linkedin-topic-attestations");
  await fresh.getByLabel("Choose an existing LinkedIn post")
    .selectOption("confirmed_publication:"+source.receipt.postId);
  await expect(fresh.getByLabel("Topics (one per line, maximum 6)")).toHaveValue("ai governance\ncareer change");
  await fresh.getByLabel("Topics (one per line, maximum 6)").fill("Customer Experience");
  await fresh.getByRole("checkbox",{name:/I personally reviewed these topic labels/}).check();
  await fresh.getByRole("button",{name:"Save reviewed topics"}).click();
  await expect(fresh.getByText(/Current revision: 2/)).toBeVisible();
  await fresh.getByRole("checkbox",{name:/I personally reviewed these topic labels/}).check();
  await fresh.getByRole("button",{name:"Clear active topic labels"}).click();
  await expect(fresh.getByText(/Current revision: 3/)).toBeVisible();
  expect(await page.evaluate((postId)=>window.electronAPI.personalBrand.listLinkedInTopicHistory({
    targetKind:"confirmed_publication",targetId:postId,
  }),source.receipt.postId)).toHaveLength(3);
  const labels=await page.evaluate(()=>window.electronAPI.personalBrand.listLinkedInTopicLabels());
  expect(labels).toHaveLength(1);
  expect(labels[0].action).toBe("clear");
  expect(labels[0].topics).toEqual([]);
  await fresh.getByLabel("Choose an existing LinkedIn post")
    .selectOption("historical_post:"+source.historic.id);
  await fresh.getByLabel("Topics (one per line, maximum 6)").fill("Career reinvention");
  await fresh.getByRole("checkbox",{name:/I personally reviewed these topic labels/}).check();
  await fresh.getByRole("button",{name:"Save reviewed topics"}).click();
  await expect(fresh.getByText(/Current revision: 1/)).toBeVisible();
  await page.evaluate((id)=>window.electronAPI.personalBrand.deleteHistoricalLinkedInPost(id,true),source.historic.id);
  const surviving=await page.evaluate(()=>window.electronAPI.personalBrand.listLinkedInTopicLabels());
  expect(surviving).toHaveLength(1);
  expect(surviving[0].targetId).toBe(source.receipt.postId);
});


test("reviewed topics show qualified same-context samples and clear to withheld",async({page})=>{
  await page.goto(server.url);
  await waitForRuntime(page);
  const ids=await page.evaluate(async()=>{
    const api=window.electronAPI.personalBrand;
    const newPosts:string[]=[];
    for(let i=0;i<6;i++){
      const publishedAt=new Date(Date.parse("2026-09-01T12:00:00.000Z")+i*86400000).toISOString();
      const d=await api.createDraft({
        body:"Distinct original reviewed LinkedIn topic experiment "+i+".",
        objective:"expertise_proof",audiences:["recruiters"],
        destination:"linkedin",format:"text",hookArchetype:"lesson",
        hypothesis:"Compare observations without causal topic attribution.",
        claimChecks:[],mediaCount:0,mediaAccessibilityReviewed:true,
      });
      await api.prepareDraft(d.id,d.revision,true);
      const receipt=await api.confirmPublication({
        draftId:d.id,revision:d.revision,
        publishedUrl:"https://www.linkedin.com/posts/topic-synthetic-approved-"+i,
        publishedAt,userConfirmed:true,
      });
      await api.appendSnapshot(receipt.postId,{
        capturedAt:new Date(Date.parse(publishedAt)+48*3600000).toISOString(),
        windowStart:publishedAt,
        windowEnd:new Date(Date.parse(publishedAt)+24*3600000).toISOString(),
        sourceLabel:"Common manual individual post analytics",
        observations:[
          {name:"profile_views",state:"manual",value:i+1},
          {name:"reached",state:"manual",value:100},
        ],
      });
      await api.attestLinkedInTopics({
        targetKind:"confirmed_publication",targetId:receipt.postId,
        topics:[i<3?"career change":"ai governance"],
      },0,true);
      newPosts.push(receipt.postId);
    }
    return newPosts;
  });
  await page.goto(`${server.url}#/personal-brand`);
  const area=page.getByTestId("linkedin-topic-cohorts");
  await expect(area.getByText(/1 descriptive topic comparison group/)).toBeVisible();
  await expect(area.getByTestId("topic-coverage")).toContainText(/6 single-topic, age-matched posts/);
  const rows=area.getByRole("row");
  const aiRow=rows.filter({hasText:"ai governance"});
  const careerRow=rows.filter({hasText:"career change"});
  await expect(aiRow.getByRole("rowheader")).toHaveText("ai governance");
  await expect(aiRow.getByRole("cell").nth(0)).toHaveText("3");
  await expect(aiRow.getByRole("cell").nth(1)).toHaveText("5.00%");
  await expect(careerRow.getByRole("rowheader")).toHaveText("career change");
  await expect(careerRow.getByRole("cell").nth(0)).toHaveText("3");
  await expect(careerRow.getByRole("cell").nth(1)).toHaveText("2.00%");
  await page.getByLabel("Observation age").selectOption("48");
  await expect(area.getByText(/0 descriptive topic comparison group/)).toBeVisible();
  await page.getByLabel("Observation age").selectOption("24");
  await expect(area.getByText(/1 descriptive topic comparison group/)).toBeVisible();

  const form=page.getByTestId("linkedin-topic-attestations");
  await form.getByLabel("Choose an existing LinkedIn post")
    .selectOption("confirmed_publication:"+ids[0]);
  await form.getByRole("checkbox",{name:/I personally reviewed these topic labels/}).check();
  await form.getByRole("button",{name:"Clear active topic labels"}).click();
  await expect(form.getByText(/Current revision: 2/)).toBeVisible();
  await expect(area.getByText(/0 descriptive topic comparison group/)).toBeVisible();
  const medianCells=area.getByRole("cell",{name:"Withheld",exact:true});
  await expect(medianCells.first()).toBeVisible();
  expect(await page.evaluate(()=>window.electronAPI.personalBrand.listPublications())).toHaveLength(6);
});
