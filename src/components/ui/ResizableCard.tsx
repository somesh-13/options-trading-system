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

/** Wraps an `.rv-card`-styled box in a CSS-resizable container that persists
 *  its width/height per `cardId` to localStorage. The base browser `resize:
 *  both` property handles the drag interaction; a `ResizeObserver` debounces
 *  writes back to storage so refreshes restore the last-set size. */
export function ResizableCard({ cardId, children, className, style, disabled }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [persisted, setPersisted] = useState<PersistedSize>({});
  const debounceRef = useRef<number | null>(null);

  // Load on mount.
  useEffect(() => {
    setPersisted(loadSize(cardId));
  }, [cardId]);

  // Observe + debounce-save.
  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      // Avoid persisting transient sizes during the drag — wait 250 ms after
      // the last resize event before writing.
      debounceRef.current = window.setTimeout(() => {
        saveSize(cardId, { w: Math.round(width), h: Math.round(height) });
      }, 250);
    });
    obs.observe(el);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      obs.disconnect();
    };
  }, [cardId, disabled]);

  const mergedStyle: CSSProperties = {
    position: 'relative',
    resize: disabled ? undefined : 'both',
    overflow: 'auto',
    ...style,
    ...(persisted.w ? { width: persisted.w } : null),
    ...(persisted.h ? { height: persisted.h } : null),
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
