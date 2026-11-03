import path from "node:path";

export function assertManagedArtifactPath(
  rawTargetPath: unknown,
  artifactsDirectory: string,
): string {
  if (typeof rawTargetPath !== "string" || !rawTargetPath.trim()) {
    throw new Error("Managed artifact path must be a non-empty string.");
  }

  const root = path.resolve(artifactsDirectory);
  const target = path.resolve(rawTargetPath);
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Only Sojourner managed artifacts can be revealed.");
  }

  return target;
}
