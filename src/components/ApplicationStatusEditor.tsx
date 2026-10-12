import { useRef, useState } from "react";
import type { ApplicationStatus, TrackedApplication } from "../shared/contracts";

interface ApplicationStatusEditorProps {
  application: TrackedApplication;
  onSave: (status: ApplicationStatus) => Promise<TrackedApplication>;
  onDirtyChange?: (dirty: boolean) => void;
}

const statuses: Array<{ value: ApplicationStatus; label: string }> = [
  { value: "interested", label: "Interested" },
  { value: "applied", label: "Applied" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

/** Keep unacknowledged status intent separate from the last stored value. */
export function ApplicationStatusEditor({ application, onSave, onDirtyChange }: ApplicationStatusEditorProps) {
  const [draft, setDraft] = useState<ApplicationStatus>(application.status);
  const desiredRef = useRef<ApplicationStatus>(application.status);
  const savedRef = useRef<ApplicationStatus>(application.status);
  const pendingRef = useRef(false);
  const reportDirty = () => onDirtyChange?.(desiredRef.current !== savedRef.current || pendingRef.current);

  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const saveLatest = async () => {
    if (pendingRef.current || desiredRef.current === savedRef.current) return;
    pendingRef.current = true;
    setState("saving");
    setError(null);
    try {
      // If a user changes the selection while a write is in flight, finish
      // that write first, then persist the newest selection. This also keeps
      // independently edited notes out of the status update payload.
      while (savedRef.current !== desiredRef.current) {
        const submitted = desiredRef.current;
        const result = await onSave(submitted);
        if (result.status !== submitted) {
          throw new Error("The saved application status differed from your selection.");
        }
        savedRef.current = submitted;
        reportDirty();
      }
      setState("saved");
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "Unable to save application status.");
    } finally {
      pendingRef.current = false;
      reportDirty();
    }
  };

  const select = (value: ApplicationStatus) => {
    desiredRef.current = value;
    reportDirty();
    setDraft(value);
    setError(null);
    if (!pendingRef.current && value === savedRef.current) {
      setState("saved");
      return;
    }
    setState("saving");
    void saveLatest();
  };

  return (
    <div className="flex min-w-40 flex-col gap-1">
      <select
        className="select-shell min-w-40"
        value={draft}
        onChange={(event) => select(event.target.value as ApplicationStatus)}
        aria-label={`Application status for ${application.title}`}
      >
        {statuses.map((status) => (
          <option key={status.value} value={status.value}>{status.label}</option>
        ))}
      </select>
      {(state === "saving" || state === "saved") && (
        <p role="status" aria-label="Application status save status" className="text-xs text-[var(--color-text-muted)]">
          {state === "saving" ? "Saving status..." : "Saved"}
        </p>
      )}
      {error && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            Status not saved: {error}. Your selection is retained.
          </p>
          <button type="button" className="secondary-button" onClick={() => void saveLatest()}>
            Retry saving status
          </button>
        </div>
      )}
    </div>
  );
}
