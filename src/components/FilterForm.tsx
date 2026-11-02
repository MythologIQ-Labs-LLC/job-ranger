import { useState } from "react";
import type { Company, FilterDraft } from "../types";

interface FilterFormProps {
  companies: Company[];
  initial?: FilterDraft;
  onSubmit: (draft: FilterDraft) => Promise<void>;
  onCancel: () => void;
}

const emptyDraft: FilterDraft = {
  name: "",
  companyId: null,
  titleInclude: [],
  titleExclude: [],
  keywordsInclude: [],
  keywordsExclude: [],
  salaryMin: null,
  locationInclude: [],
  locationExclude: [],
  isActive: true,
};

type TagField =
  | "titleInclude"
  | "titleExclude"
  | "keywordsInclude"
  | "keywordsExclude"
  | "locationInclude"
  | "locationExclude";

const tagFields: { field: TagField; id: string; label: string; placeholder: string }[] = [
  { field: "titleInclude", id: "filter-title-include", label: "Title includes", placeholder: "engineer, platform" },
  { field: "titleExclude", id: "filter-title-exclude", label: "Title excludes", placeholder: "senior, manager" },
  { field: "keywordsInclude", id: "filter-keywords-include", label: "Keywords include", placeholder: "typescript, api" },
  { field: "keywordsExclude", id: "filter-keywords-exclude", label: "Keywords exclude", placeholder: "on-call, overnight" },
  { field: "locationInclude", id: "filter-location-include", label: "Location includes", placeholder: "remote, new york" },
  { field: "locationExclude", id: "filter-location-exclude", label: "Location excludes", placeholder: "relocation required" },
];

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Tag inputs keep the raw text while typing (so commas and spaces can be typed);
// lists are parsed only when the filter is saved.
function tagText(draft: FilterDraft): Record<TagField, string> {
  return Object.fromEntries(tagFields.map(({ field }) => [field, draft[field].join(", ")])) as Record<TagField, string>;
}

export function FilterForm({ companies, initial, onSubmit, onCancel }: FilterFormProps) {
  const [draft, setDraft] = useState<FilterDraft>(initial ?? emptyDraft);
  const [tags, setTags] = useState<Record<TagField, string>>(() => tagText(initial ?? emptyDraft));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = Object.fromEntries(tagFields.map(({ field }) => [field, parseTags(tags[field])]));
    await onSubmit({ ...draft, ...parsed });
  };

  return (
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
      <div>
        <label htmlFor="filter-name" className="block text-sm font-medium">Filter name</label>
        <input
          id="filter-name"
          type="text"
          required
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          className="input-shell mt-1"
        />
      </div>
      <div>
        <label htmlFor="filter-company" className="block text-sm font-medium">Company scope</label>
        <select
          id="filter-company"
          value={draft.companyId ?? "all"}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              companyId: event.target.value === "all" ? null : event.target.value,
            }))
          }
          className="select-shell mt-1"
        >
          <option value="all">All companies</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tagFields.map(({ field, id, label, placeholder }) => (
          <div key={field}>
            <label htmlFor={id} className="block text-sm font-medium">{label}</label>
            <input
              id={id}
              type="text"
              placeholder={placeholder}
              value={tags[field]}
              onChange={(event) => setTags((current) => ({ ...current, [field]: event.target.value }))}
              className="input-shell mt-1"
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="filter-salary-min" className="block text-sm font-medium">Minimum salary</label>
          <input
            id="filter-salary-min"
            type="number"
            min={0}
            value={draft.salaryMin ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                salaryMin: event.target.value ? Number(event.target.value) : null,
              }))
            }
            className="input-shell mt-1"
          />
        </div>
        <label className="panel panel-muted flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(event) =>
              setDraft((current) => ({ ...current, isActive: event.target.checked }))
            }
          />
          Filter is active
        </label>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="secondary-button">
          Cancel
        </button>
        <button type="submit" className="primary-button">
          Save filter
        </button>
      </div>
    </form>
  );
}
