import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning";
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  variant = "danger",
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref is a synchronous lock against rapid double-click and close attempts
  // in the same React render, not an additional persistence authority.
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const closeIfIdle = () => {
    if (!pendingRef.current) onClose();
  };

  const confirm = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      pendingRef.current = false;
      setPending(false);
      onClose();
    } catch (cause) {
      // Keep the dialog open and let the user cancel or try again. Never
      // represent a failed canonical mutation as a completed confirmation.
      pendingRef.current = false;
      setPending(false);
      setError(cause instanceof Error ? cause.message : "Unable to complete this action.");
    }
  };

  return (
    <Modal open={open} onClose={closeIfIdle} title={title} size="sm">
      <div className="flex items-start gap-4">
        <div className={`flex-shrink-0 rounded-full p-2 ${variant === "danger" ? "bg-red-100" : "bg-yellow-100"}`}>
          <AlertTriangle aria-hidden="true"
            className={`h-5 w-5 ${variant === "danger" ? "text-red-600" : "text-yellow-600"}`}
          />
        </div>
        <p className="pt-1 text-sm text-[var(--color-text-secondary)]">{message}</p>
      </div>
      {error && (
        <p role="alert" className="support-note mt-4 px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={closeIfIdle} disabled={pending} className="secondary-button">
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={pending}
          aria-busy={pending}
          className={`rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-wait disabled:opacity-60 ${
            variant === "danger" ? "bg-red-600 hover:bg-red-500" : "bg-yellow-600 hover:bg-yellow-500"
          }`}
        >
          {pending ? "Working..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
