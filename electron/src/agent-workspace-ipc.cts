import { ipcMain } from "electron";
import { AgentWorkspaceBackend, AgentWorkspaceError } from "./agent-workspace-backend.cjs";

// Agent workspace local state (#286 G3). Registered by both the Electron main process and
// the PWA runtime worker, so both runtimes persist through the same backend code.

export function initializeAgentWorkspaceIpc(options: { databasePath: string; sqliteBinaryPath: string }): void {
  const backend = new AgentWorkspaceBackend(options);
  const ready = backend.initialize();
  // Errors cross IPC as plain messages; the code prefix lets the UI explain what happened.
  const handle = (channel: string, run: (...args: unknown[]) => Promise<unknown>) => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      await ready;
      try {
        return await run(...args);
      } catch (error) {
        if (error instanceof AgentWorkspaceError) throw new Error(`${error.code}: ${error.message}`);
        throw error;
      }
    });
  };
  handle("agent-workspace:get-state", () => backend.getState());
  handle("agent-workspace:set-policy", (policy) => backend.setPolicy(policy));
  handle("agent-workspace:record-export", (receipt) => backend.recordExport(receipt));
  handle("agent-workspace:list-receipts", () => backend.listReceipts());
  handle("agent-workspace:ledger-operations", (cursor, limit) => backend.ledgerOperations(cursor, limit));
  handle("agent-workspace:ledger-batches", (cursor, limit) => backend.ledgerBatches(cursor, limit));
  handle("agent-workspace:commit-reconciliation", (commit) => backend.commitReconciliation(commit));
  handle("agent-workspace:list-items", (filter) => backend.listItems(filter));
  handle("agent-workspace:get-item", (operationId, sha) => backend.getItem(operationId, sha));
  handle("agent-workspace:list-quarantine", () => backend.listQuarantine());
  handle("agent-workspace:get-quarantine", (key) => backend.getQuarantine(key));
  handle("agent-workspace:list-runs", (limit) => backend.listRuns(limit));
  handle("agent-workspace:decide", (decision) => backend.decide(decision));
}
