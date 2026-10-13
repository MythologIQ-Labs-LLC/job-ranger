import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import path from "node:path";
import { JobScoutBackend } from "./backend.cjs";
import { CareerBackend } from "./career-backend.cjs";
import { RequirementBackend } from "./requirement-backend.cjs";
import { initializeResumeIpc } from "./resume-ipc.cjs";
import { initializeEvidenceExtensionIpc } from "./evidence-extension-ipc.cjs";
import { initializeBackupIpc } from "./backup-ipc.cjs";
import { initializeAgentWorkspaceIpc } from "./agent-workspace-ipc.cjs";
import { applyPendingRestore } from "./backup-service.cjs";
import { validateExternalUrl } from "./validators.cjs";
import { registerCoreIpcHandlers } from "./core-ipc.cjs";
import { loadPageHtmlInHiddenWindow } from "./browser-loader.cjs";
import { createTray, shouldMinimizeToTray } from "./tray-notifications.cjs";
import { createPinnedFetch } from "./pinned-fetch.cjs";
import {
  detectDistributionChannel,
  electronRuntimeInfo,
  packageFamilyNameFromExecPath,
  resolveStoreUserDataDirectory,
  storeHostPath,
} from "./distribution.cjs";
import { initializeLegacyInstallIpc } from "./legacy-install-ipc.cjs";
import { parsePackageSmokeArgument, runStorePackageSmoke } from "./store-package-smoke.cjs";

const distributionChannel = detectDistributionChannel({
  windowsStore: process.windowsStore,
  isPackaged: app.isPackaged,
  env: process.env,
});

// Store (AppX) builds isolate their data root from historical direct-download
// installations so the two never share a live database. An explicit
// --user-data-dir (used by automated tests) always wins.
if (
  distributionChannel === "microsoft-store" &&
  !app.commandLine.hasSwitch("user-data-dir")
) {
  app.setPath("userData", resolveStoreUserDataDirectory(app.getPath("appData")));
}

/** Path the OS file manager sees for a path inside Job Ranger's data root. */
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
let backend: JobScoutBackend | null = null;
let careerBackend: CareerBackend | null = null;
let requirementBackend: RequirementBackend | null = null;
let isQuitting = false;

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
    title: "Job Ranger Help",
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
          label: "Open Job Ranger Data Folder",
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
  if (packageSmokeReport) {
    await runPackageSmokeAndExit(packageSmokeReport);
    return;
  }
  try {
    const userDataDirectory = app.getPath("userData");
    const dataDirectory = path.join(userDataDirectory, "data");
    await applyPendingRestore({ userDataDirectory, dataDirectory });

    backend = new JobScoutBackend({
      dataDirectory,
      browserPageLoader: loadPageHtmlInHiddenWindow,
    });
    await backend.initialize();

    const systemStatus = await backend.getSystemStatus(process.platform);
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
    initializeAgentWorkspaceIpc({
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    await initializeResumeIpc({
      dataDirectory,
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    initializeBackupIpc({
      dataDirectory,
      userDataDirectory,
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
      appVersion: app.getVersion(),
      producer: {
        runtime: "electron",
        channel: distributionChannel,
        appVersion: app.getVersion(),
        buildId: process.env.JOB_RANGER_BUILD_ID?.trim() || `electron-${app.getVersion()}`,
      },
    });

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
          buildId: process.env.JOB_RANGER_BUILD_ID,
        }),
    });
    initializeLegacyInstallIpc({
      channel: distributionChannel,
      appDataDirectory: app.getPath("appData"),
      userDataDirectory,
      dataDirectory,
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
      error instanceof Error ? error.message : "Unknown Job Ranger startup error";
    dialog.showErrorBox("Job Ranger failed to start", message);
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

app.on("before-quit", () => {
  isQuitting = true;
  void backend?.dispose();
});