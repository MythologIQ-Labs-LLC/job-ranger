import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BarChart3,
  Bell,
  BookOpenText,
  Briefcase,
  Building2,
  Compass,
  CircleHelp,
  FileText,
  LayoutDashboard,
  Library,
  Megaphone,
  Menu,
  X,
  Settings,
  UserRound,
} from "lucide-react";

const navigation = [
  { name: "Home", href: "/", icon: LayoutDashboard },
  { name: "Find Jobs", href: "/jobs", icon: Briefcase },
  { name: "Applications", href: "/applications", icon: FileText },
  { name: "Search Insights", href: "/search-insights", icon: BarChart3 },
  { name: "Personal Brand", href: "/personal-brand", icon: Megaphone },
  { name: "Career Profile", href: "/career-profile", icon: UserRound },
  { name: "Career Evidence", href: "/career-evidence/new", icon: Library },
  { name: "Career Stories", href: "/career-stories", icon: BookOpenText },
  { name: "Target Tracks", href: "/target-tracks", icon: Compass },
  { name: "Resume", href: "/resume", icon: FileText },
  { name: "Companies", href: "/companies", icon: Building2 },
  { name: "Filters", href: "/filters", icon: Bell },
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Help", href: "/help", icon: CircleHelp },
];

export function Sidebar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <aside className="app-sidebar flex h-screen flex-col">
      <div className="border-b border-white/10 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center gap-3">
          <div className="brand-mark flex h-10 w-10 items-center justify-center rounded-2xl">
            <Briefcase className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold !text-white">Job Ranger</h1>
          <button type="button"
            className="ml-auto rounded-lg border border-white/20 px-3 py-2 text-white md:hidden"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            aria-controls="job-ranger-primary-nav"
            onClick={() => setMobileOpen(open => !open)}>
            {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> :
              <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <nav id="job-ranger-primary-nav" className={`app-sidebar-nav flex-1 space-y-1 overflow-y-auto px-4 py-5 ${mobileOpen ? "block" : "hidden"} md:block`} aria-label="Primary navigation">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              onClick={() => setMobileOpen(false)}
              aria-current={isActive ? "page" : undefined}
              className={`sidebar-link group flex items-center rounded-2xl px-3 py-3 text-sm font-semibold !text-white/80 hover:!text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                isActive ? "sidebar-link-active !text-white" : ""
              }`}
            >
              <item.icon
                className={`sidebar-link-icon mr-3 h-5 w-5 flex-shrink-0 ${
                  isActive ? "!text-white" : "!text-white/60 group-hover:!text-white"
                }`}
                aria-hidden="true"
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="app-sidebar-footer border-t border-white/10 px-6 py-5 text-sm !text-white/70">
        <p className="font-semibold !text-white/90">Your search, without the spreadsheet circus</p>
        <p className="mt-2 leading-6 !text-white/70">
          Build Career Evidence, turn it into reusable stories and truthful resumes, find promising jobs, then track what happens in Applications.
        </p>
      </div>
    </aside>
  );
}
