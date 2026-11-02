/** A minimal view of an IPC event: the calling frame and the main frame of its WebContents. */
export interface SenderEvent {
  senderFrame: { url: string } | null;
  sender: { mainFrame: unknown };
}

/**
 * Drive actions upload the user's files and start Google sign-in, so only Sojourner's own
 * top-level page may call them: the packaged file:// page, or the Vite dev server in development.
 */
export function isAppFrame(event: SenderEvent, development = process.env.NODE_ENV === "development"): boolean {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  let url: URL;
  try {
    url = new URL(frame.url);
  } catch {
    return false;
  }
  return url.protocol === "file:" || (development && url.origin === "http://localhost:5173");
}

