import { useEffect, useState } from "react";
import type { RuntimeInfo } from "../shared/runtime";
import { getDesktopApi, hasDesktopApi } from "./api";

let cached: Promise<RuntimeInfo> | null = null;

/** Runtime identity is stable for a session; storage figures are refreshed by callers. */
export function loadRuntimeInfo(): Promise<RuntimeInfo> {
  if (!cached) {
    cached = getDesktopApi()
      .getRuntimeInfo()
      .catch((error: unknown) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}

export interface RuntimeInfoStatus {
  info: RuntimeInfo | null;
  /** Reading the runtime failed (or no runtime exists), so callers must not wait for it. */
  failed: boolean;
}

export function useRuntimeInfoStatus(): RuntimeInfoStatus {
  const [status, setStatus] = useState<RuntimeInfoStatus>({ info: null, failed: false });
  useEffect(() => {
    if (!hasDesktopApi()) {
      setStatus({ info: null, failed: true });
      return;
    }
    let active = true;
    void loadRuntimeInfo()
      .then((value) => {
        if (active) setStatus({ info: value, failed: false });
      })
      .catch(() => {
        if (active) setStatus({ info: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, []);
  return status;
}

export function useRuntimeInfo(): RuntimeInfo | null {
  return useRuntimeInfoStatus().info;
}
