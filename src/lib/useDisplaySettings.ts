'use client';

import { useEffect, useState } from 'react';

const ZOOM_KEY = 'rv:settings:zoom';
const ZOOM_DEFAULT = 1.0;
const ZOOM_MIN = 0.9;
const ZOOM_MAX = 1.4;

const RESIZE_KEY_PREFIX = 'rv:resize:';

function readZoom(): number {
  if (typeof window === 'undefined') return ZOOM_DEFAULT;
  const raw = window.localStorage.getItem(ZOOM_KEY);
  if (!raw) return ZOOM_DEFAULT;
  const v = Number.parseFloat(raw);
  if (!Number.isFinite(v)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
}

function applyZoom(value: number): void {
  if (typeof document === 'undefined') return;
  // CSS `zoom` rescales layout including fonts, images, and rv-card resize
  // handles. Browser support: Chromium, Safari, and Firefox 126+ (June 2024).
  // Falls back to no-op silently elsewhere.
  (document.body.style as unknown as Record<string, string>).zoom = String(value);
}

/** Read the persisted zoom value and apply it to <body> on mount. */
export function useApplyZoomOnMount(): void {
  useEffect(() => {
    applyZoom(readZoom());
  }, []);
}

/** Stateful zoom controller — used by the Settings popover. */
export function useZoomControl(): {
  zoom: number;
  setZoom: (v: number) => void;
  min: number;
  max: number;
  step: number;
} {
  const [zoom, setZoomState] = useState<number>(ZOOM_DEFAULT);

  useEffect(() => {
    const v = readZoom();
    setZoomState(v);
    applyZoom(v);
  }, []);

  const setZoom = (v: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
    setZoomState(clamped);
    applyZoom(clamped);
    try {
      window.localStorage.setItem(ZOOM_KEY, String(clamped));
    } catch {
      /* private mode / quota — non-fatal */
    }
  };

  return { zoom, setZoom, min: ZOOM_MIN, max: ZOOM_MAX, step: 0.1 };
}

/** Clear every persisted card size. Used by the Settings popover's "Reset
 *  card sizes" action. Does NOT shrink any currently-mounted cards back —
 *  the page must be reloaded for the defaults to take effect. */
export function resetAllCardSizes(): number {
  if (typeof window === 'undefined') return 0;
  let cleared = 0;
  const keysToRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(RESIZE_KEY_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => {
    window.localStorage.removeItem(k);
    cleared += 1;
  });
  return cleared;
}

export const RESIZE_LOCALSTORAGE_PREFIX = RESIZE_KEY_PREFIX;
