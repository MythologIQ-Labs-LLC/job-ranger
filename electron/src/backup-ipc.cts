import { app, dialog, ipcMain } from "electron";
import type { SojournerArchiveProducer } from "../../src/shared/backup.js";
import { ARCHIVE_FILE_EXTENSION, ARCHIVE_FILE_EXTENSIONS } from "../../src/shared/backup.js";
import { BackupService } from "./backup-service.cjs";

function archiveFileName(now = new Date()): string {
  return `sojourner-backup-${now.toISOString().replace(/[:.]/g, "-")}${ARCHIVE_FILE_EXTENSION}`;
}

export function initializeBackupIpc(options: {
  dataDirectory: string;
  userDataDirectory: string;
  databasePath: string;
  sqliteBinaryPath: string;
  appVersion: string;
  producer: SojournerArchiveProducer;
}): BackupService {
  const service = new BackupService(options);
  void service.removeArchiveWorkDirectories();

  ipcMain.handle("backups:create", async () => {
    const selection = await dialog.showSaveDialog({
      title: "Save a portable Sojourner backup",
      defaultPath: archiveFileName(),
      filters: [
        { name: "Sojourner backup", extensions: [ARCHIVE_FILE_EXTENSION.slice(1)] },
      ],
    });
    if (selection.canceled || !selection.filePath) return null;
    return service.createArchive(selection.filePath, options.producer);
  });

  ipcMain.handle("backups:select-restore", async () => {
    const selection = await dialog.showOpenDialog({
      title: "Select a Sojourner backup (.sojourner or older .jobranger file, or manifest.json inside an older backup folder)",
      properties: ["openFile"],
      filters: [
        {
          name: "Sojourner backup",
          extensions: [...ARCHIVE_FILE_EXTENSIONS.map((extension) => extension.slice(1)), "json"],
        },
      ],
    });
    if (selection.canceled || selection.filePaths.length === 0) return null;
    return service.validateRestoreSource(selection.filePaths[0]);
  });

  ipcMain.handle("backups:stage-restore", async (_event, bundlePath: string) => {
    if (typeof bundlePath !== "string" || !bundlePath.trim()) {
      throw new Error("Backup path is required");
    }
    await service.stageRestore(bundlePath.trim());
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 150);
    return { restarting: true as const };
  });

  return service;
}
