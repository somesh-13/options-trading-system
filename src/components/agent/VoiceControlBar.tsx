'use client';

import { useState, useEffect } from 'react';
import type { AgentMode } from '@/hooks/useVegaEdgeSession';
import ConnectionStatus from './ConnectionStatus';

interface VoiceControlBarProps {
  mode: AgentMode;
  connected: boolean;
  listening: boolean;
  error: string | null;
  liveUserText?: string;
  isAgentThinking?: boolean;
  isSpeechListening?: boolean;
  isSpeechSupported?: boolean;
  speechInterimText?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
  onSendText: (text: string) => void;
  onSendChatMessage: (text: string) => void;
  onMicPress: () => void;
  onMicRelease: () => void;
  onClearLiveText: () => void;
}

export default function VoiceControlBar({
  mode,
  connected,
  listening,
  error,
  liveUserText,
  isAgentThinking,
  isSpeechListening,
  isSpeechSupported,
  speechInterimText,
  onConnect,
  onDisconnect,
  onStartListening,
  onStopListening,
  onSendText,
  onSendChatMessage,
  onMicPress,
  onMicRelease,
  onClearLiveText,
}: VoiceControlBarProps) {
  const [textInput, setTextInput] = useState('');
  const [userEdited, setUserEdited] = useState(false);

  // When speech recognition produces interim text, show it in the input (chat mode)
  useEffect(() => {
    if (speechInterimText) {
      setTextInput(speechInterimText);
    }
  }, [speechInterimText]);

  // Sync liveUserText into input when in voice mode (unless user manually edited)
  useEffect(() => {
    if (mode === 'voice' && liveUserText && !userEdited) {
      setTextInput(liveUserText);
    }
  }, [liveUserText, userEdited, mode]);

  const handleSend = () => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    if (mode === 'chat') {
      onSendChatMessage(trimmed);
    } else {
      onSendText(trimmed);
    }
    setTextInput('');
    setUserEdited(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!connected) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onConnect}
            className="px-6 py-3 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors"
          >
            Connect to VegaEdge
          </button>
          <ConnectionStatus connected={connected} listening={listening} error={error} />
        </div>
        {error && <p className="text-[#FF006E] text-sm mt-3">{error}</p>}
      </div>
    );
  }

  // Chat mode: WhatsApp-style input bar
  if (mode === 'chat') {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-3">
        <div className="flex items-center gap-2">
          {/* Mic button for speech-to-text */}
          <button
            type="button"
            onClick={isSpeechListening ? onMicRelease : onMicPress}
            disabled={!isSpeechSupported}
            className={`relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              isSpeechListening
                ? 'bg-[#FF006E] text-white'
                : isSpeechSupported
                  ? 'bg-[#3D3D3D] hover:bg-[#4D4D4D] text-gray-300'
                  : 'bg-[#2A2A2A] text-gray-600 cursor-not-allowed'
            }`}
            title={!isSpeechSupported ? 'Speech recognition not supported in this browser' : isSpeechListening ? 'Stop recording' : 'Voice input'}
          >
            {isSpeechListening && (
              <span
                className="absolute inset-0 rounded-full border-2 border-[#FF006E]"
                style={{ animation: 'pulse-ring 1.5s ease-out infinite' }}
              />
            )}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>

          {/* Text input */}
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isSpeechListening ? 'Listening...' : 'Ask VegaEdge about any ticker...'}
            className="flex-1 bg-[#1E1E1E] text-white px-4 py-2.5 rounded-lg border border-gray-600 focus:border-[#00C805] focus:outline-none text-sm placeholder-gray-500"
            disabled={isAgentThinking}
          />

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!textInput.trim() || isAgentThinking}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-[#00C805] hover:bg-[#00A004] disabled:bg-gray-600 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>

          {/* Disconnect */}
          <button
            type="button"
            onClick={onDisconnect}
            className="flex-shrink-0 px-3 py-2 bg-[#3D3D3D] hover:bg-[#444] text-gray-400 rounded-lg transition-colors text-xs"
            title="Disconnect"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error && <p className="text-[#FF006E] text-sm mt-2">{error}</p>}
      </div>
    );
  }

  // Voice mode: WhatsApp-style input bar with auto-transcription
  const handleStartListening = () => {
    setTextInput('');
    setUserEdited(false);
    onClearLiveText();
    onStartListening();
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-3">
      <div className="flex items-center gap-2">
        {/* Mic button */}
        <button
          type="button"
          onClick={listening ? onStopListening : handleStartListening}
          className={`relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
            listening
              ? 'bg-[#FF006E] text-white'
              : 'bg-[#3D3D3D] hover:bg-[#4D4D4D] text-gray-300'
          }`}
          title={listening ? 'Stop recording' : 'Start recording'}
        >
          {listening && (
            <span
              className="absolute inset-0 rounded-full border-2 border-[#FF006E]"
              style={{ animation: 'pulse-ring 1.5s ease-out infinite' }}
            />
          )}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>

        {/* Text input with recording dot */}
        <div className="flex-1 relative">
          {listening && liveUserText && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 flex h-2 w-2 shrink-0 z-10">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
          )}
          <input
            type="text"
            value={textInput}
            onChange={(e) => {
              setTextInput(e.target.value);
              setUserEdited(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={listening ? 'Listening...' : 'Edit transcription or type a message...'}
            className={`w-full bg-[#1E1E1E] text-white py-2.5 rounded-lg border focus:border-[#00C805] focus:outline-none text-sm placeholder-gray-500 ${
              listening && liveUserText ? 'pl-8 pr-4 border-[#00C805]/30' : 'px-4 border-gray-600'
            }`}
          />
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!textInput.trim()}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-[#00C805] hover:bg-[#00A004] disabled:bg-gray-600 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>

        {/* Disconnect */}
        <button
          type="button"
          onClick={onDisconnect}
          className="flex-shrink-0 px-3 py-2 bg-[#3D3D3D] hover:bg-[#444] text-gray-400 rounded-lg transition-colors text-xs"
          title="Disconnect"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {error && <p className="text-[#FF006E] text-sm mt-2">{error}</p>}
    </div>
  );
}
