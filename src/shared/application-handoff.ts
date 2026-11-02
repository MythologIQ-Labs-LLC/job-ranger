import type { ApplicationMaterialProjection } from './application-materials.js';

export type ApplicationHandoffBlockReason =
  | 'missing-material'
  | 'unsupported-kind'
  | 'stale-evidence'
  | 'empty-material'
  | 'missing-evidence-links';

export type ApplicationHandoffReadiness =
  | { ready: true; text: string }
  | { ready: false; reason: ApplicationHandoffBlockReason };

/** Decide whether an explicitly selected, freshly listed material is safe to copy. No side effects. */
export function evaluateApplicationHandoff(
  material: ApplicationMaterialProjection | null,
): ApplicationHandoffReadiness {
  if (!material) return { ready: false, reason: 'missing-material' };
  if (material.kind !== 'cover-letter') return { ready: false, reason: 'unsupported-kind' };
  if (!Array.isArray(material.staleEvidenceIds) || material.staleEvidenceIds.length > 0) {
    return { ready: false, reason: 'stale-evidence' };
  }

  if (!Array.isArray(material.sections) || material.sections.length === 0 ||
      material.sections.some((section) => typeof section?.text !== 'string')) {
    return { ready: false, reason: 'empty-material' };
  }
  const text = material.sections.map((section) => section.text).join('\n\n');
  if (!text.trim()) return { ready: false, reason: 'empty-material' };

  const selected = material.selectedEvidenceIds;
  if (!Array.isArray(selected) || selected.length === 0 ||
      selected.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(selected).size !== selected.length) {
    return { ready: false, reason: 'missing-evidence-links' };
  }

  const cited = new Set<string>();
  for (const section of material.sections) {
    if (!Array.isArray(section.evidenceIds) || !section.evidenceUpdatedAtById ||
        typeof section.evidenceUpdatedAtById !== 'object') {
      return { ready: false, reason: 'missing-evidence-links' };
    }
    if (section.label === 'evidence' && section.evidenceIds.length === 0) {
      return { ready: false, reason: 'missing-evidence-links' };
    }
    for (const id of section.evidenceIds) {
      if (!selected.includes(id) ||
          typeof section.evidenceUpdatedAtById[id] !== 'string' ||
          !section.evidenceUpdatedAtById[id].trim()) {
        return { ready: false, reason: 'missing-evidence-links' };
      }
      cited.add(id);
    }
  }
  if (cited.size !== selected.length) return { ready: false, reason: 'missing-evidence-links' };
  return { ready: true, text };
}
