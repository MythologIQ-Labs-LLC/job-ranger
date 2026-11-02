import type { Company } from "../../src/shared/contracts.js";
import type { RuntimeKind } from "../../src/shared/runtime.js";
import type {
  SourceDiscoveryProviderId,
  SourceDiscoveryRequest,
  SourceDiscoveryResult,
} from "../../src/shared/source-discovery.js";
import { discoverPublicJobFeeds } from "./source-discovery.cjs";

export interface SourceDiscoveryProviderContext {
  fetchImpl: typeof fetch;
  existingCompanies: Company[];
  runtimeKind?: RuntimeKind;
  now?: () => string;
}

export interface SourceDiscoveryProvider {
  readonly id: SourceDiscoveryProviderId;
  readonly name: string;
  discover(
    request: SourceDiscoveryRequest,
    context: SourceDiscoveryProviderContext,
  ): Promise<SourceDiscoveryResult>;
}

export const publicJobFeedDiscoveryProvider: SourceDiscoveryProvider = {
  id: "public-job-feeds",
  name: "Public job feeds",
  discover: discoverPublicJobFeeds,
};
