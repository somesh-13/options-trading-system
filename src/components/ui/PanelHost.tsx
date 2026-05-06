'use client';

import { CSSProperties, ReactNode } from 'react';
import { ResizableCard } from './ResizableCard';
import { PanelMenu } from './PanelMenu';

interface Props {
  /** Stable card identifier (used by ResizableCard for size persistence). */
  cardId: string;
  children: ReactNode;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  style?: CSSProperties;
  className?: string;
}

/** A registered panel: ResizableCard + 3-dot menu in the top-right corner.
 *  The menu only renders the actions whose handlers are provided. */
export function PanelHost({
  cardId,
  children,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  style,
  className,
}: Props) {
  return (
    <ResizableCard
      cardId={cardId}
      className={className}
      style={{ position: 'relative', ...style }}
    >
      <PanelMenu
        onRemove={onRemove}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
      />
      {children}
    </ResizableCard>
  );
}
