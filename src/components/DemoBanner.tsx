import { useState } from "react";
import { FlaskConical, RotateCcw } from "lucide-react";
import { DEMO_IDLE_RESET_HOURS, DEMO_RESET_REQUEST_EVENT, IS_DEMO_FLAVOR } from "../demo/flavor";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Persistent notice shown on every page of the demo flavor (rendered by Layout).
 * Renders nothing in the standard flavor.
 */
export function DemoBanner() {
  const [confirming, setConfirming] = useState(false);
  if (!IS_DEMO_FLAVOR) return null;
  return (
    <section
      aria-label="Demo workspace notice"
      data-testid="demo-banner"
      className="support-note mb-4 min-w-0 px-4 py-3 text-sm"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 font-semibold text-[var(--color-text-primary)]">
          <FlaskConical aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-[var(--color-primary)]" />
          Demo workspace: fictional sample data
        </p>
        <button type="button" className="secondary-button flex-shrink-0" onClick={() => setConfirming(true)}>
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Reset demo
        </button>
      </div>
      <p className="mt-1 leading-5 text-[var(--color-text-secondary)]">
        Morgan Rivera, Harbor Health and the listings are made up. What you enter stays in this browser on this site
        until a new demo session starts (a new tab or window) or the demo sits unused for {DEMO_IDLE_RESET_HOURS} hours;
        then it is replaced with fresh sample data. To remove it now, use Reset demo or clear this site's data.
      </p>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          window.dispatchEvent(new CustomEvent(DEMO_RESET_REQUEST_EVENT));
        }}
        title="Reset the demo workspace?"
        message="This erases everything entered in this demo session and starts again from the fictional sample workspace. Nothing outside this browser is affected."
        confirmLabel="Reset demo"
        cancelLabel="Keep my changes"
        variant="warning"
      />
    </section>
  );
}
