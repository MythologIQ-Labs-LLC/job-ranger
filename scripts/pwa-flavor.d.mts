export type PwaFlavor = "standard" | "demo";

export declare const PWA_FLAVORS: readonly PwaFlavor[];
export declare const PWA_FLAVOR_ENV: string;
export declare function parsePwaFlavor(value: string | null | undefined): PwaFlavor;
export declare function pwaBuildId(options: {
  version: string;
  commit: string;
  flavor: string | null | undefined;
  override?: string | null;
}): string;
export declare function buildIdMatchesFlavor(buildId: unknown, flavor: unknown): boolean;
export declare function pwaOutDirName(flavor: string | null | undefined): string;
export declare function pwaArchiveName(version: string, flavor: string | null | undefined): string;
export declare function pwaTrustFileName(flavor: string | null | undefined): string;
