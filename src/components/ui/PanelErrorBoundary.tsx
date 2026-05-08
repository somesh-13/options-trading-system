'use client';

import { Component, type ReactNode } from 'react';

interface PanelErrorBoundaryProps {
  label: string;
  children: ReactNode;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[PanelErrorBoundary:${this.props.label}]`, error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        className="rv-card"
        style={{
          padding: 16,
          border: '1px solid rgba(255, 0, 110, 0.35)',
          background: 'rgba(255, 0, 110, 0.06)',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pink)', marginBottom: 6 }}>
          {this.props.label.toUpperCase()} UNAVAILABLE
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          {error.message || 'Component failed to render. Other panels should still work.'}
        </div>
      </div>
    );
  }
}
