/**
 * Entry point of the Sojourner web/PWA runtime.
 *
 * Boot order:
 * 1. start the runtime worker (local persistence + shared application core);
 * 2. install the renderer API through the *shared* Electron preload module,
 *    whose `electron` import is bound to the web IPC client;
 * 3. render the same React application the Electron runtime renders.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { WebRuntimeClient, setActiveWebRuntimeClient, type RuntimeBootState } from "./runtime/client";
import { registerJobRangerServiceWorker } from "./service-worker-registration";
import { PwaBootGate, PwaRuntimeBanners } from "./PwaShell";
import { trustedScriptUrl } from "./security/trusted-types";
import runtimeWorkerUrl from "./runtime/worker-main.ts?worker&url";
import { DEMO_RESET_REQUEST_EVENT, IS_DEMO_FLAVOR } from "../demo/flavor";
import { completeDemoSession, demoSessionId, restartDemoSession } from "../demo/session";
import type { PageToWorkerMessage } from "./runtime/protocol";

const worker = new Worker(trustedScriptUrl(runtimeWorkerUrl), {
  type: "module",
  name: "job-ranger-runtime",
});
const client = new WebRuntimeClient(worker);
setActiveWebRuntimeClient(client);

if (IS_DEMO_FLAVOR) {
  // Demo flavor: the worker keeps this tab's demo workspace only if it belongs to this
  // tab's session id; otherwise (and never for a non-demo workspace) it decides what to do
  // under the Web Lock before opening the database. Registered before React mounts, so
  // preferences are reset before the app renders.
  const start: PageToWorkerMessage = { type: "demo-session", sessionId: demoSessionId() };
  worker.postMessage(start);
  const stop = client.onStateChange((state) => {
    if (state.status !== "ready") return;
    stop();
    completeDemoSession(state.demo?.reset ?? false);
  });
  // "Reset demo" (DemoBanner): forget this session and reload; the worker replaces the workspace.
  window.addEventListener(DEMO_RESET_REQUEST_EVENT, () => restartDemoSession());
}

// The shared preload bridge exposes window.electronAPI exactly as in Electron.
await import("../../electron/src/preload.cjs");
const { App } = await import("../App");

void registerJobRangerServiceWorker();

function PwaRoot() {
  const [state, setState] = useState<RuntimeBootState>(client.bootState);
  useEffect(() => client.onStateChange(setState), []);
  return (
    <>
      <PwaBootGate state={state}>
        <App />
      </PwaBootGate>
      <PwaRuntimeBanners />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PwaRoot />
  </StrictMode>,
);
