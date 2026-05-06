'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Panel-layout state hook backed by localStorage.
 *
 * Each (pageId, sectionId) pair owns one ordered visible-id list plus a hidden
 * list of removed-but-restorable panel ids. New panels added in code that
 * aren't in the persisted state are appended to `visible` automatically — this
 * is the forward-compat path so a code update doesn't strand new panels in an
 * "invisible to existing users" state.
 */

const PREFIX = 'rv:layout:';

export interface PanelLayoutState {
  visible: string[];
  hidden: string[];
}

function storageKey(pageId: string, sectionId: string): string {
  return `${PREFIX}${pageId}:${sectionId}`;
}

function load(pageId: string, sectionId: string, defaultIds: string[]): PanelLayoutState {
  if (typeof window === 'undefined') {
    return { visible: defaultIds, hidden: [] };
  }
  let parsed: PanelLayoutState | null = null;
  try {
    const raw = window.localStorage.getItem(storageKey(pageId, sectionId));
    if (raw) parsed = JSON.parse(raw) as PanelLayoutState;
  } catch {
    parsed = null;
  }
  const persistedVisible = (parsed?.visible ?? []).filter(
    (s): s is string => typeof s === 'string' && defaultIds.includes(s),
  );
  const persistedHidden = (parsed?.hidden ?? []).filter(
    (s): s is string => typeof s === 'string' && defaultIds.includes(s),
  );
  if (persistedVisible.length === 0 && persistedHidden.length === 0) {
    return { visible: defaultIds, hidden: [] };
  }
  // Forward-compat: append any defaultId we haven't seen yet to `visible`.
  const known = new Set([...persistedVisible, ...persistedHidden]);
  const newPanels = defaultIds.filter((id) => !known.has(id));
  return {
    visible: [...persistedVisible, ...newPanels],
    hidden: persistedHidden,
  };
}

function save(pageId: string, sectionId: string, state: PanelLayoutState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(pageId, sectionId), JSON.stringify(state));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export interface PanelLayoutController extends PanelLayoutState {
  removePanel: (id: string) => void;
  restorePanel: (id: string) => void;
  movePanel: (id: string, dir: 'up' | 'down') => void;
  reset: () => void;
}

export function usePanelLayout(
  pageId: string,
  sectionId: string,
  defaultIds: string[],
): PanelLayoutController {
  // Stable string key so the load effect doesn't re-run on every parent render.
  const defaultsKey = useMemo(() => defaultIds.join('|'), [defaultIds]);

  const [state, setState] = useState<PanelLayoutState>({ visible: defaultIds, hidden: [] });

  useEffect(() => {
    setState(load(pageId, sectionId, defaultIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultsKey covers defaultIds
  }, [pageId, sectionId, defaultsKey]);

  const update = useCallback(
    (next: PanelLayoutState) => {
      setState(next);
      save(pageId, sectionId, next);
    },
    [pageId, sectionId],
  );

  const removePanel = useCallback(
    (id: string) => {
      setState((curr) => {
        const next: PanelLayoutState = {
          visible: curr.visible.filter((x) => x !== id),
          hidden: curr.hidden.includes(id) ? curr.hidden : [...curr.hidden, id],
        };
        save(pageId, sectionId, next);
        return next;
      });
    },
    [pageId, sectionId],
  );

  const restorePanel = useCallback(
    (id: string) => {
      setState((curr) => {
        if (curr.visible.includes(id)) return curr;
        const next: PanelLayoutState = {
          visible: [...curr.visible, id],
          hidden: curr.hidden.filter((x) => x !== id),
        };
        save(pageId, sectionId, next);
        return next;
      });
    },
    [pageId, sectionId],
  );

  const movePanel = useCallback(
    (id: string, dir: 'up' | 'down') => {
      setState((curr) => {
        const idx = curr.visible.indexOf(id);
        if (idx < 0) return curr;
        const target = dir === 'up' ? idx - 1 : idx + 1;
        if (target < 0 || target >= curr.visible.length) return curr;
        const visible = [...curr.visible];
        [visible[idx], visible[target]] = [visible[target], visible[idx]];
        const next: PanelLayoutState = { ...curr, visible };
        save(pageId, sectionId, next);
        return next;
      });
    },
    [pageId, sectionId],
  );

  const reset = useCallback(() => {
    update({ visible: defaultIds, hidden: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultsKey covers defaultIds
  }, [update, defaultsKey]);

  return { ...state, removePanel, restorePanel, movePanel, reset };
}
