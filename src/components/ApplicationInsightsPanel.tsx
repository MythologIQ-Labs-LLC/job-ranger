import { useEffect, useState } from "react";
import { BadgeDollarSign, ChevronDown, Trash2 } from "lucide-react";
import { useApplicationInsights } from "../career/application-insights";
import { useTargetTracks } from "../career/target-tracks";
import type { ApplicationOfferInput } from "../shared/application-insights";
import { ConfirmDialog } from "./ConfirmDialog";

const emptyOffer: ApplicationOfferInput = {
  status: "active",
  basePay: null,
  payBasis: "annual",
  currency: "USD",
  bonusNotes: "",
  equityNotes: "",
  benefitsNotes: "",
  startDate: null,
  responseDeadline: null,
  negotiationNotes: "",
};

export function ApplicationInsightsPanel({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  const insights = useApplicationInsights(applicationId, open);
  const { tracks } = useTargetTracks();
  const [offerDraft, setOfferDraft] = useState<ApplicationOfferInput>(emptyOffer);
  const [showOffer, setShowOffer] = useState(false);
  const [confirmRemoveOffer, setConfirmRemoveOffer] = useState(false);

  useEffect(() => {
    if (!insights.detail?.offer) return;
    const offer = insights.detail.offer;
    setOfferDraft({
      status: offer.status,
      basePay: offer.basePay,
      payBasis: offer.payBasis,
      currency: offer.currency,
      bonusNotes: offer.bonusNotes,
      equityNotes: offer.equityNotes,
      benefitsNotes: offer.benefitsNotes,
      startDate: offer.startDate,
      responseDeadline: offer.responseDeadline,
      negotiationNotes: offer.negotiationNotes,
    });
    setShowOffer(true);
  }, [insights.detail?.offer]);

  const saveOffer = async () => {
    await insights.saveOffer(offerDraft);
    setShowOffer(true);
  };

  const removeOffer = async () => {
    await insights.deleteOffer();
    setOfferDraft(emptyOffer);
    setShowOffer(false);
  };

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <span className="font-semibold text-[var(--color-text-primary)]">Search context & offer</span>
          <span className="ml-2 text-xs text-[var(--color-text-muted)]">target track, terms, negotiation</span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {insights.error && (
            <div className="support-note px-4 py-3 text-sm text-[var(--color-danger)]">{insights.error}</div>
          )}

          <section className="panel panel-muted rounded-2xl p-4">
            <label className="block">
              <span className="metric-label">Target track</span>
              <select
                className="select-shell mt-2 w-full"
                aria-label="Application target track"
                value={insights.detail?.searchContext.targetTrackId ?? ""}
                disabled={insights.loading || insights.busy}
                onChange={(event) => void insights.setTargetTrack(event.target.value || null)}
              >
                <option value="">Unassigned</option>
                {tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
              </select>
            </label>
            <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
              Assigned explicitly for search analysis. Job Ranger does not infer this from the job title.
            </p>
          </section>

          <section className="panel panel-muted rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-semibold"><BadgeDollarSign className="h-4 w-4" /> Offer details</div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Optional terms and private negotiation notes.</p>
              </div>
              {!showOffer && (
                <button type="button" className="secondary-button" onClick={() => setShowOffer(true)}>Add offer details</button>
              )}
            </div>

            {showOffer && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label>
                  <span className="metric-label">Status</span>
                  <select
                    className="select-shell mt-2 w-full"
                    value={offerDraft.status}
                    onChange={(event) => setOfferDraft((current) => ({ ...current, status: event.target.value as ApplicationOfferInput["status"] }))}
                  >
                    <option value="active">Active</option><option value="accepted">Accepted</option>
                    <option value="declined">Declined</option><option value="withdrawn">Withdrawn</option>
                    <option value="expired">Expired</option>
                  </select>
                </label>
                <label>
                  <span className="metric-label">Base pay</span>
                  <input className="input-shell mt-2" type="number" min="0" step="0.01" value={offerDraft.basePay ?? ""}
                    onChange={(event) => setOfferDraft((current) => ({ ...current, basePay: event.target.value ? Number(event.target.value) : null }))} />
                </label>
                <label>
                  <span className="metric-label">Pay basis</span>
                  <select className="select-shell mt-2 w-full" value={offerDraft.payBasis}
                    onChange={(event) => setOfferDraft((current) => ({ ...current, payBasis: event.target.value as ApplicationOfferInput["payBasis"] }))}>
                    <option value="annual">Annual</option><option value="hourly">Hourly</option><option value="other">Other</option>
                  </select>
                </label>
                <label>
                  <span className="metric-label">Currency</span>
                  <input className="input-shell mt-2 uppercase" maxLength={3} value={offerDraft.currency ?? "USD"}
                    onChange={(event) => setOfferDraft((current) => ({ ...current, currency: event.target.value }))} />
                </label>
                <label><span className="metric-label">Start date</span><input className="input-shell mt-2" type="date" value={offerDraft.startDate ?? ""}
                  onChange={(event) => setOfferDraft((current) => ({ ...current, startDate: event.target.value || null }))} /></label>
                <label><span className="metric-label">Response deadline</span><input className="input-shell mt-2" type="date" value={offerDraft.responseDeadline ?? ""}
                  onChange={(event) => setOfferDraft((current) => ({ ...current, responseDeadline: event.target.value || null }))} /></label>
                {(["bonusNotes", "benefitsNotes", "negotiationNotes"] as const).map((field) => (
                  <label key={field} className="sm:col-span-2">
                    <span className="metric-label">{field === "bonusNotes" ? "Bonus / variable compensation" : field === "benefitsNotes" ? "Benefits / other terms" : "Negotiation notes"}</span>
                    <textarea className="input-shell mt-2 min-h-20 py-3" value={offerDraft[field] ?? ""}
                      onChange={(event) => setOfferDraft((current) => ({ ...current, [field]: event.target.value }))} />
                  </label>
                ))}
                <label className="sm:col-span-2">
                  <span className="metric-label">Equity</span>
                  <textarea className="input-shell mt-2 min-h-16 py-3" value={offerDraft.equityNotes ?? ""}
                    onChange={(event) => setOfferDraft((current) => ({ ...current, equityNotes: event.target.value }))} />
                </label>
                <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
                  {insights.detail?.offer && (
                    <button type="button" className="secondary-button" disabled={insights.busy} onClick={() => setConfirmRemoveOffer(true)}>
                      <Trash2 className="h-4 w-4" /> Remove offer details
                    </button>
                  )}
                  <button type="button" className="primary-button" disabled={insights.busy} onClick={() => void saveOffer()}>Save offer details</button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      <ConfirmDialog
        open={confirmRemoveOffer && Boolean(insights.detail?.offer)}
        onClose={() => setConfirmRemoveOffer(false)}
        onConfirm={async () => {
          if (!insights.detail?.offer) throw new Error("Offer details are no longer available.");
          await removeOffer();
          setConfirmRemoveOffer(false);
        }}
        title="Remove offer details?"
        message="Permanently delete this application's saved offer terms, compensation, benefits, deadlines, and private negotiation notes? The rest of the application remains. This cannot be undone."
        confirmLabel="Remove offer details"
      />
    </div>
  );
}
