import { useState } from "react";
import { Braces, FileDown, FileUp } from "lucide-react";
import type {
  JsonResumeExportResult,
  JsonResumeImportResult,
} from "../shared/json-resume";
import { getDesktopApi } from "../services/api";

export function JsonResumePanel() {
  const [busy, setBusy] = useState<"import" | "export" | null>(null);
  const [importResult, setImportResult] = useState<JsonResumeImportResult | null>(null);
  const [exportResult, setExportResult] = useState<JsonResumeExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importJsonResume = async () => {
    setBusy("import");
    setError(null);
    setExportResult(null);
    try {
      const result = await getDesktopApi().jsonResume.importFile();
      if (result) setImportResult(result);
    } catch (cause) {
      setImportResult(null);
      setError(cause instanceof Error ? cause.message : "JSON Resume import failed.");
    } finally {
      setBusy(null);
    }
  };

  const exportJsonResume = async () => {
    setBusy("export");
    setError(null);
    setImportResult(null);
    try {
      const result = await getDesktopApi().jsonResume.exportFile();
      if (result) setExportResult(result);
    } catch (cause) {
      setExportResult(null);
      setError(cause instanceof Error ? cause.message : "JSON Resume export failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]">
      <div>
        <div className="flex items-center gap-3">
          <Braces className="h-5 w-5 text-[var(--color-primary)]" />
          <h2 className="text-2xl font-semibold">JSON Resume interoperability</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          Exchange a standard structured resume without changing what Sojourner treats as career truth. Imports become reviewable candidate evidence. Exports use only confirmed or user-authored Career Evidence.
        </p>
      </div>

      <div className="panel panel-strong space-y-5 p-6">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="primary-button disabled:opacity-60"
            onClick={() => void importJsonResume()}
            disabled={busy !== null}
          >
            <FileUp className="h-4 w-4" />
            {busy === "import" ? "Importing..." : "Import JSON Resume"}
          </button>
          <button
            type="button"
            className="secondary-button disabled:opacity-60"
            onClick={() => void exportJsonResume()}
            disabled={busy !== null}
          >
            <FileDown className="h-4 w-4" />
            {busy === "export" ? "Exporting..." : "Export JSON Resume"}
          </button>
        </div>

        <div className="rounded-2xl bg-[var(--color-surface-muted)] p-4 text-sm leading-6 text-[var(--color-text-secondary)]">
          JSON Resume is an interchange format, not Sojourner's canonical career store. Unsupported source fields remain preserved in the imported source artifact, and Sojourner-specific provenance is not invented into unrelated standard fields during export.
        </div>

        {importResult && (
          <div className="panel panel-muted p-4 text-sm text-[var(--color-text-secondary)]">
            <p className="font-semibold text-[var(--color-text-primary)]">
              {importResult.duplicate ? "Existing import reused" : "JSON Resume imported"}
            </p>
            <p className="mt-1">
              {importResult.proposedEvidence.length} candidate evidence record{importResult.proposedEvidence.length === 1 ? "" : "s"} available for review in Career Profile.
            </p>
            {importResult.profileNameProposal && (
              <p className="mt-2">
                The source also names <strong>{importResult.profileNameProposal}</strong>. Sojourner did not silently overwrite the Career Profile name.
              </p>
            )}
            {importResult.warnings.map((warning) => (
              <p key={warning} className="mt-2 text-xs">{warning}</p>
            ))}
          </div>
        )}

        {exportResult && (
          <div className="panel panel-muted p-4 text-sm text-[var(--color-text-secondary)]">
            <p className="font-semibold text-[var(--color-text-primary)]">JSON Resume exported</p>
            <p className="mt-1 break-all">{exportResult.filePath}</p>
            <p className="mt-2">
              {exportResult.exportedEvidenceCount} confirmed evidence record{exportResult.exportedEvidenceCount === 1 ? "" : "s"} represented
              {exportResult.omittedEvidenceCount > 0 ? ` · ${exportResult.omittedEvidenceCount} omitted where no unambiguous standard section exists` : ""}.
            </p>
            {exportResult.warnings.map((warning) => (
              <p key={warning} className="mt-2 text-xs">{warning}</p>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
