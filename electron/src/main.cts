import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import path from "node:path";
import { SojournerBackend } from "./backend.cjs";
import { CareerBackend } from "./career-backend.cjs";
import { RequirementBackend } from "./requirement-backend.cjs";
import { initializeResumeIpc } from "./resume-ipc.cjs";
import { initializeEvidenceExtensionIpc } from "./evidence-extension-ipc.cjs";
import { initializeBackupIpc } from "./backup-ipc.cjs";
import { initializeDriveIpc, registerUnavailableDriveIpc, type DriveIpcHandles } from "./drive-ipc.cjs";
import { initializeStorageIpc } from "./storage-ipc.cjs";
import type { StorageService } from "./storage/storage-service.cjs";
import { applyPendingRestore, rebaseRestoredManagedPaths } from "./backup-service.cjs";
import { SqliteClient } from "./sqlite.cjs";
import { validateExternalUrl } from "./validators.cjs";
import { registerCoreIpcHandlers } from "./core-ipc.cjs";
import { loadPageHtmlInHiddenWindow } from "./browser-loader.cjs";
import { createTray, shouldMinimizeToTray } from "./tray-notifications.cjs";
import { createPinnedFetch } from "./pinned-fetch.cjs";
import {
  detectDistributionChannel,
  electronRuntimeInfo,
  packageFamilyNameFromExecPath,
  resolvePinnedUserDataDirectory,
  storeHostPath,
} from "./distribution.cjs";
import { initializeLegacyInstallIpc } from "./legacy-install-ipc.cjs";
import { migrateLegacyUserData } from "./legacy-migration.cjs";
import { resolveSqliteBinarySync, sqliteIntegrityCheck, sqliteManagedPathRebase } from "./sqlite-sync.cjs";
import { parsePackageSmokeArgument, runStorePackageSmoke } from "./store-package-smoke.cjs";

const distributionChannel = detectDistributionChannel({
  windowsStore: process.windowsStore,
  isPackaged: app.isPackaged,
  env: process.env,
});

// Pin the data root before anything reads userData or opens the database: packaged
// direct-download builds use %APPDATA%\Sojourner and Store (AppX) builds their isolated
// "Sojourner Store" folder. Data written before the rename (%APPDATA%\job-ranger,
// "Job Ranger Store") is copied there and verified first (legacy-migration.cts); if
// that fails, this run uses the untouched legacy folder. Development runs and an
// explicit --user-data-dir keep Electron's default.
const pinnedUserData = resolvePinnedUserDataDirectory({
  channel: distributionChannel,
  appDataDirectory: app.getPath("appData"),
  hasUserDataDirSwitch: app.commandLine.hasSwitch("user-data-dir"),
});
if (pinnedUserData) {
  const sqliteBinary = resolveSqliteBinarySync();
  const userDataMigration = migrateLegacyUserData({
    target: pinnedUserData.target,
    legacy: pinnedUserData.legacy,
    verifyDatabase: sqliteIntegrityCheck(sqliteBinary),
    rebaseManagedPaths: sqliteManagedPathRebase(sqliteBinary),
    log: (message) => console.log(`[data folder] ${message}`),
  });
  if (userDataMigration.kind === "busy") {
    // Never open either folder while another start may still be moving the data.
    dialog.showErrorBox(
      "Sojourner is still starting",
      "Another Sojourner window is still moving your data to its new folder. Wait for it to open, then try again.",
    );
    app.exit(1);
  } else {
    app.setPath("userData", userDataMigration.userDataDirectory);
  }
}

/** Path the OS file manager sees for a path inside Sojourner's data root. */
function hostPath(target: string): string {
  if (distributionChannel !== "microsoft-store" || !process.env.LOCALAPPDATA) return target;
  return storeHostPath(target, {
    appDataDirectory: app.getPath("appData"),
    localAppDataDirectory: process.env.LOCALAPPDATA,
    packageFamilyName: packageFamilyNameFromExecPath(process.execPath),
  });
}

const packageSmokeReport = parsePackageSmokeArgument(process.argv);

