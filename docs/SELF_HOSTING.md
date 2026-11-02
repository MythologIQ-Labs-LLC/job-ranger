# Self-host Job Ranger as a PWA

This is the shortest path to running the current Job Ranger web app on your own computer.

The PWA is **local-first**. The application is served from your machine, and Job Ranger's Career Ops data is stored in the browser's local OPFS storage for the exact origin `http://localhost:4174`.

You do not need a hosted Job Ranger account, Docker, a separate database server, an AI subscription, or cloud storage.

## What you need

- Windows, macOS, or Linux
- Chrome or Edge for the currently validated path
- Node.js `22.12.0` or newer
- npm, which is included with Node.js
- Git, unless you download the repository as a ZIP instead

Firefox and Safari are not yet part of the evidence-backed public PWA compatibility matrix.

## Option A: clone with Git

Open a terminal or PowerShell window and run:

```bash
git clone https://github.com/MythologIQ-Labs-LLC/sojourner.git
cd sojourner
npm ci
npm run selfhost:pwa
```

When the server reports that it is ready, open:

```text
http://localhost:4174
```

Keep that terminal window open while you use Job Ranger.

## Option B: no Git

1. Open the [Job Ranger repository](https://github.com/MythologIQ-Labs-LLC/sojourner).
2. Choose **Code → Download ZIP**.
3. Extract the ZIP.
4. Open a terminal or PowerShell window in the extracted `job-ranger` folder.
5. Run:

```bash
npm ci
npm run selfhost:pwa
```

6. Open `http://localhost:4174` in Chrome or Edge.

## Install it like an app

Once Job Ranger is open in Chrome or Edge, use the browser's **Install app** control when available. The installed PWA opens in its own window while still using the same local Job Ranger origin and data.

Installing the PWA is optional. A normal browser tab works too.

## Stop and restart Job Ranger

To stop the local server, return to the terminal and press `Ctrl+C`.

To start it again later:

```bash
cd sojourner
npm run selfhost:pwa
```

Then return to `http://localhost:4174`.

## Update safely

Before a meaningful update, export a `.jobranger` portable backup from Job Ranger.

If you cloned with Git:

```bash
git pull
npm ci
npm run selfhost:pwa
```

If you downloaded a ZIP, download and extract the newer source, run `npm ci`, and start it with `npm run selfhost:pwa`.

Keep using the exact `http://localhost:4174` origin. Browser storage is origin-bound, so silently switching to a different port can make the existing profile appear missing. Job Ranger deliberately uses a strict port for this reason.

Application updates replace the application shell. They do not intentionally replace Career Ops data stored for the origin.

## Back up your data

Use Job Ranger's portable `.jobranger` export before upgrades, experiments, or browser-profile changes.

Do not clear storage for `localhost:4174` unless you intend to remove that local Job Ranger profile.

The portable archive is also the supported way to move data between the desktop application, a self-hosted PWA, and a future public Job Ranger origin.

## What stays local

The PWA stores its SQLite database and managed artifacts in browser-local OPFS storage.

The core workflow does not require a hosted account or remote AI provider. Public job-source requests occur only for supported sources and within the documented browser security boundary.

For the implementation and security model, see [PWA Runtime](./design/PWA_RUNTIME.md).

## If self-hosting is more setup than you want

The stable v1.2.0 desktop release remains available for Windows and macOS. Its installers are currently unsigned/unnotarized, so platform trust warnings are documented and expected.

A public hosted PWA is not currently offered. If external demand justifies it, MythologIQ Labs may offer a very low-cost hosted option later while preserving the local/self-hosted path.
