import { createHashRouter, Outlet, RouterProvider } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import { ThemeProvider } from "./theme/ThemeProvider";
import { Dashboard } from "./pages/Dashboard";
import { Companies } from "./pages/Companies";
import { Jobs } from "./pages/Jobs";
import { Filters } from "./pages/Filters";
import { Settings } from "./pages/Settings";
import { Help } from "./pages/Help";
import { Applications } from "./pages/Applications";
import { SearchInsights } from "./pages/SearchInsights";
import { PersonalBrand } from "./pages/PersonalBrand";
import { CareerProfile } from "./pages/CareerProfile";
import { CareerStories } from "./pages/CareerStories";
import { EvidenceEntry } from "./pages/EvidenceEntry";
import { TargetTracks } from "./pages/TargetTracks";
import { Resume } from "./pages/Resume";
import { AgentWorkspace } from "./pages/AgentWorkspace";
import { Onboarding } from "./pages/Onboarding";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import { ToastContainer } from "./components/ToastContainer";
import { useAppContext } from "./context/AppContext";
import { useCareerProfile } from "./career/storage";
import { useOnboardingPreference } from "./career/onboarding";

function HomeRoute() {
  const { profile, save, configured, loading } = useCareerProfile();
  const { dismissed } = useOnboardingPreference();

  if (loading) {
    return (
      <Layout>
        <section className="panel panel-strong px-6 py-7 text-sm text-[var(--color-text-secondary)]">
          Loading your workspace...
        </section>
      </Layout>
    );
  }

  if (!configured && !dismissed) {
    return <Onboarding profile={profile} saveProfile={save} />;
  }

  return <Dashboard />;
}

function AppRoutes() {
  const { toasts, removeToast } = useAppContext();
  return (
    <ErrorBoundary>
      <Outlet />
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ErrorBoundary>
  );
}

function OnboardingRoute() {
  const { profile, save, loading } = useCareerProfile();

  if (loading) {
    return (
      <Layout>
        <section className="panel panel-strong px-6 py-7 text-sm text-[var(--color-text-secondary)]">
          Loading your setup...
        </section>
      </Layout>
    );
  }

  return <Onboarding profile={profile} saveProfile={save} />;
}

// The data hash-router preserves the existing #/ URLs used by the PWA
// and packaged desktop shell, while allowing one first-class navigation blocker
// for unacknowledged Career Ops edits. Keep the route inventory unchanged.
const router = createHashRouter([{
  element: <AppRoutes />,
  children: [
    { index: true, element: <HomeRoute /> },
    { path: "onboarding", element: <OnboardingRoute /> },
    { path: "career-evidence/new", element: <EvidenceEntry /> },
    { path: "career-stories", element: <CareerStories /> },
    { path: "jobs", element: <Jobs /> },
    { path: "applications", element: <Applications /> },
    { path: "search-insights", element: <SearchInsights /> },
    { path: "personal-brand", element: <PersonalBrand /> },
    { path: "career-profile", element: <CareerProfile /> },
    { path: "target-tracks", element: <TargetTracks /> },
    { path: "resume", element: <Resume /> },
    { path: "agent-workspace", element: <AgentWorkspace /> },
    { path: "companies", element: <Companies /> },
    { path: "filters", element: <Filters /> },
    { path: "settings", element: <Settings /> },
    { path: "help", element: <Help /> },
  ],
}]);

export function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <RouterProvider router={router} />
      </AppProvider>
    </ThemeProvider>
  );
}
