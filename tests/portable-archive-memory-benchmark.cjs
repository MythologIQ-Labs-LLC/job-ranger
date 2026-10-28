// #302 measurement (not part of npm test): peak Node memory while packing a synthetic,
// non-sensitive backup bundle into a .jobranger archive.
//
//   node --expose-gc tests/portable-archive-memory-benchmark.cjs [totalMiB] [portable-archive.cjs]
//
// Reports the peak rise in process.memoryUsage().arrayBuffers (Buffer/ArrayBuffer memory, where
// file and archive bytes live) and in RSS above the level measured just before packing. This is
// the shared core running on Node (the desktop harness); it is not a browser heap measurement.
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MiB = 1024 * 1024;
const totalMiB = Number(process.argv[2] ?? 160);
const modulePath = path.resolve(process.argv[3] ?? path.join(__dirname, '../electron-runtime/electron/src/portable-archive.cjs'));
const archive = require(modulePath);

async function makeBundle(root) {
  const bundle = path.join(root, 'bundle');
  // One database of a quarter of the total, the rest in equal 16 MiB artifacts.
  const databaseMiB = Math.max(1, Math.round(totalMiB / 4));
  const files = [['database/job-ranger.sqlite', databaseMiB]];
  for (let index = 0, left = totalMiB - databaseMiB; left > 0; index += 1, left -= 16) {
    files.push([`artifacts/synthetic-${index}.bin`, Math.min(16, left)]);
  }
  const block = Buffer.alloc(MiB);
  const records = [];
  for (const [relative, sizeMiB] of files) {
    const target = path.join(bundle, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const handle = await fs.open(target, 'w');
    const hash = createHash('sha256');
    for (let index = 0; index < sizeMiB; index += 1) {
      block.fill(index + relative.length);
      hash.update(block);
      await handle.write(block);
    }
    await handle.close();
    records.push({ path: relative, bytes: sizeMiB * MiB, sha256: hash.digest('hex') });
  }
  await fs.writeFile(path.join(bundle, 'manifest.json'), JSON.stringify({
    database: records[0],
    artifactFiles: records.slice(1),
  }));
  return bundle;
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jr-302-bench-'));
  try {
    const bundle = await makeBundle(root);
    global.gc?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const base = process.memoryUsage();
    let peakArrayBuffers = 0;
    let peakRss = 0;
    const sample = () => {
      const usage = process.memoryUsage();
      peakArrayBuffers = Math.max(peakArrayBuffers, usage.arrayBuffers - base.arrayBuffers);
      peakRss = Math.max(peakRss, usage.rss - base.rss);
    };
    const timer = setInterval(sample, 1);
    const started = Date.now();
    const packed = await archive.packBackupBundle({
      bundleDirectory: bundle,
      archivePath: path.join(root, 'backup.jobranger'),
      producer: { runtime: 'web', channel: 'bench', appVersion: 'bench', buildId: 'bench' },
      createdAt: '2026-10-17T12:00:00.000Z',
    });
    sample();
    clearInterval(timer);
    console.log(JSON.stringify({
      module: path.relative(process.cwd(), modulePath),
      node: process.version,
      bundleMiB: totalMiB,
      archiveMiB: +(packed.bytes / MiB).toFixed(1),
      peakArrayBuffersMiB: +(peakArrayBuffers / MiB).toFixed(1),
      peakRssMiB: +(peakRss / MiB).toFixed(1),
      ms: Date.now() - started,
      sha256: packed.sha256,
    }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
