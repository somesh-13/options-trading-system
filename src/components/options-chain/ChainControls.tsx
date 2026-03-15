'use client';

interface ChainControlsProps {
  side: 'buy' | 'sell';
  onSideChange: (side: 'buy' | 'sell') => void;
  optionType: 'call' | 'put';
  onOptionTypeChange: (type: 'call' | 'put') => void;
  expirations: string[];
  selectedExpiration: string;
  onExpirationChange: (exp: string) => void;
  loading: boolean;
  now: number;
}

export default function ChainControls({
  side,
  onSideChange,
  optionType,
  onOptionTypeChange,
  expirations,
  selectedExpiration,
  onExpirationChange,
  loading,
  now,
}: ChainControlsProps) {
  return (
    <div className="bg-[#2D2D2D] rounded-lg p-4 mb-4">
      <div className="flex flex-wrap gap-4 items-center">
        {/* Buy/Sell toggle */}
        <div className="flex gap-1 bg-[#1E1E1E] rounded-lg p-1">
          <button
            onClick={() => onSideChange('buy')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
              side === 'buy' ? 'bg-[#00C805] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => onSideChange('sell')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
              side === 'sell' ? 'bg-[#FF006E] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Sell
          </button>
        </div>

        {/* Call/Put toggle */}
        <div className="flex gap-1 bg-[#1E1E1E] rounded-lg p-1">
          <button
            onClick={() => onOptionTypeChange('call')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
              optionType === 'call' ? 'bg-[#00C805] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Calls
          </button>
          <button
            onClick={() => onOptionTypeChange('put')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
              optionType === 'put' ? 'bg-[#FF006E] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Puts
          </button>
        </div>

        {/* Expiration dropdown */}
        {expirations.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={selectedExpiration}
              onChange={(e) => onExpirationChange(e.target.value)}
              disabled={loading}
              className="bg-[#1E1E1E] text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {expirations.map((exp) => {
                const dte = now > 0 ? Math.ceil((new Date(exp).getTime() - now) / 86400000) : 0;
                return (
                  <option key={exp} value={exp}>
                    {exp} ({dte > 0 ? dte : 0} DTE)
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {loading && <span className="text-gray-400 text-sm">Loading...</span>}
      </div>
    </div>
  );
}
