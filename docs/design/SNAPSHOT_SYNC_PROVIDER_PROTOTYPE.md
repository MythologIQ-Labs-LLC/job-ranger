# Provider-neutral snapshot transport contract (prototype)

**Status:** Draft for [#257](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/257); **NOT accepted**, invoked by the application, or ready to ship. The real Google Drive provider and OAuth consent live under separate issues [#258](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/258) and [#252](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/252).

## Intent and dependencies

`src/shared/snapshot-sync.ts` prototypes a cross-runtime `SyncProvider` interface for Google Drive and possible OneDrive, without coupling the shared Career Ops core to a Google or Microsoft SDK.

This code is a **contract candidate and structural validation helpers**, not a cloud connector. It does **not** perform any file transfer, fetch, browser popup, file deletion, OAuth token storage, or background sync.

**Undecided product requirements:**

- [#255](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/255) decides whether the transferred object is the existing, versioned `.jobranger` portable archive or a separate, minimized agent-readable snapshot. The provider receives an opaque Blob plus the originating format identifier; it may not transform data or claim Truth Gate authority. Even an allowed filename extension is **not** fixed here.
- [#256](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/256) chooses the exact upload trigger, UI and disclosure. This draft assumes each transfer is initiated by a human action; any automatic background use requires a separate product/security decision.
- [#251](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/251) chooses retention and deletion policy. This draft has **no default retention count** and **no automatic delete**. Its `pruneSnapshots` requires a fresh, explicit selected-file preview/approval regardless of future retention choice.
- [#254](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/254) owns user-facing privacy, location, archive contents, permission/revocation/help text when the behavior ships.

## Interface review

| Method | Meaning | Promise / exclusion |
| --- | --- | --- |
| `authenticate(): Promise<SyncConnection>` | Start auth from an existing user gesture, via runtime-specific logic. | Must not open Google popup after arbitrary awaits or authorize cloud writes. |
| `isAuthenticated(): Promise<SyncConnection>` | Query connection truth with provenance, not a Boolean cached flag. | Only `connected_verified` after actual provider probe and timestamp; `authorized_unverified` is not proof. |
| `signOut(): Promise<SignOutResult>` | Clear local credential and report provider revocation accurately. | Remote revocation may be `failed`/`not_attempted`; no false success copy. |
| `uploadArchive(request: ApprovedSnapshotUpload): Promise<UploadOutcome>` | Transfer only specific archive bytes bound to explicit per-operation approval. | A successful upload response is `accepted_unverified` until readable remote content is verified. |
| `listSnapshots(query: SnapshotListQuery): Promise<SnapshotListPage>` | Page through app-created / user-authorized snapshot folder only, bounded to 1–100 items. | No account-wide listing or automatic host API access. |
| `pruneSnapshots(request: ApprovedSnapshotPrune): Promise<PruneResult>` | Delete only the exact remotely observed, explicitly approved IDs in the exact folder. | Partial failures reported with IDs. Does not silently implement a retention rule. |

The contract deliberately exposes no access token and no agent write API, and it does not create a background runtime. Google and OneDrive adapters must enforce their own scope, remote ownership, status, encrypted-in-transit HTTPS and error-code classification.

## Structural guards and their limits

Pure helpers `assertApprovedSnapshotUpload`, `assertApprovedSnapshotPrune`, `assertSnapshotListQuery` reject mismatched fingerprints, changed byte length, traversal filenames, missing disclosures, malformed identifiers, stale/future approvals, cross-folder deletions, wrong selection/order, duplicate IDs, out-of-bounds pagination.

These are defense in depth. JavaScript/TypeScript caller-supplied `validated: true` or `kind: "explicit_share_snapshot"` is **not cryptographic proof** of human consent or correct data. The orchestrator MUST:

1. Generate a versioned snapshot from canonical local data using the existing archive validator and verify its SHA-256 from the actual Blob before presenting consent. Never trust a third-party filename or unverified declared SHA.
2. Show where the bytes will go, what they contain, what Google `drive.file` permits and whether another agent can access them. Issue a unique short-lived transaction approval *only from the UI's human-initiated confirm control*, bound to the verified digest and byte length.
3. Pass the approved Blob to the current provider implementation immediately. An adapter must recheck actual authorization, scope, the bound approval, parent folder identity, remote file owner/permissions and expiry. A stored consent record does not authorize a new upload.
4. After provider upload success, query the specific remote object's readable metadata/content with the provider's own token, verify SHA-256/length against the approved source bytes, and only then display verified success. Google Drive's remote metadata may not expose a SHA-256 for arbitrary opaque files, so compare content or another accepted integrity proof. On uncertain connectivity, do not promise completion, delete local copies, or auto-repeat a potentially successful upload without deduplication.
5. For deletion, list the app-created folder, show the **exact** candidate remote files and bytes to the human, obtain new consent for precisely those opaque IDs, and re-verify the actual folder and file identities immediately before deletion. Expiry/race/conflict is a denial, not a silent override.
6. If a provider is blocked by CORS, an expired access token, browser popup policy, service failure or insufficient scope, report a specific recoverable state and preserve offline/manual export.

A five-minute freshness window is a conservative **prototype**, not yet a product-approved UX policy. It is enforced on the validated approval and prune preview independently. The client can forge data and the browser has no hardware-backed consent verifier; do not portray this as a security boundary against compromised first-party code.

## Agent sharing is separate authorization

Job Ranger's `drive.file` permission applies to **Job Ranger's** OAuth app. It does not give a ChatGPT/Claude/other agent the same grant or guarantee it can see archives. Any third-party agent needs its own user-approved Drive connection, actual file access within that app's scope, and an independently defined, minimized/read-only data-consumption contract. Do not store in Google `appDataFolder` if the product expects ordinary Drive browsing or third-party agent access: that folder is hidden from other apps and requires a different scope. <https://developers.google.com/workspace/drive/api/guides/appdata>

## Acceptance and follow-ups

1. Typecheck and run `node --experimental-strip-types tests/sync-provider-contract.test.mjs`; ordinary CI/Windows/PWA tests must pass against the exact PR head.
2. Independent adversarial review of the API and its **actual** human-gesture enforcement boundary, provider identity/folder guards, expiry, size limits, source hash validation and remote proof.
3. Resolve #255, #256 and #251 before implementation: don't convert this prototype into a shipped upload/prune behavior by assumption.
4. Port exact signatures into PWA / native adapters in separately reviewed code with fake provider conformance and real-user Google evidence. No OneDrive credentials or implementation until evidence of need.
5. Add public docs and a tested manual-export recovery path; revisit any future PWA-only decision under #259 separately.

**Do not close #257 or merge this as a final accepted interface merely because tests pass.**
