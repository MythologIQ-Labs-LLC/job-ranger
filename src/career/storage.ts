import { useCallback, useEffect, useState } from "react";
import type { Job } from "../types";
import type {
  ApplicationStatus,
  ApplicationUpdate,
  CareerProfile,
  LegacyCareerMigration,
  OnCallPreference,
  PayBasis,
  TrackedApplication,
} from "../shared/contracts";
import { getDesktopApi } from "../services/api";

export type {
  ApplicationStatus,
  CareerProfile,
  OnCallPreference,
  PayBasis,
  TrackedApplication,
};

type StoredCareerProfile = Omit<Partial<CareerProfile>, "version"> & {
  minimumHourlyPay?: number | null;
  version?: number;
};

const profileKey = "sojourner.career-profile.v1";
const applicationsKey = "sojourner.applications.v1";
const profileEvent = "sojourner:career-profile-changed";
const applicationsEvent = "sojourner:applications-changed";

export const emptyCareerProfile: CareerProfile = {
  version: 2,
  fullName: "",
  homeLocation: "",
  radiusMiles: null,
  minimumPay: null,
  payBasis: "hourly",
  targetTitles: [],
  skills: [],
  certifications: [],
  sectors: [],
  onCallPreference: "either",
  fullTimeOnly: true,
  updatedAt: null,
};

function cleanList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function normalizeCareerProfile(profile: CareerProfile): CareerProfile {
  const normalizedMinimumPay =
    profile.minimumPay === null || Number.isNaN(profile.minimumPay)
      ? null
      : profile.payBasis === "annual"
        ? Math.max(0, Math.round(profile.minimumPay))
        : Math.max(0, Math.round(profile.minimumPay * 100) / 100);

  return {
    ...profile,
    version: 2,
    fullName: profile.fullName.trim(),
    homeLocation: profile.homeLocation.trim(),
    radiusMiles:
      profile.radiusMiles === null || Number.isNaN(profile.radiusMiles)
        ? null
        : Math.max(0, Math.round(profile.radiusMiles)),
    minimumPay: normalizedMinimumPay,
    payBasis: profile.payBasis === "annual" ? "annual" : "hourly",
    targetTitles: cleanList(profile.targetTitles),
    skills: cleanList(profile.skills),
    certifications: cleanList(profile.certifications),
    sectors: cleanList(profile.sectors),
    updatedAt: profile.updatedAt,
  };
}

function readLegacyJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readLegacyProfile(): CareerProfile | null {
  if (!window.localStorage.getItem(profileKey)) {
    return null;
  }

  const stored = readLegacyJson<StoredCareerProfile>(profileKey, {});
  const { minimumHourlyPay: legacyMinimumHourlyPay, ...current } = stored;
  const minimumPay =
    typeof current.minimumPay === "number"
      ? current.minimumPay
      : typeof legacyMinimumHourlyPay === "number"
        ? legacyMinimumHourlyPay
        : null;

  return normalizeCareerProfile({
    ...emptyCareerProfile,
    ...current,
    version: 2,
    minimumPay,
    payBasis: current.payBasis === "annual" ? "annual" : "hourly",
    targetTitles: Array.isArray(current.targetTitles) ? current.targetTitles : [],
    skills: Array.isArray(current.skills) ? current.skills : [],
    certifications: Array.isArray(current.certifications) ? current.certifications : [],
    sectors: Array.isArray(current.sectors) ? current.sectors : [],
  });
}

function readLegacyApplications(): TrackedApplication[] {
  if (!window.localStorage.getItem(applicationsKey)) {
    return [];
  }
  const stored = readLegacyJson<TrackedApplication[]>(applicationsKey, []);
  return Array.isArray(stored) ? stored : [];
}

let legacyMigrationPromise: Promise<void> | null = null;

async function ensureLegacyMigration(): Promise<void> {
  if (legacyMigrationPromise) {
    return legacyMigrationPromise;
  }

  legacyMigrationPromise = (async () => {
    const hasProfile = window.localStorage.getItem(profileKey) !== null;
    const hasApplications = window.localStorage.getItem(applicationsKey) !== null;
    if (!hasProfile && !hasApplications) {
      return;
    }

    const payload: LegacyCareerMigration = {
      profile: readLegacyProfile(),
      applications: readLegacyApplications(),
    };

    await getDesktopApi().career.migrateLegacy(payload);

    if (hasProfile) {
      window.localStorage.removeItem(profileKey);
    }
    if (hasApplications) {
      window.localStorage.removeItem(applicationsKey);
    }
  })().catch((error) => {
    legacyMigrationPromise = null;
    throw error;
  });

  return legacyMigrationPromise;
}

export function hasCareerProfile(profile: CareerProfile): boolean {
  return Boolean(
    profile.homeLocation || profile.targetTitles.length > 0 || profile.skills.length > 0,
  );
}

export function useCareerProfile() {
  const [profile, setProfile] = useState<CareerProfile>(emptyCareerProfile);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      await ensureLegacyMigration();
      const stored = await getDesktopApi().career.getProfile();
      setProfile(stored ?? emptyCareerProfile);
      setError(null);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Unable to load Career Profile",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener(profileEvent, handleChange);
    return () => window.removeEventListener(profileEvent, handleChange);
  }, [refresh]);

  const save = useCallback(async (next: CareerProfile) => {
    const saved = await getDesktopApi().career.saveProfile(next);
    setProfile(saved);
    setError(null);
    window.dispatchEvent(new CustomEvent(profileEvent));
    return saved;
  }, []);

  return {
    profile,
    save,
    configured: hasCareerProfile(profile),
    loading,
    error,
  };
}

export async function trackJob(
  job: Pick<Job, "id">,
  _legacyCompanyName?: string,
): Promise<TrackedApplication> {
  await ensureLegacyMigration();
  const application = await getDesktopApi().applications.track(job.id);
  window.dispatchEvent(new CustomEvent(applicationsEvent));
  return application;
}

export function useApplications() {
  const [applications, setApplications] = useState<TrackedApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      await ensureLegacyMigration();
      const stored = await getDesktopApi().applications.list();
      setApplications(stored);
      setError(null);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Unable to load applications",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener(applicationsEvent, handleChange);
    return () => window.removeEventListener(applicationsEvent, handleChange);
  }, [refresh]);

  const update = useCallback(async (id: string, patch: ApplicationUpdate) => {
    const updated = await getDesktopApi().applications.update(id, patch);
    setApplications((current) =>
      current.map((application) =>
        application.id === updated.id ? updated : application,
      ),
    );
    setError(null);
    window.dispatchEvent(new CustomEvent(applicationsEvent));
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await getDesktopApi().applications.delete(id);
    setApplications((current) =>
      current.filter((application) => application.id !== id),
    );
    setError(null);
    window.dispatchEvent(new CustomEvent(applicationsEvent));
  }, []);

  return { applications, update, remove, loading, error };
}
