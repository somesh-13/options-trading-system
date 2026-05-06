'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';

interface Props {
  children: ReactNode;
  /** When this changes, the carousel auto-centers the `.on` child into view.
   *  Pass the selected strike or expiration index as a string so a deep-link
   *  to a far-OTM contract scrolls it into the viewport instead of the user
   *  having to hunt for it. */
  centerOnKey?: string | number;
  /** Style overrides for the outer wrapper (the position:relative box). */
  style?: React.CSSProperties;
}

const ARROW_BTN_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 2,
  width: 24,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(13,14,17,0.92)',
  border: '1px solid var(--line)',
  borderRadius: 4,
  color: 'var(--ink)',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: 0,
};

/** Wrap any horizontal `.rv-expstrip`-style row with left/right arrow buttons.
 *  The arrows scroll ~80% of the visible width and hide themselves when the
 *  inner container is already at that edge. The strip itself is created here
 *  (not by callers) so callers stay simple — pass the `.rv-exp` items as
 *  children. */
export function ScrollCarousel({ children, centerOnKey, style }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  // Update arrow visibility based on current scroll position. Called on mount,
  // scroll, resize, and after children change.
  const updateEdges = () => {
    const el = ref.current;
    if (!el) return;
    const slack = 4; // tolerate sub-pixel rounding
    setCanLeft(el.scrollLeft > slack);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - slack);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateEdges();
    el.addEventListener('scroll', updateEdges, { passive: true });
    let obs: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      obs = new ResizeObserver(updateEdges);
      obs.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', updateEdges);
      obs?.disconnect();
    };
  }, [children]);

  // Auto-center the selected item when its identity changes.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const selected = el.querySelector('.on') as HTMLElement | null;
    if (!selected) return;
    const target = selected.offsetLeft - (el.clientWidth - selected.clientWidth) / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    // Edges may need a refresh once the smooth-scroll settles.
    const t = window.setTimeout(updateEdges, 350);
    return () => window.clearTimeout(t);
  }, [centerOnKey]);

  const scrollDir = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <div style={{ position: 'relative', ...style }}>
      {canLeft && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollDir(-1)}
          style={{ ...ARROW_BTN_STYLE, left: -2 }}
        >
          ‹
        </button>
      )}
      <div ref={ref} className="rv-expstrip">
        {children}
      </div>
      {canRight && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollDir(1)}
          style={{ ...ARROW_BTN_STYLE, right: -2 }}
        >
          ›
        </button>
      )}
    </div>
  );
}
