// Closed envelopes for the agent workspace (#285/#286), mirrored by the JSON Schemas in
// docs/design/schemas. Structure only: these checks grant no authority.
//
// Version history (decision record docs/design/DRIVE_AGENT_CONTRACT_DECISIONS_286.md):
// - jr-agent-operation-batch v1 (G2 draft) is superseded and refused with an explicit
//   diagnostic; it is never reinterpreted as v2.
// - v2 adds per-draft attachment references bound to the commit marker (D02), explicit new
//   versus correction evidence proposals (D05), and is checked against the trusted local
//   workspace ID (D13).
// - jr-agent-export (manifest) v2 adds career_direction and selected_applications scopes
//   (D06), the workspace ID and the omitted-scope list (D14).

import { AgentWorkspaceError, decodeStrictUtf8, parseStrictJson, type Diagnostic } from "./strict-json.ts";

export const LIMITS = {
  maxBatchBytes: 4 * 1024 * 1024,
  maxCommitBytes: 64 * 1024,
  maxManifestBytes: 256 * 1024,
  maxOperations: 100,
  maxAttachments: 20,
  maxAttachmentBytes: 20 * 1024 * 1024,
} as const;

export const BATCH_SCHEMA_VERSION = 2;
export const MANIFEST_SCHEMA_VERSION = 2;

type Spec =
  | { t: "string"; min?: number; max?: number; pattern?: RegExp; timestamp?: boolean }
  | { t: "const"; value: unknown }
  | { t: "enum"; values: readonly unknown[] }
  | { t: "int"; min: number; max: number }
  | { t: "nullable"; of: Spec }
  | { t: "array"; items: Spec; min?: number; max?: number; unique?: boolean }
  | { t: "object"; required: Record<string, Spec>; optional?: Record<string, Spec> };

const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const SHA256 = /^[a-f0-9]{64}$/;
const str = (min: number, max: number, pattern?: RegExp): Spec => ({ t: "string", min, max, pattern });
const timestamp: Spec = { t: "string", min: 20, max: 32, pattern: TIMESTAMP, timestamp: true };
export const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
export const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/;
const recordId = str(6, 128, RECORD_ID_PATTERN);
// IDs of Job Ranger's own records (jobs use stringified integers such as "42").
const canonicalId = str(1, 128, RECORD_ID_PATTERN);
const operationId = str(7, 128, /^op_[A-Za-z0-9_-]+$/);
const batchId = str(7, 128, /^batch_[A-Za-z0-9_-]+$/);
const exportId = str(9, 96, /^ex_[A-Za-z0-9_-]+$/);
const sha256: Spec = str(64, 64, SHA256);
const longText = str(1, 50_000);
const title = str(1, 240);
const evidenceRefs: Spec = {
  t: "array",
  max: 120,
  items: { t: "object", required: { record_id: canonicalId, revision: str(6, 160) } },
};

export const AGENT_OWNED_KINDS = ["workspace_note_version", "opportunity_annotation", "material_draft_version", "follow_up_plan"] as const;
export const CONSEQUENTIAL_KINDS = ["application_status_claim", "evidence_change_proposal"] as const;
export type OperationKind = (typeof AGENT_OWNED_KINDS)[number] | (typeof CONSEQUENTIAL_KINDS)[number];

/**
 * D03: closed, versioned mapping from the agent's claimed-status vocabulary to canonical
 * ApplicationStatus, used only to compare and display. A matching claim proves nothing and
 * never changes canonical status.
 */
export const CLAIM_STATUS_MAPPING = {
  version: 1,
  map: { drafted: "interested", submitted: "applied", interviewing: "interview", offered: "offer", rejected: "rejected", withdrawn: "withdrawn" },
} as const;
export type ClaimedStatus = keyof typeof CLAIM_STATUS_MAPPING.map;

export const ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};
const ATTACHMENT_PATH = /^workspace\/attachments\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const attachmentRef: Spec = {
  t: "object",
  required: {
    path: str(1, 240, ATTACHMENT_PATH),
    media_type: { t: "enum", values: Object.keys(ATTACHMENT_TYPES) },
    bytes: { t: "int", min: 1, max: LIMITS.maxAttachmentBytes },
    sha256,
  },
};

