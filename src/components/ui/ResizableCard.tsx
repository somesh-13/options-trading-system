'use client';

import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { RESIZE_LOCALSTORAGE_PREFIX } from '@/lib/useDisplaySettings';

interface Props {
  /** Stable identifier — the persisted size is keyed by this. Pick something
   *  unlikely to change across renames (e.g. `stock-detail:financials`). */
  cardId: string;
  children: ReactNode;
  /** Extra classes to add to the wrapper. The base class is always `rv-card`. */
  className?: string;
  /** Inline overrides — merged on top of the wrapper's defaults. The persisted
   *  width/height are applied last so they always win. */
  style?: CSSProperties;
  /** Disable persistence — useful for cards that should not be resizable. */
  disabled?: boolean;
}

interface PersistedSize {
  w?: number;
  h?: number;
}

/** Floor for any persisted/applied height — prevents stale localStorage entries
 *  from clipping a card down to a single row of content. */
const MIN_CARD_HEIGHT = 120;

function loadSize(cardId: string): PersistedSize {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(RESIZE_LOCALSTORAGE_PREFIX + cardId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedSize;
    return {
      w: typeof parsed.w === 'number' && Number.isFinite(parsed.w) ? parsed.w : undefined,
      h: typeof parsed.h === 'number' && Number.isFinite(parsed.h) ? parsed.h : undefined,
    };
  } catch {
    return {};
  }
}

function saveSize(cardId: string, size: PersistedSize): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RESIZE_LOCALSTORAGE_PREFIX + cardId, JSON.stringify(size));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

function clearSize(cardId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RESIZE_LOCALSTORAGE_PREFIX + cardId);
  } catch {
    /* non-fatal */
  }
}

/** Wraps an `.rv-card`-styled box in a CSS-resizable container that persists
 *  its width/height per `cardId` to localStorage. The base browser `resize:
 *  both` property handles the drag interaction; a `ResizeObserver` debounces
 *  writes back to storage so refreshes restore the last-set size.
 *
 *  Persistence is gated on a real user drag (pointerdown on the wrapper) so
 *  layout reflows during data load don't lock the card to a transient short
 *  height. A `MIN_CARD_HEIGHT` floor and a one-time cleanup of persisted
 *  heights smaller than the natural `scrollHeight` keep stale entries from
 *  clipping content. */
export function ResizableCard({ cardId, children, className, style, disabled }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [persisted, setPersisted] = useState<PersistedSize>(() => loadSize(cardId));
  const debounceRef = useRef<number | null>(null);
  /** True only while the user is actively drag-resizing. Resize events
   *  outside this window are layout reflow, not user intent — skip them. */
  const dragActiveRef = useRef(false);

  // One-time-discard a persisted height that's already shorter than the
  // rendered scrollHeight (stale clip from a previous bug). Initial load is
  // handled lazily by useState above so this effect only fires when a
  // cleanup is actually needed.
  useEffect(() => {
    if (
      persisted.h != null &&
      ref.current != null &&
      persisted.h < ref.current.scrollHeight
    ) {
      clearSize(cardId);
      setPersisted((prev) => ({ w: prev.w }));
    }
    // Intentional: only runs on mount per cardId — we do not want repeat
    // re-checks when persisted updates from a user drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  // Mark drag windows on pointerdown/up so the ResizeObserver only writes
  // sizes the user actually chose.
  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const onDown = () => {
      dragActiveRef.current = true;
    };
    const onUp = () => {
      // Keep the flag set briefly so the trailing debounced save still fires.
      window.setTimeout(() => {
        dragActiveRef.current = false;
      }, 400);
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, [disabled]);

  // Observe + debounce-save (only during an active user drag).
  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (!dragActiveRef.current) return; // ignore reflow-driven resizes
      const { width, height } = entry.contentRect;
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      // Avoid persisting transient sizes during the drag — wait 250 ms after
      // the last resize event before writing.
      debounceRef.current = window.setTimeout(() => {
        saveSize(cardId, {
          w: Math.round(width),
          h: Math.max(MIN_CARD_HEIGHT, Math.round(height)),
        });
      }, 250);
    });
    obs.observe(el);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      obs.disconnect();
    };
  }, [cardId, disabled]);

  const appliedHeight =
    persisted.h != null ? Math.max(MIN_CARD_HEIGHT, persisted.h) : undefined;

  const mergedStyle: CSSProperties = {
    position: 'relative',
    resize: disabled ? undefined : 'both',
    overflow: 'auto',
    minHeight: MIN_CARD_HEIGHT,
    ...style,
    ...(persisted.w ? { width: persisted.w } : null),
    ...(appliedHeight ? { height: appliedHeight } : null),
  };

  return (
    <div
      ref={ref}
      className={`rv-card${className ? ' ' + className : ''}`}
      style={mergedStyle}
      data-card-id={cardId}
    >
      {children}
    </div>
  );
}
