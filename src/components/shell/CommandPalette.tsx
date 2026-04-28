'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type TickerEntry = { symbol: string; name: string; exchange?: string };

type NavAction    = { kind: 'nav';    label: string; path: string };
type TickerAction = { kind: 'ticker'; symbol: string; name?: string };
type RunAction    = { kind: 'action'; label: string; run: () => void | Promise<void> };

type PaletteAction = NavAction | TickerAction | RunAction;

const NAV: NavAction[] = [
  { kind: 'nav', label: 'Today (home)',  path: '/' },
  { kind: 'nav', label: 'Scanner',       path: '/scanner' },
  { kind: 'nav', label: 'Option Chain',  path: '/options-chain' },
  { kind: 'nav', label: 'Pricing',       path: '/pricing' },
  { kind: 'nav', label: 'Portfolio',     path: '/portfolio' },
  { kind: 'nav', label: 'Positions',     path: '/positions' },
  { kind: 'nav', label: 'Risk',          path: '/risk-mgmt' },
  { kind: 'nav', label: 'Auto Engine',   path: '/auto-engine' },
  { kind: 'nav', label: 'Backtest',      path: '/backtest' },
  { kind: 'nav', label: 'Sentiment',     path: '/sentiment' },
  { kind: 'nav', label: 'Strategy',      path: '/strategy' },
  { kind: 'nav', label: 'Vol Surface',   path: '/vol-surface' },
  { kind: 'nav', label: 'Trade Journal', path: '/journal' },
  { kind: 'nav', label: 'Execution',     path: '/execution' },
  { kind: 'nav', label: 'Agent',         path: '/agent' },
];

const ACTIONS: RunAction[] = [
  { kind: 'action', label: 'halt engine',          run: () => fetch('/api/auto-engine/halt',    { method: 'POST' }).catch(() => {}) },
  { kind: 'action', label: 'resume engine',        run: () => fetch('/api/auto-engine/resume',  { method: 'POST' }).catch(() => {}) },
  { kind: 'action', label: 'rehedge to delta 0',   run: () => fetch('/api/strategy/hedging',     { method: 'POST' }).catch(() => {}) },
  { kind: 'action', label: 'switch to paper',      run: () => {} },
  { kind: 'action', label: 'switch to live',       run: () => {} },
];

// Module-scope cache + in-flight promise so concurrent opens dedupe.
let tickerCache: TickerEntry[] | null = null;
let tickerPromise: Promise<TickerEntry[]> | null = null;

// Small fallback so the palette stays useful if the JSON isn't present yet.
const FALLBACK_TICKERS: TickerEntry[] = [
  'CIFR', 'MARA', 'RIOT', 'WULF', 'HOOD', 'COIN', 'PYPL', 'GRAB',
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
].map((symbol) => ({ symbol, name: '' }));

