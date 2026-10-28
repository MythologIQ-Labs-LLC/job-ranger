import { FlaskConical } from "lucide-react";
import { DEMO_IDLE_RESET_HOURS, IS_DEMO_FLAVOR } from "../demo/flavor";

/** Honest description of what the demo is and is not (demo flavor only; Settings and Help). */
export function DemoLimitations() {
  if (!IS_DEMO_FLAVOR) return null;
  return (
    <section
      className="support-note mt-6 px-6 py-5"
      aria-labelledby="demo-limitations-heading"
      data-testid="demo-limitations"
    >
      <div className="flex items-center gap-3">
        <FlaskConical aria-hidden="true" className="h-5 w-5 flex-shrink-0 text-[var(--color-primary)]" />
        <h2 id="demo-limitations-heading" className="text-xl font-semibold text-[var(--color-text-primary)]">
          About this demo
        </h2>
      </div>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-text-secondary)]">
        <li>
          This is the real Sojourner application running a fictional sample workspace. Morgan Rivera, Harbor Health
          and every listing marked as a demo listing are made up; demo listings are not real openings and cannot be
          opened or applied to.
        </li>
        <li>
          Everything stays in this browser on this demo site. Nothing you enter is sent to Sojourner or anyone else,
          and there is no account, sync or analytics.
        </li>
        <li>
          The workspace belongs to one demo session. It is replaced with fresh sample data when a new demo session starts
          (opening the demo in a new tab or window, or after the browser restarts without restoring your tabs), when it
          has not been used for {DEMO_IDLE_RESET_HOURS} hours, or when you choose Reset demo. Until then it stays in this
          browser, even after you close the tab; to remove it right away, use Reset demo or clear this site's data. Do not
          rely on the demo for real career records.
        </li>
        <li>
          Files you export, such as resume PDFs and JSON Resume files, contain the fictional sample data and carry no demo
          marker. Do not submit them as a real application.
        </li>
        <li>
          Public job-board sources you add yourself are real openings, read directly by your browser like in the full
          web app.
        </li>
        <li>
          Not part of the demo: monitoring sources or notifications while the browser is closed, AI inference and MCP
          connections, desktop-only features (system tray, career sites that need a hidden browser, revealing files),
          Google Drive, sync and accounts. Backups you export download to your device; restoring one here lasts only
          for this demo session.
        </li>
      </ul>
    </section>
  );
}
