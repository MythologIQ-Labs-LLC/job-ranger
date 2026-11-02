# Application Materials

Application materials are versioned projections of application context and confirmed Career Evidence. They are not a second source of career truth.

## Authority boundaries

- Career Evidence remains the authority for factual career claims.
- The tracked Application owns the opportunity context.
- Requirement mapping determines which confirmed evidence supports the saved job.
- Application materials may quote or organize supported confirmed evidence, but they do not create new factual evidence.
- A generated draft is a historical projection. Later Career Evidence corrections do not rewrite the old draft.
- Each factual section snapshots the `updatedAt` value of the supporting Career Evidence it used.
- If supporting evidence is later edited, rejected, merged, or superseded, the historical draft is marked stale and should be rebuilt before use.
- No inference provider is required for deterministic material creation.

## First supported material

The first material type is a deterministic cover-letter draft. It contains:

1. an opening based only on the tracked application title and company;
2. up to three concise factual paragraphs derived from the strongest distinct direct or transferable Career Evidence mappings;
3. a neutral closing using the saved profile name when available.

Unsupported or ambiguous job requirements remain visible as warnings and are never converted into claims.

## Versioning

Each created cover letter receives a monotonically increasing version per application. Old versions remain available until explicitly deleted. Deleting the application cascades its prepared materials.

Version history is immutable application context, not a live view of current Career Evidence. When factual evidence changes after a material version was prepared, Sojourner preserves the old wording for history and marks that version stale rather than silently rewriting it.

## Copying a cover letter for manual use (#270, #228)

**Copy text** on a cover-letter version is the manual handoff into an employer's own application form. It is implemented on `main` (#270) and is not in a published release.

- **Explicit and single-version.** Nothing is copied until the user clicks **Copy text** on one version. There is one copy control per version and one status region (`copyNotice`).
- **Fresh read, then a pure readiness check.** On click, the panel re-reads `applicationMaterials.list(applicationId)`, finds the same version by id and application, and passes it to `evaluateApplicationHandoff` in `src/shared/application-handoff.ts`. The function has no IO, clock or network. It returns the exact displayed text (sections joined by a blank line) or one fail-closed reason: `missing-material`, `unsupported-kind`, `stale-evidence`, `empty-material` or `missing-evidence-links`. That last reason covers empty, duplicate or uncited selected evidence ids, citations outside the selection, an evidence section without a citation, and missing evidence timestamps. Staleness comes only from the backend's `staleEvidenceIds`.
- **Truthful outcome.** Success is reported only after `navigator.clipboard.writeText` resolves. A blocked reason or a denied or unavailable clipboard is reported as "not copied" or "Copy was unavailable", and the text stays selectable.
- **No lifecycle side effects.** Copying never submits an application, marks it applied or changes its status, and sends nothing over the network. The clipboard is outside Sojourner's local database: after an explicit copy, other clipboard consumers on the device can read the text.

Evidence: `tests/application-handoff.test.mjs` (each readiness reason), `tests/pwa/cover-letter-copy.spec.ts` (real Chromium clipboard, denial, stale before and during review, no status change, no external request) and `tests/e2e/application-materials.spec.ts` (Electron: exact text, unchanged `interested` status, denied copy, stale version blocked; the clipboard is substituted there, so it does not prove the native Electron clipboard). Scope and limits: [`docs/plans/228-application-handoff.md`](../plans/228-application-handoff.md). No Qortara gate or audit PASS is recorded for this work; it is reviewed under the `GOVERNANCE.md` merge standard.

## Deliberate limitations

This tranche does not add free-form AI rewriting, arbitrary factual editing, autonomous submission, DOCX/PDF rendering, or generic document templates. Those capabilities require their own evidence-backed justification and must preserve the same truth boundary.
