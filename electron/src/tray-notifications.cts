import { Tray, Menu, Notification, nativeImage, BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import type { Settings } from "../../src/shared/contracts.js";
export { shouldMinimizeToTray } from "./tray-policy.cjs";

export interface ScrapeNotification {
  companyName: string;
  newJobCount: number;
  matchedJobCount: number;
}

let tray: Tray | null = null;

export function createTray(
  iconPath: string,
  mainWindow: BrowserWindow | null,
  onQuit: () => void,
): Tray | null {
  if (!existsSync(iconPath)) {
    return null;
  }

  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  if (icon.isEmpty()) {
    return null;
  }

  tray = new Tray(icon);
  tray.setToolTip("Sojourner");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Sojourner", click: () => mainWindow?.show() },
      { type: "separator" },
      { label: "Quit", click: onQuit },
    ]),
  );
  tray.on("click", () => mainWindow?.show());

  return tray;
}

export function showJobNotification(payload: ScrapeNotification, settings: Settings): void {
  if (!settings.notificationsEnabled) return;
  if (payload.newJobCount === 0 && payload.matchedJobCount === 0) return;
  if (payload.newJobCount === 0 && !settings.notifyOnMatchedJobs) return;

  const bodyParts: string[] = [];
  if (payload.newJobCount > 0 && settings.notifyOnNewJobs) {
    bodyParts.push(`${payload.newJobCount} new job${payload.newJobCount === 1 ? "" : "s"}`);
  }
  if (payload.matchedJobCount > 0 && settings.notifyOnMatchedJobs) {
    bodyParts.push(
      `${payload.matchedJobCount} matched filter${payload.matchedJobCount === 1 ? "" : "s"}`,
    );
  }

  if (bodyParts.length === 0) return;

  const notification = new Notification({
    title: payload.companyName,
    body: bodyParts.join(", "),
    silent: false,
  });
  notification.show();
}
