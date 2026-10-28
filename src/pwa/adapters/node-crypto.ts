/**
 * Browser runtime adapter for the subset of `node:crypto` used by the shared
 * Sojourner core: synchronous SHA-256 content hashing (provenance hashes,
 * backup integrity) and RFC 4122 random UUIDs.
 *
 * SubtleCrypto digests are asynchronous, while the shared core computes
 * hashes synchronously, so SHA-256 is implemented here (FIPS 180-4) and is
 * verified against Node's implementation by tests/pwa-adapters.test.mjs.
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const encoder = new TextEncoder();

class Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private blockLength = 0;
  private totalLength = 0;
  private finished = false;

  update(data: Uint8Array): void {
    if (this.finished) throw new Error("Digest already called");
    let offset = 0;
    this.totalLength += data.length;
    while (offset < data.length) {
      const take = Math.min(64 - this.blockLength, data.length - offset);
      this.block.set(data.subarray(offset, offset + take), this.blockLength);
      this.blockLength += take;
      offset += take;
      if (this.blockLength === 64) {
        this.compress();
        this.blockLength = 0;
      }
    }
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error("Digest already called");
    const bitLength = this.totalLength * 8;
    this.block[this.blockLength++] = 0x80;
    if (this.blockLength > 56) {
      this.block.fill(0, this.blockLength);
      this.compress();
      this.blockLength = 0;
    }
    this.block.fill(0, this.blockLength, 56);
    const view = new DataView(this.block.buffer);
    view.setUint32(56, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(60, bitLength >>> 0, false);
    this.compress();
    this.finished = true;
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let index = 0; index < 8; index += 1) outView.setUint32(index * 4, this.state[index], false);
    return out;
  }

  private compress(): void {
    const w = this.words;
    const b = this.block;
    for (let i = 0; i < 16; i += 1) {
      w[i] = (b[i * 4] << 24) | (b[i * 4 + 1] << 16) | (b[i * 4 + 2] << 8) | b[i * 4 + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, bb, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    const s = this.state;
    s[0] = (s[0] + a) | 0;
    s[1] = (s[1] + bb) | 0;
    s[2] = (s[2] + c) | 0;
    s[3] = (s[3] + d) | 0;
    s[4] = (s[4] + e) | 0;
    s[5] = (s[5] + f) | 0;
    s[6] = (s[6] + g) | 0;
    s[7] = (s[7] + h) | 0;
  }
}

function toHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface HashLike {
  update(data: string | Uint8Array, encoding?: string): HashLike;
  digest(encoding?: "hex" | "base64"): string;
}

export function createHash(algorithm: string): HashLike {
  if (algorithm.toLowerCase() !== "sha256") {
    throw new Error(`The Sojourner web runtime only supports sha256 hashing (requested ${algorithm})`);
  }
  const hash = new Sha256();
  const api: HashLike = {
    update(data, encoding) {
      if (typeof data === "string") {
        if (encoding && encoding !== "utf8" && encoding !== "utf-8") {
          throw new Error(`Unsupported hash input encoding: ${encoding}`);
        }
        hash.update(encoder.encode(data));
      } else {
        hash.update(data);
      }
      return api;
    },
    digest(encoding = "hex") {
      const bytes = hash.digest();
      if (encoding === "hex") return toHex(bytes);
      if (encoding === "base64") return toBase64(bytes);
      throw new Error(`Unsupported digest encoding: ${String(encoding)}`);
    },
  };
  return api;
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export default { createHash, randomUUID };
