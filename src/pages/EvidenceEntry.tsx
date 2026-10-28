import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ExternalLink,
  History,
  PencilLine,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useCareerEvidence } from "../career/evidence";
import { useOnboardingPreference } from "../career/onboarding";
import type { CredentialStatus, EvidenceSubjectType } from "../shared/contracts";

const evidenceTypes: Array<{ value: EvidenceSubjectType; label: string }> = [
  { value: "role", label: "Job or role" },
  { value: "skill", label: "Skill" },
  { value: "credential", label: "License or credential" },
  { value: "education", label: "Education or training" },
  { value: "project", label: "Project, freelance, volunteer, or portfolio work" },
  { value: "achievement", label: "Achievement or result" },
  { value: "publication", label: "Publication or public work" },
  { value: "other", label: "Other useful career evidence" },
];

function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function EvidenceEntry() {
  const navigate = useNavigate();
  const evidence = useCareerEvidence();
  const { dismiss } = useOnboardingPreference();
  const [subjectType, setSubjectType] = useState<EvidenceSubjectType>("role");
  const [statement, setStatement] = useState("");
  const [organization, setOrganization] = useState("");
  const [titleOrName, setTitleOrName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [skills, setSkills] = useState("");
  const [credentialIssuer, setCredentialIssuer] = useState("");
  const [credentialJurisdiction, setCredentialJurisdiction] = useState("");
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | "">("");
  const [credentialExpiration, setCredentialExpiration] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [workSampleUrl, setWorkSampleUrl] = useState("");
  const [localReference, setLocalReference] = useState("");
  const [supersedingId, setSupersedingId] = useState<string | null>(null);
  const [replacementText, setReplacementText] = useState("");
  const [replacementType, setReplacementType] = useState<EvidenceSubjectType>("other");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evidenceById = useMemo(
    () => new Map(evidence.items.map((item) => [item.evidence.id, item.evidence])),
    [evidence.items],
  );

  const clearForNext = () => {
    setStatement("");
    setOrganization("");
    setTitleOrName("");
    setStartDate("");
    setEndDate("");
    setSkills("");
    setCredentialIssuer("");
    setCredentialJurisdiction("");
    setCredentialStatus("");
    setCredentialExpiration("");
    setCredentialId("");
    setWorkSampleUrl("");
    setLocalReference("");
  };

  const handleSave = async () => {
    if (!statement.trim()) {
      setError("Describe one fact about your background before saving it.");
      return;
    }

    setError(null);
    try {
      await evidence.create({
        subjectType,
        statement,
        organization: organization || undefined,
        titleOrName: titleOrName || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        skills: splitList(skills),
        credential:
          subjectType === "credential"
            ? {
                issuer: credentialIssuer || null,
                jurisdiction: credentialJurisdiction || null,
                status: credentialStatus || null,
                expirationDate: credentialExpiration || null,
                credentialId: credentialId || null,
              }
            : null,
        references: [
          ...(workSampleUrl.trim()
            ? [{ kind: "url" as const, label: "Work sample", value: workSampleUrl.trim() }]
            : []),
          ...(localReference.trim()
            ? [{ kind: "local" as const, label: "Local reference", value: localReference.trim() }]
            : []),
        ],
      });
      setSaved(true);
      clearForNext();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save career evidence");
    }
  };

  const beginSupersede = (id: string, text: string, type: EvidenceSubjectType) => {
    setSupersedingId(id);
    setReplacementText(text);
    setReplacementType(type);
    setError(null);
  };

  const handleSupersede = async () => {
    if (!supersedingId || !replacementText.trim()) return;
    try {
      await evidence.supersede(supersedingId, {
        statement: replacementText.trim(),
        subjectType: replacementType,
      });
      setSupersedingId(null);
      setReplacementText("");
      setSaved(true);
    } catch (supersedeError) {
      setError(
        supersedeError instanceof Error
          ? supersedeError.message
          : "Unable to replace career evidence",
      );
    }
  };

  const finish = () => {
    dismiss();
    navigate("/career-profile");
  };

  return (
    <Layout>
      <section className="panel panel-strong px-6 py-7 sm:px-8">
        <span className="alpha-pill">
          <Plus className="h-3.5 w-3.5" />
          Career Evidence
        </span>
        <h1 className="page-title mt-4">Build your career evidence one fact at a time.</h1>
        <p className="page-copy">
          Add work you can stand behind in an interview. A fact can come from a job, project, license, volunteer role, freelance engagement, education, portfolio, military service, or something else that genuinely demonstrates what you have done.
        </p>
      </section>

      {(error || evidence.error) && (
        <section className="support-note mt-6 px-5 py-4 text-sm text-[var(--color-danger)]">
          {error ?? evidence.error}
        </section>
      )}

      <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_0.42fr]">
        <div className="panel panel-strong p-6 sm:p-8">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <label>
              <span className="metric-label">What kind of evidence is this?</span>
              <select
                className="select-shell mt-2"
                aria-label="Evidence type"
                value={subjectType}
                onChange={(event) => {
                  setSubjectType(event.target.value as EvidenceSubjectType);
                  setSaved(false);
                }}
              >
                {evidenceTypes.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span className="metric-label">Organization or group</span>
              <input
                className="input-shell mt-2"
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                placeholder="Optional"
              />
            </label>

            <label className="sm:col-span-2">
              <span className="metric-label">What did you do, know, earn, or accomplish?</span>
              <textarea
                className="input-shell mt-2 min-h-32 resize-y py-3"
                value={statement}
                onChange={(event) => {
                  setStatement(event.target.value);
                  setSaved(false);
                }}
                placeholder="Example: Coordinated weekly scheduling for six field technicians across three service areas."
              />
              <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                Write one factual statement. Sojourner will not inflate it into something you did not say.
              </span>
            </label>

            <label>
              <span className="metric-label">Role, project, credential, or item name</span>
              <input
                className="input-shell mt-2"
                value={titleOrName}
                onChange={(event) => setTitleOrName(event.target.value)}
                placeholder="Optional"
              />
            </label>

            <label>
              <span className="metric-label">Skills or tools demonstrated</span>
              <input
                className="input-shell mt-2"
                value={skills}
                onChange={(event) => setSkills(event.target.value)}
                placeholder="Optional, comma separated"
              />
            </label>

            <label>
              <span className="metric-label">Started</span>
              <input
                className="input-shell mt-2"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                placeholder="Optional, e.g. 2023 or Jan 2023"
              />
            </label>

            <label>
              <span className="metric-label">Ended</span>
              <input
                className="input-shell mt-2"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                placeholder="Optional or Present"
              />
            </label>
          </div>

          {subjectType === "credential" && (
            <section className="border-divider mt-7 border-t pt-6">
              <div>
                <h2 className="text-lg font-semibold">Credential details</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
                  Add only what you know. Status and expiration can affect whether a credential actually establishes current eligibility; Sojourner will not assume an old license is active.
                </p>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                <label>
                  <span className="metric-label">Issuer</span>
                  <input className="input-shell mt-2" aria-label="Credential issuer" value={credentialIssuer} onChange={(event) => setCredentialIssuer(event.target.value)} placeholder="Optional" />
                </label>
                <label>
                  <span className="metric-label">Jurisdiction</span>
                  <input className="input-shell mt-2" aria-label="Credential jurisdiction" value={credentialJurisdiction} onChange={(event) => setCredentialJurisdiction(event.target.value)} placeholder="Optional, e.g. Maryland" />
                </label>
                <label>
                  <span className="metric-label">Status</span>
                  <select className="select-shell mt-2" aria-label="Credential status" value={credentialStatus} onChange={(event) => setCredentialStatus(event.target.value as CredentialStatus | "")}>
                    <option value="">Not specified</option>
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="inactive">Inactive</option>
                    <option value="expired">Expired</option>
                  </select>
                </label>
                <label>
                  <span className="metric-label">Expiration date</span>
                  <input className="input-shell mt-2" aria-label="Credential expiration date" type="date" value={credentialExpiration} onChange={(event) => setCredentialExpiration(event.target.value)} />
                </label>
                <label className="sm:col-span-2">
                  <span className="metric-label">Credential or license number</span>
                  <input className="input-shell mt-2" aria-label="Credential identifier" value={credentialId} onChange={(event) => setCredentialId(event.target.value)} placeholder="Optional" autoComplete="off" />
                </label>
              </div>
            </section>
          )}

          <section className="border-divider mt-7 border-t pt-6">
            <h2 className="text-lg font-semibold">Work samples and references</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
              Optional. Web links must use http or https. Local references are stored as inert text; Sojourner will not open or execute them automatically.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <label>
                <span className="metric-label">Work sample link</span>
                <input
                  className="input-shell mt-2"
                  aria-label="Work sample link"
                  value={workSampleUrl}
                  onChange={(event) => setWorkSampleUrl(event.target.value)}
                  placeholder="https://..."
                />
              </label>
              <label>
                <span className="metric-label">Local reference</span>
                <input
                  className="input-shell mt-2"
                  aria-label="Local evidence reference"
                  value={localReference}
                  onChange={(event) => setLocalReference(event.target.value)}
                  placeholder="Optional file/path note"
                />
              </label>
            </div>
          </section>

          <div className="border-divider mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <div className="text-sm text-[var(--color-text-secondary)]">
              {saved ? (
                <span className="inline-flex items-center gap-2 font-semibold text-[var(--color-success)]">
                  <Check className="h-4 w-4" /> Saved as user-authored evidence
                </span>
              ) : (
                "Nothing becomes a claim until you save it."
              )}
            </div>
            <button type="button" className="primary-button" onClick={() => void handleSave()} disabled={evidence.busy}>
              <Plus className="h-4 w-4" />
              {evidence.busy ? "Saving..." : "Add career evidence"}
            </button>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="story-card">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[var(--color-success)]" />
              <h2 className="text-xl font-semibold">You are the source</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">
              Facts entered here are stored as user-authored Career Evidence. References support your record, but a URL or file path never becomes a factual claim by itself.
            </p>
          </div>

          <div className="story-card">
            <p className="story-kicker">Corrections preserve history</p>
            <h2 className="story-title">Replace a fact instead of erasing it.</h2>
            <p className="story-copy">
              When a confirmed fact needs correction, Sojourner keeps the old record, retires it from matching, and links it to the replacement.
            </p>
          </div>

          <div className="story-card">
            <p className="story-kicker">Keep moving</p>
            <h2 className="story-title">Add as much as is useful today.</h2>
            <p className="story-copy">
              You can stop after one fact and continue searching. Career history is allowed to be incremental. Civilization survives.
            </p>
            <button type="button" className="secondary-button mt-5" onClick={finish}>
              Continue to Career Profile
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </aside>
      </section>

      <section className="panel panel-strong mt-6 p-6 sm:p-8" aria-labelledby="current-evidence-heading">
        <div className="max-w-3xl">
          <span className="metric-label">Current facts</span>
          <h2 id="current-evidence-heading" className="mt-2 text-2xl font-semibold">Review and correct confirmed evidence.</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            Replacing a fact creates a new authoritative record and preserves explicit lineage to the retired version. It does not rewrite history in place.
          </p>
        </div>

        {evidence.confirmed.length === 0 ? (
          <div className="support-note mt-5 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            No confirmed Career Evidence yet.
          </div>
        ) : (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {evidence.confirmed.map(({ evidence: item }) => {
              const itemMetadata = evidence.metadataByEvidence.get(item.id);
              const replacing = supersedingId === item.id;
              const replacesEarlier = (itemMetadata?.lineage ?? []).some(
                (lineage) => lineage.successorEvidenceId === item.id,
              );
              return (
                <article key={item.id} className="panel panel-muted rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="metric-label">{item.subjectType}</div>
                      <p className="mt-2 text-sm leading-6">{item.statement}</p>
                      {replacesEarlier && (
                        <p className="mt-2 text-xs font-semibold text-[var(--color-primary)]">Replaces an earlier version of this fact</p>
                      )}
                    </div>
                    {!replacing && (
                      <button
                        type="button"
                        className="secondary-button"
                        aria-label={`Replace evidence: ${item.statement}`}
                        onClick={() => beginSupersede(item.id, item.statement, item.subjectType)}
                        disabled={evidence.busy}
                      >
                        <PencilLine className="h-4 w-4" /> Replace
                      </button>
                    )}
                  </div>

                  {(itemMetadata?.references.length ?? 0) > 0 && (
                    <div className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3">
                      {itemMetadata?.references.map((reference) => (
                        <div key={reference.id} className="text-xs text-[var(--color-text-secondary)]">
                          <span className="font-semibold">{reference.label ?? (reference.kind === "url" ? "Web reference" : "Local reference")}:</span>{" "}
                          {reference.kind === "url" ? (
                            <button
                              type="button"
                              className="surface-link-button inline-flex items-center gap-1"
                              onClick={() => void window.electronAPI.openExternal(reference.value)}
                            >
                              {reference.value}<ExternalLink className="h-3 w-3" />
                            </button>
                          ) : (
                            <span>{reference.value}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {replacing && (
                    <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
                      <select
                        className="select-shell"
                        aria-label="Replacement evidence type"
                        value={replacementType}
                        onChange={(event) => setReplacementType(event.target.value as EvidenceSubjectType)}
                      >
                        {evidenceTypes.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <textarea
                        className="input-shell min-h-24 resize-y py-3"
                        aria-label="Replacement evidence statement"
                        value={replacementText}
                        onChange={(event) => setReplacementText(event.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <button type="button" className="surface-link-button text-sm font-semibold" onClick={() => setSupersedingId(null)} disabled={evidence.busy}>Cancel</button>
                        <button type="button" className="primary-button" onClick={() => void handleSupersede()} disabled={evidence.busy || !replacementText.trim()}>
                          <History className="h-4 w-4" /> Save replacement
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {evidence.superseded.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-semibold">Superseded history ({evidence.superseded.length})</summary>
            <div className="mt-3 space-y-2">
              {evidence.superseded.map(({ evidence: item }) => {
                const lineage = (evidence.metadataByEvidence.get(item.id)?.lineage ?? []).find(
                  (entry) => entry.predecessorEvidenceId === item.id,
                );
                const replacement = lineage ? evidenceById.get(lineage.successorEvidenceId) : null;
                return (
                  <div key={item.id} className="panel panel-muted rounded-2xl px-4 py-3 text-sm">
                    <p className="line-through opacity-70">{item.statement}</p>
                    {replacement && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Replaced by: {replacement.statement}</p>}
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </section>
    </Layout>
  );
}