const payloadSpecs: Record<OperationKind, Spec> = {
  workspace_note_version: {
    t: "object",
    required: { title, body: longText },
    optional: { source_links: { t: "array", max: 20, items: str(1, 1024, /^https:\/\//) } },
  },
  opportunity_annotation: {
    t: "object",
    required: { opportunity_id: canonicalId, title, notes: longText, observed_at: timestamp },
  },
  material_draft_version: {
    t: "object",
    required: {
      material_kind: { t: "enum", values: ["resume", "cover_letter", "worksheet", "interview_prep"] },
      title,
      body: longText,
      source_evidence_refs: evidenceRefs,
      gate_status: { t: "const", value: "not_checked" },
    },
    // D02: exact references into the batch's commit-marker inventory.
    optional: { attachments: { t: "array", min: 1, max: LIMITS.maxAttachments, items: attachmentRef } },
  },
  follow_up_plan: {
    t: "object",
    required: { label: title, description: longText, due_at: { t: "nullable", of: timestamp } },
  },
  application_status_claim: {
    t: "object",
    required: {
      application_id: canonicalId,
      claimed_status: { t: "enum", values: Object.keys(CLAIM_STATUS_MAPPING.map) },
      reported_context: longText,
    },
  },
  evidence_change_proposal: {
    t: "object",
    required: {
      // D05: "new" has no target; "correction" names an existing evidence record.
      proposal_kind: { t: "enum", values: ["new", "correction"] },
      evidence_id: { t: "nullable", of: canonicalId },
      change_reason: longText,
      proposed_text: longText,
      source_evidence_refs: evidenceRefs,
    },
  },
};

const operationEnvelope: Record<string, Spec> = {
  operation_id: operationId,
  record_id: recordId,
  base_revision: { t: "nullable", of: str(6, 160) },
  previous_operation_id: { t: "nullable", of: operationId },
  authored_at: timestamp,
};

const batchEnvelope: Record<string, Spec> = {
  workspace_id: str(6, 128, WORKSPACE_ID_PATTERN),
  batch_id: batchId,
  source_export_id: exportId,
  source_manifest_sha256: sha256,
  actor_claim: {
    t: "object",
    required: { actor_id: str(6, 128, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/), display_name: str(1, 240) },
  },
  created_at: timestamp,
  previous_batch_id: { t: "nullable", of: batchId },
};

const commitSpec: Record<string, Spec> = {
  batch_id: batchId,
  batch_sha256: sha256,
  batch_bytes: { t: "int", min: 1, max: LIMITS.maxBatchBytes },
  attachments: { t: "array", max: LIMITS.maxAttachments, items: attachmentRef },
};

const MANIFEST_SCOPES = [
  "tracks",
  "career_direction",
  "confirmed_evidence",
  "selected_opportunities",
  "selected_applications",
  "resume_templates",
  "selected_resumes",
  "selected_cover_letters",
] as const;
// D14: a stable privacy-policy class list, identical in every export; never a live report.
const MANIFEST_EXCLUSIONS = [
  "application_private_notes",
  "unapproved_evidence",
  "credentials",
  "contact_identity",
  "unselected_contacts",
  "raw_source_documents",
  "unselected_applications",
  "unselected_resumes",
  "unselected_cover_letters",
  "compensation_and_location_preferences",
] as const;
export const MANIFEST_ROLES = [...MANIFEST_SCOPES, "gate_report", "guide", "schema"] as const;
export const MANIFEST_MEDIA_TYPES = ["application/json", "text/markdown", "application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
export { MANIFEST_SCOPES, MANIFEST_EXCLUSIONS };

const scopeList = (min: number): Spec => ({ t: "array", min, max: MANIFEST_SCOPES.length, unique: true, items: { t: "enum", values: MANIFEST_SCOPES } });

const manifestSpec: Record<string, Spec> = {
  export_id: exportId,
  workspace_id: str(6, 128, WORKSPACE_ID_PATTERN),
  created_at: timestamp,
  job_ranger_build: str(1, 120),
  source_revision: str(1, 160),
  selection: {
    t: "object",
    required: {
      scopes: scopeList(1),
      omitted_scopes: scopeList(0),
      excluded_by_default: { t: "array", min: 1, max: 15, unique: true, items: { t: "enum", values: MANIFEST_EXCLUSIONS } },
    },
  },
  files: {
    t: "array",
    min: 1,
    max: 100,
    items: {
      t: "object",
      required: {
        path: str(1, 240, /^(?:data|materials|schema)\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/),
        role: { t: "enum", values: MANIFEST_ROLES },
        media_type: { t: "enum", values: MANIFEST_MEDIA_TYPES },
        bytes: { t: "int", min: 1, max: 20_971_520 },
        sha256: { t: "string", pattern: SHA256 },
      },
    },
  },
};

const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function check(value: unknown, spec: Spec, path: string, out: Diagnostic[]): void {
  const push = (code: string, message: string): void => {
    out.push({ code, path, message });
  };
  switch (spec.t) {
    case "string": {
      if (typeof value !== "string") return push("invalid_type", `Expected a string, found ${typeName(value)}.`);
      if (spec.min !== undefined && value.length < spec.min) return push("too_short", `Must be at least ${spec.min} characters.`);
      if (spec.max !== undefined && value.length > spec.max) return push("too_long", `Must be at most ${spec.max} characters.`);
      if (spec.pattern && !spec.pattern.test(value)) return push("invalid_format", "Value does not match the required format.");
      if (spec.timestamp) {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().replace(".000Z", "Z") !== value) {
          return push("invalid_format", "Timestamp is not a real UTC date-time.");
        }
      }
      return;
    }
    case "const":
      if (value !== spec.value) push("invalid_value", `Must be ${JSON.stringify(spec.value)}.`);
      return;
    case "enum":
      if (!spec.values.includes(value)) push("invalid_value", `Must be one of: ${spec.values.join(", ")}.`);
      return;
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) return push("invalid_type", `Expected an integer, found ${typeName(value)}.`);
      if (value < spec.min || value > spec.max) push("out_of_range", `Must be between ${spec.min} and ${spec.max}.`);
      return;
    case "nullable":
      if (value !== null) check(value, spec.of, path, out);
      return;
    case "array": {
      if (!Array.isArray(value)) return push("invalid_type", `Expected an array, found ${typeName(value)}.`);
      if (spec.min !== undefined && value.length < spec.min) return push("too_few_items", `Needs at least ${spec.min} item(s).`);
      if (spec.max !== undefined && value.length > spec.max) return push("too_many_items", `Allows at most ${spec.max} item(s).`);
      if (spec.unique && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) push("duplicate_item", "Items must be unique.");
      value.forEach((item, i) => check(item, spec.items, `${path}[${i}]`, out));
      return;
    }
    case "object":
      checkObject(value, spec.required, spec.optional ?? {}, path, out);
  }
}

function checkObject(value: unknown, required: Record<string, Spec>, optional: Record<string, Spec>, path: string, out: Diagnostic[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    out.push({ code: "invalid_type", path, message: `Expected an object, found ${typeName(value)}.` });
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!hasOwn(required, key) && !hasOwn(optional, key)) {
      out.push({ code: "unknown_field", path: `${path}.${key.slice(0, 64)}`, message: `Field "${key.slice(0, 64)}" is not part of this closed format.` });
    }
  }
  for (const [key, spec] of Object.entries(required)) {
    if (!hasOwn(record, key)) out.push({ code: "missing_field", path: `${path}.${key}`, message: `Required field "${key}" is missing.` });
    else check(record[key], spec, `${path}.${key}`, out);
  }
  for (const [key, spec] of Object.entries(optional)) {
    if (hasOwn(record, key)) check(record[key], spec, `${path}.${key}`, out);
  }
}

function checkEnvelopeHeader(value: unknown, format: string, version: number, out: Diagnostic[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    out.push({ code: "invalid_type", path: "$", message: `Expected a ${format} object, found ${typeName(value)}.` });
    return false;
  }
  const record = value as Record<string, unknown>;
  const declared = record.schema_version;
  if (record.format !== format) out.push({ code: "unsupported_format", path: "$.format", message: `Expected format "${format}".` });
  else if (typeof declared === "number" && Number.isInteger(declared) && declared >= 1 && declared < version) {
    out.push({ code: "superseded_schema_version", path: "$.schema_version", message: `${format} v${declared} is superseded; write schema_version ${version}. Older files are never reinterpreted.` });
  } else if (declared !== version) {
    out.push({ code: "unsupported_schema_version", path: "$.schema_version", message: `Only schema_version ${version} is supported.` });
  }
  return out.length === 0;
}

/** Checks a closed envelope whose format/schema_version header was already verified. */
function checkClosed(value: Record<string, unknown>, version: number, spec: Record<string, Spec>, out: Diagnostic[]): void {
  const header: Record<string, Spec> = { format: { t: "const", value: value.format }, schema_version: { t: "const", value: version } };
  checkObject(value, { ...header, ...spec }, {}, "$", out);
}

function readJson(bytes: Uint8Array, limit: number): { value?: unknown; diagnostics: Diagnostic[] } {
  if (bytes.length > limit) return { diagnostics: [{ code: "too_large", path: "$", message: `File exceeds ${limit} bytes.` }] };
  try {
    return { value: parseStrictJson(decodeStrictUtf8(bytes)), diagnostics: [] };
  } catch (error) {
    if (error instanceof AgentWorkspaceError) return { diagnostics: [error.toDiagnostic()] };
    throw error;
  }
}

export interface AttachmentRef {
  path: string;
  media_type: string;
  bytes: number;
  sha256: string;
}

export interface Operation {
  operation_id: string;
  record_id: string;
  base_revision: string | null;
  previous_operation_id: string | null;
  authored_at: string;
  kind: OperationKind;
  payload: Record<string, unknown>;
}

export interface OperationBatch {
  format: "jr-agent-operation-batch";
  schema_version: 2;
  workspace_id: string;
  batch_id: string;
  source_export_id: string;
  source_manifest_sha256: string;
  actor_claim: { actor_id: string; display_name: string };
  created_at: string;
  previous_batch_id: string | null;
  operations: Operation[];
}

export type ParseResult<T> = { ok: true; value: T; batch: T; diagnostics: [] } | { ok: false; diagnostics: Diagnostic[] };

const foldPath = (path: string) => path.normalize("NFKC").toLowerCase();

function checkAttachmentList(list: AttachmentRef[], path: string, out: Diagnostic[]): void {
  const seen = new Set<string>();
  list.forEach((attachment, i) => {
    const at = `${path}[${i}]`;
    if (!attachment.path.toLowerCase().endsWith(ATTACHMENT_TYPES[attachment.media_type])) {
      out.push({ code: "invalid_value", path: `${at}.path`, message: "Attachment extension does not match its media type." });
    }
    const folded = foldPath(attachment.path);
    if (seen.has(folded)) out.push({ code: "duplicate_item", path: `${at}.path`, message: "Attachment paths must be unique." });
    seen.add(folded);
  });
}

export function parseOperationBatch(bytes: Uint8Array): ParseResult<OperationBatch> {
  const { value, diagnostics } = readJson(bytes, LIMITS.maxBatchBytes);
  if (diagnostics.length) return { ok: false, diagnostics };
  const out: Diagnostic[] = [];
  if (!checkEnvelopeHeader(value, "jr-agent-operation-batch", BATCH_SCHEMA_VERSION, out)) return { ok: false, diagnostics: out };
  const record = value as Record<string, unknown>;
  const { operations, ...rest } = record;
  checkClosed(rest, BATCH_SCHEMA_VERSION, batchEnvelope, out);
  if (!hasOwn(record, "operations")) {
    out.push({ code: "missing_field", path: "$.operations", message: 'Required field "operations" is missing.' });
  } else if (!Array.isArray(operations)) {
    out.push({ code: "invalid_type", path: "$.operations", message: "Expected an array of operations." });
  } else if (operations.length < 1) {
    out.push({ code: "too_few_items", path: "$.operations", message: "Needs at least 1 operation." });
  } else if (operations.length > LIMITS.maxOperations) {
    out.push({ code: "too_many_items", path: "$.operations", message: `Allows at most ${LIMITS.maxOperations} operations.` });
  } else {
    const seen = new Set<string>();
    // Every reference to one attachment path must describe identical bytes.
    const attachmentsByPath = new Map<string, string>();
    operations.forEach((operation, i) => {
      const path = `$.operations[${i}]`;
      const kind = (operation as Record<string, unknown> | null)?.kind;
      if (typeof kind !== "string" || !hasOwn(payloadSpecs, kind)) {
        out.push({ code: "unknown_kind", path: `${path}.kind`, message: "Unsupported operation kind." });
        return;
      }
      const before = out.length;
      checkObject(operation, { ...operationEnvelope, kind: { t: "const", value: kind }, payload: payloadSpecs[kind as OperationKind] }, {}, path, out);
      const op = operation as Record<string, unknown>;
      const id = op.operation_id;
      if (typeof id === "string") {
        if (seen.has(id)) out.push({ code: "duplicate_operation_id", path: `${path}.operation_id`, message: `Operation "${id}" appears more than once in this batch.` });
        seen.add(id);
      }
      if (out.length !== before) return;
      const payload = op.payload as Record<string, unknown>;
      if (kind === "evidence_change_proposal") {
        const isNew = payload.proposal_kind === "new";
        if (isNew !== (payload.evidence_id === null)) {
          out.push({ code: "invalid_value", path: `${path}.payload.evidence_id`, message: 'A "new" proposal has evidence_id null; a "correction" names the evidence it corrects.' });
        }
      }
      if (kind === "material_draft_version" && Array.isArray(payload.attachments)) {
        const list = payload.attachments as AttachmentRef[];
        checkAttachmentList(list, `${path}.payload.attachments`, out);
        for (const a of list) {
          const key = foldPath(a.path);
          const identity = `${a.path}\u0000${a.media_type}\u0000${a.bytes}\u0000${a.sha256}`;
          if (attachmentsByPath.has(key) && attachmentsByPath.get(key) !== identity) {
            out.push({ code: "attachment_conflict", path: `${path}.payload.attachments`, message: `Attachment "${a.path}" is described differently by two operations.` });
          }
          attachmentsByPath.set(key, identity);
        }
      }
    });
  }
  if (out.length) return { ok: false, diagnostics: out };
  return { ok: true, value: record as unknown as OperationBatch, batch: record as unknown as OperationBatch, diagnostics: [] };
}

/** Distinct attachment references made by a parsed batch's operations, sorted by path. */
export function batchAttachmentRefs(batch: OperationBatch): AttachmentRef[] {
  const byPath = new Map<string, AttachmentRef>();
  for (const op of batch.operations) {
    const list = op.kind === "material_draft_version" ? (op.payload.attachments as AttachmentRef[] | undefined) : undefined;
    for (const a of list ?? []) byPath.set(a.path, { path: a.path, media_type: a.media_type, bytes: a.bytes, sha256: a.sha256 });
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export interface CommitMarker {
  format: "jr-agent-batch-commit";
  schema_version: 1;
  batch_id: string;
  batch_sha256: string;
  batch_bytes: number;
  attachments: AttachmentRef[];
}

/**
 * D01: completion marker `<batch_id>.commit.json`, published last. It binds the batch bytes
 * and the exact attachment inventory. Integrity only: not identity, consent or a transaction.
 */
export function parseCommitMarker(bytes: Uint8Array): ParseResult<CommitMarker> {
  const { value, diagnostics } = readJson(bytes, LIMITS.maxCommitBytes);
  if (diagnostics.length) return { ok: false, diagnostics };
  const out: Diagnostic[] = [];
  if (!checkEnvelopeHeader(value, "jr-agent-batch-commit", 1, out)) return { ok: false, diagnostics: out };
  const record = value as Record<string, unknown>;
  checkClosed(record, 1, commitSpec, out);
  if (!out.length) checkAttachmentList(record.attachments as AttachmentRef[], "$.attachments", out);
  if (out.length) return { ok: false, diagnostics: out };
  return { ok: true, value: record as unknown as CommitMarker, batch: record as unknown as CommitMarker, diagnostics: [] };
}

/** Structural checks for an export manifest object (closed v2 envelope). */
export function validateExportManifest(value: unknown): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!checkEnvelopeHeader(value, "jr-agent-export", MANIFEST_SCHEMA_VERSION, out)) return out;
  checkClosed(value as Record<string, unknown>, MANIFEST_SCHEMA_VERSION, manifestSpec, out);
  return out;
}

export function parseExportManifest(bytes: Uint8Array): { ok: boolean; value?: Record<string, unknown>; diagnostics: Diagnostic[] } {
  const { value, diagnostics } = readJson(bytes, LIMITS.maxManifestBytes);
  if (diagnostics.length) return { ok: false, diagnostics };
  const out = validateExportManifest(value);
  return out.length ? { ok: false, diagnostics: out } : { ok: true, value: value as Record<string, unknown>, diagnostics: [] };
}
