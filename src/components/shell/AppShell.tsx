'use client';

import { useState, useCallback } from 'react';
import { TopBar } from './TopBar';
import { LeftRail } from './LeftRail';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="rv">
      <TopBar onHamburgerClick={openDrawer} />

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="rv-drawer-backdrop"
          aria-hidden="true"
          onClick={closeDrawer}
        />
      )}

      <div className="rv-body">
        {/* Desktop sidebar / mobile drawer */}
        <div
          className={`rv-rail-wrapper${drawerOpen ? ' rv-rail-open' : ''}`}
          aria-expanded={drawerOpen}
        >
          <LeftRail onNavigate={closeDrawer} />
        </div>

        <div className="rv-content">{children}</div>
      </div>
    </div>
  );
}
