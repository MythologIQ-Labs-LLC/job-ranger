// Default baseline for scripts/verify-release-upgrade.mjs.
//
// The Job Ranger releases were archived as job-ranger-vX.Y.Z tags (owner
// decision 2026-11-02) and Sojourner releases use vX.Y.Z. A Sojourner install
// upgrades Job Ranger data in place, so until Sojourner has a stable tag the
// baseline is the newest stable Job Ranger tag (job-ranger-v1.2.0).
// Pre-release tags (v1.0.0-alpha.1, job-ranger-v1.2.0-rc.5) are never chosen.

function newestStable(tags, prefix) {
  const pattern = new RegExp(`^${prefix}(\\d+)\\.(\\d+)\\.(\\d+)$`);
  const stable = [];
  for (const raw of tags) {
    const tag = String(raw).trim();
    const match = tag.match(pattern);
    if (match) stable.push({ tag, parts: match.slice(1).map(Number) });
  }
  stable.sort((a, b) => a.parts[0] - b.parts[0] || a.parts[1] - b.parts[1] || a.parts[2] - b.parts[2]);
  return stable.at(-1)?.tag ?? null;
}

/** Newest stable Sojourner vX.Y.Z tag, else newest stable job-ranger-vX.Y.Z tag, else null. */
export function selectDefaultBaseline(tags) {
  return newestStable(tags, "v") ?? newestStable(tags, "job-ranger-v");
}
