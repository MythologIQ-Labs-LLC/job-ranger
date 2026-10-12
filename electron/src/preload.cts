import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../../src/shared/contracts.js";
import type { ApplicationInsightsDesktopApi } from "../../src/shared/application-insights.js";
import type { ApplicationLifecycleDesktopApi } from "../../src/shared/application-lifecycle.js";
import type { ApplicationMaterialsDesktopApi } from "../../src/shared/application-materials.js";
import type { BackupDesktopApi } from "../../src/shared/backup.js";
import type { CareerStoriesDesktopApi } from "../../src/shared/career-stories.js";
import type { PersonalBrandDesktopApi } from "../../src/shared/personal-brand-api.js";
import type { EvidenceExtensionDesktopApi } from "../../src/shared/evidence-extensions.js";
import type { InterviewPrepDesktopApi } from "../../src/shared/interview-prep.js";
import type { JsonResumeDesktopApi } from "../../src/shared/json-resume.js";
import type { ResumeDesktopApi } from "../../src/shared/resume-api.js";
import type { SourceDiscoveryDesktopApi } from "../../src/shared/source-discovery.js";
import type { RuntimeDesktopApi } from "../../src/shared/runtime.js";
import type { LegacyInstallDesktopApi } from "../../src/shared/legacy-install.js";

