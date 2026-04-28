// RV — revamp UI primitives used by every "After" frame.
window.RV = {
  // Top bar + left rail shell. `content` is HTML to inject in the main content area.
  shell({ page = '', crumb = '', content = '', activeRail = null, regime = 'high-vol' } = {}) {
    const rail = [
      { id: 'home',    icon: '◎',  label: 'Home' },
      { id: 'scan',    icon: '⊞',  label: 'Scanner' },
      { id: 'chain',   icon: '≣',  label: 'Chain' },
      { id: 'price',   icon: 'ƒ',  label: 'Pricing' },
      { sep: true },
      { id: 'port',    icon: '⊟',  label: 'Portfolio' },
      { id: 'pos',     icon: '◫',  label: 'Positions' },
      { id: 'risk',    icon: '△',  label: 'Risk' },
      { sep: true },
      { id: 'engine',  icon: '⟳',  label: 'Auto' },
      { id: 'back',    icon: '⊿',  label: 'Backtest' },
      { id: 'sent',    icon: '∿',  label: 'NLP' },
      { id: 'agent',   icon: '◉',  label: 'Agent' },
    ];
    // auto-detect active from page name if not given
    const map = {
      'Today': 'home', 'Scanner': 'scan', 'Option Chain': 'chain', 'Pricing': 'price',
      'Portfolio': 'port', 'Positions': 'pos', 'Risk': 'risk',
      'Auto Engine': 'engine', 'Backtest': 'back', 'Sentiment': 'sent', 'Agent': 'agent',
    };
    const active = activeRail || map[page] || 'home';
    const regimeClass = regime === 'crash' ? 'crash' : regime === 'normal' ? 'normal' : '';
    const regimeLabel = regime === 'crash' ? 'CRASH' : regime === 'normal' ? 'NORMAL' : 'HIGH VOL';

    return `
      <div class="rv">
        <div class="rv-topbar">
          <div class="rv-brand">
            <div class="logo"></div>
            <div class="name">vega<span>Edge</span></div>
          </div>
          <div class="rv-crumbs">${crumb}</div>
          <div class="rv-search">
            <span>⌕</span>
            <span>Search tickers, actions, pages</span>
            <span class="kbd">⌘K</span>
          </div>
          <div class="rv-pills">
            <span class="rv-pill regime ${regimeClass}"><span class="dot" style="background:currentColor;"></span>HMM · ${regimeLabel}</span>
            <span class="rv-pill var">VaR 1d · <b>$2.8k</b></span>
            <span class="rv-pill paper">PAPER</span>
            <span class="rv-pill live"><span class="dot"></span>live data</span>
          </div>
        </div>
        <div class="rv-body">
          <div class="rv-rail">
            ${rail.map(r => r.sep
              ? '<div class="sep"></div>'
              : `<div class="item ${r.id===active?'active':''}" title="${r.label}"><span style="font-size:14px;">${r.icon}</span></div>`
            ).join('')}
          </div>
          <div class="rv-content">${content}</div>
        </div>
      </div>
    `;
  },

  // Compact IV/HV scale (0.5 ←→ 2.0) with BUY/SELL shaded zones.
  ivhvScale(iv, hv, ratio) {
    const min = 0.5, max = 2.0;
    const pct = Math.max(0, Math.min(1, (ratio - min) / (max - min))) * 100;
    return `
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="position:relative;width:110px;height:10px;border:1px solid var(--line);border-radius:2px;background:#0c0d10;overflow:hidden;">
          <div style="position:absolute;left:0;top:0;bottom:0;width:${(0.8-min)/(max-min)*100}%;background:rgba(0,200,5,.15);"></div>
          <div style="position:absolute;right:0;top:0;bottom:0;width:${(max-1.3)/(max-min)*100}%;background:rgba(255,215,0,.15);"></div>
          <div style="position:absolute;left:${(1.0-min)/(max-min)*100}%;top:0;bottom:0;width:1px;background:var(--ink-mute);"></div>
          <div style="position:absolute;left:${pct}%;top:-2px;bottom:-2px;width:2px;background:var(--ink);transform:translateX(-1px);"></div>
        </div>
        <span style="font-family:'JetBrains Mono';font-size:10px;color:var(--ink-mute);">
          ${(iv*100).toFixed(0)}/${(hv*100).toFixed(0)}
        </span>
      </div>
    `;
  },

  // Tiny spark SVG
  spark(seed = 1, color = 'var(--ink-dim)', up = true) {
    const n = 24;
    const pts = [];
    let y = 50;
    for (let i = 0; i < n; i++) {
      y += Math.sin(seed*(i+1)*0.3)*5 + (up ? -0.6 : 0.6);
      y = Math.max(10, Math.min(90, y));
      pts.push(`${(i/(n-1))*100},${y}`);
    }
    return `<svg class="rv-spark" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.join(' ')}"/></svg>`;
  },

  // Candle chart placeholder
  candles(seed = 1, h = 160) {
    const n = 40;
    let y = 50;
    const els = [];
    for (let i = 0; i < n; i++) {
      const drift = Math.sin(seed + i*0.3) * 3;
      const o = y;
      y += drift;
      const c = y;
      const hh = Math.max(o,c) + Math.abs(Math.sin(seed*i))*2;
      const ll = Math.min(o,c) - Math.abs(Math.cos(seed*i))*2;
      const up = c > o;
      const x = (i/n)*100;
      const w = 100/n * 0.7;
      const col = up ? 'var(--green)' : 'var(--pink)';
      els.push(`<line x1="${x+w/2}" x2="${x+w/2}" y1="${100-hh}" y2="${100-ll}" stroke="${col}" stroke-width=".4"/>`);
      els.push(`<rect x="${x}" y="${100-Math.max(o,c)}" width="${w}" height="${Math.max(0.5,Math.abs(c-o))}" fill="${col}"/>`);
    }
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:${h}px;">${els.join('')}</svg>`;
  },
};
