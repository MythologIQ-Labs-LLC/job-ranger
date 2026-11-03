/**
 * Build-time adapter substitution for the web runtime (used by vite.pwa.config.ts).
 *
 * `selectRuntimeAdapterTarget` decides which file an import maps to. The plugin
 * never returns that path as a module id itself: it asks the bundler's resolver
 * for the id (`this.resolve`), the same resolver that handles ordinary relative
 * imports of the adapters. Hand-built ids diverged from the resolver's on
 * Windows (backslashes), so the worker bundled `electron-worker.ts` twice and
 * IPC handlers registered into a copy that dispatch never read.
 */
import type { Plugin } from "vite";

export type RuntimeTarget = "page" | "worker";

export interface RuntimeAdapterEnvironment {
  root: string;
  pathApi: {
    join(...parts: string[]): string;
    resolve(...parts: string[]): string;
    dirname(p: string): string;
    basename(p: string): string;
  };
  exists(candidate: string): boolean;
  nodeBuiltinAdapters: Record<string, string>;
  sharedCoreAdapters: Record<string, string>;
}

export type AdapterSelection = string | null | { error: string };

function adapterPath(env: RuntimeAdapterEnvironment, file: string): string {
  return env.pathApi.join(env.root, "src", "pwa", "adapters", file);
}

function isSharedCoreImporter(importer: string | undefined): boolean {
  return importer?.replace(/\\/g, "/").includes("/electron/src/") ?? false;
}

function selectSharedCoreModule(source: string, importer: string, env: RuntimeAdapterEnvironment): AdapterSelection {
  const { pathApi } = env;
  const candidate = pathApi.resolve(pathApi.dirname(importer), source.replace(/\.cjs$/, ".cts"));
  if (!env.exists(candidate)) return null;
  const adapter = env.sharedCoreAdapters[pathApi.basename(candidate)];
  if (adapter && pathApi.dirname(candidate) === pathApi.join(env.root, "electron", "src")) {
    return adapterPath(env, adapter);
  }
  return candidate;
}

export function selectRuntimeAdapterTarget(
  source: string,
  importer: string | undefined,
  target: RuntimeTarget,
  env: RuntimeAdapterEnvironment,
): AdapterSelection {
  if (source === "electron") {
    return adapterPath(env, target === "worker" ? "electron-worker.ts" : "electron-page.ts");
  }
  const isNodeScheme = source.startsWith("node:");
  const builtinAdapter = env.nodeBuiltinAdapters[isNodeScheme ? source.slice(5) : source];
  if (builtinAdapter && (isNodeScheme || isSharedCoreImporter(importer))) {
    return adapterPath(env, builtinAdapter);
  }
  if (isNodeScheme) {
    return { error: `${source} has no web runtime adapter (imported by ${importer ?? "unknown"})` };
  }
  if (!importer || !source.startsWith(".") || !source.endsWith(".cjs")) return null;
  return selectSharedCoreModule(source, importer, env);
}

export function createRuntimeAdapterPlugin(target: RuntimeTarget, env: RuntimeAdapterEnvironment): Plugin {
  return {
    name: `sojourner-runtime-adapters:${target}`,
    enforce: "pre",
    async resolveId(source, importer) {
      const selection = selectRuntimeAdapterTarget(source, importer, target, env);
      if (selection === null) return null;
      if (typeof selection !== "string") this.error(selection.error);
      const resolved = await this.resolve(selection, importer, { skipSelf: true });
      if (!resolved) this.error(`${selection} (web runtime adapter for ${source}) could not be resolved`);
      return resolved;
    },
  };
}