const moduleDirectory = __dirname;
const processStartupFetch = globalThis.fetch;
const pinnedDiscoveryFetch = createPinnedFetch();

let mainWindow: BrowserWindow | null = null;
let helpWindow: BrowserWindow | null = null;
let backend: SojournerBackend | null = null;
let careerBackend: CareerBackend | null = null;
let requirementBackend: RequirementBackend | null = null;
let isQuitting = false;

// One running app per data folder: a second launch focuses the existing window instead of
// opening the same database twice. Automated runs pass their own --user-data-dir, so
// parallel test instances each hold their own lock; the packaged smoke run is exempt.
const hasInstanceLock = packageSmokeReport !== null || app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.exit(0);
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}
let storageService: StorageService | null = null;
let quitFlushDone = false;

function discoveryFetchImpl(): typeof fetch {
  // Production uses the DNS-pinned transport. Electron E2E replaces the main
  // process global fetch after launch with deterministic fixture responses;
  // preserving that explicit test seam avoids sending tests to public feeds.
  return globalThis.fetch === processStartupFetch
    ? pinnedDiscoveryFetch
    : globalThis.fetch;
}

function appAssetPath(fileName: string): string {
  const root = app.getAppPath();
  return process.env.NODE_ENV === "development"
    ? path.join(root, "public", fileName)
    : path.join(root, "dist", fileName);
}

