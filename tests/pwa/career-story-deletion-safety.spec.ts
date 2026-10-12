import { expect, test } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

test("Career Story deletion requires approval, leaves evidence and unrelated stories, and exposes failed mutations", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  const fixture = await page.evaluate(async () => {
    const api = window.electronAPI;
    const first = await api.career.createUserEvidence({
      subjectType: "achievement",
      organization: "Community Clinic",
      titleOrName: "Scheduling improvements",
      statement: "Coordinated scheduling across multiple clinics.",
      skills: ["Scheduling"],
    });
    const second = await api.career.createUserEvidence({
      subjectType: "achievement",
      organization: "Neighborhood Foundation",
      titleOrName: "Volunteer program",
      statement: "Organized a local volunteer intake program.",
      skills: ["Coordination"],
    });
    const storyA = await api.careerStories.create({
      title: "Referral process improvement",
      tags: ["operations"],
      situation: "The clinic needed faster intake.",
      challenge: "Referrals were delayed.",
      action: "Coordinated a shared scheduling workflow.",
      result: "The team reviewed cases more consistently.",
      reflection: "Clear ownership matters.",
      evidenceIds: [first.id],
    });
    const storyB = await api.careerStories.create({
      title: "Volunteer coordination example",
      tags: ["community"],
      situation: "Volunteer interest was rising.",
      challenge: "Intake required organization.",
      action: "Introduced shared intake steps.",
      result: "Volunteer onboarding became more consistent.",
      reflection: "Document repeatable work.",
      evidenceIds: [second.id],
    });
    return { storyA: storyA.id, storyB: storyB.id, evidenceIds: [first.id, second.id] };
  });

  await page.goto(`${server.url}#/career-stories`);
  await waitForRuntime(page);
  const firstButton = page.getByRole("button", { name: "Delete Career Story Referral process improvement" });
  const secondButton = page.getByRole("button", { name: "Delete Career Story Volunteer coordination example" });
  await expect(firstButton).toBeVisible();
  await expect(secondButton).toBeVisible();

  await firstButton.click();
  const dialog = page.getByRole("dialog", { name: "Delete Career Story?" });
  await expect(dialog).toContainText("Referral process improvement");
  await expect(dialog).toContainText("underlying Career Evidence remains unchanged");
  expect((await page.evaluate(() => window.electronAPI.careerStories.list())).length).toBe(2);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await page.evaluate(() => window.electronAPI.careerStories.list())).length).toBe(2);

  await page.evaluate(() => {
    const api = window.electronAPI.careerStories;
    const original = api.delete.bind(api);
    const state = window as unknown as { rejectStory?: () => void; attempts: number; restoreDelete?: () => void };
    state.attempts = 0;
    state.restoreDelete = () => { api.delete = original; };
    api.delete = async () => new Promise<void>((_resolve, reject) => {
      state.attempts++;
      state.rejectStory = () => reject(new Error("Synthetic Career Story delete failure"));
    });
  });

  await firstButton.click();
  await dialog.getByRole("button", { name: "Delete Career Story", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as unknown as { rejectStory: () => void }).rejectStory());
  await expect(dialog.getByRole("alert")).toContainText("Synthetic Career Story delete failure");
  expect(await page.evaluate(() => (window as unknown as { attempts: number }).attempts)).toBe(1);
  expect((await page.evaluate(() => window.electronAPI.careerStories.list())).length).toBe(2);

  await page.evaluate(() => {
    (window as unknown as { restoreDelete: () => void }).restoreDelete();
    const api = window.electronAPI.careerStories;
    const originalList = api.list.bind(api);
    (window as unknown as { restoreList?: () => void }).restoreList = () => { api.list = originalList; };
    api.list = async () => { throw new Error("Synthetic post-delete listing interruption"); };
  });
  await dialog.getByRole("button", { name: "Delete Career Story", exact: true }).click();
  // DELETE success is enough. A separate read outage must not make the user
  // believe their irreversible deletion was rejected.
  await expect(dialog).toBeHidden();
  await expect(firstButton).toBeHidden();
  await page.evaluate(() => (window as unknown as { restoreList: () => void }).restoreList());
  await expect(secondButton).toBeVisible();
  expect((await page.evaluate(() => window.electronAPI.careerStories.list())).map((story) => story.id))
    .toEqual([fixture.storyB]);
  const allEvidence = await page.evaluate(() => window.electronAPI.career.listEvidence());
  for (const id of fixture.evidenceIds) {
    expect(allEvidence.some((item) => item.evidence.id === id)).toBe(true);
  }
  await page.reload();
  await waitForRuntime(page);
  expect((await page.evaluate(() => window.electronAPI.careerStories.list())).map((story) => story.id))
    .toEqual([fixture.storyB]);
});
