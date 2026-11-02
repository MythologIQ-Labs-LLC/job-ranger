/**
 * Service worker lifecycle for the Sojourner web runtime.
 *
 * Safety rules:
 * - the service worker caches only the versioned application shell; it never
 *   stores or intercepts career data (that lives in OPFS, owned by the runtime
 *   worker);
 * - a new version never activates silently under a running session: it waits
 *   until the user chooses "Reload to update", so an old page never talks to a
 *   new runtime (or vice versa) mid-session;
 * - if registration or an update fails, the currently running version keeps
 *   working and the failure is reported, never hidden.
 */
import { trustedScriptUrl } from "./security/trusted-types";

export const UPDATE_READY_EVENT = "job-ranger:update-ready";
export const UPDATE_FAILED_EVENT = "job-ranger:update-failed";

let waitingWorker: ServiceWorker | null = null;

function announceWaiting(worker: ServiceWorker): void {
  waitingWorker = worker;
  window.dispatchEvent(new CustomEvent(UPDATE_READY_EVENT));
}

export function applyWaitingUpdate(): void {
  if (!waitingWorker) {
    window.location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => window.location.reload(),
    { once: true },
  );
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
}

export async function registerJobRangerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.register(trustedScriptUrl("./sw.js"), {
      scope: "./",
      updateViaCache: "none",
    });
    if (registration.waiting && navigator.serviceWorker.controller) {
      announceWaiting(registration.waiting);
    }
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          announceWaiting(installing);
        }
        if (installing.state === "redundant") {
          window.dispatchEvent(
            new CustomEvent(UPDATE_FAILED_EVENT, {
              detail: navigator.serviceWorker.controller
                ? "A new version could not be verified and installed."
                : "The offline app shell could not be installed.",
            }),
          );
        }
      });
    });
    // Check for a new deployment when the app regains focus and hourly.
    const check = () => void registration.update().catch((error: unknown) => {
      window.dispatchEvent(
        new CustomEvent(UPDATE_FAILED_EVENT, {
          detail: error instanceof Error ? error.message : "Update check failed.",
        }),
      );
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    setInterval(check, 60 * 60 * 1000);
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent(UPDATE_FAILED_EVENT, {
        detail: error instanceof Error ? error.message : "Service worker registration failed.",
      }),
    );
  }
}
