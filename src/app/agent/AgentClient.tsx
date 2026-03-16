'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useVegaEdgeSession } from '@/hooks/useVegaEdgeSession';
import VoiceOrb from '@/components/agent/VoiceOrb';
import SignalPanel from '@/components/agent/SignalPanel';
import WatchlistTable from '@/components/agent/WatchlistTable';
import TranscriptPanel from '@/components/agent/TranscriptPanel';
import LiveChart from '@/components/LiveChart';
import type { AgentMode } from '@/hooks/useVegaEdgeSession';

export default function AgentClient() {
  const session = useVegaEdgeSession();
  const [textInput, setTextInput] = useState('');

  const handleModeChange = useCallback((newMode: AgentMode) => {
    if (session.listening) session.stopListening();
    session.setMode(newMode);
  }, [session]);

  const handleVoiceToggle = useCallback(() => {
    if (session.listening) {
      session.stopListening();
    } else {
      session.clearLiveText();
      session.startListening();
    }
  }, [session]);

  const handleStopSpeaking = useCallback(() => {
    session.stopSpeaking();
  }, [session]);

  const handleSend = useCallback(() => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    if (session.mode === 'chat') {
      session.sendChatMessage(trimmed);
    } else {
      session.sendText(trimmed);
    }
    setTextInput('');
  }, [textInput, session]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasData = session.chartData || session.signals.length > 0 || session.watchlistData;

  return (
    <main className="h-screen bg-[#1E1E1E] text-white flex flex-col overflow-hidden">
      {/* Top bar — minimal */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-500 hover:text-white transition-colors text-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-semibold tracking-tight">VegaEdge</h1>
              <span className={`w-1.5 h-1.5 rounded-full ${
                session.connected ? 'bg-[#00C805]' : 'bg-gray-500 animate-pulse'
              }`} />
            </div>
          </div>

          {/* Mode toggle — pill style */}
          <div className="flex items-center gap-0.5 bg-[#2D2D2D] rounded-full p-0.5">
            <button
              type="button"
              onClick={() => handleModeChange('chat')}
              className={`px-5 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                session.mode === 'chat'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('voice')}
              className={`px-5 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                session.mode === 'voice'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Voice
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 flex">
        {/* Center area */}
        <div className="flex-1 flex flex-col min-h-0">
          {session.mode === 'voice' ? (
            /* ---- VOICE MODE: Perplexity-style centered orb ---- */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Transcript — takes remaining space */}
              <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4">
                <div className="max-w-2xl mx-auto">
                  <TranscriptPanel
                    transcript={session.transcript}
                    liveUserText={session.liveUserText}
                    streamingModelText={session.streamingModelText}
                    isAgentThinking={session.isAgentThinking}
                    minimal
                  />
                </div>
              </div>

              {/* Voice orb — anchored at bottom */}
              <div className="flex-shrink-0 flex flex-col items-center pb-10 pt-6">
                <VoiceOrb
                  listening={session.listening}
                  isSpeaking={session.isSpeaking}
                  connected={session.connected}
                  onToggle={handleVoiceToggle}
                  onStop={handleStopSpeaking}
                />
                {session.liveUserText && (
                  <p className="mt-4 text-sm text-gray-400 max-w-md text-center italic">
                    &ldquo;{session.liveUserText}&rdquo;
                  </p>
                )}
                {session.error && (
                  <p className="mt-3 text-xs text-[#FF006E]">{session.error}</p>
                )}
              </div>
            </div>
          ) : (
            /* ---- CHAT MODE ---- */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Transcript */}
              <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4">
                <div className="max-w-2xl mx-auto">
                  <TranscriptPanel
                    transcript={session.transcript}
                    streamingModelText={session.streamingModelText}
                    isAgentThinking={session.isAgentThinking}
                  />
                </div>
              </div>

              {/* Chat input bar */}
              <div className="flex-shrink-0 px-6 pb-6 pt-3">
                <div className="max-w-2xl mx-auto">
                  <div className="flex items-center gap-2 bg-[#2D2D2D] rounded-2xl px-4 py-2 border border-white/5 focus-within:border-[#00C805]/30 transition-colors">
                    <input
                      type="text"
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask VegaEdge about any ticker..."
                      className="flex-1 bg-transparent text-white text-sm py-2 focus:outline-none placeholder-gray-500"
                      disabled={session.isAgentThinking || !session.connected}
                    />
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!textInput.trim() || session.isAgentThinking || !session.connected}
                      className="flex-shrink-0 w-8 h-8 rounded-full bg-[#00C805] hover:bg-[#00A004] disabled:bg-gray-600 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14" />
                        <path d="M12 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  {session.error && (
                    <p className="mt-2 text-xs text-[#FF006E] text-center">{session.error}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar — data panels (shown when data exists) */}
        {hasData && (
          <div className="hidden lg:flex flex-col w-[380px] flex-shrink-0 border-l border-white/5 overflow-y-auto p-4 space-y-4">
            {session.chartData && (
              <LiveChart
                data={session.chartData}
                ticker={session.chartTicker}
                history={session.chartHistory}
              />
            )}
            {session.signals.length > 0 && (
              <SignalPanel signals={session.signals} />
            )}
            {session.watchlistData && (
              <WatchlistTable
                data={session.watchlistData}
                summary={session.watchlistSummary}
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
