import { Link } from "react-router-dom";
import { CircleHelp, ShieldCheck } from "lucide-react";
import { Layout } from "../components/Layout";

const workflow = [
  {
    heading: "Describe your direction",
    description: "Start with the person behind the resume. Capture the work you want, your constraints and your target roles without forcing everything into one career path.",
    route: "/target-tracks",
    action: "Open Target Tracks",
  },
  {
    heading: "Build a factual career record",
    description: "Record employment, projects, volunteer work, skills and credentials. Imported material stays unconfirmed until you review it. Only confirmed or self-authored Career Evidence can support application claims.",
    route: "/career-evidence/new",
    action: "Open Career Evidence",
  },
  {
    heading: "Find promising opportunities",
    description: "Use saved employer sources and filters, then assess opportunities against the Target Track you select. Eligibility, evidence, preferences and unknowns are reported separately, not as a made-up hiring probability.",
    route: "/jobs",
    action: "Open Find Jobs",
  },
  {
    heading: "Prepare truthful materials",
    description: "Use confirmed evidence to make a resume for a specific role. The Truth Gate checks support for statements, and the Parseability Gate checks what survives PDF export.",
    route: "/resume",
    action: "Open Resume",
  },
  {
    heading: "Track what actually happened",
    description: "Record applications and next steps instead of guessing whether sending more resumes helped. Job Ranger does not submit applications on your behalf.",
    route: "/applications",
    action: "Open Applications",
  },
  {
    heading: "Learn from your professional presence",
    description: "Prepare a professional post, review its factual claims, copy it for manual publication, and record the real publication time and observed metrics. Missing metrics are not zeros and engagement is not proof of hiring impact.",
    route: "/personal-brand",
    action: "Open Personal Brand",
  },
] as const;

export function Help() {
  return (
    <Layout>
      <section className="panel panel-strong px-6 py-7 sm:px-8">
        <span className="alpha-pill">
          <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
          Help and getting started
        </span>
        <h1 className="page-title mt-4">Find a better path, one decision at a time.</h1>
        <p className="page-copy">
          Job Ranger is a local-first Career Ops workspace. You can start with your work history,
          career goals, or a job that interests you. You do not need a subscription to an AI model,
          a connected social account, or a finished resume to begin.
        </p>
      </section>

      <section className="mt-8" aria-labelledby="help-workflow">
        <h2 id="help-workflow" className="text-2xl font-semibold text-[var(--color-text-primary)]">
          Your workflow
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          These are suggested steps, not required checkpoints. Return to any step as your goals change.
        </p>
        <ol className="mt-5 grid gap-4 md:grid-cols-2">
          {workflow.map((step, index) => (
            <li key={step.route} className="panel px-5 py-5">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">
                Step {index + 1}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
                {step.heading}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                {step.description}
              </p>
              <Link className="mt-4 inline-flex text-sm font-semibold text-[var(--color-primary)] underline underline-offset-4 focus-visible:outline focus-visible:outline-2" to={step.route}>
                {step.action}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel mt-8 px-6 py-6 sm:px-8" aria-labelledby="help-data">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-[var(--color-primary)]" aria-hidden="true" />
          <h2 id="help-data" className="text-xl font-semibold text-[var(--color-text-primary)]">
            Keep control of your work and data
          </h2>
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">
          Your workspace is stored locally. The desktop and browser versions use separate local storage.
          In the web app, your saved information belongs to this browser profile and the exact address
          where you opened Job Ranger. Clearing browser site data can erase the workspace.
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">
          Export a portable backup before moving devices, changing installations, or clearing browser
          data. Restore through Settings and review its validation results. Help is bundled with this
          app, so these instructions do not depend on an internet connection.
        </p>
        <Link className="mt-4 inline-flex text-sm font-semibold text-[var(--color-primary)] underline underline-offset-4 focus-visible:outline focus-visible:outline-2" to="/settings">
          Open Settings and backup tools
        </Link>
      </section>

      <section className="support-note mt-6 px-6 py-5" aria-labelledby="help-boundaries">
        <h2 id="help-boundaries" className="font-semibold text-[var(--color-text-primary)]">
          What Job Ranger will not decide for you
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          An imported resume is not automatically verified evidence. A matching job is not a promise
          of eligibility or an interview. A prepared post is not a published post. Your approval is
          required for factual claims and external actions, and the deterministic application works
          without inference or a ChatGPT connection.
        </p>
      </section>
    </Layout>
  );
}
