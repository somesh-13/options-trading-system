'use client';

interface IVHVPanelProps {
  iv: number;
  hv: number;
  ratio: number;
  signal: string;
}

export default function IVHVPanel({ iv, hv, ratio, signal }: IVHVPanelProps) {
  const signalColor =
    signal === 'SELL' ? 'bg-[#FF006E]/20 text-[#FF006E] border-[#FF006E]/30'
    : signal === 'BUY' ? 'bg-[#00C805]/20 text-[#00C805] border-[#00C805]/30'
    : 'bg-[#FFD700]/20 text-[#FFD700] border-[#FFD700]/30';

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-400">IV / HV Signal</h3>
        <span className={`px-3 py-1 rounded text-xs font-bold border ${signalColor}`}>
          {signal}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-gray-500">Implied Vol</p>
          <p className="text-lg font-bold text-white">{(iv * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Historical Vol</p>
          <p className="text-lg font-bold text-white">{(hv * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">IV/HV Ratio</p>
          <p className={`text-lg font-bold ${ratio > 1.3 ? 'text-[#FF006E]' : ratio < 0.8 ? 'text-[#00C805]' : 'text-[#FFD700]'}`}>
            {ratio.toFixed(2)}x
          </p>
        </div>
      </div>
    </div>
  );
}
