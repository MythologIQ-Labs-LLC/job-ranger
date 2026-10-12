import { ipcMain } from "electron";
import { PersonalBrandBackend } from "./personal-brand-backend.cjs";

export function initializePersonalBrandIpc(options: {
  databasePath: string;
  sqliteBinaryPath: string;
}): void {
  const backend = new PersonalBrandBackend(options);
  const ready = backend.initialize();
  ipcMain.handle("personal-brand:list-drafts", async () => {
    await ready;
    return backend.listDrafts();
  });
  ipcMain.handle("personal-brand:create-draft", async (_event, input: unknown) => {
    await ready;
    return backend.createDraft(input);
  });
  ipcMain.handle("personal-brand:update-draft", async (_event, id: string, revision: number, input: unknown) => {
    await ready;
    return backend.updateDraft(id, revision, input);
  });
  ipcMain.handle("personal-brand:prepare-draft", async (_event, id: string, revision: number, reviewed: boolean) => {
    await ready;
    return backend.prepareDraft(id, revision, reviewed);
  });
  ipcMain.handle("personal-brand:list-prepared", async () => {
    await ready;
    return backend.listPrepared();
  });
  ipcMain.handle("personal-brand:confirm-publication", async (_event, input: unknown) => {
    await ready;
    return backend.confirmPublication(input as Parameters<typeof backend.confirmPublication>[0]);
  });
  ipcMain.handle("personal-brand:list-publications", async () => {
    await ready;
    return backend.listPublications();
  });
  ipcMain.handle("personal-brand:append-snapshot", async (_event, postId: string, input: unknown) => {
    await ready;
    return backend.appendSnapshot(postId, input as Parameters<typeof backend.appendSnapshot>[1]);
  });
  ipcMain.handle("personal-brand:list-snapshots", async (_event, postId: string) => {
    await ready;
    return backend.listSnapshots(postId);
  });
  ipcMain.handle("personal-brand:list-linkedin-imports", async () => {
    await ready;
    return backend.listLinkedInImports();
  });
  ipcMain.handle("personal-brand:save-linkedin-import", async (_event, preview: unknown, confirmed: boolean) => {
    await ready;
    return backend.saveLinkedInImport(preview, confirmed);
  });
  ipcMain.handle("personal-brand:delete-linkedin-import", async (_event, id: string, confirmed: boolean) => {
    await ready;
    return backend.deleteLinkedInImport(id, confirmed);
  });
  ipcMain.handle("personal-brand:list-historical-linkedin-posts", async () => {
    await ready;
    return backend.listHistoricalLinkedInPosts();
  });
  ipcMain.handle("personal-brand:record-historical-linkedin-post", async (_event, input: unknown, confirmed: boolean) => {
    await ready;
    return backend.recordHistoricalLinkedInPost(input, confirmed);
  });
  ipcMain.handle("personal-brand:delete-historical-linkedin-post", async (_event, id: string, confirmed: boolean) => {
    await ready;
    return backend.deleteHistoricalLinkedInPost(id, confirmed);
  });
  ipcMain.handle("personal-brand:list-linkedin-topic-labels", async () => {
    await ready;
    return backend.listLinkedInTopicLabels();
  });
  ipcMain.handle("personal-brand:list-linkedin-topic-history", async (_event, target: unknown) => {
    await ready;
    return backend.listLinkedInTopicHistory(target);
  });
  ipcMain.handle("personal-brand:attest-linkedin-topics", async (_event, input: unknown, expectedRevision: number, confirmed: boolean) => {
    await ready;
    return backend.attestLinkedInTopics(input, expectedRevision, confirmed);
  });
  ipcMain.handle("personal-brand:list-career-outcomes", async () => {
    await ready;
    return backend.listCareerOutcomes();
  });
  ipcMain.handle("personal-brand:record-career-outcome", async (_event, input: unknown) => {
    await ready;
    return backend.recordCareerOutcome(input);
  });
  ipcMain.handle("personal-brand:delete-career-outcome", async (_event, id: string, userConfirmed: boolean) => {
    await ready;
    return backend.deleteCareerOutcome(id, userConfirmed);
  });
}
