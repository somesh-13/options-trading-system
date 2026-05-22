'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type RailItem = { icon: string; label: string; tooltip: string; href: string } | { sep: true };

const ITEMS: RailItem[] = [
  { icon: '◎', label: 'Home',       tooltip: 'Today — opportunities ranked by EV', href: '/' },
  { icon: '⊞', label: 'Scanner',    tooltip: 'Multi-ticker IV/HV mispricing scanner', href: '/scanner' },
  { icon: '⚡', label: 'AI DC',      tooltip: 'AI data center peer comparison — GPUs, $/MW, utilization', href: '/ai-datacenter' },
  { icon: '⇉', label: 'Flow',       tooltip: 'Options flow leaderboard — premium $ + OI buildup', href: '/flow' },
  { icon: '≣', label: 'Chain',      tooltip: 'Option chain with inline ticket',       href: '/options-chain' },
  { icon: 'ƒ', label: 'Pricing',    tooltip: 'Black-Scholes calculator + Greeks',     href: '/pricing' },
  { sep: true },
  { icon: 'R', label: 'Robinhood',  tooltip: 'Live broker · NAV · holdings · activity · analytics', href: '/robinhood' },
  { icon: '◫', label: 'Positions',  tooltip: 'Per-ticker position detail + trade ticket',           href: '/positions' },
  { icon: '△', label: 'Risk',       tooltip: 'VaR · limits · drawdown · TCA · stress',              href: '/risk-mgmt' },
  { sep: true },
  { icon: '⟳', label: 'Auto',       tooltip: 'Auto-engine: scanner + executor',       href: '/auto-engine' },
  { icon: '⊿', label: 'Backtest',   tooltip: 'Walk-forward backtesting',              href: '/backtest' },
  { icon: '∿', label: 'NLP',        tooltip: 'NLP sentiment from filings + news',     href: '/sentiment' },
  { icon: '◉', label: 'Agent',      tooltip: 'VegaEdge live agent (LLM)',             href: '/agent' },
  { sep: true },
  { icon: '?', label: 'Glossary',   tooltip: 'Glossary — plain-English definitions of every term', href: '/glossary' },
];

interface LeftRailProps {
  /** Called after a nav link is clicked — used by AppShell to close the mobile drawer. */
  onNavigate?: () => void;
}

export function LeftRail({ onNavigate }: LeftRailProps) {
  const pathname = usePathname() || '/';

  return (
    <div className="rv-rail">
      {ITEMS.map((it, i) =>
        'sep' in it ? (
          <div key={`sep-${i}`} className="sep" />
        ) : (
          <Link
            key={it.href}
            href={it.href}
            title={it.tooltip}
            className={`item ${pathname === it.href ? 'active' : ''}`}
            onClick={onNavigate}
          >
            <span className="ricon" aria-hidden>{it.icon}</span>
            <span className="rlabel">{it.label}</span>
          </Link>
        )
      )}
    </div>
  );
}
