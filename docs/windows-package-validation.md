# Windows Package Validation

This note records the release-blocking Windows packaging validation completed on 2026-09-24 while closing issue #38.

## Why this validation exists

The first v1.1.0 Windows release build failed before packaging because the desktop backend expected `sqlite3.exe` to exist on the host. That exposed a product defect: a normal Windows user should not need to install SQLite separately after installing Sojourner.

## Corrected boundary

The Windows release path now:

1. downloads the pinned official SQLite 3.53.4 x64 tools archive from `sqlite.org`;
2. verifies the archive against SQLite's published SHA3-256 digest;
3. copies only `sqlite3.exe` into the Electron Builder resource staging path;
4. uses that executable for release-build repository health checks;
5. packages it under the installed application's `resources` directory;
6. resolves the packaged executable before host `PATH` during normal Windows application runtime.

Source/development runs may still use `SQLITE3_PATH` or a host `sqlite3` executable on `PATH`.

## Evidence

GitHub Actions run `36017084154` on a Windows runner completed successfully and proved all of the following:

- clean dependency installation;
- pinned SQLite download and SHA3-256 verification;
- repository health through the Windows release build;
- successful NSIS installer generation;
- `sqlite3.exe` present and executable under `release/win-unpacked/resources`;
- runtime resolution selected the packaged SQLite executable with `SQLITE3_PATH` removed;
- expected Windows installer output was produced.

This document is evidence for the release migration, not a standing manual runbook. The durable checks live in `.github/workflows/release-build.yml`.
