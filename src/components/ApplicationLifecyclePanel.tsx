import { useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileText,
  Mail,
  Phone,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { format } from "date-fns";
import { useApplicationLifecycle } from "../career/application-lifecycle";
import { ConfirmDialog } from "./ConfirmDialog";
import type {
  ApplicationContactInput,
  ApplicationEventInput,
  ApplicationEventKind,
} from "../shared/application-lifecycle";
import { getDesktopApi } from "../services/api";
import { useRuntimeInfo } from "../services/runtime";

interface ApplicationLifecyclePanelProps {
  applicationId: string;
}

const emptyContact: ApplicationContactInput = {
  name: "",
  role: null,
  email: null,
  phone: null,
  notes: "",
};

const emptyEvent: Omit<ApplicationEventInput, "eventAt"> & { eventAt: string } = {
  kind: "follow-up",
  title: "",
  eventAt: "",
  reminderAt: null,
  notes: "",
};

function toIso(localValue: string): string {
  return new Date(localValue).toISOString();
}

function eventKindLabel(kind: ApplicationEventKind): string {
  switch (kind) {
    case "follow-up":
      return "Follow-up";
    case "interview":
      return "Interview";
    case "deadline":
      return "Deadline";
    case "offer":
      return "Offer";
    case "other":
      return "Other";
  }
}

export function ApplicationLifecyclePanel({ applicationId }: ApplicationLifecyclePanelProps) {
  const revealLabel = useRuntimeInfo()?.capabilities.revealInFileManager === false ? "Download file" : "Show file";
  const [open, setOpen] = useState(false);
  const lifecycle = useApplicationLifecycle(applicationId, open);
  const [contactDraft, setContactDraft] = useState<ApplicationContactInput>(emptyContact);
  const [eventDraft, setEventDraft] = useState(emptyEvent);
  const [showContactForm, setShowContactForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [deleteContactId, setDeleteContactId] = useState<string | null>(null);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const selectedContact = lifecycle.lifecycle.contacts.find((contact) => contact.id === deleteContactId) ?? null;
  const selectedEvent = lifecycle.lifecycle.events.find((event) => event.id === deleteEventId) ?? null;

  const upcomingCount = useMemo(
    () => lifecycle.lifecycle.events.filter((event) => !event.completedAt).length,
    [lifecycle.lifecycle.events],
  );

  const saveContact = async () => {
    await lifecycle.createContact(contactDraft);
    setContactDraft(emptyContact);
    setShowContactForm(false);
  };

  const saveEvent = async () => {
    await lifecycle.createEvent({
      kind: eventDraft.kind,
      title: eventDraft.title,
      eventAt: toIso(eventDraft.eventAt),
      reminderAt: eventDraft.reminderAt ? toIso(eventDraft.reminderAt) : null,
      notes: eventDraft.notes,
    });
    setEventDraft(emptyEvent);
    setShowEventForm(false);
  };

  return (
    <div className="mt-5 border-t border-[var(--color-border)] pt-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <span className="font-semibold text-[var(--color-text-primary)]">Application details</span>
          <span className="ml-2 text-xs text-[var(--color-text-muted)]">
            {open ? "contacts, events, reminders, submitted files" : "people, follow-ups, submitted files"}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-5 space-y-5">
          {lifecycle.error && (
            <div className="support-note px-4 py-3 text-sm text-[var(--color-danger)]">
              {lifecycle.error}
            </div>
          )}

          {lifecycle.loading ? (
            <p className="text-sm text-[var(--color-text-secondary)]">Loading application details...</p>
          ) : (
            <>
              <section className="panel panel-muted rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold">
                      <FileText className="h-4 w-4" /> Submitted files
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Exact resume artifacts Job Ranger linked to this application.
                    </p>
                  </div>
                  <span className="soft-badge">{lifecycle.lifecycle.artifacts.length}</span>
                </div>

                <div className="mt-3 space-y-2">
                  {lifecycle.lifecycle.artifacts.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      No submitted resume is recorded yet. Export a targeted resume for this tracked job to preserve the exact version here.
                    </p>
                  ) : (
                    lifecycle.lifecycle.artifacts.map((artifact) => (
                      <div
                        key={artifact.linkId}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] px-3 py-3"
                      >
                        <div>
                          <div className="font-semibold text-sm">
                            {artifact.format.toUpperCase()} v{artifact.version} · {artifact.purpose}
                          </div>
                          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                            Recorded {format(new Date(artifact.recordedAt), "MMM d, yyyy h:mm a")}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void getDesktopApi().showItemInFolder(artifact.managedPath)}
                        >
                          {revealLabel}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="panel panel-muted rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold">
                      <UserRound className="h-4 w-4" /> People
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Recruiters, hiring managers, interviewers, or other contacts for this application.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowContactForm((current) => !current)}
                  >
                    <Plus className="h-4 w-4" /> Add person
                  </button>
                </div>

                {showContactForm && (
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label>
                      <span className="metric-label">Name</span>
                      <input
                        className="input-shell mt-2"
                        aria-label="Contact name"
                        value={contactDraft.name}
                        onChange={(event) =>
                          setContactDraft((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      <span className="metric-label">Role</span>
                      <input
                        className="input-shell mt-2"
                        aria-label="Contact role"
                        value={contactDraft.role ?? ""}
                        onChange={(event) =>
                          setContactDraft((current) => ({ ...current, role: event.target.value }))
                        }
                        placeholder="Recruiter, hiring manager..."
                      />
                    </label>
                    <label>
                      <span className="metric-label">Email</span>
                      <input
                        className="input-shell mt-2"
                        type="email"
                        aria-label="Contact email"
                        value={contactDraft.email ?? ""}
                        onChange={(event) =>
                          setContactDraft((current) => ({ ...current, email: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      <span className="metric-label">Phone</span>
                      <input
                        className="input-shell mt-2"
                        aria-label="Contact phone"
                        value={contactDraft.phone ?? ""}
                        onChange={(event) =>
                          setContactDraft((current) => ({ ...current, phone: event.target.value }))
                        }
                      />
                    </label>
                    <label className="sm:col-span-2">
                      <span className="metric-label">Notes</span>
                      <textarea
                        className="input-shell mt-2 min-h-20 py-3"
                        aria-label="Contact notes"
                        value={contactDraft.notes ?? ""}
                        onChange={(event) =>
                          setContactDraft((current) => ({ ...current, notes: event.target.value }))
                        }
                      />
                    </label>
                    <div className="sm:col-span-2 flex justify-end gap-2">
                      <button type="button" className="secondary-button" onClick={() => setShowContactForm(false)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={lifecycle.busy || !contactDraft.name.trim()}
                        onClick={() => void saveContact()}
                      >
                        Save person
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  {lifecycle.lifecycle.contacts.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-secondary)]">No contacts recorded yet.</p>
                  ) : (
                    lifecycle.lifecycle.contacts.map((contact) => (
                      <div key={contact.id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-border)] px-3 py-3">
                        <div>
                          <div className="font-semibold text-sm">
                            {contact.name}{contact.role ? ` · ${contact.role}` : ""}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
                            {contact.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{contact.email}</span>}
                            {contact.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{contact.phone}</span>}
                          </div>
                          {contact.notes && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{contact.notes}</p>}
                        </div>
                        <button
                          type="button"
                          className="surface-link-button p-2 text-[var(--color-text-muted)]"
                          aria-label={`Delete contact ${contact.name}`}
                          disabled={lifecycle.busy}
                          onClick={() => setDeleteContactId(contact.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="panel panel-muted rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold">
                      <CalendarClock className="h-4 w-4" /> Events & reminders
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Interviews, follow-ups, deadlines, and offer milestones stay attached to this application.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="soft-badge">{upcomingCount} open</span>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setShowEventForm((current) => !current)}
                    >
                      <Plus className="h-4 w-4" /> Add event
                    </button>
                  </div>
                </div>

                {showEventForm && (
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label>
                      <span className="metric-label">Type</span>
                      <select
                        className="select-shell mt-2"
                        aria-label="Event type"
                        value={eventDraft.kind}
                        onChange={(event) =>
                          setEventDraft((current) => ({ ...current, kind: event.target.value as ApplicationEventKind }))
                        }
                      >
                        <option value="follow-up">Follow-up</option>
                        <option value="interview">Interview</option>
                        <option value="deadline">Deadline</option>
                        <option value="offer">Offer</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label>
                      <span className="metric-label">Title</span>
                      <input
                        className="input-shell mt-2"
                        aria-label="Event title"
                        value={eventDraft.title}
                        onChange={(event) =>
                          setEventDraft((current) => ({ ...current, title: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      <span className="metric-label">When</span>
                      <input
                        className="input-shell mt-2"
                        type="datetime-local"
                        aria-label="Event time"
                        value={eventDraft.eventAt}
                        onChange={(event) =>
                          setEventDraft((current) => ({ ...current, eventAt: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      <span className="metric-label">Remind me</span>
                      <input
                        className="input-shell mt-2"
                        type="datetime-local"
                        aria-label="Reminder time"
                        value={eventDraft.reminderAt ?? ""}
                        onChange={(event) =>
                          setEventDraft((current) => ({ ...current, reminderAt: event.target.value || null }))
                        }
                      />
                    </label>
                    <label className="sm:col-span-2">
                      <span className="metric-label">Notes</span>
                      <textarea
                        className="input-shell mt-2 min-h-20 py-3"
                        aria-label="Event notes"
                        value={eventDraft.notes ?? ""}
                        onChange={(event) =>
                          setEventDraft((current) => ({ ...current, notes: event.target.value }))
                        }
                      />
                    </label>
                    <div className="sm:col-span-2 flex justify-end gap-2">
                      <button type="button" className="secondary-button" onClick={() => setShowEventForm(false)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={lifecycle.busy || !eventDraft.title.trim() || !eventDraft.eventAt}
                        onClick={() => void saveEvent()}
                      >
                        Save event
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  {lifecycle.lifecycle.events.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-secondary)]">No events recorded yet.</p>
                  ) : (
                    lifecycle.lifecycle.events.map((event) => {
                      const completed = Boolean(event.completedAt);
                      const reminderOverdue =
                        !completed && event.reminderAt && new Date(event.reminderAt).getTime() <= Date.now();
                      return (
                        <div key={event.id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-border)] px-3 py-3">
                          <div className={completed ? "opacity-60" : ""}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="soft-badge">{eventKindLabel(event.kind)}</span>
                              {reminderOverdue && <span className="soft-badge soft-badge-warning">Reminder due</span>}
                              <span className="font-semibold text-sm">{event.title}</span>
                            </div>
                            <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                              {format(new Date(event.eventAt), "MMM d, yyyy h:mm a")}
                              {event.reminderAt && ` · reminder ${format(new Date(event.reminderAt), "MMM d, h:mm a")}`}
                            </div>
                            {event.notes && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{event.notes}</p>}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="surface-link-button p-2"
                              aria-label={completed ? `Reopen ${event.title}` : `Complete ${event.title}`}
                              onClick={() =>
                                void lifecycle.updateEvent(event.id, {
                                  completedAt: completed ? null : new Date().toISOString(),
                                })
                              }
                            >
                              {completed ? <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" /> : <Circle className="h-4 w-4" />}
                            </button>
                            <button
                              type="button"
                              className="surface-link-button p-2 text-[var(--color-text-muted)]"
                              aria-label={`Delete event ${event.title}`}
                              disabled={lifecycle.busy}
                              onClick={() => setDeleteEventId(event.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(selectedContact)}
        onClose={() => setDeleteContactId(null)}
        onConfirm={async () => {
          if (!selectedContact) throw new Error("The selected person is no longer in this application.");
          await lifecycle.deleteContact(selectedContact.id);
          setDeleteContactId(null);
        }}
        title="Delete application contact?"
        message={`Remove "${selectedContact?.name ?? "this contact"}" from this application's people list? Their saved contact information and notes will be deleted. This cannot be undone.`}
        confirmLabel="Delete contact"
      />
      <ConfirmDialog
        open={Boolean(selectedEvent)}
        onClose={() => setDeleteEventId(null)}
        onConfirm={async () => {
          if (!selectedEvent) throw new Error("The selected event is no longer in this application.");
          await lifecycle.deleteEvent(selectedEvent.id);
          setDeleteEventId(null);
        }}
        title="Delete application event?"
        message={`Delete "${selectedEvent?.title ?? "this event"}" from this application? The event record and any associated reminder will be removed. This cannot be undone.`}
        confirmLabel="Delete event"
      />
    </div>
  );
}
