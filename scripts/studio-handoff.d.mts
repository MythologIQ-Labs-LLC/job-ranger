export type StudioBuildInfo = {
  product: string;
  version: string;
  buildId: string;
  /** Absent only in builds made before flavors existed (treated as standard; see effectiveBuildFlavor). */
  flavor?: "standard" | "demo";
  commit: string;
  serviceWorkerSha256: string;
  assets?: { path: string; sha256: string }[];
};

export declare const STUDIO_HANDOFF_FILE: string;
export declare const DEMO_IDLE_RESET_HOURS: number;
export declare function effectiveBuildFlavor(buildInfo: StudioBuildInfo): "standard" | "demo";
export declare function createStudioHandoff(buildInfo: StudioBuildInfo): object;
export declare function assertStudioHandoff(handoff: unknown, buildInfo: StudioBuildInfo): object;
export declare function inspectStudioPwaBuild(
  directory: string,
  expectedBuildId: string | undefined,
  expectedFlavor: "standard" | "demo"
): Promise<{ status: string; buildId: string; flavor: "standard" | "demo"; commit: string; version: string; verifiedAssets: number; buildInfoSha256: string }>;
export declare function inspectLiveStudioPwa(
  origin: string,
  expectedBuildId: string,
  expectedBuildInfoSha256: string,
  expectedFlavor: "standard" | "demo",
  fetchImpl?: typeof fetch
): Promise<{ status: string; origin: string; buildId: string; flavor: "standard" | "demo"; verifiedAssets: number }>;
