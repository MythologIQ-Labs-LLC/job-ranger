import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CandidateEvidence,
  CandidateEvidenceReviewItem,
  EvidenceReviewUpdate,
  PastedResumeInput,
  ResumeImportResult,
  SourceArtifact,
  UserAuthoredEvidenceInput,
} from "../shared/contracts";
import type {
  EvidenceMetadata,
  EvidenceSupersedeInput,
} from "../shared/evidence-extensions";
import { getDesktopApi } from "../services/api";

const evidenceEvent = "sojourner:career-evidence-changed";

export function useCareerEvidence() {
  const [artifacts, setArtifacts] = useState<SourceArtifact[]>([]);
  const [items, setItems] = useState<CandidateEvidenceReviewItem[]>([]);
  const [metadata, setMetadata] = useState<EvidenceMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<ResumeImportResult | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++refreshSequence.current;
    try {
      const [nextArtifacts, nextItems, nextMetadata] = await Promise.all([
        getDesktopApi().career.listSourceArtifacts(),
        getDesktopApi().career.listEvidence(),
        getDesktopApi().careerEvidence.listMetadata(),
      ]);
      if (requestId !== refreshSequence.current) return;
      setArtifacts(nextArtifacts);
      setItems(nextItems);
      setMetadata(nextMetadata);
      setError(null);
    } catch (refreshError) {
      if (requestId !== refreshSequence.current) return;
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Unable to load career evidence",
      );
    } finally {
      if (requestId === refreshSequence.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener(evidenceEvent, handleChange);
    return () => window.removeEventListener(evidenceEvent, handleChange);
  }, [refresh]);

  const runImport = useCallback(
    async (operation: () => Promise<ResumeImportResult | null>) => {
      setBusy(true);
      setError(null);
      try {
        const result = await operation();
        if (result) {
          setLastImport(result);
          await refresh();
          window.dispatchEvent(new CustomEvent(evidenceEvent));
        }
        return result;
      } catch (importError) {
        setError(
          importError instanceof Error
            ? importError.message
            : "Unable to import career evidence",
        );
        throw importError;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const importFile = useCallback(
    () => runImport(() => getDesktopApi().career.selectResumeImport()),
    [runImport],
  );

  const importPastedText = useCallback(
    (input: PastedResumeInput) =>
      runImport(() => getDesktopApi().career.importPastedText(input)),
    [runImport],
  );

  const create = useCallback(
    async (input: UserAuthoredEvidenceInput) => {
      setBusy(true);
      setError(null);
      try {
        const { references = [], ...careerInput } = input;
        const created = await getDesktopApi().career.createUserEvidence(careerInput);
        if (references.length > 0) {
          await getDesktopApi().careerEvidence.setReferences(created.id, references);
        }
        await refresh();
        window.dispatchEvent(new CustomEvent(evidenceEvent));
        return created;
      } catch (createError) {
        setError(
          createError instanceof Error
            ? createError.message
            : "Unable to add career evidence",
        );
        throw createError;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const review = useCallback(
    async (id: string, update: EvidenceReviewUpdate) => {
      setBusy(true);
      setError(null);
      try {
        const reviewed = await getDesktopApi().career.reviewEvidence(id, update);

        setItems((current) =>
          current.map((item) =>
            item.evidence.id === reviewed.id
              ? { ...item, evidence: reviewed }
              : item,
          ),
        );

        await refresh();
        window.dispatchEvent(new CustomEvent(evidenceEvent));
        return reviewed;
      } catch (reviewError) {
        setError(
          reviewError instanceof Error
            ? reviewError.message
            : "Unable to review career evidence",
        );
        throw reviewError;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const merge = useCallback(
    async (sourceId: string, targetId: string) => {
      setBusy(true);
      setError(null);
      try {
        const merged = await getDesktopApi().career.mergeEvidence(sourceId, targetId);
        await refresh();
        window.dispatchEvent(new CustomEvent(evidenceEvent));
        return merged;
      } catch (mergeError) {
        setError(
          mergeError instanceof Error
            ? mergeError.message
            : "Unable to merge career evidence",
        );
        throw mergeError;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const supersede = useCallback(
    async (evidenceId: string, input: EvidenceSupersedeInput) => {
      setBusy(true);
      setError(null);
      try {
        const replacement = await getDesktopApi().careerEvidence.supersedeEvidence(
          evidenceId,
          input,
        );
        await refresh();
        window.dispatchEvent(new CustomEvent(evidenceEvent));
        return replacement;
      } catch (supersedeError) {
        setError(
          supersedeError instanceof Error
            ? supersedeError.message
            : "Unable to replace career evidence",
        );
        throw supersedeError;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const metadataByEvidence = useMemo(
    () => new Map(metadata.map((entry) => [entry.evidenceId, entry])),
    [metadata],
  );

  const pending = useMemo(
    () => items.filter(({ evidence }) => evidence.verificationState === "imported"),
    [items],
  );

  const confirmed = useMemo(
    () =>
      items.filter(
        ({ evidence }) =>
          evidence.verificationState === "user-confirmed" ||
          evidence.verificationState === "user-authored",
      ),
    [items],
  );

  const superseded = useMemo(
    () =>
      items.filter(({ evidence }) => {
        if (evidence.verificationState !== "rejected") return false;
        return (metadataByEvidence.get(evidence.id)?.lineage ?? []).some(
          (lineage) => lineage.predecessorEvidenceId === evidence.id,
        );
      }),
    [items, metadataByEvidence],
  );

  const rejected = useMemo(
    () =>
      items.filter(({ evidence }) => {
        if (evidence.verificationState !== "rejected") return false;
        return !(metadataByEvidence.get(evidence.id)?.lineage ?? []).some(
          (lineage) => lineage.predecessorEvidenceId === evidence.id,
        );
      }),
    [items, metadataByEvidence],
  );

  return {
    artifacts,
    items,
    metadata,
    metadataByEvidence,
    pending,
    confirmed,
    superseded,
    rejected,
    loading,
    busy,
    error,
    lastImport,
    refresh,
    importFile,
    importPastedText,
    create,
    review,
    merge,
    supersede,
  };
}

export type CareerEvidenceRecord = CandidateEvidence;
