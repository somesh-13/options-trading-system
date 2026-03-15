'use client';

import { useState } from 'react';
import ConnectionStatus from './ConnectionStatus';

interface VoiceControlBarProps {
  connected: boolean;
  listening: boolean;
  error: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
  onSendText: (text: string) => void;
}

export default function VoiceControlBar({
  connected,
  listening,
  error,
  onConnect,
  onDisconnect,
  onStartListening,
  onStopListening,
  onSendText,
}: VoiceControlBarProps) {
  const [textInput, setTextInput] = useState('');

  const handleSend = () => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    onSendText(trimmed);
    setTextInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-4">
        {/* Left: buttons */}
        <div className="flex items-center gap-3">
          {!connected ? (
            <button
              type="button"
              onClick={onConnect}
              className="px-6 py-3 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors"
            >
              Connect to VegaEdge
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={listening ? onStopListening : onStartListening}
                className="relative px-6 py-3 rounded-lg font-bold transition-colors text-white"
                style={{ backgroundColor: listening ? '#FF006E' : '#3D3D3D' }}
              >
                {listening && (
                  <span
                    className="absolute inset-0 rounded-lg border-2 border-[#FF006E]"
                    style={{ animation: 'pulse-ring 1.5s ease-out infinite' }}
                  />
                )}
                {listening ? 'Stop Mic' : 'Start Mic'}
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                className="px-4 py-3 bg-[#3D3D3D] hover:bg-[#444] text-gray-300 rounded-lg transition-colors text-sm"
              >
                Disconnect
              </button>
            </>
          )}
        </div>

        {/* Center: status */}
        <ConnectionStatus connected={connected} listening={listening} error={error} />

        {/* Right: text input */}
        {connected && (
          <div className="flex-1 min-w-[200px] flex items-center gap-2 ml-auto">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask VegaEdge about any ticker..."
              className="flex-1 bg-[#1E1E1E] text-white px-4 py-2.5 rounded-lg border border-gray-600 focus:border-[#00C805] focus:outline-none text-sm placeholder-gray-500"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!textInput.trim()}
              className="px-4 py-2.5 bg-[#00C805] hover:bg-[#00A004] disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
            >
              Send
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-[#FF006E] text-sm mt-3">{error}</p>}
    </div>
  );
}
