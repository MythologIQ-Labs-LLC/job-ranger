import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  Company,
  CompanyDraft,
  CompanyUpdate,
  Filter,
  FilterDraft,
  FilterUpdate,
  Job,
  ScrapeRun,
  Settings,
  SettingsUpdate,
  SystemStatus,
  Toast,
} from "../types";
import { getDesktopApi } from "../services/api";
import { createCompanyActions } from "./useCompanyActions";
import { createFilterActions } from "./useFilterActions";

interface AppState {
  companies: Company[];
  jobs: Job[];
  filters: Filter[];
  scrapeRuns: ScrapeRun[];
  settings: Settings | null;
  systemStatus: SystemStatus | null;
  toasts: Toast[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addCompany: (draft: CompanyDraft) => Promise<void>;
  updateCompany: (id: string, update: CompanyUpdate) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;
  runScraper: (companyId: string) => Promise<void>;
  addFilter: (draft: FilterDraft) => Promise<void>;
  updateFilter: (id: string, update: FilterUpdate) => Promise<void>;
  deleteFilter: (id: string) => Promise<void>;
  updateSettings: (update: SettingsUpdate) => Promise<void>;
  markJobAsSeen: (id: string) => Promise<void>;
  removeToast: (id: string) => void;
}

const AppContext = createContext<AppState | undefined>(undefined);
const autoDismissMs = 5000;

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [scrapeRuns, setScrapeRuns] = useState<ScrapeRun[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addToast = (toast: Omit<Toast, "id">) => {
    const nextToast: Toast = {
      ...toast,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
    setToasts((current) => [nextToast, ...current].slice(0, 5));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== nextToast.id));
    }, autoDismissMs);
  };

  const removeToast = (id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  };

  const refresh = async () => {
    const api = getDesktopApi();
    setRefreshing(true);
    setError(null);

    try {
      const [nextCompanies, nextJobs, nextFilters, nextSettings, nextRuns, nextSystemStatus] =
        await Promise.all([
          api.companies.list(),
          api.jobs.list(),
          api.filters.list(),
          api.settings.get(),
          api.scrapeRuns.listRecent(12),
          api.system.getStatus(),
        ]);

      startTransition(() => {
        setCompanies(nextCompanies);
        setJobs(nextJobs);
        setFilters(nextFilters);
        setSettings(nextSettings);
        setScrapeRuns(nextRuns);
        setSystemStatus(nextSystemStatus);
      });
    } catch (refreshError) {
      const message =
        refreshError instanceof Error ? refreshError.message : "Failed to load Job Ranger data.";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const companyActions = createCompanyActions(refresh, addToast, setError);
  const filterActions = createFilterActions(refresh, addToast, setError);

  const value = useMemo<AppState>(
    () => ({
      companies,
      jobs,
      filters,
      scrapeRuns,
      settings,
      systemStatus,
      toasts,
      loading,
      refreshing,
      error,
      refresh,
      ...companyActions,
      ...filterActions,
      updateSettings: async (update) => {
        setError(null);
        try {
          const nextSettings = await getDesktopApi().settings.update(update);
          setSettings(nextSettings);
          await refresh();
          addToast({
            title: "Settings saved",
            message: "Your settings were saved on this device.",
            type: "success",
          });
        } catch (actionError) {
          const message = actionError instanceof Error ? actionError.message : "Action failed.";
          setError(message);
          addToast({ title: "Action failed", message, type: "error" });
          throw actionError;
        }
      },
      markJobAsSeen: async (id) => {
        setError(null);
        try {
          await getDesktopApi().jobs.markSeen(id);
          await refresh();
          addToast({
            title: "Job updated",
            message: "The job is no longer marked as new.",
            type: "info",
          });
        } catch (actionError) {
          const message = actionError instanceof Error ? actionError.message : "Action failed.";
          setError(message);
          addToast({ title: "Action failed", message, type: "error" });
          throw actionError;
        }
      },
      removeToast,
    }),
    [companies, jobs, filters, scrapeRuns, settings, systemStatus, toasts, loading, refreshing, error],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
};
