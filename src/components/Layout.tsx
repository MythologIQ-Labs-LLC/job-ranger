import { ReactNode, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { DemoBanner } from './DemoBanner';
import { MAIN_CONTENT_ID, focusMainContent, hasPendingMainFocusRequest } from './mainFocus';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  useEffect(() => {
    if (hasPendingMainFocusRequest()) focusMainContent();
  }, []);

  return (
    <div className="app-shell">
      {/* The hash router owns "#/..." URLs, so the skip link moves focus instead of navigating. */}
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          focusMainContent();
        }}
      >
        Skip to main content
      </a>
      <Sidebar />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="app-main overflow-y-auto focus:outline-none">
        <div className="content-wrap animate-rise px-2 py-4 sm:px-4 sm:py-6 md:px-6">
          <DemoBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
