import { useState } from "react";
import { Filter as FilterIcon, Pencil, Plus, Power, SlidersHorizontal, Trash2 } from "lucide-react";
import { FilterForm } from "../components/FilterForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Layout } from "../components/Layout";
import { Modal } from "../components/Modal";
import { useAppContext } from "../context/AppContext";
import type { Filter, FilterDraft } from "../types";

function toDraft(filter: Filter): FilterDraft {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = filter;
  return draft;
}

function ruleText(values: string[], empty: string): string {
  return values.join(", ") || empty;
}

export function Filters() {
  const { filters, companies, addFilter, updateFilter, deleteFilter } = useAppContext();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const deleteTarget = filters.find((filter) => filter.id === deleteTargetId) ?? null;
  const editTarget = filters.find((filter) => filter.id === editTargetId) ?? null;

  const toggle = async (filter: Filter) => {
    setTogglingId(filter.id);
    try {
      await updateFilter(filter.id, { isActive: !filter.isActive });
    } catch {
      // updateFilter already reports the failure; the card keeps showing the saved state.
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <Layout>
      <section className="panel panel-strong px-6 py-7 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="alpha-pill">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Signal tuning
            </span>
            <h1 className="page-title mt-4">Build filters that coach the next scrape toward relevance.</h1>
            <p className="page-copy">
              Filters are a supportive layer, not an advanced configuration burden. Start narrow, observe the match count on the next run, and only add more logic if the queue still feels noisy.
            </p>
          </div>
          <button type="button" onClick={() => setModalOpen(true)} className="primary-button">
            <Plus className="h-4 w-4" />
            Create filter
          </button>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <article className="story-card">
          <p className="story-kicker">Keep it simple</p>
          <h2 className="story-title">Start with title + one keyword</h2>
          <p className="story-copy">
            Most Alpha users get meaningful signal by combining one role title phrase with one domain keyword.
          </p>
        </article>
        <article className="story-card">
          <p className="story-kicker">Scope carefully</p>
          <h2 className="story-title">Use company scoping when a board is noisy</h2>
          <p className="story-copy">
            Company-specific rules help when one source is broad and another is already clean enough.
          </p>
        </article>
        <article className="story-card">
          <p className="story-kicker">Review calmly</p>
          <h2 className="story-title">Tune after the next real scrape</h2>
          <p className="story-copy">
            Filter design is easier when you react to actual results instead of guessing upfront.
          </p>
        </article>
      </section>

      <div className="mt-8 space-y-4">
        {filters.length === 0 && (
          <div className="panel panel-strong px-6 py-12 text-center">
            <FilterIcon className="mx-auto h-10 w-10 text-[var(--color-text-muted)]" />
            <h2 className="mt-4 text-xl font-semibold">No filters yet</h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Create one rule for the role family you care about most, then let the next scrape show you whether the signal improved.
            </p>
          </div>
        )}

        {filters.map((filter) => {
          const company = companies.find((candidate) => candidate.id === filter.companyId);
          return (
            <section key={filter.id} className="panel panel-strong p-6" aria-labelledby={`filter-name-${filter.id}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 id={`filter-name-${filter.id}`} className="text-xl font-semibold text-[var(--color-text-primary)]">{filter.name}</h2>
                    <span className={`soft-badge ${filter.isActive ? "soft-badge-success" : "soft-badge-info"}`}>
                      {filter.isActive ? "Active" : "Disabled"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                    {company ? `Scoped to ${company.name}` : "Applies to every supported company"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setEditTargetId(filter.id)} aria-label={`Edit filter ${filter.name}`} className="secondary-button">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggle(filter)}
                    disabled={togglingId === filter.id}
                    aria-label={`${filter.isActive ? "Disable" : "Enable"} filter ${filter.name}`}
                    className="secondary-button"
                  >
                    <Power className="h-4 w-4" aria-hidden="true" />
                    {filter.isActive ? "Disable" : "Enable"}
                  </button>
                  <button type="button" onClick={() => setDeleteTargetId(filter.id)} aria-label={`Delete filter ${filter.name}`} className="danger-button">
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-4 text-sm text-[var(--color-text-secondary)] md:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Title includes", ruleText(filter.titleInclude, "Any")],
                  ["Keywords include", ruleText(filter.keywordsInclude, "Any")],
                  ["Location includes", ruleText(filter.locationInclude, "Any")],
                  ["Minimum salary", filter.salaryMin ? `$${filter.salaryMin.toLocaleString()}` : "Any"],
                  ["Title excludes", ruleText(filter.titleExclude, "None")],
                  ["Keywords exclude", ruleText(filter.keywordsExclude, "None")],
                  ["Location excludes", ruleText(filter.locationExclude, "None")],
                ].map(([term, value]) => (
                  <div key={term}>
                    <dt className="font-semibold text-[var(--color-text-primary)]">{term}</dt>
                    <dd className="mt-1">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteFilter(deleteTarget.id);
          setDeleteTargetId(null);
        }}
        title="Delete filter?"
        message={`Delete "${deleteTarget?.name ?? "this filter"}"? This removes its local matching rules and cannot be undone.`}
        confirmLabel="Delete filter"
      />
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Create filter">
        <FilterForm
          companies={companies}
          onSubmit={async (draft) => {
            await addFilter(draft);
            setModalOpen(false);
          }}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>
      <Modal open={Boolean(editTarget)} onClose={() => setEditTargetId(null)} title="Edit filter">
        {editTarget && (
          <FilterForm
            key={editTarget.id}
            companies={companies}
            initial={toDraft(editTarget)}
            onSubmit={async (draft) => {
              await updateFilter(editTarget.id, draft);
              setEditTargetId(null);
            }}
            onCancel={() => setEditTargetId(null)}
          />
        )}
      </Modal>
    </Layout>
  );
}
