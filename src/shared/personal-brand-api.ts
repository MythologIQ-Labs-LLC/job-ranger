import type {
  AnalyticsSnapshot, ManualPostPackage, ManualPublicationReceipt,
  PersonalBrandDraft,
} from "./personal-brand.js";
import type { LinkedInExportPreview } from "./linkedin-analytics.js";
import type { HistoricalLinkedInPostInput, HistoricalLinkedInPost } from "./linkedin-history.js";
import type { LinkedInTopicEvent, TopicLabelInput, TopicTarget } from "./linkedin-topics.js";
import type { SavedLinkedInExport, LinkedInImportResult } from "./linkedin-import-ledger.js";
import type { CareerOutcomeInput, CareerOutcomeRecord } from "./personal-brand-outcomes.js";

export type PersonalBrandDraftInput = Omit<PersonalBrandDraft, "id" | "revision">;

export type AnalyticsSnapshotInput = Pick<AnalyticsSnapshot,
  "capturedAt" | "windowStart" | "windowEnd" | "sourceLabel" | "observations">;

export interface PersonalBrandDesktopApi {
  personalBrand: {
    listDrafts(): Promise<PersonalBrandDraft[]>;
    createDraft(input: PersonalBrandDraftInput): Promise<PersonalBrandDraft>;
    updateDraft(id: string, expectedRevision: number, input: PersonalBrandDraftInput): Promise<PersonalBrandDraft>;
    prepareDraft(id: string, expectedRevision: number, humanReviewConfirmed: boolean): Promise<ManualPostPackage>;
    listPrepared(): Promise<ManualPostPackage[]>;
    confirmPublication(input: {
      draftId: string;
      revision: number;
      publishedUrl: string;
      publishedAt: string;
      userConfirmed: boolean;
    }): Promise<ManualPublicationReceipt>;
    listPublications(): Promise<ManualPublicationReceipt[]>;
    appendSnapshot(postId: string, input: AnalyticsSnapshotInput): Promise<AnalyticsSnapshot>;
    listSnapshots(postId: string): Promise<AnalyticsSnapshot[]>;
    listLinkedInImports(): Promise<SavedLinkedInExport[]>;
    saveLinkedInImport(preview: LinkedInExportPreview, userConfirmed: boolean): Promise<LinkedInImportResult>;
    deleteLinkedInImport(id: string, userConfirmed: boolean): Promise<void>;
    listHistoricalLinkedInPosts(): Promise<HistoricalLinkedInPost[]>;
    recordHistoricalLinkedInPost(input: HistoricalLinkedInPostInput, confirmed: boolean): Promise<HistoricalLinkedInPost>;
    deleteHistoricalLinkedInPost(id: string, confirmed: boolean): Promise<void>;
    listLinkedInTopicLabels(): Promise<LinkedInTopicEvent[]>;
    listLinkedInTopicHistory(target: TopicTarget): Promise<LinkedInTopicEvent[]>;
    attestLinkedInTopics(input: TopicLabelInput, expectedRevision: number, confirmed: boolean): Promise<LinkedInTopicEvent>;
    listCareerOutcomes(): Promise<CareerOutcomeRecord[]>;
    recordCareerOutcome(input: CareerOutcomeInput): Promise<CareerOutcomeRecord>;
    deleteCareerOutcome(id: string, userConfirmed: boolean): Promise<void>;
  };
}
