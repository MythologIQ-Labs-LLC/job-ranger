import { useRef, useState } from "react";
import type { TrackedApplication } from "../shared/contracts";

interface ApplicationNotesEditorProps {
  application: TrackedApplication;
  onSave: (notes: string) => Promise<TrackedApplication>;
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Keep text immediately responsive while serializing durable writes for this
 * one application. A late response must never overwrite newer user input.
 * No shadow persistence or external service is introduced.
 */
export function ApplicationNotesEditor({ application, onSave, onDirtyChange }: ApplicationNotesEditorProps) {
  const [draft, setDraft] = useState(application.notes);
  const desiredRef = useRef(application.notes);
  const persistedRef = useRef(application.notes);
  const savingRef = useRef(false);
  const reportDirty = () => onDirtyChange?.(desiredRef.current !== persistedRef.current || savingRef.current);

  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const saveLatest = async () => {
    if (savingRef.current || desiredRef.current === persistedRef.current) return;
    savingRef.current = true;
    setState("saving");
    setError(null);
    try {
      while (persistedRef.current !== desiredRef.current) {
        const submitted = desiredRef.current;
        const saved = await onSave(submitted);
        if (saved.notes !== submitted) {
          throw new Error("The saved notes differed from your draft. Review and retry.");
        }
        persistedRef.current = submitted;
        reportDirty();
      }
      setState("saved");
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "Unable to save application notes.");
    } finally {
      savingRef.current = false;
      reportDirty();
    }
  };

  const edit = (text: string) => {
    desiredRef.current = text;
    reportDirty();
    setDraft(text);
    setError(null);
    if (!savingRef.current && text === persistedRef.current) {
      setState("saved");
      return;
    }
    setState("saving");
    void saveLatest();
  };

  return (
    <div className="mt-5">
      <label className="block">
        <span className="metric-label">Notes</span>
        <textarea
          className="input-shell mt-2 min-h-24 resize-y py-3"
          value={draft}
          onChange={(event) => edit(event.target.value)}
          placeholder="What you liked about the role, context you want to remember, or anything that does not belong to a specific person or milestone..."
        />
      </label>
      {state !== "idle" && state !== "error" && (
        <p role="status" aria-label="Application notes save status" className="mt-2 text-xs text-[var(--color-text-muted)]">
          {state === "saving" ? "Saving notes..." : "Saved"}
        </p>
      )}
      {error && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            Notes not saved: {error}. Your draft is still here.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void saveLatest()}
          >
            Retry saving notes
          </button>
        </div>
      )}
    </div>
  );
}
