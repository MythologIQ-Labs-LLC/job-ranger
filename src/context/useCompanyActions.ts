import { getDesktopApi } from "../services/api";
import type { CompanyDraft, CompanyUpdate, Toast } from "../types";

export function createCompanyActions(
  refresh: () => Promise<void>,
  addToast: (toast: Omit<Toast, "id">) => void,
  setError: (error: string | null) => void,
) {
  const withFeedback = async (
    action: () => Promise<void>,
    successToast: Omit<Toast, "id">,
  ) => {
    setError(null);
    try {
      await action();
      addToast(successToast);
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Action failed.";
      setError(message);
      addToast({ title: "Action failed", message, type: "error" });
      throw actionError;
    }
  };

  return {
    addCompany: async (draft: CompanyDraft) => {
      await withFeedback(
        async () => {
          await getDesktopApi().companies.create(draft);
          await refresh();
        },
        {
          title: "Company saved",
          message: "Sojourner is now tracking the new source locally.",
          type: "success",
        },
      );
    },

    updateCompany: async (id: string, update: CompanyUpdate) => {
      await withFeedback(
        async () => {
          await getDesktopApi().companies.update(id, update);
          await refresh();
        },
        {
          title: "Company updated",
          message: "The source configuration was updated.",
          type: "success",
        },
      );
    },

    deleteCompany: async (id: string) => {
      await withFeedback(
        async () => {
          await getDesktopApi().companies.delete(id);
          await refresh();
        },
        {
          title: "Company removed",
          message: "Associated jobs and scrape history were removed.",
          type: "success",
        },
      );
    },

    runScraper: async (companyId: string) => {
      setError(null);
      try {
        const run = await getDesktopApi().companies.runScrape(companyId);
        await refresh();

        if (run.status === "success") {
          addToast({
            title: "Scrape finished",
            message: "Latest jobs and run history have been refreshed.",
            type: "success",
          });
          return;
        }

        if (run.status === "unsupported") {
          addToast({
            title: "Source unsupported",
            message: run.errorMessage ?? "This source needs a different extraction path.",
            type: "info",
          });
          return;
        }

        const failureMessage = run.errorMessage ?? "The scrape did not complete successfully.";
        setError(failureMessage);
        addToast({ title: "Scrape failed", message: failureMessage, type: "error" });
      } catch (actionError) {
        const message = actionError instanceof Error ? actionError.message : "Action failed.";
        setError(message);
        addToast({ title: "Action failed", message, type: "error" });
        throw actionError;
      }
    },
  };
}
