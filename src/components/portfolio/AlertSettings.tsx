'use client';

import { useState } from 'react';
import type { AlertConfig } from '@/hooks/useAlerts';

interface AlertSettingsProps {
  config: AlertConfig;
  onUpdate: (config: AlertConfig) => void;
}

export default function AlertSettings({ config, onUpdate }: AlertSettingsProps) {
  const [expanded, setExpanded] = useState(false);
  const [local, setLocal] = useState<AlertConfig>(config);

  const handleChange = (key: keyof AlertConfig, value: number | boolean) => {
    const updated = { ...local, [key]: value };
    setLocal(updated);
    onUpdate(updated);
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-6 py-4 flex items-center justify-between hover:bg-[#333333] rounded-lg transition-colors"
      >
        <h3 className="text-lg font-bold">Alert Settings</h3>
        <span className="text-gray-400">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="px-6 pb-6 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* P&L Thresholds */}
            <div>
              <h4 className="text-sm font-bold text-gray-300 mb-3">P&L Thresholds</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Daily Loss Alert ($)</label>
                  <input
                    type="number"
                    value={local.daily_loss_threshold}
                    onChange={(e) => handleChange('daily_loss_threshold', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF006E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Daily Gain Alert ($)</label>
                  <input
                    type="number"
                    value={local.daily_gain_threshold}
                    onChange={(e) => handleChange('daily_gain_threshold', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Position Loss Alert (%)</label>
                  <input
                    type="number"
                    value={local.position_loss_pct_threshold}
                    onChange={(e) => handleChange('position_loss_pct_threshold', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF006E]"
                  />
                </div>
              </div>
            </div>

            {/* Greeks Thresholds */}
            <div>
              <h4 className="text-sm font-bold text-gray-300 mb-3">Greeks Thresholds</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Max Delta</label>
                  <input
                    type="number"
                    value={local.max_delta}
                    onChange={(e) => handleChange('max_delta', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Max Gamma</label>
                  <input
                    type="number"
                    value={local.max_gamma}
                    onChange={(e) => handleChange('max_gamma', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Max Vega</label>
                  <input
                    type="number"
                    value={local.max_vega}
                    onChange={(e) => handleChange('max_vega', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
              </div>
            </div>

            {/* Theta + Notifications */}
            <div>
              <h4 className="text-sm font-bold text-gray-300 mb-3">Theta & Notifications</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Max Theta</label>
                  <input
                    type="number"
                    value={local.max_theta}
                    onChange={(e) => handleChange('max_theta', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
                <div className="pt-2 space-y-3">
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={local.browser_notifications}
                      onChange={(e) => handleChange('browser_notifications', e.target.checked)}
                      className="accent-[#00C805]"
                    />
                    Browser Notifications
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={local.sound_alerts}
                      onChange={(e) => handleChange('sound_alerts', e.target.checked)}
                      className="accent-[#00C805]"
                    />
                    Sound Alerts
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
