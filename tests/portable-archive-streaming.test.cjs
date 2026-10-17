// #302: packBackupBundle streams the archive to disk instead of holding every bundle file plus a
// full archive copy in memory. These checks pin the bytes to the in-memory encoder (so existing
// .jobranger readers are unaffected), bound the read and write sizes, and require a failed or
// inconsistent pack to leave nothing behind.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const nodeFs = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const archive = require('../electron-runtime/electron/src/portable-archive.cjs');

const MiB = 1024 * 1024;
const producer = { runtime: 'web', channel: 'test', appVersion: 'test-302', buildId: 'streaming' };
const createdAt = '2026-10-17T12:00:00.000Z';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Deterministic, non-sensitive filler bytes. */
function filler(size, seed) {
  const bytes = Buffer.alloc(size);
  let value = seed;
  for (let index = 0; index < size; index += 1) {
    value = (value * 1103515245 + 12345) >>> 0;
    bytes[index] = value >>> 24;
  }
  return bytes;
}

async function makeBundle(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jr-302-'));
  const bundle = path.join(root, 'bundle');
  const [database, ...artifacts] = Object.keys(files);
  for (const [relative, bytes] of Object.entries(files)) {
    const target = path.join(bundle, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  const manifest = Buffer.from(`${JSON.stringify({
    database: { path: database },
    artifactFiles: artifacts.map((relative) => ({ path: relative })),
  }, null, 2)}\n`);
  await fs.writeFile(path.join(bundle, 'manifest.json'), manifest);
  return { root, bundle, manifest, archivePath: path.join(root, 'out', 'backup.jobranger') };
}

const sampleFiles = () => ({
  'database/job-ranger.sqlite': filler(3 * MiB + 17, 1),
  'artifacts/resumes/morgan-rivera.pdf': filler(5 * MiB + 3, 2),
  'artifacts/evidence/empty.txt': Buffer.alloc(0),
  'artifacts/evidence/notes – ünïcode.txt': Buffer.from('Scheduling notes\n'),
});

/** Temporarily replaces a property for one test. */
function patch(target, key, replacement) {
  const original = target[key];
  target[key] = replacement(original);
  return () => { target[key] = original; };
}

async function exists(target) {
  return fs.access(target).then(() => true, () => false);
}

test('streamed archive bytes match the in-memory encoder exactly', async () => {
  const files = sampleFiles();
  const { root, bundle, manifest, archivePath } = await makeBundle(files);
  try {
    const packed = await archive.packBackupBundle({ bundleDirectory: bundle, archivePath, producer, createdAt });
    const written = await fs.readFile(archivePath);
    const expected = archive.encodeStoreZip([
      { name: archive.ARCHIVE_MANIFEST_FILE, bytes: Buffer.from(`${JSON.stringify(packed.manifest, null, 2)}\n`) },
      { name: archive.BACKUP_MANIFEST_FILE, bytes: manifest },
      ...Object.entries(files).map(([name, bytes]) => ({ name, bytes })),
    ]);
    assert.ok(Buffer.from(expected).equals(written), 'streamed archive differs from encodeStoreZip output');
    assert.equal(packed.bytes, written.length);
    assert.equal(packed.sha256, sha256(written));
    assert.equal(packed.manifest.backupManifest.sha256, sha256(manifest));
    assert.equal(packed.manifest.createdAt, createdAt);
    assert.equal(await exists(`${archivePath}.partial`), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('packing never reads a whole bundle file or writes the archive as one buffer', async () => {
  const files = sampleFiles();
  const largest = Math.max(...Object.values(files).map((bytes) => bytes.length));
  const { root, bundle, archivePath } = await makeBundle(files);
  const writes = [];
  const restoreRead = patch(nodeFs.promises, 'readFile', (original) => async (target, ...rest) => {
    if (String(target).startsWith(bundle) && path.basename(String(target)) !== 'manifest.json') {
      throw new Error(`whole-file read of ${path.relative(bundle, String(target))}`);
    }
    return original(target, ...rest);
  });
  const restoreWrite = patch(nodeFs.promises, 'writeFile', (original) => async (target, data, ...rest) => {
    if (ArrayBuffer.isView(data)) {
      writes.push(data.byteLength);
      return original(target, data, ...rest);
    }
    return original(target, (async function* () {
      for await (const chunk of data) {
        writes.push(chunk.byteLength);
        yield chunk;
      }
    })(), ...rest);
  });
  try {
    const packed = await archive.packBackupBundle({ bundleDirectory: bundle, archivePath, producer, createdAt });
    assert.ok(packed.bytes > largest);
    assert.ok(writes.length > 1, 'archive was written in more than one chunk');
    assert.ok(Math.max(...writes) <= MiB, `largest single write was ${Math.max(...writes)} bytes`);
    assert.equal(writes.reduce((sum, size) => sum + size, 0), packed.bytes);
  } finally {
    restoreRead();
    restoreWrite();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a streamed archive round-trips through extraction with identical files', async () => {
  const files = sampleFiles();
  const { root, bundle, manifest, archivePath } = await makeBundle(files);
  try {
    await archive.packBackupBundle({ bundleDirectory: bundle, archivePath, producer, createdAt });
    const extracted = path.join(root, 'extracted');
    const parsed = await archive.extractArchiveToBundle(archivePath, extracted);
    assert.deepEqual(parsed.producer, producer);
    assert.equal(sha256(await fs.readFile(path.join(extracted, 'manifest.json'))), sha256(manifest));
    for (const [relative, bytes] of Object.entries(files)) {
      assert.equal(sha256(await fs.readFile(path.join(extracted, ...relative.split('/')))), sha256(bytes), relative);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('truncated or corrupted streamed archives are rejected before anything is extracted', async () => {
  const { root, bundle, archivePath } = await makeBundle(sampleFiles());
  try {
    await archive.packBackupBundle({ bundleDirectory: bundle, archivePath, producer, createdAt });
    const bytes = await fs.readFile(archivePath);
    const truncated = path.join(root, 'truncated.jobranger');
    await fs.writeFile(truncated, bytes.subarray(0, bytes.length - 1000));
    await assert.rejects(archive.extractArchiveToBundle(truncated, path.join(root, 'x1')), archive.PortableArchiveError);
    assert.equal(await exists(path.join(root, 'x1')), false);
    const flipped = Buffer.from(bytes);
    flipped[Math.floor(bytes.length / 2)] ^= 0xff;
    const corrupt = path.join(root, 'corrupt.jobranger');
    await fs.writeFile(corrupt, flipped);
    await assert.rejects(archive.extractArchiveToBundle(corrupt, path.join(root, 'x2')), /CRC-32/);
    assert.equal(await exists(path.join(root, 'x2')), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

for (const change of ['content', 'length']) {
  test(`a file whose ${change} changes between the two reads fails the pack and leaves no file`, async () => {
    const { root, bundle, archivePath } = await makeBundle(sampleFiles());
    const target = path.join(bundle, 'artifacts', 'resumes', 'morgan-rivera.pdf');
    let reads = 0;
    const restore = patch(nodeFs, 'createReadStream', (original) => (file, ...rest) => {
      if (path.resolve(String(file)) === target && ++reads === 2) {
        // The second (writing) pass sees different bytes than the CRC pass measured.
        const bytes = nodeFs.readFileSync(target);
        if (change === 'content') bytes[10] ^= 0xff;
        return (async function* () { yield change === 'content' ? bytes : bytes.subarray(1); })();
      }
      return original(file, ...rest);
    });
    try {
      await assert.rejects(
        archive.packBackupBundle({ bundleDirectory: bundle, archivePath, producer, createdAt }),
        /morgan-rivera\.pdf changed while the backup archive was being written/,
      );
      assert.equal(reads, 2);
      assert.equal(await exists(archivePath), false);
      assert.equal(await exists(`${archivePath}.partial`), false);
    } finally {
      restore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

test('a storage failure mid-write removes the partial archive and keeps the error', async () => {
  const { root, bundle, archivePath } = await makeBundle(sampleFiles());
  const restore = patch(nodeFs.promises, 'writeFile', (original) => (target, data, ...rest) =>
    original(target, (async function* () {
      let count = 0;
      for await (const chunk of data) {
        if (++count === 4) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
        yield chunk;
      }
    })(), ...rest));
  try {
    await assert.rejects(
      archive.packBackupBundle({ bundleDirectory: bundle, archivePath, producer, createdAt }),
      (error) => error.code === 'ENOSPC',
    );
    assert.equal(await exists(archivePath), false);
    assert.equal(await exists(`${archivePath}.partial`), false);
  } finally {
    restore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an oversized bundle is refused from file sizes before any file is read', async () => {
  const { root, bundle, archivePath } = await makeBundle(sampleFiles());
  let streams = 0;
  const restoreStream = patch(nodeFs, 'createReadStream', (original) => (...args) => {
    streams += 1;
    return original(...args);
  });
  const restoreStat = patch(nodeFs.promises, 'lstat', (original) => async (target, ...rest) => {
    const stat = await original(target, ...rest);
    if (path.basename(String(target)) !== 'job-ranger.sqlite') return stat;
    return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { size: archive.MAX_ARCHIVE_BYTES });
  });
  try {
    await assert.rejects(
      archive.packBackupBundle({ bundleDirectory: bundle, archivePath, producer, createdAt }),
      /exceeds the supported 2 GB size/,
    );
    assert.equal(streams, 0);
    assert.equal(await exists(`${archivePath}.partial`), false);
  } finally {
    restoreStream();
    restoreStat();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('unsafe or repeated paths in the backup manifest are refused before writing', async () => {
  for (const [label, artifactPath] of [['traversal', '../outside.txt'], ['repeat', 'DATABASE/job-ranger.sqlite']]) {
    const { root, bundle, archivePath } = await makeBundle(sampleFiles());
    try {
      const manifestPath = path.join(bundle, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.artifactFiles.push({ path: artifactPath });
      await fs.writeFile(manifestPath, JSON.stringify(manifest));
      await assert.rejects(
        archive.packBackupBundle({ bundleDirectory: bundle, archivePath, producer, createdAt }),
        archive.PortableArchiveError,
        label,
      );
      assert.equal(await exists(path.dirname(archivePath)) && await exists(`${archivePath}.partial`), false, label);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});
