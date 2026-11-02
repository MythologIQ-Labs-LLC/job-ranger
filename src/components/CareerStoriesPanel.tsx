import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpenText,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useCareerStories } from "../career/stories";
import { ConfirmDialog } from "./ConfirmDialog";
import type { CandidateEvidence } from "../shared/contracts";
import type { CareerStory, CareerStoryInput } from "../shared/career-stories";

interface CareerStoriesPanelProps {
  evidence: CandidateEvidence[];
}

type StoryDraft = Omit<CareerStoryInput, "tags"> & { tagsText: string };

const emptyDraft: StoryDraft = {
  title: "",
  tagsText: "",
  situation: "",
  challenge: "",
  action: "",
  result: "",
  reflection: "",
  evidenceIds: [],
};

function tagsFromText(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/,|\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function toInput(draft: StoryDraft): CareerStoryInput {
  return {
    title: draft.title,
    tags: tagsFromText(draft.tagsText),
    situation: draft.situation,
    challenge: draft.challenge,
    action: draft.action,
    result: draft.result,
    reflection: draft.reflection,
    evidenceIds: draft.evidenceIds,
  };
}

function draftFromStory(story: CareerStory): StoryDraft {
  return {
    title: story.title,
    tagsText: story.tags.join(", "),
    situation: story.situation,
    challenge: story.challenge,
    action: story.action,
    result: story.result,
    reflection: story.reflection,
    // Stale links are intentionally not carried into the editable selection.
    // The user must choose current evidence or a suggested successor explicitly.
    evidenceIds: story.evidence.filter((item) => !item.stale).map((item) => item.evidenceId),
  };
}

export function CareerStoriesPanel({ evidence }: CareerStoriesPanelProps) {
  const stories = useCareerStories();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteStoryId, setDeleteStoryId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StoryDraft>(emptyDraft);

  const evidenceById = useMemo(
    () => new Map(evidence.map((item) => [item.id, item])),
    [evidence],
  );

  const resetForm = () => {
    setDraft(emptyDraft);
    setEditingId(null);
    setFormOpen(false);
  };

  const beginCreate = () => {
    setDraft(emptyDraft);
    setEditingId(null);
    setFormOpen(true);
  };

  const beginEdit = (story: CareerStory) => {
    setDraft(draftFromStory(story));
    setEditingId(story.id);
    setFormOpen(true);
  };

  const toggleEvidence = (evidenceId: string) => {
    setDraft((current) => ({
      ...current,
      evidenceIds: current.evidenceIds.includes(evidenceId)
        ? current.evidenceIds.filter((id) => id !== evidenceId)
        : [...current.evidenceIds, evidenceId],
    }));
  };

  const save = async () => {
    const input = toInput(draft);
    if (editingId) {
      await stories.update(editingId, input);
    } else {
      await stories.create(input);
    }
    resetForm();
  };

  const selectedStory = stories.stories.find((story) => story.id === deleteStoryId) ?? null;

  const activeStory = editingId
    ? stories.stories.find((story) => story.id === editingId) ?? null
    : null;

  return (
    <section className="panel panel-strong mt-6 p-6 sm:p-8" aria-labelledby="career-stories-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <span className="metric-label">Career stories</span>
          <h2 id="career-stories-heading" className="mt-2 text-2xl font-semibold">
            Organize proven work into stories you can reuse.
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            Capture the situation, challenge, action, result, and what you learned for interviews,
            networking, and future application materials. Every story stays linked to confirmed
            Career Evidence. The story helps you frame facts; it never becomes a new source of truth.
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={formOpen ? resetForm : beginCreate}
          disabled={evidence.length === 0}
        >
          {formOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {formOpen ? "Close editor" : "Add story"}
        </button>
      </div>

      {evidence.length === 0 && (
        <div className="support-note mt-5 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          Confirm at least one Career Evidence item before creating a story.
        </div>
      )}

      {stories.error && (
        <div className="support-note mt-5 px-4 py-3 text-sm text-[var(--color-danger)]">
          {stories.error}
        </div>
      )}

      {formOpen && (
        <div className="panel panel-muted mt-5 rounded-2xl p-5">
          <div className="flex items-center gap-2 font-semibold">
            <BookOpenText className="h-4 w-4" />
            {editingId ? "Edit Career Story" : "New Career Story"}
          </div>

          {activeStory && activeStory.staleEvidenceIds.length > 0 && (
            <div className="support-note mt-4 px-4 py-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-warning)]" />
                <div>
                  <div className="font-semibold">This story references evidence that has changed.</div>
                  <div className="mt-1 text-[var(--color-text-secondary)]">
                    Stale links are not selected automatically. Review the suggestions below and choose
                    the current evidence that still supports this story.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="sm:col-span-1">
              <span className="metric-label">Story title</span>
              <input
                className="input-shell mt-2"
                aria-label="Career Story title"
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Launching a difficult customer program"
              />
            </label>
            <label className="sm:col-span-1">
              <span className="metric-label">Tags</span>
              <input
                className="input-shell mt-2"
                aria-label="Career Story tags"
                value={draft.tagsText}
                onChange={(event) => setDraft((current) => ({ ...current, tagsText: event.target.value }))}
                placeholder="leadership, customer success, turnaround"
              />
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {([
              ["Situation", "situation", "What was happening?"],
              ["Challenge", "challenge", "What made it difficult or important?"],
              ["Action", "action", "What did you actually do?"],
              ["Result", "result", "What changed or happened afterward?"],
              ["Reflection", "reflection", "What did you learn or how would you use it again?"],
            ] as const).map(([label, key, placeholder]) => (
              <label key={key} className={key === "reflection" ? "md:col-span-2" : ""}>
                <span className="metric-label">{label}</span>
                <textarea
                  className="input-shell mt-2 min-h-28 resize-y py-3"
                  aria-label={`Career Story ${label.toLowerCase()}`}
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [key]: event.target.value }))
                  }
                  placeholder={placeholder}
                />
              </label>
            ))}
          </div>

          <div className="mt-5">
            <div className="metric-label">Evidence this story is built from</div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Choose current confirmed facts. The narrative above is framing, not factual authority.
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {evidence.map((item) => (
                <label
                  key={item.id}
                  className="panel panel-muted flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    aria-label={`Use evidence: ${item.statement}`}
                    checked={draft.evidenceIds.includes(item.id)}
                    onChange={() => toggleEvidence(item.id)}
                  />
                  <span className="min-w-0 text-sm leading-5">{item.statement}</span>
                </label>
              ))}
            </div>
          </div>

          {activeStory?.evidence.some((item) => item.stale) && (
            <div className="mt-4 space-y-2">
              {activeStory.evidence
                .filter((item) => item.stale)
                .map((item) => (
                  <div key={item.evidenceId} className="rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm">
                    <div className="font-semibold">Previous linked evidence</div>
                    <p className="mt-1 text-[var(--color-text-secondary)]">{item.statement}</p>
                    {item.replacementEvidenceIds.length > 0 ? (
                      <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                        Suggested current replacement{item.replacementEvidenceIds.length > 1 ? "s" : ""}: {item.replacementEvidenceIds
                          .map((id) => evidenceById.get(id)?.statement ?? id)
                          .join(" · ")}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                        No current replacement is recorded. Choose other current evidence if this story still applies.
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="secondary-button" onClick={resetForm} disabled={stories.busy}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void save()}
              disabled={stories.busy || !draft.title.trim() || draft.evidenceIds.length === 0}
            >
              {stories.busy ? "Saving..." : editingId ? "Save story" : "Create story"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {stories.loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading Career Stories...</p>
        ) : stories.stories.length === 0 ? (
          <div className="support-note px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            No Career Stories yet. Add one when you have an example you want to reuse in interviews,
            networking, or application materials.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {stories.stories.map((story) => (
              <article key={story.id} className="panel panel-muted rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{story.title}</h3>
                      {story.staleEvidenceIds.length > 0 && (
                        <span className="soft-badge soft-badge-warning">Needs evidence review</span>
                      )}
                    </div>
                    {story.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {story.tags.map((tag) => (
                          <span key={tag} className="soft-badge">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="surface-link-button p-2"
                      aria-label={`Edit Career Story ${story.title}`}
                      onClick={() => beginEdit(story)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="surface-link-button p-2 text-[var(--color-text-muted)]"
                      aria-label={`Delete Career Story ${story.title}`}
                      onClick={() => setDeleteStoryId(story.id)}
                      disabled={stories.busy}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-3 text-sm">
                  {([
                    ["Situation", story.situation],
                    ["Challenge", story.challenge],
                    ["Action", story.action],
                    ["Result", story.result],
                    ["Reflection", story.reflection],
                  ] as const)
                    .filter(([, value]) => Boolean(value))
                    .map(([label, value]) => (
                      <div key={label}>
                        <div className="metric-label">{label}</div>
                        <p className="mt-1 leading-6 text-[var(--color-text-secondary)]">{value}</p>
                      </div>
                    ))}
                </div>

                <div className="mt-4 border-t border-[var(--color-border)] pt-3">
                  <div className="metric-label">Linked Career Evidence</div>
                  <div className="mt-2 space-y-2">
                    {story.evidence.map((item) => (
                      <div key={item.evidenceId} className="text-sm">
                        <div className={item.stale ? "text-[var(--color-warning)]" : "text-[var(--color-text-secondary)]"}>
                          {item.statement}
                        </div>
                        {item.stale && (
                          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                            This evidence is no longer current. Edit the story to choose current evidence.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(selectedStory)}
        onClose={() => setDeleteStoryId(null)}
        onConfirm={async () => {
          if (!selectedStory) throw new Error("The selected Career Story is no longer available.");
          await stories.remove(selectedStory.id);
          setDeleteStoryId(null);
        }}
        title="Delete Career Story?"
        message={`Delete "${selectedStory?.title ?? "this story"}" and its situation, challenge, action, result, reflection, and story-to-evidence links? Your underlying Career Evidence remains unchanged. This cannot be undone.`}
        confirmLabel="Delete Career Story"
      />
    </section>
  );
}
