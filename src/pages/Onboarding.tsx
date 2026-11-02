import { useEffect, useState } from "react";
import {
  ArrowRight,
  Compass,
  FileUp,
  PencilLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useCareerEvidence } from "../career/evidence";
import { useOnboardingPreference } from "../career/onboarding";
import type { CareerProfile, PayBasis } from "../career/storage";
import { getDesktopApi } from "../services/api";
import type { PreferenceStrength, WorkMode } from "../shared/contracts";

interface OnboardingProps {
  profile: CareerProfile;
  saveProfile: (profile: CareerProfile) => Promise<CareerProfile>;
}

type AuthoredStrength = Exclude<PreferenceStrength, "unspecified" | "target">;

const workModeOptions: Array<{ value: WorkMode; label: string }> = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "on-site", label: "On-site" },
];

function splitTargets(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function toggleValue<T extends string>(values: T[], value: T, checked: boolean): T[] {
  return checked
    ? Array.from(new Set([...values, value]))
    : values.filter((item) => item !== value);
}

export function Onboarding({ profile, saveProfile }: OnboardingProps) {
  const navigate = useNavigate();
  const evidence = useCareerEvidence();
  const { dismiss } = useOnboardingPreference();
  const [targetText, setTargetText] = useState(profile.targetTitles.join("\n"));
  const [homeLocation, setHomeLocation] = useState(profile.homeLocation);
  const [locationStrength, setLocationStrength] = useState<AuthoredStrength>("preferred");
  const [workModes, setWorkModes] = useState<WorkMode[]>([]);
  const [workModeStrength, setWorkModeStrength] = useState<AuthoredStrength>("preferred");
  const [minimumPay, setMinimumPay] = useState(
    profile.minimumPay === null ? "" : String(profile.minimumPay),
  );
  const [payBasis, setPayBasis] = useState<PayBasis>(profile.payBasis);
  const [payStrength, setPayStrength] = useState<AuthoredStrength>("preferred");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTargetText(profile.targetTitles.join("\n"));
    setHomeLocation(profile.homeLocation);
    setMinimumPay(profile.minimumPay === null ? "" : String(profile.minimumPay));
    setPayBasis(profile.payBasis);
  }, [profile]);

  const finish = (destination = "/") => {
    dismiss();
    navigate(destination);
  };

  const handleResumeFirst = async () => {
    setError(null);
    try {
      const result = await evidence.importFile();
      if (result) {
        finish("/career-profile");
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import resume");
    }
  };

  const handleGoalFirst = async () => {
    const targets = splitTargets(targetText);
    if (targets.length === 0) {
      setError("Add at least one kind of work you want to pursue.");
      return;
    }

    const normalizedHomeLocation = homeLocation.trim();
    if (locationStrength === "required" && !normalizedHomeLocation) {
      setError("Add a home area before making location a requirement.");
      return;
    }
    if (workModeStrength === "required" && workModes.length === 0) {
      setError("Choose at least one work mode before making work mode a requirement.");
      return;
    }

    const parsedMinimumPay = minimumPay.trim() ? Number(minimumPay) : null;
    if (parsedMinimumPay !== null && (!Number.isFinite(parsedMinimumPay) || parsedMinimumPay < 0)) {
      setError("Minimum pay must be a non-negative number.");
      return;
    }
    if (payStrength === "required" && parsedMinimumPay === null) {
      setError("Add a minimum pay before making compensation a requirement.");
      return;
    }

    const normalizedRadiusMiles = normalizedHomeLocation ? profile.radiusMiles : null;

    setSaving(true);
    setError(null);
    try {
      const savedProfile = await saveProfile({
        ...profile,
        homeLocation: normalizedHomeLocation,
        radiusMiles: normalizedRadiusMiles,
        minimumPay: parsedMinimumPay,
        payBasis,
        targetTitles: targets,
      });

      const trackInput = {
        name: "Primary search",
        relation: "target" as const,
        roleTitles: targets,
        seniority: null,
        direction: null,
        constraints: {
          geography: {
            locations: normalizedHomeLocation ? [normalizedHomeLocation] : [],
            radiusMiles: savedProfile.radiusMiles,
            strength:
              normalizedHomeLocation || savedProfile.radiusMiles !== null
                ? locationStrength
                : ("preferred" as const),
          },
          workModes: {
            values: workModes,
            strength: workModes.length > 0 ? workModeStrength : ("preferred" as const),
          },
          employmentArrangements: {
            values: [],
            strength: "preferred" as const,
          },
          compensation: {
            floor: parsedMinimumPay,
            target: null,
            basis: payBasis,
            floorStrength: parsedMinimumPay !== null ? payStrength : ("preferred" as const),
          },
          onCall: {
            value: "either" as const,
            strength: "preferred" as const,
          },
          industries: {
            values: [],
            strength: "preferred" as const,
          },
        },
        isActive: true,
      };

      const desktopApi = getDesktopApi();
      const tracks = await desktopApi.career.listTargetTracks();
      if (tracks.some((track) => track.id === "legacy-default")) {
        await desktopApi.career.updateTargetTrack("legacy-default", trackInput);
      } else {
        await desktopApi.career.createTargetTrack(trackInput);
      }
      finish();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save your starting goals");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <section className="panel panel-strong overflow-hidden px-6 py-7 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="alpha-pill">
              <Sparkles className="h-3.5 w-3.5" />
              First run
            </span>
            <h1 className="page-title mt-4">Start with what you already have.</h1>
            <p className="page-copy">
              You do not need a complete profile before Sojourner becomes useful. Start from a resume, enter your background yourself, or just tell Sojourner what kind of work you want. You can fill in the rest as the search develops.
            </p>
          </div>
          <button
            type="button"
            className="surface-link-button text-sm font-semibold text-[var(--color-text-secondary)]"
            onClick={() => finish()}
          >
            Skip setup for now
          </button>
        </div>
      </section>

      {(error || evidence.error) && (
        <section className="support-note mt-6 px-5 py-4 text-sm text-[var(--color-danger)]">
          {error ?? evidence.error}
        </section>
      )}

      <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <article className="story-card flex flex-col">
          <div className="flex items-center gap-3">
            <FileUp className="h-5 w-5 text-[var(--color-primary)]" />
            <p className="story-kicker">Resume first</p>
          </div>
          <h2 className="story-title mt-3">I already have a resume</h2>
          <p className="story-copy flex-1">
            Import the document you already use. Sojourner preserves the source, extracts career evidence locally, and asks you to review proposed facts before they become authoritative.
          </p>
          <button
            type="button"
            className="primary-button mt-5 w-fit"
            onClick={() => void handleResumeFirst()}
            disabled={evidence.busy}
          >
            <FileUp className="h-4 w-4" />
            {evidence.busy ? "Importing..." : "Import a resume"}
          </button>
        </article>

        <article className="story-card flex flex-col">
          <div className="flex items-center gap-3">
            <PencilLine className="h-5 w-5 text-[var(--color-primary)]" />
            <p className="story-kicker">Build it myself</p>
          </div>
          <h2 className="story-title mt-3">I do not have a resume handy</h2>
          <p className="story-copy flex-1">
            Start with the experience, skills, credentials, projects, and preferences that matter to you. Irrelevant sections can stay empty, because apparently forms are allowed to serve people rather than the reverse.
          </p>
          <button
            type="button"
            className="secondary-button mt-5 w-fit"
            onClick={() => navigate("/career-evidence/new")}
          >
            Enter my background
            <ArrowRight className="h-4 w-4" />
          </button>
        </article>

        <article className="story-card flex flex-col">
          <div className="flex items-center gap-3">
            <Compass className="h-5 w-5 text-[var(--color-primary)]" />
            <p className="story-kicker">Goals first</p>
          </div>
          <h2 className="story-title mt-3">I know what I want to look for</h2>
          <p className="story-copy">
            Give Sojourner enough direction to start. These are search goals and constraints, not claims about experience.
          </p>

          <div className="mt-5 space-y-4">
            <label>
              <span className="metric-label">Work I want to pursue</span>
              <textarea
                className="input-shell mt-2 min-h-24 resize-y py-3"
                value={targetText}
                onChange={(event) => setTargetText(event.target.value)}
                placeholder={"One role or direction per line\nAdjacent role\nStretch role"}
              />
            </label>

            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="metric-label">Home area</span>
                <select
                  className="select-shell w-auto min-w-28"
                  aria-label="Onboarding location importance"
                  value={locationStrength}
                  onChange={(event) => setLocationStrength(event.target.value as AuthoredStrength)}
                >
                  <option value="preferred">Preferred</option>
                  <option value="required">Required</option>
                </select>
              </div>
              <input
                className="input-shell mt-2"
                aria-label="Home area"
                value={homeLocation}
                onChange={(event) => setHomeLocation(event.target.value)}
                placeholder="Optional city, state, or region"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="metric-label">Work mode</span>
                <select
                  className="select-shell w-auto min-w-28"
                  aria-label="Onboarding work mode importance"
                  value={workModeStrength}
                  onChange={(event) => setWorkModeStrength(event.target.value as AuthoredStrength)}
                >
                  <option value="preferred">Preferred</option>
                  <option value="required">Required</option>
                </select>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {workModeOptions.map((option) => (
                  <label
                    key={option.value}
                    className="panel panel-muted flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={workModes.includes(option.value)}
                      onChange={(event) =>
                        setWorkModes((current) =>
                          toggleValue(current, option.value, event.target.checked),
                        )
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="metric-label">Minimum pay</span>
                <select
                  className="select-shell w-auto min-w-28"
                  aria-label="Onboarding pay importance"
                  value={payStrength}
                  onChange={(event) => setPayStrength(event.target.value as AuthoredStrength)}
                >
                  <option value="preferred">Preferred</option>
                  <option value="required">Required</option>
                </select>
              </div>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  className="input-shell"
                  aria-label="Onboarding minimum pay"
                  type="number"
                  min="0"
                  step={payBasis === "hourly" ? "0.50" : "1000"}
                  value={minimumPay}
                  onChange={(event) => setMinimumPay(event.target.value)}
                  placeholder={payBasis === "hourly" ? "Optional" : "Optional annual minimum"}
                />
                <select
                  className="select-shell w-auto min-w-28"
                  aria-label="Onboarding pay basis"
                  value={payBasis}
                  onChange={(event) => setPayBasis(event.target.value as PayBasis)}
                >
                  <option value="hourly">per hour</option>
                  <option value="annual">per year</option>
                </select>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="primary-button mt-5 w-fit"
            onClick={() => void handleGoalFirst()}
            disabled={saving}
          >
            <Compass className="h-4 w-4" />
            {saving ? "Saving..." : "Save goals and continue"}
          </button>
        </article>
      </section>

      <section className="support-note mt-6 flex items-start gap-3 px-5 py-4 text-sm text-[var(--color-text-secondary)]">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-success)]" />
        <p>
          Your actual career facts still live in Career Evidence, and imported statements remain proposals until you confirm them. First-run setup is guidance, not a second profile database.
        </p>
      </section>
    </Layout>
  );
}
