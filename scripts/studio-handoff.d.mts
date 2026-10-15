export type StudioBuildInfo = {
  product: string;
  version: string;
  buildId: string;
  commit: string;
  serviceWorkerSha256: string;
  assets?: { path: string; sha256: string }[];
};

export declare const STUDIO_HANDOFF_FILE: string;
export declare function createStudioHandoff(buildInfo: StudioBuildInfo): object;
export declare function assertStudioHandoff(handoff: unknown, buildInfo: StudioBuildInfo): object;
export declare function inspectStudioPwaBuild(
  directory: string,
  expectedBuildId?: string
): Promise<{ status: string; buildId: string; commit: string; version: string; verifiedAssets: number; buildInfoSha256: string }>;
export declare function inspectLiveStudioPwa(
  origin: string,
  expectedBuildId: string,
  expectedBuildInfoSha256: string,
  fetchImpl?: typeof fetch
): Promise<{ status: string; origin: string; buildId: string; verifiedAssets: number }>;
