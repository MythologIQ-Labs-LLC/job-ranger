# Backup and Restore

Issue: #65

## Purpose

Sojourner is local-first, so the local data directory is valuable user-owned state. Backup and restore must protect that state without introducing a cloud account, sync provider, or second canonical data model.

A backup is a portable snapshot of Sojourner's canonical SQLite database plus the managed files that database references.

## Bundle format

Version 1 backups are directories named with the `.sojourner-backup` suffix and contain:

- `manifest.json`;
- `sojourner.sqlite3`, created with SQLite `VACUUM INTO` for a consistent snapshot;
- managed files under their portable `artifacts/...` paths.

The manifest records:

- format and version;
- creation time and app version;
- SHA-256 and byte size for the database and every managed file;
- the exact database migration identities present in the snapshot;
- each managed source/resume artifact record and its path relative to the Sojourner data root.

## Authority boundary

The backup format is not a competing career schema. The SQLite database remains canonical for Career Evidence, opportunities, applications, lifecycle state, Career Stories, application materials, settings, and other durable product state.

Managed artifacts remain files. The manifest exists only to verify and relocate the snapshot safely.

## Creation rules

Backup creation must:

1. snapshot SQLite with `VACUUM INTO` rather than copying a potentially changing database file;
2. include every file referenced by `source_artifacts.managed_path` and `resume_artifacts.managed_path`;
3. reject referenced files outside the Sojourner managed `artifacts/` tree;
4. verify copied files against their stored content hashes;
5. write the manifest only after all snapshot data has been copied and verified;
6. publish the completed bundle by renaming a temporary sibling directory, so incomplete backups are not presented as finished backups.

## Restore rules

Restore is deliberately two-phase.

### 1. Validate and stage while Sojourner is running

Before the user is offered the destructive restore action, Sojourner validates:

- bundle format and manifest bounds;
- safe relative paths with no traversal;
- database and artifact file hashes/sizes;
- SQLite `PRAGMA integrity_check`;
- manifest migration identities against the bundled database;
- that every backup migration is recognized by the current installation;
- database managed-artifact rows against manifest file metadata.

The selected backup is copied into a private restore-staging directory. Absolute managed paths inside the staged database are rebased to the current installation's data root. The staged database is integrity-checked again after rebasing.

### 2. Apply before backend initialization on restart

Sojourner writes a narrow pending-restore marker and relaunches. On the next process start, restore is applied before any backend initializes. The live data directory is swapped with the verified staged directory using same-parent filesystem renames. The marker is consumed exactly once.

This avoids modifying the live SQLite database while ordinary Sojourner services are running.

## Portability

Backups must survive moving between machines and operating systems where the Sojourner data root differs. Absolute `managed_path` values are therefore never treated as portable truth. The manifest carries safe relative paths, and restore rewrites managed database paths to the destination installation.

## Failure behavior

- Missing, changed, or symlinked managed files make backup creation fail rather than silently producing partial protection.
- A tampered or incomplete bundle is rejected before restore staging.
- A backup using migration identities unknown to the installed Sojourner version is rejected rather than guessed forward.
- A backup from another app version may restore when its migration identities are recognized; Sojourner warns that ordinary startup migrations may subsequently upgrade the database.

## Deliberate limitations

Version 1 does not provide:

- cloud sync;
- scheduled remote backups;
- incremental/differential backups;
- encryption/key management;
- merge-style restore;
- selective per-record restore.

Those capabilities require separate product evidence. The first requirement is boring, verifiable protection of the user's local state, which is somehow still an ambitious standard in software.

## Validation

Repository health must prove at minimum:

- a backup includes database state and referenced managed artifacts;
- the bundle validates before restore;
- restore works into a different data root;
- absolute managed paths are rebased to that new root;
- restored data is readable after normal backend initialization;
- the pending restore marker is consumed once;
- tampered artifact bytes are rejected before restore.

## Portable archive (post-v1.2.0)

A validated backup bundle can be packed into a single `.sojourner` file (`electron/src/portable-archive.cts`). This is the interchange format between the Electron and web/PWA runtimes.

**Names before the rename (2026-11-02), still read:** archives with the `.jobranger` extension, the `job-ranger-archive.json` manifest entry and the `job-ranger-portable-archive` / `job-ranger-backup` format ids, bundles whose database is `jobscout.sqlite3`, and restores staged with the `job-ranger-pending-restore` marker. Readers normalize them (`LEGACY_*` constants in `src/shared/backup.ts`, `electron/src/portable-archive.cts`, `electron/src/backup-service.cts`, `electron/src/database-file.cts`); only the Sojourner names are written. `tests/portable-archive-smoke-test.cjs` and `tests/backup-restore-smoke-test.cjs` restore both.

- **Container:** ZIP with STORE entries only. Compressed, encrypted, ZIP64, multi-part, symlink, or unsafe-path entries are rejected, and every entry is CRC-32 verified.
- **`sojourner-archive.json`:** archive format version (`sojourner-portable-archive` v1), producing runtime/channel/version/build, content format/version (`sojourner-backup` v1), and the SHA-256 and size of the inner `manifest.json`.
- **Inner bundle:** unchanged backup format v1 (SQLite snapshot, managed artifacts, migrations, managed-path records, per-file SHA-256).
- **Determinism:** entries use a fixed timestamp, so identical content produces identical archive bytes. Authoritative times live in the manifests.
- **Restore** extracts into a private work directory, then runs the full `validateBackup` before anything is staged. Migrations are compared against the migrations this build knows (core + feature registry). Newer archive formats, newer backup formats, and unknown migrations are rejected with explicit messages. Work directories are removed after staging or on the next start.
- **Desktop UI:** *Create backup* now saves a `.sojourner` file. *Select backup to restore* accepts a `.sojourner` file or the `manifest.json` inside a v1.2.0 backup folder.

Additional validation: `tests/portable-archive-smoke-test.cjs` covers round trip, determinism, bit flips, path traversal, newer versions, tampered manifest, tampered database with a valid CRC, and re-compression, on both the CLI and WASM SQLite engines. `tests/pwa/portability.spec.ts` covers Electron ↔ PWA moves.
