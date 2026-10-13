import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BarChart3,
  BookOpenText,
  Briefcase,
  Building2,
  ChevronRight,
  CircleHelp,
  Compass,
  FileText,
  LayoutDashboard,
  Library,
  Megaphone,
  Menu,
  Settings,
  SlidersHorizontal,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { focusMainContent, requestMainFocus } from "./mainFocus";

type NavItem = { name: string; href: string; icon: LucideIcon };
type NavGroup = { id: string; label: string; icon: LucideIcon; links: NavItem[] };

// Keep established routes intact. Only their presentation and grouping change.
const primaryLinks: NavItem[] = [
  { name: "Home", href: "/", icon: LayoutDashboard },
  { name: "Find Jobs", href: "/jobs", icon: Briefcase },
  { name: "Applications", href: "/applications", icon: FileText },
  { name: "Personal Brand", href: "/personal-brand", icon: Megaphone },
];

const navGroups: NavGroup[] = [
  {
    id: "career",
    label: "My Career",
    icon: UserRound,
    links: [
      { name: "Career Profile", href: "/career-profile", icon: UserRound },
      { name: "Target Tracks", href: "/target-tracks", icon: Compass },
      { name: "Career Evidence", href: "/career-evidence/new", icon: Library },
      { name: "Career Stories", href: "/career-stories", icon: BookOpenText },
      { name: "Resume", href: "/resume", icon: FileText },
    ],
  },
  {
    id: "search",
    label: "Search Tools",
    icon: SlidersHorizontal,
    links: [
      { name: "Companies", href: "/companies", icon: Building2 },
      { name: "Filters", href: "/filters", icon: SlidersHorizontal },
      { name: "Search Insights", href: "/search-insights", icon: BarChart3 },
    ],
  },
];

const utilityLinks: NavItem[] = [
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Help", href: "/help", icon: CircleHelp },
];

function groupForPath(pathname: string): string | null {
  return navGroups.find(group => group.links.some(link => link.href === pathname))?.id ?? null;
}

function SidebarNavLink({
  item,
  active,
  nested = false,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  nested?: boolean;
  onNavigate: (href: string) => void;
}) {
  return (
    <Link
      to={item.href}
      onClick={() => onNavigate(item.href)}
      aria-current={active ? "page" : undefined}
      className={`sidebar-link group flex min-h-11 items-center rounded-xl py-2.5 text-sm
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white
        ${nested ? "pl-9 pr-3 font-medium" : "px-3 font-semibold"}
        ${active ? "sidebar-link-active !text-white" : "!text-white/80 hover:!text-white"}`}
    >
      <item.icon
        className={`mr-3 shrink-0 ${nested ? "h-4 w-4" : "h-5 w-5"}
          ${active ? "!text-white" : "!text-white/60 group-hover:!text-white"}`}
        aria-hidden="true"
      />
      {item.name}
    </Link>
  );
}

export function Sidebar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(() => groupForPath(location.pathname));
  const activeGroup = groupForPath(location.pathname);

  // Deep links and browser back/forward open the group containing the active page.
  // Top-level destinations restore a compact sidebar; users can reopen a group.
  useEffect(() => {
    setOpenGroup(groupForPath(location.pathname));
  }, [location.pathname]);

  // On short screens an auto-expanded group can leave the current page below the
  // sidebar's own scroll area. Reveal it once per route without moving page content.
  const navRef = useRef<HTMLElement>(null);
  const revealedPath = useRef<string | null>(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || active.offsetParent === null || revealedPath.current === location.pathname) return;
    revealedPath.current = location.pathname;
    const navBox = nav.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    if (activeBox.bottom > navBox.bottom) nav.scrollTop += activeBox.bottom - navBox.bottom + 12;
    else if (activeBox.top < navBox.top) nav.scrollTop -= navBox.top - activeBox.top + 12;
  }, [location.pathname, openGroup, mobileOpen]);

  const toggleRef = useRef<HTMLButtonElement>(null);
  // Escape closes the open mobile menu and returns focus to the button that opened it.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  // Choosing a destination from the mobile menu hides that link, so hand focus to the
  // destination page's main content instead of leaving it on a hidden element.
  const closeMobileMenu = (href: string) => {
    if (mobileOpen) {
      if (href === location.pathname) focusMainContent();
      else requestMainFocus();
    }
    setMobileOpen(false);
  };

  return (
    <aside className="app-sidebar flex h-screen flex-col">
      <div className="border-b border-white/10 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center gap-3">
          <div className="brand-mark flex h-10 w-10 items-center justify-center rounded-2xl">
            <Briefcase className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold !text-white">Job Ranger</h1>
          <button
            type="button"
            ref={toggleRef}
            className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/20 text-white md:hidden"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            aria-controls="job-ranger-primary-nav job-ranger-utility-nav"
            onClick={() => setMobileOpen(open => !open)}
          >
            {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> :
              <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <nav
        ref={navRef}
        id="job-ranger-primary-nav"
        className={`app-sidebar-nav min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3
          ${mobileOpen ? "block" : "hidden"} md:block`}
        aria-label="Primary navigation"
      >
        {primaryLinks.map(item => (
          <SidebarNavLink
            key={item.href}
            item={item}
            active={location.pathname === item.href}
            onNavigate={closeMobileMenu}
          />
        ))}

        <div className="my-3 border-t border-white/10 pt-3" role="group" aria-label="Supporting navigation">
          {navGroups.map(group => {
            const expanded = openGroup === group.id;
            const containsCurrentPage = activeGroup === group.id;
            const groupPanelId = `job-ranger-nav-group-${group.id}`;
            return (
              <div key={group.id} className="mb-1">
                <button
                  type="button"
                  className={`sidebar-link group flex min-h-11 w-full items-center rounded-xl px-3 py-2.5
                    text-left text-sm font-semibold !text-white/80 hover:!text-white
                    focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white
                    ${containsCurrentPage ? "bg-white/10 !text-white" : ""}`}
                  aria-expanded={expanded}
                  aria-controls={groupPanelId}
                  onClick={() => setOpenGroup(current => current === group.id ? null : group.id)}
                >
                  <group.icon className="mr-3 h-5 w-5 shrink-0 !text-white/60 group-hover:!text-white" aria-hidden="true" />
                  <span className="flex-1">
                    {group.label}
                    {containsCurrentPage && !expanded && <span className="sr-only"> (contains current page)</span>}
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                <div id={groupPanelId} hidden={!expanded} className="space-y-0.5 pb-1">
                  {group.links.map(item => (
                    <SidebarNavLink
                      key={item.href}
                      item={item}
                      active={location.pathname === item.href}
                      nested
                      onNavigate={closeMobileMenu}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </nav>

      <nav id="job-ranger-utility-nav" className={`app-sidebar-footer border-t border-white/10 px-4 py-3 ${mobileOpen ? "block" : "hidden"} md:block`} aria-label="Utility navigation">
        {utilityLinks.map(item => (
          <SidebarNavLink
            key={item.href}
            item={item}
            active={location.pathname === item.href}
            onNavigate={closeMobileMenu}
          />
        ))}
      </nav>
    </aside>
  );
}
