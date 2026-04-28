import { Sparkline } from '@/components/charts/Sparkline';

export function GreekBigCell({
  sym,
  ord,
  name,
  val,
  unit,
  desc,
  sparkSeed,
  sparkColor,
}: {
  sym: string;
  ord: 1 | 2;
  name: string;
  val: string;
  unit?: string;
  desc: string;
  sparkSeed: number;
  sparkColor: string;
}) {
  return (
    <div className={`rv-greek-big${ord === 2 ? ' ord2' : ''}`} style={{ position: 'relative' }}>
      {ord === 2 && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--gold)',
          }}
        />
      )}
      <div className="hd">
        <div className="sym">{sym}</div>
        <div className="nm">
          {name}
          {ord === 2 ? ' · cross' : ''}
        </div>
      </div>
      <div className="val">{val}</div>
      {unit && (
        <div
          style={{
            fontSize: 9,
            color: 'var(--ink-mute)',
            fontFamily: "'JetBrains Mono', monospace",
            marginTop: 1,
          }}
        >
          {unit}
        </div>
      )}
      <div className="spark">
        <Sparkline seed={sparkSeed} color={sparkColor} up />
      </div>
      <div className="desc">{desc}</div>
    </div>
  );
}
