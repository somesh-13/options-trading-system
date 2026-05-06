'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { StatusPills } from './StatusPills';
import { CommandPaletteTrigger } from './CommandPalette';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { SettingsButton } from './SettingsButton';

const PAGE_LABELS: Record<string, string> = {
  '': 'Today',
  'scanner': 'Scanner',
  'options-chain': 'Option Chain',
  'pricing': 'Pricing',
  'portfolio': 'Portfolio',
  'positions': 'Positions',
  'risk-mgmt': 'Risk',
  'risk': 'Risk',
  'auto-engine': 'Auto Engine',
  'backtest': 'Backtest',
  'sentiment': 'Sentiment',
  'agent': 'Agent',
  'vol-surface': 'Vol Surface',
  'strategy': 'Strategy',
  'journal': 'Trade Journal',
  'execution': 'Execution',
  'replay': 'Replay',
  'stock': 'Stock',
};

type Crumb = { label: string; href: string };

function crumbsFromPath(pathname: string): Crumb[] {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [{ label: 'Home', href: '/' }];
  if (parts.length === 0) {
    crumbs.push({ label: 'Today', href: '/' });
    return crumbs;
  }
  let href = '';
  parts.forEach((p) => {
    href += `/${p}`;
    const label = PAGE_LABELS[p] ?? decodeURIComponent(p);
    crumbs.push({ label, href });
  });
  return crumbs;
}

const NOOP_SUBSCRIBE = () => () => {};

interface TopBarProps {
  onHamburgerClick?: () => void;
}

export function TopBar({ onHamburgerClick }: TopBarProps) {
  const pathname = usePathname();
  const mounted = useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => true,
    () => false,
  );
  const crumbs = mounted && pathname ? crumbsFromPath(pathname) : [{ label: 'Home', href: '/' }];
  return (
    <div className="rv-topbar">
      {/* Hamburger — visible only on mobile (hidden via CSS above 768 px) */}
      <button
        type="button"
        className="rv-hamburger"
        aria-label="Open navigation menu"
        onClick={onHamburgerClick}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>

      <Link href="/" className="rv-brand" prefetch aria-label="VegaEdge home">
        <div className="logo" />
        <div className="name">vega<span>Edge</span></div>
      </Link>
      <div className="rv-crumbs" suppressHydrationWarning>
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={`${c.href}-${i}`}>
              {i > 0 && <span style={{ margin: '0 6px', color: 'var(--ink-mute)' }}>·</span>}
              {isLast ? (
                <b>{c.label}</b>
              ) : (
                <Link href={c.href} prefetch className="rv-crumb-link">
                  {c.label}
                </Link>
              )}
            </span>
          );
        })}
      </div>
      <CommandPaletteTrigger />
      <div className="rv-pills"><StatusPills /></div>
      <SettingsButton />
      <NotificationBell />
    </div>
  );
}