const desktopApi: DesktopApi & ResumeDesktopApi & EvidenceExtensionDesktopApi & SourceDiscoveryDesktopApi & ApplicationLifecycleDesktopApi & InterviewPrepDesktopApi & CareerStoriesDesktopApi & PersonalBrandDesktopApi & ApplicationMaterialsDesktopApi & BackupDesktopApi & ApplicationInsightsDesktopApi & JsonResumeDesktopApi & RuntimeDesktopApi & LegacyInstallDesktopApi = {
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  getPlatform: () => ipcRenderer.invoke("app:get-platform"),
  getRuntimeInfo: () => ipcRenderer.invoke("app:get-runtime-info"),
  openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url),
  showItemInFolder: (targetPath: string) =>
    ipcRenderer.invoke("app:show-item-in-folder", targetPath),
  system: {
    getStatus: () => ipcRenderer.invoke("system:get-status"),
  },
  companies: {
    list: () => ipcRenderer.invoke("companies:list"),
    create: (draft) => ipcRenderer.invoke("companies:create", draft),
    update: (id, update) => ipcRenderer.invoke("companies:update", id, update),
    delete: (id) => ipcRenderer.invoke("companies:delete", id),
    runScrape: (id) => ipcRenderer.invoke("companies:run-scrape", id),
  },
  discovery: {
    discover: (request) => ipcRenderer.invoke("discovery:discover", request),
  },
  jobs: {
    list: () => ipcRenderer.invoke("jobs:list"),
    markSeen: (id) => ipcRenderer.invoke("jobs:mark-seen", id),
    getEvidenceCoverage: (id) =>
      ipcRenderer.invoke("jobs:get-evidence-coverage", id),
  },
  filters: {
    list: () => ipcRenderer.invoke("filters:list"),
    create: (draft) => ipcRenderer.invoke("filters:create", draft),
    update: (id, update) => ipcRenderer.invoke("filters:update", id, update),
    delete: (id) => ipcRenderer.invoke("filters:delete", id),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (update) => ipcRenderer.invoke("settings:update", update),
  },
  scrapeRuns: {
    listRecent: (limit) => ipcRenderer.invoke("scrape-runs:list-recent", limit),
  },
  career: {
    getProfile: () => ipcRenderer.invoke("career:get-profile"),
    saveProfile: (profile) => ipcRenderer.invoke("career:save-profile", profile),
    listTargetTracks: () => ipcRenderer.invoke("career:list-target-tracks"),
    createTargetTrack: (input) =>
      ipcRenderer.invoke("career:create-target-track", input),
    updateTargetTrack: (id, input) =>
      ipcRenderer.invoke("career:update-target-track", id, input),
    deleteTargetTrack: (id) =>
      ipcRenderer.invoke("career:delete-target-track", id),
    migrateLegacy: (payload) => ipcRenderer.invoke("career:migrate-legacy", payload),
    selectResumeImport: () => ipcRenderer.invoke("career:select-resume-import"),
    importPastedText: (input) =>
      ipcRenderer.invoke("career:import-pasted-text", input),
    createUserEvidence: (input) =>
      ipcRenderer.invoke("career:create-user-evidence", input),
    listSourceArtifacts: () =>
      ipcRenderer.invoke("career:list-source-artifacts"),
    listEvidence: () => ipcRenderer.invoke("career:list-evidence"),
    reviewEvidence: (id, update) =>
      ipcRenderer.invoke("career:review-evidence", id, update),
    mergeEvidence: (sourceId, targetId) =>
      ipcRenderer.invoke("career:merge-evidence", sourceId, targetId),
  },
  careerEvidence: {
    listMetadata: () => ipcRenderer.invoke("career-evidence:list-metadata"),
    setReferences: (evidenceId, references) =>
      ipcRenderer.invoke("career-evidence:set-references", evidenceId, references),
    supersedeEvidence: (evidenceId, input) =>
      ipcRenderer.invoke("career-evidence:supersede", evidenceId, input),
  },
  careerStories: {
    list: () => ipcRenderer.invoke("career-stories:list"),
    create: (input) => ipcRenderer.invoke("career-stories:create", input),
    update: (storyId, input) =>
      ipcRenderer.invoke("career-stories:update", storyId, input),
    delete: (storyId) => ipcRenderer.invoke("career-stories:delete", storyId),
  },
  personalBrand: {
    listDrafts: () => ipcRenderer.invoke("personal-brand:list-drafts"),
    createDraft: (input) => ipcRenderer.invoke("personal-brand:create-draft", input),
    updateDraft: (id, revision, input) => ipcRenderer.invoke("personal-brand:update-draft", id, revision, input),
    prepareDraft: (id, revision, reviewed) => ipcRenderer.invoke("personal-brand:prepare-draft", id, revision, reviewed),
    listPrepared: () => ipcRenderer.invoke("personal-brand:list-prepared"),
    confirmPublication: (input) => ipcRenderer.invoke("personal-brand:confirm-publication", input),
    listPublications: () => ipcRenderer.invoke("personal-brand:list-publications"),
    appendSnapshot: (postId, input) => ipcRenderer.invoke("personal-brand:append-snapshot", postId, input),
    listSnapshots: (postId) => ipcRenderer.invoke("personal-brand:list-snapshots", postId),
    listLinkedInImports: () => ipcRenderer.invoke("personal-brand:list-linkedin-imports"),
    saveLinkedInImport: (preview, confirmed) => ipcRenderer.invoke("personal-brand:save-linkedin-import", preview, confirmed),
    deleteLinkedInImport: (id, confirmed) => ipcRenderer.invoke("personal-brand:delete-linkedin-import", id, confirmed),
    listHistoricalLinkedInPosts: () => ipcRenderer.invoke("personal-brand:list-historical-linkedin-posts"),
    recordHistoricalLinkedInPost: (input, confirmed) => ipcRenderer.invoke("personal-brand:record-historical-linkedin-post", input, confirmed),
    deleteHistoricalLinkedInPost: (id, confirmed) => ipcRenderer.invoke("personal-brand:delete-historical-linkedin-post", id, confirmed),
    listLinkedInTopicLabels: () => ipcRenderer.invoke("personal-brand:list-linkedin-topic-labels"),
    listLinkedInTopicHistory: (target) => ipcRenderer.invoke("personal-brand:list-linkedin-topic-history", target),
    attestLinkedInTopics: (input, expectedRevision, confirmed) => ipcRenderer.invoke("personal-brand:attest-linkedin-topics", input, expectedRevision, confirmed),
    listCareerOutcomes: () => ipcRenderer.invoke("personal-brand:list-career-outcomes"),
    recordCareerOutcome: (input) => ipcRenderer.invoke("personal-brand:record-career-outcome", input),
    deleteCareerOutcome: (id, confirmed) => ipcRenderer.invoke("personal-brand:delete-career-outcome", id, confirmed),
  },
  applications: {
    list: () => ipcRenderer.invoke("applications:list"),
    track: (jobId) => ipcRenderer.invoke("applications:track", jobId),
    update: (id, update) => ipcRenderer.invoke("applications:update", id, update),
    delete: (id) => ipcRenderer.invoke("applications:delete", id),
  },
  applicationLifecycle: {
    get: (applicationId) => ipcRenderer.invoke("application-lifecycle:get", applicationId),
    createContact: (applicationId, input) =>
      ipcRenderer.invoke("application-lifecycle:create-contact", applicationId, input),
    updateContact: (contactId, input) =>
      ipcRenderer.invoke("application-lifecycle:update-contact", contactId, input),
    deleteContact: (contactId) =>
      ipcRenderer.invoke("application-lifecycle:delete-contact", contactId),
    createEvent: (applicationId, input) =>
      ipcRenderer.invoke("application-lifecycle:create-event", applicationId, input),
    updateEvent: (eventId, update) =>
      ipcRenderer.invoke("application-lifecycle:update-event", eventId, update),
    deleteEvent: (eventId) =>
      ipcRenderer.invoke("application-lifecycle:delete-event", eventId),
  },
  applicationMaterials: {
    list: (applicationId) =>
      ipcRenderer.invoke("application-materials:list", applicationId),
    createCoverLetter: (applicationId) =>
      ipcRenderer.invoke("application-materials:create-cover-letter", applicationId),
    delete: (projectionId) =>
      ipcRenderer.invoke("application-materials:delete", projectionId),
  },
  applicationInsights: {
    get: (applicationId) => ipcRenderer.invoke("application-insights:get", applicationId),
    setTargetTrack: (applicationId, targetTrackId) =>
      ipcRenderer.invoke("application-insights:set-target-track", applicationId, targetTrackId),
    saveOffer: (applicationId, input) =>
      ipcRenderer.invoke("application-insights:save-offer", applicationId, input),
    deleteOffer: (applicationId) =>
      ipcRenderer.invoke("application-insights:delete-offer", applicationId),
    getSearchLearning: () => ipcRenderer.invoke("application-insights:search-learning"),
  },
  backups: {
    create: () => ipcRenderer.invoke("backups:create"),
    selectRestore: () => ipcRenderer.invoke("backups:select-restore"),
    stageRestore: (bundlePath) => ipcRenderer.invoke("backups:stage-restore", bundlePath),
  },
  legacyInstall: {
    detect: () => ipcRenderer.invoke("legacy-install:detect"),
    stageImport: () => ipcRenderer.invoke("legacy-install:stage-import"),
  },
  jsonResume: {
    importFile: () => ipcRenderer.invoke("json-resume:import"),
    exportFile: () => ipcRenderer.invoke("json-resume:export"),
  },
  interviewPrep: {
    get: (applicationId) => ipcRenderer.invoke("interview-prep:get", applicationId),
  },
  resume: {
    list: () => ipcRenderer.invoke("resume:list"),
    create: (input) => ipcRenderer.invoke("resume:create", input),
    get: (id) => ipcRenderer.invoke("resume:get", id),
    updateStatement: (id, update) =>
      ipcRenderer.invoke("resume:update-statement", id, update),
    previewTailoring: (request) =>
      ipcRenderer.invoke("resume:preview-tailoring", request),
    applyTailoring: (request) =>
      ipcRenderer.invoke("resume:apply-tailoring", request),
    exportPdf: (request) => ipcRenderer.invoke("resume:export-pdf", request),
    compareVersions: (fromArtifactId, toArtifactId) =>
      ipcRenderer.invoke("resume:compare-versions", fromArtifactId, toArtifactId),
  },
};

contextBridge.exposeInMainWorld("electronAPI", desktopApi);
