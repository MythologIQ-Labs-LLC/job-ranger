// Provider registry and runtime capability reporting. The production registry
// is empty: no provider is authorized, so every runtime reports inference as
// unavailable. Test-only providers are registered from test code only.

import type {
  InferenceCapabilityReport,
  InferenceLocation,
  InferenceProviderAdapter,
} from "./contract.cjs";

export interface InferenceRegistryEntry {
  adapter: InferenceProviderAdapter;
  /** Assigned by Sojourner; the descriptor's declaredLocation is never used for policy. */
  location: InferenceLocation;
  modelId: string;
  timeoutMs: number;
}

export interface InferenceRegistry {
  register(entry: InferenceRegistryEntry): void;
  get(providerId: string): InferenceRegistryEntry | undefined;
  list(): InferenceRegistryEntry[];
}

export function createInferenceRegistry(): InferenceRegistry {
  const entries = new Map<string, InferenceRegistryEntry>();
  return {
    register(entry) {
      const { providerId } = entry.adapter.descriptor;
      if (entries.has(providerId)) throw new Error("Inference provider is already registered.");
      if (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs < 1 || entry.timeoutMs > 600_000) {
        throw new Error("Inference provider timeout must be between 1 ms and 10 minutes.");
      }
      entries.set(providerId, { ...entry });
    },
    get: (providerId) => entries.get(providerId),
    list: () => Array.from(entries.values()),
  };
}

/** The registry production runtimes use. Contract Draft 0.2 authorizes no provider. */
export function createProductionInferenceRegistry(): InferenceRegistry {
  return createInferenceRegistry();
}

export type InferenceRuntime = "electron" | "pwa";

export function reportInferenceCapability(
  registry: InferenceRegistry,
  runtime: InferenceRuntime,
): InferenceCapabilityReport {
  const entries = registry.list();
  if (entries.length === 0) return { available: false, reason: "not-configured" };
  const usable = entries.find((entry) => entry.location === "in-process");
  // Slice A has no consent mechanism, so loopback and remote providers cannot run.
  if (!usable) return { available: false, reason: "consent-required" };
  if (runtime !== "electron" && runtime !== "pwa") return { available: false, reason: "runtime-unsupported" };
  return {
    available: true,
    providerId: usable.adapter.descriptor.providerId,
    location: usable.location,
    tasks: usable.adapter.descriptor.supportedTasks.map((item) => item.task),
  };
}
