// Transmission manifest computed from everything the broker transmits
// (payload and context). An uncovered leaf is a policy violation before any
// provider call, so the manifest cannot understate what leaves Sojourner.

import type {
  InferenceDataClass,
  InferenceLocation,
  InferenceRequestContext,
  InferenceTransmissionItem,
  InferenceTransmissionManifest,
} from "./contract.cjs";

export interface ManifestFieldRule {
  /** Normalized path prefix, arrays written as `[]`, e.g. `payload.evidence[].`. */
  prefix: string;
  dataClass: InferenceDataClass;
  purpose: string;
}

export class ManifestCoverageError extends Error {}

interface Leaf {
  path: string;
  value: unknown;
}

function collectLeaves(value: unknown, path: string, leaves: Leaf[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectLeaves(item, `${path}[]`, leaves));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectLeaves(child, `${path}.${key}`, leaves);
    }
    return;
  }
  if (value !== undefined) leaves.push({ path, value });
}

function ruleFor(path: string, rules: readonly ManifestFieldRule[]): ManifestFieldRule | undefined {
  return rules.find((rule) =>
    path === rule.prefix ||
    (rule.prefix.endsWith(".") && path.startsWith(rule.prefix)) ||
    path.startsWith(`${rule.prefix}.`) ||
    path.startsWith(`${rule.prefix}[`),
  );
}

function isRecordId(leaf: Leaf): boolean {
  return typeof leaf.value === "string" && (/\.id$/.test(leaf.path) || /Ids?(\[\])?$/.test(leaf.path));
}

function addLeaf(items: Map<InferenceDataClass, InferenceTransmissionItem>, rule: ManifestFieldRule, leaf: Leaf): void {
  const item =
    items.get(rule.dataClass) ??
    { dataClass: rule.dataClass, purpose: rule.purpose, recordIds: [], fields: [], redactions: [] };
  if (!item.fields.includes(leaf.path)) item.fields.push(leaf.path);
  if (isRecordId(leaf) && !item.recordIds.includes(leaf.value as string)) item.recordIds.push(leaf.value as string);
  items.set(rule.dataClass, item);
}

export function computeTransmissionManifest(
  transmitted: { payload: unknown; context: InferenceRequestContext },
  rules: readonly ManifestFieldRule[],
  location: InferenceLocation,
  redactions: readonly string[] = [],
): InferenceTransmissionManifest {
  const leaves: Leaf[] = [];
  collectLeaves(transmitted.payload, "payload", leaves);
  collectLeaves(transmitted.context, "context", leaves);
  const items = new Map<InferenceDataClass, InferenceTransmissionItem>();
  for (const leaf of leaves) {
    const rule = ruleFor(leaf.path, rules);
    if (!rule) throw new ManifestCoverageError("A transmitted field is not covered by the task's manifest policy.");
    addLeaf(items, rule, leaf);
  }
  const list = Array.from(items.values()).map((item) => ({ ...item, redactions: [...redactions] }));
  return {
    location,
    items: list,
    containsPersonalCareerData: list.some((item) => item.dataClass !== "public-job-text"),
    consentReceiptId: null,
  };
}
