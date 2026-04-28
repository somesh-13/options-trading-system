'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type RailItem = { icon: string; label: string; tooltip: string; href: string } | { sep: true };

const ITEMS: RailItem[] = [
  { icon: '◎', label: 'Home',       tooltip: 'Today — opportunities ranked by EV', href: '/' },
  { icon: '⊞', label: 'Scanner',    tooltip: 'Multi-ticker IV/HV mispricing scanner', href: '/scanner' },
  { icon: '≣', label: 'Chain',      tooltip: 'Option chain with inline ticket',       href: '/options-chain' },
  { icon: 'ƒ', label: 'Pricing',    tooltip: 'Black-Scholes calculator + Greeks',     href: '/pricing' },
  { sep: true },
  { icon: '⊟', label: 'Portfolio',  tooltip: 'NAV · equity curve · attribution',      href: '/portfolio' },
  { icon: 'R', label: 'Robinhood',  tooltip: 'Robinhood real portfolio · holdings · activity', href: '/robinhood' },
  { icon: '◫', label: 'Positions',  tooltip: 'Open positions + Greek contribution',   href: '/positions' },
  { icon: '△', label: 'Risk',       tooltip: 'VaR · limits · drawdown',               href: '/risk-mgmt' },
  { sep: true },
  { icon: '⟳', label: 'Auto',       tooltip: 'Auto-engine: scanner + executor',       href: '/auto-engine' },
  { icon: '⊿', label: 'Backtest',   tooltip: 'Walk-forward backtesting',              href: '/backtest' },
  { icon: '∿', label: 'NLP',        tooltip: 'NLP sentiment from filings + news',     href: '/sentiment' },
  { icon: '◉', label: 'Agent',      tooltip: 'VegaEdge live agent (LLM)',             href: '/agent' },
];

export function LeftRail() {
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
          >
            <span className="ricon" aria-hidden>{it.icon}</span>
            <span className="rlabel">{it.label}</span>
          </Link>
        )
      )}
    </div>
  );
}