function builtPagePath(fileName: string): string {
  return path.join(app.getAppPath(), "dist", fileName);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f5f3ef",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(moduleDirectory, "preload.cjs"),
      webSecurity: true,
    },
    icon: appAssetPath("ICON.png"),
  });

  if (process.env.NODE_ENV === "development") {
    void mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(builtPagePath("index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // The window only ever shows Sojourner's own page; links open in the system browser instead.
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const current = mainWindow?.webContents.getURL() ?? "";
    if (new URL(targetUrl, current || undefined).href.split("#")[0] !== current.split("#")[0]) event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(validateExternalUrl(url));
    } catch {
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' https:;",
          "X-Frame-Options": "DENY",
        },
      });
    },
  );

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("close", async (event) => {
    const settings = await backend?.getSettings();
    if (shouldMinimizeToTray(settings ?? null, isQuitting)) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function openHelpWindow(): void {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus();
    return;
  }

  helpWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: "#f5f3ef",
    title: "Sojourner Help",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    icon: appAssetPath("ICON.png"),
  });

  if (process.env.NODE_ENV === "development") {
    void helpWindow.loadURL("http://localhost:5173/help.html");
  } else {
    void helpWindow.loadFile(builtPagePath("help.html"));
  }

  helpWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(validateExternalUrl(url));
    } catch {
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  helpWindow.on("closed", () => {
    helpWindow = null;
  });
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Quit",
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload", accelerator: "CmdOrCtrl+R" },
        { role: "forceReload", accelerator: "CmdOrCtrl+Shift+R" },
        { role: "toggleDevTools", accelerator: "CmdOrCtrl+Shift+I" },
        { type: "separator" },
        { role: "resetZoom", accelerator: "CmdOrCtrl+0" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+Plus" },
        { role: "zoomOut", accelerator: "CmdOrCtrl+-" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open Help",
          accelerator: "F1",
          click: () => openHelpWindow(),
        },
        { type: "separator" },
        {
          label: "Open Sojourner Data Folder",
          click: () => {
            void shell.openPath(hostPath(app.getPath("userData")));
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function runPackageSmokeAndExit(reportPath: string): Promise<void> {
  try {
    await runStorePackageSmoke({
      reportPath,
      appVersion: app.getVersion(),
      channel: distributionChannel,
      windowsStore: process.windowsStore === true,
      userDataDirectory: app.getPath("userData"),
      appDataDirectory: app.getPath("appData"),
      localAppDataDirectory: process.env.LOCALAPPDATA ?? null,
      execPath: process.execPath,
      resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? null,
      platform: process.platform,
    });
    app.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    app.exit(1);
  }
}

app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  if (packageSmokeReport) {
    await runPackageSmokeAndExit(packageSmokeReport);
    return;
  }
  try {
    const userDataDirectory = app.getPath("userData");
    const dataDirectory = path.join(userDataDirectory, "data");
    const restoreApplied = await applyPendingRestore({ userDataDirectory, dataDirectory });

    backend = new SojournerBackend({
      dataDirectory,
      browserPageLoader: loadPageHtmlInHiddenWindow,
    });
    await backend.initialize();

    const systemStatus = await backend.getSystemStatus(process.platform);
    if (restoreApplied) {
      // A restore staged in another data folder (such as the legacy %APPDATA%\job-ranger,
      // before the start-up migration) keeps that folder's artifact paths.
      await rebaseRestoredManagedPaths(new SqliteClient(systemStatus.databasePath, systemStatus.sqliteBinaryPath), dataDirectory);
    }
    careerBackend = new CareerBackend({
      dataDirectory,
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    await careerBackend.initialize();
    requirementBackend = new RequirementBackend({
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    initializeEvidenceExtensionIpc({
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    const resumeService = await initializeResumeIpc({
      dataDirectory,
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    // Google Drive export (#314): hidden unless this build has a Desktop OAuth client. A Drive
    // start-up failure must never stop Sojourner from opening; the feature is reported unavailable.
    let drive: DriveIpcHandles | null = null;
    try {
      drive = await initializeDriveIpc({
        userDataDirectory,
        databasePath: systemStatus.databasePath,
        sqliteBinaryPath: systemStatus.sqliteBinaryPath,
        resumeService,
      });
    } catch (error) {
      console.error("Google Drive export could not start:", error instanceof Error ? error.message : error);
      registerUnavailableDriveIpc("its local export journal could not be opened.");
    }
    const producer = {
      runtime: "electron" as const,
      channel: distributionChannel,
      appVersion: app.getVersion(),
      buildId: process.env.SOJOURNER_BUILD_ID?.trim() || `electron-${app.getVersion()}`,
    };
    const backupService = initializeBackupIpc({
      dataDirectory,
      userDataDirectory,
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
      appVersion: app.getVersion(),
      producer,
    });
    // Storage location (#249): automatic backups and exported documents to a folder,
    // Google Drive or OneDrive. The working database always stays local. A failure here
    // never blocks startup; the Settings section then stays hidden.
    try {
      storageService = await initializeStorageIpc({
        userDataDirectory,
        databasePath: systemStatus.databasePath,
        sqliteBinaryPath: systemStatus.sqliteBinaryPath,
        backupService,
        producer,
        drive,
      });
    } catch {
      storageService = null;
    }

    registerCoreIpcHandlers({
      backend,
      careerBackend,
      requirementBackend,
      appVersion: app.getVersion(),
      platform: process.platform,
      discoveryFetch: discoveryFetchImpl,
      hostPath,
      getRuntimeInfo: async () =>
        electronRuntimeInfo({
          channel: distributionChannel,
          appVersion: app.getVersion(),
          platform: process.platform,
          userDataDirectory,
          sqliteBinaryPath: systemStatus.sqliteBinaryPath,
          buildId: process.env.SOJOURNER_BUILD_ID,
        }),
    });
    initializeLegacyInstallIpc({
      channel: distributionChannel,
      appDataDirectory: app.getPath("appData"),
      userDataDirectory,
      dataDirectory,
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
      appVersion: app.getVersion(),
    });
    createWindow();
    createMenu();
    createTray(appAssetPath("ICON.png"), mainWindow, () => app.quit());

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Sojourner startup error";
    dialog.showErrorBox("Sojourner failed to start", message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  // The packaged smoke renders PDFs in short-lived hidden windows; it exits explicitly.
  if (packageSmokeReport) return;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  // Unbacked workspace changes are backed up to the storage location before quitting
  // (bounded, so a provider outage cannot keep Sojourner from closing).
  if (storageService && !quitFlushDone) {
    event.preventDefault();
    quitFlushDone = true;
    const service = storageService;
    void service.needsQuitFlush()
      .then((needed) => (needed ? service.flushForQuit(120_000) : service.stop()))
      .catch(() => undefined)
      .finally(() => app.quit());
    return;
  }
  isQuitting = true;
  void backend?.dispose();
});