// Verifies a published export packet against the locally trusted receipt (#285).
// A remote manifest cannot authenticate itself: its digest must match the local receipt
// first, and only then are its file entries used to check file bytes.

import { sha256Hex } from "./canonical.ts";
import { parseExportManifest } from "./schema-v1.ts";
import type { Diagnostic } from "./strict-json.ts";
import type { ExportReceipt } from "./types.ts";

export interface PacketToVerify {
  manifestBytes: Uint8Array;
  files: Map<string, { bytes: Uint8Array }>;
  receipt: ExportReceipt;
}

export async function verifyExportPacket({ manifestBytes, files, receipt }: PacketToVerify): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  const manifestDigest = await sha256Hex(manifestBytes);
  if (manifestDigest !== receipt.manifest_sha256 || manifestBytes.length !== receipt.manifest_bytes) {
    out.push({ code: "manifest_digest_mismatch", path: "manifest.json", message: "Manifest bytes do not match the local export receipt." });
    return out;
  }
  const parsed = parseExportManifest(manifestBytes);
  if (!parsed.ok || !parsed.value) return parsed.diagnostics;
  const manifest = parsed.value as { export_id: string; files: { path: string; bytes: number; sha256: string }[] };
  if (manifest.export_id !== receipt.export_id) {
    out.push({ code: "export_id_mismatch", path: "manifest.json", message: "Manifest export ID differs from the local receipt." });
  }
  const declared = new Set<string>();
  for (const entry of manifest.files) {
    declared.add(entry.path);
    const file = files.get(entry.path);
    if (!file) {
      out.push({ code: "file_missing", path: entry.path, message: "File listed in the manifest is missing." });
      continue;
    }
    if (file.bytes.length !== entry.bytes) {
      out.push({ code: "file_size_mismatch", path: entry.path, message: `Expected ${entry.bytes} bytes, found ${file.bytes.length}.` });
    }
    if ((await sha256Hex(file.bytes)) !== entry.sha256) {
      out.push({ code: "file_digest_mismatch", path: entry.path, message: "File bytes do not match the manifest digest." });
    }
  }
  for (const path of files.keys()) {
    if (!declared.has(path)) out.push({ code: "unexpected_file", path, message: "File is not listed in the manifest." });
  }
  return out;
}