async function loadTickers(): Promise<TickerEntry[]> {
  if (tickerCache) return tickerCache;
  if (tickerPromise) return tickerPromise;
  tickerPromise = (async () => {
    try {
      const res = await fetch('/us-tickers.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as TickerEntry[];
      tickerCache = data;
      return data;
    } catch {
      tickerCache = FALLBACK_TICKERS;
      return FALLBACK_TICKERS;
    }
  })();
  return tickerPromise;
}

const MIN_QUERY = 3;
const MAX_INLINE_RESULTS = 8;

export function CommandPaletteTrigger() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tickers, setTickers] = useState<TickerEntry[] | null>(tickerCache);
  const [matches, setMatches] = useState<TickerAction[]>([]);
  const [idx, setIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Kick off the lazy load on first mount so suggestions are ready immediately.
  useEffect(() => {
    if (tickers) return;
    let cancelled = false;
    loadTickers().then((list) => { if (!cancelled) setTickers(list); });
    return () => { cancelled = true; };
  }, [tickers]);

  // ⌘K / Ctrl+K opens the full modal palette (pages + actions + tickers).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click-outside closes the inline dropdown.
  useEffect(() => {
    if (!focused) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [focused]);

  // Debounced filter — only fires when 3+ chars are typed.
  useEffect(() => {
    const needle = q.trim();
    const handle = setTimeout(() => {
      if (needle.length < MIN_QUERY || !tickers) {
        setMatches([]);
      } else {
        setMatches(filterTickers(tickers, needle).slice(0, MAX_INLINE_RESULTS));
      }
      setIdx(0);
    }, 60);
    return () => clearTimeout(handle);
  }, [q, tickers]);

  const navigateTo = (symbol: string) => {
    router.push(`/stock/${symbol.toUpperCase()}`);
    setQ('');
    setFocused(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = matches[idx];
      if (pick) navigateTo(pick.symbol);
      else if (q.trim().length >= 1) navigateTo(q.trim());
    } else if (e.key === 'Escape') {
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  const showDropdown = focused && q.trim().length >= MIN_QUERY;
  const tickerCount = tickers?.length ?? 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
      <div className="rv-search" style={{ cursor: 'text', padding: 0 }}>
        <span style={{ padding: '0 0 0 10px', color: 'var(--ink-mute)' }}>⌕</span>
        <input
          ref={inputRef}
          type="text"
          value={q}
          placeholder={tickerCount ? `Search ${tickerCount.toLocaleString()} tickers…` : 'Search tickers…'}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          style={{
            flex: 1,
            background: 'transparent',
            border: 0,
            outline: 'none',
            color: 'var(--ink)',
            fontSize: 12,
            fontFamily: 'inherit',
            padding: '5px 0',
          }}
        />
        <button
          type="button"
          className="kbd"
          onClick={() => setOpen(true)}
          title="Open command palette"
          style={{ cursor: 'pointer', border: 0, marginRight: 6 }}
        >
          ⌘K
        </button>
      </div>

      {showDropdown && (
        <div
          className="rv-cmd"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            width: 'auto',
            maxHeight: '50vh',
            overflowY: 'auto',
            zIndex: 50,
          }}
        >
          {!tickers && <div className="rv-cmd-empty">loading ticker list…</div>}
          {tickers && matches.length === 0 && (
            <div className="rv-cmd-empty">
              no ticker matches — press Enter to open /stock/{q.trim().toUpperCase()}
            </div>
          )}
          {matches.map((m, i) => (
            <div
              key={m.symbol}
              className={`rv-cmd-item ${i === idx ? 'sel' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); navigateTo(m.symbol); }}
            >
              <span className="kind">ticker</span>
              <span className="label">
                <b style={{ color: 'var(--ink)' }}>{m.symbol}</b>
                {m.name && (
                  <span style={{ color: 'var(--ink-mute)', marginLeft: 8, fontSize: 11 }}>— {m.name}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {open && <CommandPalette onClose={() => setOpen(false)} />}
    </div>
  );
}

const MAX_RESULTS = 12;

function filterTickers(tickers: TickerEntry[], needle: string): TickerAction[] {
  if (!needle) {
    return tickers.slice(0, MAX_RESULTS).map((t) => ({ kind: 'ticker', symbol: t.symbol, name: t.name }));
  }
  const n = needle.toLowerCase();
  const prefix: TickerEntry[] = [];
  const contains: TickerEntry[] = [];
  const nameMatch: TickerEntry[] = [];

  for (const t of tickers) {
    const sym = t.symbol.toLowerCase();
    if (sym === n || sym.startsWith(n)) {
      prefix.push(t);
      if (prefix.length >= MAX_RESULTS) break;
      continue;
    }
    if (sym.includes(n)) contains.push(t);
    else if (t.name && t.name.toLowerCase().includes(n)) nameMatch.push(t);
  }

  const out = [...prefix, ...contains, ...nameMatch].slice(0, MAX_RESULTS);
  return out.map((t) => ({ kind: 'ticker', symbol: t.symbol, name: t.name }));
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [tickers, setTickers] = useState<TickerEntry[] | null>(tickerCache);
  const [matches, setMatches] = useState<PaletteAction[]>([]);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (tickers) return;
    let cancelled = false;
    loadTickers().then((list) => { if (!cancelled) setTickers(list); });
    return () => { cancelled = true; };
  }, [tickers]);

  // Debounce the filter so typing into a ~11k-entry list stays snappy.
  useEffect(() => {
    const needle = q.trim();
    const handle = setTimeout(() => {
      const tickerMatches = tickers ? filterTickers(tickers, needle) : [];
      if (!needle) {
        setMatches([...NAV.slice(0, 6), ...tickerMatches.slice(0, 6), ...ACTIONS.slice(0, 2)].slice(0, MAX_RESULTS));
        return;
      }
      const low = needle.toLowerCase();
      const navMatches = NAV.filter((n) => n.label.toLowerCase().includes(low) || n.path.includes(low));
      const actionMatches = ACTIONS.filter((a) => a.label.toLowerCase().includes(low));
      setMatches([...tickerMatches, ...navMatches, ...actionMatches].slice(0, MAX_RESULTS));
    }, 80);
    return () => clearTimeout(handle);
  }, [q, tickers]);

  const select = (a: PaletteAction) => {
    if (a.kind === 'nav') router.push(a.path);
    else if (a.kind === 'ticker') router.push(`/stock/${a.symbol}`);
    else void a.run();
    onClose();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = matches[idx];
      if (pick) select(pick);
      else if (q.trim()) {
        // Allow typing a ticker symbol that's not in the cache (e.g. a brand new listing).
        router.push(`/stock/${q.trim().toUpperCase()}`);
        onClose();
      }
    }
  };

  const loading = !tickers && q.trim().length > 0;

  // Prefix memo purely to suppress the unused-var lint while keeping the hook symmetrical.
  const placeholder = useMemo(
    () => (tickers ? `Type a ticker, page, or action — ${tickers.length.toLocaleString()} tickers indexed` : 'Loading tickers…'),
    [tickers],
  );

  return (
    <div className="rv-cmd-backdrop" onClick={onClose}>
      <div className="rv-cmd" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="rv-cmd-input"
          placeholder={placeholder}
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={onKey}
        />
        <div className="rv-cmd-list">
          {loading && <div className="rv-cmd-empty">loading ticker list…</div>}
          {!loading && matches.length === 0 && (
            <div className="rv-cmd-empty">
              {q.trim() ? `no matches — press Enter to open /stock/${q.trim().toUpperCase()}` : 'no matches'}
            </div>
          )}
          {matches.map((a, i) => (
            <div
              key={`${a.kind}-${a.kind === 'ticker' ? a.symbol : a.label}`}
              className={`rv-cmd-item ${i === idx ? 'sel' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => select(a)}
            >
              <span className="kind">{a.kind}</span>
              <span className="label">
                {a.kind === 'ticker' ? a.symbol : a.label}
                {a.kind === 'ticker' && a.name ? (
                  <span style={{ color: 'var(--ink-mute)', marginLeft: 8, fontSize: 11 }}>— {a.name}</span>
                ) : null}
              </span>
              {a.kind === 'nav' && <span className="path">{a.path}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
